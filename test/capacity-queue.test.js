import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { capacityRuleIdentity, classifyBacklog, validateQueueCapacityProtocol, assertCapacityRuleLaunchReady } from '../src/experiment/capacity-queue.js';
import { evaluatePilotRun, makePilotBatch, nextPilotStep } from '../src/experiment/pilot.js';
import { pilotTimingForPhase } from '../src/experiment/pilot-timing.js';
import { executePilotSession, newPilotState, assertPilotCanStart, assertPilotEvidence } from '../src/experiment/pilot-session.js';

const protocol = JSON.parse(readFileSync(new URL('../config/capacity-queue-pair-protocol.json', import.meta.url)));
const observationProtocol = JSON.parse(readFileSync(new URL('../config/queue-observation-pair-protocol.json', import.meta.url)));
const iso = s => new Date(Date.UTC(2026, 8, 21) + s * 1000).toISOString();
function evidence(boundaries = Array(8).fill(0), conditionId = 'R-A', policy = protocol) {
  const seconds = boundaries.length * 30, transfers = [], pending = [];
  const add = at => {
    const t = { transferId: `t${transfers.length}`, receivedAt: iso(at), terminalAt: null,
      terminalState: 'FULFILLED', correct: true, timingComplete: true };
    transfers.push(t); return t;
  };
  boundaries.forEach((b, i) => {
    add(i * 30 + 1).terminalAt = iso(i * 30 + 2);
    while (pending.length < b) pending.push(add(i * 30 + 1));
    while (pending.length > b) pending.shift().terminalAt = iso(i * 30 + 2);
  });
  pending.forEach(t => { t.terminalAt = iso(seconds + 1); });
  const phase = boundaries.length === 8 ? 'screening' : 'confirmation';
  return { manifest: { run: { phase, conditionId, offeredRate: 4, faultScenario: 'none' },
    study: { pilotProtocolId: policy.protocolId, capacityRule: capacityRuleIdentity(policy) },
    deepDiagnostics: { enabled: true }, lifecycle: pilotTimingForPhase(policy, phase) },
    qualification: { valid: true, status: 'QUALIFIED', safety: { passed: true }, gates: { offeredLoadDelivered: true },
      performance: { workloadCheckRate: 1, terminalCallbacksComplete: true } },
    telemetry: { transfers_pending: 0, transfers_failed: 0 }, cleanup: { passed: true },
    databaseDiagnostics: { schemaVersion: 1, enabled: true, recordingErrors: 0, overwrittenSamples: 0, truncatedActivitySamples: 0,
      settings: { version: '170000', track_io_timing: 'on', track_wal_io_timing: 'on', track_activities: 'on' },
      samples: [1, 2].map(() => ({ counters: { wal: {}, checkpointer: {}, io: [] } })) },
    resourceJsonl: [1, 2].map(() => JSON.stringify({ linuxDiagnostics: { valid: true } })).join('\n'),
    outcomes: { schemaVersion: 2, measurementStart: iso(0), measurementEnd: iso(seconds), observationEnd: iso(seconds + 2),
      measurementSeconds: seconds, timingCompletenessRatio: 1, unplaceableTransfers: 0, windowSeconds: 30,
      transfers, terminalCounts: { total: transfers.length, completed: transfers.length, failed: 0, pendingAfterDrain: 0 },
      windowSeries: boundaries.map((b, i) => ({ complete: true, underLoad: true, startAt: iso(i * 30), endAt: iso((i + 1) * 30), backlogAtEnd: b, p95DurableCompletionMs: i === 7 ? 100000 : 50 })) } };
}

