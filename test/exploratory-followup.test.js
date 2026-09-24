import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exploratoryProtocols, approvedObservationProtocol, approvedObservationProtocols, IMPLEMENTATION_REBUILD_STAGES, rebuildsImplementation } from '../src/experiment/queue-observation.js';
import { capacityRuleIdentity, assertCapacityRuleLaunchReady, validateQueueCapacityProtocol, assertObservationBatchScope } from '../src/experiment/capacity-queue.js';
import { evaluatePilotRun, nextPilotStep, makePilotBatch } from '../src/experiment/pilot.js';
import { pilotTimingForPhase } from '../src/experiment/pilot-timing.js';
import { executePilotSession, newPilotState, assertPilotEvidence, assertPilotCanStart } from '../src/experiment/pilot-session.js';
import { assertPredecessorReview, assertExploratoryRootReview } from '../src/experiment/exploratory-review.js';
import { sourceFiles } from '../src/experiment/provenance.js';

const iso = s => new Date(Date.UTC(2026, 8, 21) + s * 1000).toISOString();
const lifecycle = p => ({ ...pilotTimingForPhase(p, p.exploratoryPair.phase), faultAtSeconds: p.faults.atSeconds,
  adapterCrashSeconds: p.faults.adapterCrashSeconds, databaseFaultSeconds: p.faults.databaseDelaySeconds, databaseLatencyMs: p.faults.databaseLatencyMs });
function evidence(p, run = makePilotBatch(nextPilotStep([], p), p, 1).runs[0]) {
  const fault = run.phase === 'fault', seconds = fault ? 600 : 240, clear = run.faultScenario === 'adapter-crash' ? 271 : 301;
  const transfers = Array.from({ length: seconds / 30 }, (_, i) => ({ transferId: `t${i}`, receivedAt: iso(i * 30 + 1),
    terminalAt: iso(i * 30 + 2), terminalState: 'FULFILLED', correct: true, timingComplete: true }));
  return { manifest: { run, lifecycle: lifecycle(p), pilotSessionId: 'session',
    study: { pilotProtocolId: p.protocolId, capacityRule: capacityRuleIdentity(p) }, deepDiagnostics: { enabled: true },
    checksums: { sourceSnapshotSha256: 'source', frozenComposeSha256: 'compose' } },
    qualification: { valid: true, status: 'QUALIFIED', safety: { passed: true },
      gates: { offeredLoadDelivered: true, faultEvidenceComplete: true }, performance: { workloadCheckRate: 1, terminalCallbacksComplete: true } },
    telemetry: { transfers_pending: 0, transfers_failed: 0 }, cleanup: { passed: true },
    databaseDiagnostics: { schemaVersion: 1, enabled: true, recordingErrors: 0, overwrittenSamples: 0, truncatedActivitySamples: 0,
      settings: { version: '170000', track_io_timing: 'on', track_wal_io_timing: 'on', track_activities: 'on' },
      samples: [1, 2].map(() => ({ counters: { wal: {}, checkpointer: {}, io: [] } })) },
    resourceJsonl: [1, 2].map(() => JSON.stringify({ linuxDiagnostics: { valid: true } })).join('\n'),
    ...(fault ? { fault: { scenario: run.faultScenario, completed: true, scheduledAtMeasurementSecond: 240,
      requestedAt: iso(240), injectedAt: iso(241), clearedAt: iso(clear) } } : {}),
    outcomes: { schemaVersion: 2, measurementStart: iso(0), measurementEnd: iso(seconds), observationEnd: iso(seconds + 2),
      measurementSeconds: seconds, timingCompletenessRatio: 1, unplaceableTransfers: 0, windowSeconds: 30, transfers,
      terminalCounts: { total: transfers.length, completed: transfers.length, failed: 0, pendingAfterDrain: 0 },
      windowSeries: transfers.map((_, i) => ({ complete: true, underLoad: true, startAt: iso(i * 30), endAt: iso((i + 1) * 30), backlogAtEnd: 0, p95DurableCompletionMs: i % 2 ? 10000 : 50 })),
      faultAnalysis: fault ? { scenario: run.faultScenario, injectedAt: iso(241), clearedAt: iso(clear), baseline: { windows: 3 },
        recoveryCensored: false, backlogClearanceCensored: false, recoveryTimeSeconds: 119, backlogClearanceSeconds: 59 } : null } };
}