const cases = [
  ['flat', [0,0,0,0,0,0,0,0], 'SUSTAINED'],
  ['constant nonzero', [3,3,3,3,3,3,3,3], 'SUSTAINED'],
  ['early cleared burst', [3,2,1,0,0,0,0,0], 'SUSTAINED'],
  ['steady growth', [1,2,3,4,5,6,7,8], 'NOT_SUSTAINED_QUEUE_GROWTH'],
  ['late burst', [0,0,0,0,0,0,0,1], 'INCONCLUSIVE'],
  ['alternating falling phase', [2,1,2,1,2,1,2,1], 'SUSTAINED'],
  ['alternating rising phase', [1,2,1,2,1,2,1,2], 'INCONCLUSIVE'],
  ['growth then clearance', [1,2,3,4,5,6,0,0], 'INCONCLUSIVE'],
  ['late low-rate accumulation', [0,0,0,0,0,1,1,1], 'INCONCLUSIVE']
];
for (const [label, b, expected] of cases) test(`queue rule: ${label}, same result for REST/Kafka`, () => {
  assert.equal(classifyBacklog(b).status, expected);
  for (const condition of ['R-A', 'K-A']) assert.equal(evaluatePilotRun(evidence(b, condition), protocol).status, expected);
});
test('full measurement uses 20 windows and reports drain completions without erasing under-load growth', () => {
  const result = evaluatePilotRun(evidence(Array.from({ length: 20 }, (_, i) => i + 1)), protocol);
  assert.equal(result.status, 'NOT_SUSTAINED_QUEUE_GROWTH'); assert.equal(result.windows.length, 20);
});
test('stress: finite bounded oscillations may be inconclusive; long monotone growth never passes', () => {
  let inconclusive = 0;
  for (const length of [8, 20, 60, 120]) {
    assert.equal(classifyBacklog(Array.from({ length }, (_, i) => i)).status, 'NOT_SUSTAINED_QUEUE_GROWTH');
    assert.equal(classifyBacklog(Array(length).fill(10)).status, 'SUSTAINED');
    for (const period of [2, 4, 8, 16, 32]) for (let shift = 0; shift < period; shift++) {
      const b = Array.from({ length }, (_, i) => Math.round(10 + 5 * Math.sin(2 * Math.PI * (i + shift) / period)));
      if (classifyBacklog(b).status === 'INCONCLUSIVE') inconclusive++;
      // Do not assert bounded series can never fail: a finite rising arc can
      // look identical to genuine accumulation. Report, do not tune to pass it.
    }
  }
  assert.ok(inconclusive > 0);
});
test('smallest positive exact slope is not rounded down to a pass', () => {
  assert.equal(classifyBacklog([0,0,0,0,0,0,0,1]).whole.sign, 1);
  assert.throws(() => classifyBacklog([0,0,0,0,0,.1]));
});
test('known bounded oscillation exposes scientific validation blocker; launch stays disabled', () => {
  // A period-32-window queue never leaves [5, 15], yet this ten-minute slice
  // satisfies all three growth criteria. Preserve this counterexample.
  const b = [11,10,9,8,7,6,6,5,5,5,5,5,6,6,7,8,9,10,11,12];
  assert.equal(classifyBacklog(b).status, 'NOT_SUSTAINED_QUEUE_GROWTH');
  assert.equal(evaluatePilotRun(evidence(b), protocol).status, 'NOT_SUSTAINED_QUEUE_GROWTH');
  assert.throws(() => assertCapacityRuleLaunchReady(capacityRuleIdentity(protocol)), /bounded-oscillation/);
});
for (const [name, mutate] of [
  ['missing window', d => d.outcomes.windowSeries.splice(2, 1)],
  ['gap', d => { d.outcomes.windowSeries[2].startAt = iso(61); }],
  ['fabricated backlog', d => { d.outcomes.windowSeries[2].backlogAtEnd = 1; }],
  ['incomplete timing', d => { d.outcomes.timingCompletenessRatio = .999; }],
  ['missing terminal timestamp', d => { d.outcomes.transfers[0].terminalAt = null; }],
  ['missing arrival', d => { delete d.outcomes.transfers[0].receivedAt; }],
  ['generator dropped/shortfall', d => { d.qualification.gates.offeredLoadDelivered = false; }],
  ['bad diagnostics', d => { d.databaseDiagnostics.recordingErrors = 1; }],
  ['missing diagnostics', d => { delete d.databaseDiagnostics; }],
  ['wrong rule', d => { d.manifest.study.capacityRule.version = 'unknown'; }],
  ['changed policy hash', d => { d.manifest.study.capacityRule.policySha256 = 'changed'; }],
  ['wrong actual clock', d => { d.outcomes.measurementEnd = iso(600); }],
  ['short/full confusion', d => { d.manifest.run.phase = 'confirmation'; }],
  ['unqualified evidence', d => { d.qualification.valid = false; }]
]) test(`invalid evidence cannot be an overload boundary: ${name}`, () => {
  const d = evidence(); mutate(d);
  assert.equal(evaluatePilotRun(d, protocol).status, 'INVALID_OR_HARNESS_LIMIT');
});
test('correctness and safety are independent from a shrinking queue', () => {
  const d = evidence([3,2,1,0,0,0,0,0]);
  d.outcomes.transfers[0].terminalState = 'FAILED'; d.outcomes.transfers[0].correct = false;
  d.outcomes.terminalCounts.failed = 1; d.telemetry.transfers_failed = 1;
  assert.equal(evaluatePilotRun(d, protocol).status, 'NOT_CORRECTLY_SUSTAINED');
  d.qualification.safety.passed = false;
  assert.equal(evaluatePilotRun(d, protocol).status, 'SAFETY_FAILURE');
});
test('missing callbacks and pending work fail correctness, not automatically queue growth', () => {
  const d = evidence(); d.qualification.performance.terminalCallbacksComplete = false;
  assert.equal(evaluatePilotRun(d, protocol).status, 'NOT_CORRECTLY_SUSTAINED');
  const pending = evidence([1,1,1,1,1,1,1,1]);
  const t = pending.outcomes.transfers.find(t => t.terminalAt === iso(241));
  t.terminalAt = null; t.terminalState = 'PREPARED'; t.correct = false;
  pending.telemetry.transfers_pending = 1; pending.outcomes.terminalCounts.pendingAfterDrain = 1;
  assert.equal(evaluatePilotRun(pending, protocol).status, 'NOT_CORRECTLY_SUSTAINED');
});
test('HTTP check boundary is inclusive and agrees with the k6 expression', () => {
  for (const [rate, status] of [[.994999, 'NOT_CORRECTLY_SUSTAINED'], [.995, 'SUSTAINED'], [.995001, 'SUSTAINED']]) {
    const d = evidence(); d.qualification.performance.workloadCheckRate = rate;
    assert.equal(evaluatePilotRun(d, protocol).status, status);
  }
  assert.match(readFileSync(new URL('../infra/k6/load.js', import.meta.url), 'utf8'), /checks: \['rate>=0\.995'\]/);
});
test('policy hash is stable across object key order; unknown versions and scope expansions are rejected', () => {
  assert.deepEqual(capacityRuleIdentity(protocol), capacityRuleIdentity(Object.fromEntries(Object.entries(protocol).reverse())));
  for (const change of [p => p.maximumRuns++, p => p.maximumRate++, p => p.deepDiagnostics = false, p => p.ruleVersion = 'v2']) {
    const p = structuredClone(protocol); change(p); assert.throws(() => validateQueueCapacityProtocol(p));
  }
  assert.throws(() => makePilotBatch({ phase: 'fault', rate: 4, repetitions: 1 }, protocol, 1));
  assert.throws(() => makePilotBatch(nextPilotStep([], protocol), protocol, 2));
});

async function session({ fault, pause = false, policy = protocol } = {}) {
  const state = newPilotState(), files = new Map(), data = new Map(), cleanup = [];
  let clock = Date.parse(iso(0)), request = null;
  const io = { save: () => {}, log: () => {}, write: (k, v) => files.set(k, structuredClone(v)), readPauseRequest: () => request,
    readEvidence: id => data.get(id), runExists: id => data.has(id) };
  const result = await executePilotSession({ state, protocol: policy, now: () => clock, pid: 123, io,
    prepare: () => {}, check: () => {},
    runTrial: async (_, run, sessionId) => {
      clock += 360000;
      const d = evidence(Array(8).fill(0), run.conditionId, policy);
      d.manifest.run = run; d.manifest.pilotSessionId = sessionId;
      d.manifest.checksums = { sourceSnapshotSha256: 'source', frozenComposeSha256: 'compose' };
      if (fault) fault(d);
      data.set(run.runId, d);
      if (pause) request = { mode: 'after-pair', sessionId, controllerPid: 123 };
      return { code: 0 };
    }, cleanup: () => { cleanup.push('cleanup'); return { passed: true }; }, restore: () => { cleanup.push('restore'); return []; } });
  return { state, result, files, data, cleanup, io };
}
test('approved scope stops after exactly two, cleans/restores, never schedules a third', async () => {
  const f = await session();
  assert.equal(f.result.status, 'SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED'); assert.equal(f.result.failed, false);
  assert.equal(f.state.records.length, 2); assert.equal(f.state.batches.length, 1);
  assert.deepEqual(new Set(f.state.records.map(r => r.conditionId)), new Set(['R-A', 'K-A']));
  assert.deepEqual(f.cleanup, ['cleanup', 'restore']); assert.ok(f.state.sessions[0].endedAt);
  assert.throws(() => assertPilotCanStart(f.state, { resume: true }));
});
test('pause request during first run finishes the pair, then ends at the approved review gate', async () => {
  const f = await session({ pause: true });
  assert.equal(f.result.status, 'SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED'); assert.equal(f.state.records.length, 2);
});
test('performance failure is retained and paired; safety/invalid evidence stops immediately', async () => {
  const failure = await session({ fault: d => { d.qualification.performance.workloadCheckRate = .5; } });
  assert.equal(failure.state.records.length, 2);
  assert.ok(failure.state.records.every(r => r.stability.status === 'NOT_CORRECTLY_SUSTAINED'));
  for (const fault of [d => { d.qualification.safety.passed = false; }, d => { d.outcomes.timingCompletenessRatio = .99; }]) {
    const f = await session({ fault }); assert.equal(f.result.status, 'REVIEW_REQUIRED'); assert.equal(f.state.records.length, 1);
    assert.deepEqual(f.cleanup, ['cleanup', 'restore']);
  }
});
test('checkpoint verification calls the same rule and rejects altered rule hashes/evidence', async () => {
  const f = await session();
  const verify = () => assertPilotEvidence({ state: f.state, protocol, freeze: { sourceSha256: 'source', frozenComposeSha256: 'compose' },
    readBatch: file => f.files.get(file), readEvidence: f.io.readEvidence });
  assert.doesNotThrow(verify);
  f.state.records[0].stability.rule.policySha256 = 'changed'; assert.throws(verify, /not resumable/);
});