for (const p of exploratoryProtocols) {
  const key = p.exploratoryPair.key;
  test(`${key}: exact fixed-rate pair, deterministic matched seed, correct duration, no third run`, () => {
    validateQueueCapacityProtocol(p); assert.equal(assertCapacityRuleLaunchReady(capacityRuleIdentity(p)), p);
    const step = nextPilotStep([], p), batch = makePilotBatch(step, p, 1);
    assert.deepEqual(makePilotBatch(step, p, 1), batch);
    assert.equal(assertObservationBatchScope(batch, lifecycle(p), true), p);
    assert.equal(batch.runs.length, 2); assert.equal(batch.runs[0].randomSeed, batch.runs[1].randomSeed);
    assert.ok(batch.runs.every(r => r.offeredRate === p.exploratoryPair.rate && r.faultScenario === p.exploratoryPair.faultScenario));
    assert.throws(() => makePilotBatch(step, p, 2));
    const records = batch.runs.map(run => ({ conditionId: run.conditionId, phase: run.phase, rate: run.offeredRate,
      faultScenario: run.faultScenario, stability: evaluatePilotRun(evidence(p, run), p) }));
    assert.match(nextPilotStep(records, p).action, /PAIR_COMPLETE_REVIEW_REQUIRED/);
    assert.throws(() => nextPilotStep([...records, records[0]], p));
    for (const r of records) { assert.equal(r.stability.status, 'OBSERVATION_RECORDED'); assert.equal('stable' in r.stability, false); }
  });
  test(`${key}: rate, fault, timing, diagnostics and policy changes cannot bypass launch scope`, () => {
    const batch = makePilotBatch(nextPilotStep([], p), p, 1);
    for (const mutate of [b => b.runs[0].offeredRate++, b => b.runs[0].faultScenario = 'other', b => b.runs[0].phase = 'confirmation',
      b => b.runs[0].randomSeed = 'other', b => b.protocolId = 'other', b => b.runs[1].runId = b.runs[0].runId,
      b => b.runs[0].repetition++, b => b.runs[0].sequence++, b => b.expectedRunCount++]) {
      const b = structuredClone(batch); mutate(b); assert.throws(() => assertObservationBatchScope(b, lifecycle(p), true));
    }
    assert.throws(() => assertObservationBatchScope(batch, { ...lifecycle(p), measurementDuration: '30s' }, true));
    assert.throws(() => assertObservationBatchScope(batch, lifecycle(p), false));
    for (const mutate of [v => v.maximumRuns++, v => v.maximumRate++, v => v.exploratoryPair.rate++, v => v.faults.atSeconds++]) {
      const v = structuredClone(p); mutate(v); assert.throws(() => validateQueueCapacityProtocol(v)); assert.throws(() => assertCapacityRuleLaunchReady(capacityRuleIdentity(v)));
    }
  });
}
for (const p of exploratoryProtocols.filter(p => p.exploratoryPair.phase === 'fault')) {
  test(`${p.exploratoryPair.key}: actual injection, clearance and manifest settings are required`, () => {
    for (const mutate of [d => delete d.fault, d => d.fault.completed = false, d => d.fault.scenario = 'other',
      d => d.fault.requestedAt = iso(239), d => d.fault.clearedAt = iso(250), d => d.fault.clearedAt = iso(610),
      d => d.outcomes.faultAnalysis = null, d => d.outcomes.faultAnalysis.baseline.windows = 2,
      d => d.manifest.lifecycle.databaseLatencyMs = 1, d => d.qualification.gates.faultEvidenceComplete = false]) {
      const d = evidence(p); mutate(d); assert.equal(evaluatePilotRun(d, p).status, 'INVALID_OR_HARNESS_LIMIT');
    }
    assert.throws(() => assertObservationBatchScope(makePilotBatch(nextPilotStep([], p), p, 1), { ...lifecycle(p), faultAtSeconds: 1 }, true));
  });
  test(`${p.exploratoryPair.key}: censoring is descriptive, while failed transfers still stop for correctness review`, () => {
    const d = evidence(p); d.qualification.status = 'CENSORED';
    Object.assign(d.outcomes.faultAnalysis, { recoveryCensored: true, recoveryTimeSeconds: null, recoveryObservationSeconds: 299 });
    const result = evaluatePilotRun(d, p);
    assert.equal(result.status, 'OBSERVATION_RECORDED'); assert.equal(result.fault.recoveryTimeSeconds, null);
    assert.equal(result.fault.recoveryCensored, true); assert.equal(result.queue.role, p.queueRole);
    d.telemetry.transfers_failed = 1; assert.equal(evaluatePilotRun(d, p).status, 'CORRECTNESS_REVIEW_REQUIRED');
    d.qualification.safety.passed = false; assert.equal(evaluatePilotRun(d, p).status, 'SAFETY_FAILURE');
  });
}
async function session(p, mutate = () => {}) {
  const state = newPilotState(), files = new Map(), data = new Map(), actions = [];
  let clock = Date.parse(iso(0)), request;
  const io = { save() {}, log() {}, write: (k, v) => files.set(k, structuredClone(v)), readPauseRequest: () => request,
    readEvidence: id => data.get(id), runExists: id => data.has(id) };
  await executePilotSession({ state, protocol: p, now: () => clock, pid: 123, io, prepare() {}, check() {},
    runTrial: async (_, run, sessionId) => { clock += 360000; const d = evidence(p, run); d.manifest.pilotSessionId = sessionId;
      mutate(d); data.set(run.runId, d); request = { mode: 'after-pair', sessionId, controllerPid: 123 }; return { code: 0 }; },
    cleanup: () => { actions.push('cleanup'); return { passed: true }; }, restore: () => { actions.push('restore'); return []; } });
  return { state, files, data, actions, io };
}
test('all three stages stop after their pair; faults are assessed live and re-evaluated at review', async () => {
  for (const p of exploratoryProtocols) {
    const f = await session(p);
    assert.match(f.state.status, /PAIR_COMPLETE_REVIEW_REQUIRED/); assert.equal(f.state.records.length, 2);
    assert.deepEqual(f.actions, ['cleanup', 'restore']); assert.ok(f.state.pauseRequested);
    assert.throws(() => assertPilotCanStart(f.state, { resume: true }));
    const verify = () => assertPilotEvidence({ state: f.state, protocol: p, freeze: { sourceSha256: 'source', frozenComposeSha256: 'compose' },
      readBatch: name => f.files.get(name), readEvidence: f.io.readEvidence });
    verify(); f.state.records[0].stability.checks.noFailedTransfers = false; assert.throws(verify);
  }
});
test('each stage retains a correctness failure, stops immediately and restores services', async () => {
  for (const p of exploratoryProtocols) {
    const f = await session(p, d => d.telemetry.transfers_failed = 1);
    assert.equal(f.state.status, 'REVIEW_REQUIRED'); assert.equal(f.state.records.length, 1);
    assert.deepEqual(f.actions, ['cleanup', 'restore']);
  }
});
test('review is required before any new stage; every imported protocol is part of source provenance', () => {
  for (const p of exploratoryProtocols) {
    assert.throws(() => assertPredecessorReview(p, null));
    assert.throws(() => assertPredecessorReview(p, { decision: 'APPROVED_NEXT_EXPLORATORY_PAIR', note: 'review', nextProtocolId: p.protocolId, currentSourceSha256: 'changed' }));
    assert.throws(() => assertExploratoryRootReview('/tmp/unapproved-root', p, {}));
    assert.ok(sourceFiles().includes(`config/exploratory-${p.exploratoryPair.key}-protocol.json`));
  }
  assert.equal(capacityRuleIdentity(approvedObservationProtocol).policySha256, '7e62524653ad6db2a9fa3156b8825eb1a03b0480c2f35a50c6ad25c49eefdf1c');
  const old = JSON.parse(readFileSync('config/capacity-queue-pair-protocol.json'));
  assert.throws(() => assertCapacityRuleLaunchReady(capacityRuleIdentity(old)), /blocked/);
});

test('direct experiment execution cannot expand a permitted rule identity or bypass prerequisite review', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'exploratory-guard-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const p of exploratoryProtocols) {
    const file = path.join(root, `${p.exploratoryPair.key}.json`), target = path.join(root, 'uncreated');
    const batch = makePilotBatch(nextPilotStep([], p), p, 1), timing = lifecycle(p);
    for (const changed of [true, false]) {
      const b = structuredClone(batch); if (changed) b.runs[0].offeredRate++;
      writeFileSync(file, JSON.stringify(b));
      const before = readdirSync(root).sort();
      const r = spawnSync(process.execPath, ['scripts/run-experiment.mjs', '--execute', '--pilot-spec', file, '--results', target],
        { encoding: 'utf8', env: { ...process.env, PATH: '', DEEP_DIAGNOSTICS: 'true', WARMUP_DURATION: timing.warmupDuration, MEASUREMENT_DURATION: timing.measurementDuration } });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, changed ? /differs from its approved/ : /ENOENT/);
      assert.deepEqual(readdirSync(root).sort(), before);
    }
  }
});

test('realized architecture order is a documented function of each stage seed; new fault stages run Kafka first', () => {
  const expectedFirst = { 'screening-r8': 'R-A', 'adapter-r4': 'R-A', 'database-r4': 'R-A', 'adapter-k4': 'K-A', 'database-k4': 'K-A' };
  assert.deepEqual(exploratoryProtocols.map(p => p.exploratoryPair.key).sort(), Object.keys(expectedFirst).sort());
  for (const p of exploratoryProtocols) {
    const runs = makePilotBatch(nextPilotStep([], p), p, 1).runs;
    assert.equal(runs.length, 2);
    assert.equal(runs[0].conditionId, expectedFirst[p.exploratoryPair.key], `${p.exploratoryPair.key} first condition`);
    assert.notEqual(runs[0].conditionId, runs[1].conditionId);
  }
});
test('stages form one linear predecessor chain with distinct roots; only the two rebuild stages may change the source hash', () => {
  const ids = new Set(approvedObservationProtocols.map(p => p.protocolId));
  const roots = exploratoryProtocols.map(p => p.exploratoryPair.root), predecessors = exploratoryProtocols.map(p => p.exploratoryPair.predecessorRoot);
  assert.equal(new Set(roots).size, roots.length); assert.equal(new Set(predecessors).size, predecessors.length);
  for (const p of exploratoryProtocols) {
    assert.ok(ids.has(p.exploratoryPair.predecessorProtocolId), `${p.exploratoryPair.key} predecessor protocol is approved`);
    assert.notEqual(p.exploratoryPair.root, p.exploratoryPair.predecessorRoot);
  }
  assert.deepEqual([...IMPLEMENTATION_REBUILD_STAGES].sort(), ['adapter-k4', 'screening-r8']);
  assert.deepEqual(exploratoryProtocols.filter(rebuildsImplementation).map(p => p.exploratoryPair.key), ['screening-r8', 'adapter-k4']);
  for (const key of IMPLEMENTATION_REBUILD_STAGES) assert.ok(exploratoryProtocols.some(p => p.exploratoryPair.key === key), `${key} is a known stage`);
  assert.equal(rebuildsImplementation(approvedObservationProtocol), false);
  assert.equal(rebuildsImplementation(undefined), false);
});
test('a non-rebuild stage refuses a predecessor frozen under a different source hash; a rebuild stage does not check it', () => {
  const byKey = Object.fromEntries(exploratoryProtocols.map(p => [p.exploratoryPair.key, p]));
  assert.equal(rebuildsImplementation(byKey['database-k4']), false);
  assert.equal(rebuildsImplementation(byKey['adapter-k4']), true);
});