test('approved descriptive rule launches only with its exact policy identity; v1 stays held', () => {
  assert.doesNotThrow(() => assertCapacityRuleLaunchReady(capacityRuleIdentity(observationProtocol)));
  assert.throws(() => assertCapacityRuleLaunchReady(capacityRuleIdentity(protocol)), /blocked/);
  for (const change of [p => p.maximumRuns++, p => p.startRate++, p => p.deepDiagnostics = false,
    p => p.observation.automaticBoundaryDecision = 'PASS', p => p.queueRole = 'CAPACITY_PASS']) {
    const p = structuredClone(observationProtocol); change(p);
    assert.throws(() => validateQueueCapacityProtocol(p));
    assert.throws(() => assertCapacityRuleLaunchReady(capacityRuleIdentity(p)), /blocked/);
  }
});
test('all valid queue shapes and latency spikes are descriptions, never capacity pass/fail', () => {
  for (const [, b] of cases) for (const condition of ['R-A', 'K-A']) {
    const result = evaluatePilotRun(evidence(b, condition, observationProtocol), observationProtocol);
    assert.equal(result.status, 'OBSERVATION_RECORDED');
    assert.equal('stable' in result, false); assert.equal(result.capacityEstablished, false);
    assert.equal(result.automaticBoundaryDecision, null); assert.equal(result.queue.automaticBoundaryDecision, null);
  }
});
test('descriptive observation still fails closed for eligibility and correctness', () => {
  for (const mutate of [d => d.outcomes.timingCompletenessRatio = .99, d => d.outcomes.windowSeries.pop(),
    d => d.databaseDiagnostics.recordingErrors++, d => d.qualification.gates.offeredLoadDelivered = false,
    d => d.manifest.study.capacityRule.policySha256 = 'changed', d => d.manifest.run.offeredRate = 8]) {
    const d = evidence(Array(8).fill(0), 'R-A', observationProtocol); mutate(d);
    assert.equal(evaluatePilotRun(d, observationProtocol).status, 'INVALID_OR_HARNESS_LIMIT');
  }
  for (const mutate of [d => d.qualification.performance.workloadCheckRate = .994, d => d.telemetry.transfers_failed++,
    d => d.telemetry.transfers_pending++, d => d.qualification.performance.terminalCallbacksComplete = false]) {
    const d = evidence(Array(8).fill(0), 'R-A', observationProtocol); mutate(d);
    assert.equal(evaluatePilotRun(d, observationProtocol).status, 'CORRECTNESS_REVIEW_REQUIRED');
  }
});
test('approved descriptive pair stops after exactly two and cannot resume into escalation', async () => {
  const f = await session({ policy: observationProtocol, pause: true });
  assert.equal(f.result.status, 'SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED'); assert.equal(f.state.records.length, 2);
  assert.ok(f.state.records.every(r => r.stability.status === 'OBSERVATION_RECORDED' && !('stable' in r.stability)));
  assert.equal(f.state.capacityDecision.capacityEstablished, false);
  assert.deepEqual(f.cleanup, ['cleanup', 'restore']); assert.throws(() => assertPilotCanStart(f.state, { resume: true }));
});
test('descriptive correctness failure stops immediately but retains its evidence and cleans up', async () => {
  const f = await session({ policy: observationProtocol, fault: d => { d.telemetry.transfers_failed = 1; } });
  assert.equal(f.result.status, 'REVIEW_REQUIRED'); assert.equal(f.state.records.length, 1);
  assert.equal(f.state.records[0].stability.status, 'CORRECTNESS_REVIEW_REQUIRED');
  assert.deepEqual(f.cleanup, ['cleanup', 'restore']);
});
test('approved descriptive checkpoint reproduces the same decision and rejects tampering', async () => {
  const f = await session({ policy: observationProtocol });
  const verify = () => assertPilotEvidence({ state: f.state, protocol: observationProtocol,
    freeze: { sourceSha256: 'source', frozenComposeSha256: 'compose' }, readBatch: name => f.files.get(name), readEvidence: f.io.readEvidence });
  assert.doesNotThrow(verify);
  f.state.records[0].stability.queue.status = 'CAPACITY_PASS'; assert.throws(verify, /not resumable/);
});
