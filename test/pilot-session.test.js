import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertPilotBudget, assertPilotCanStart, assertPilotEvidence, atPairBoundary, executePilotSession, newPilotState, pilotTiming } from '../src/experiment/pilot-session.js';
import { pilotTimingForPhase } from '../src/experiment/pilot-timing.js';

const protocol = JSON.parse(readFileSync(new URL('../config/pilot-protocol.json', import.meta.url)));
const calibrationProtocol = JSON.parse(readFileSync(new URL('../config/calibration-protocol.json', import.meta.url)));
function evidence(sessionId, run, policy) {
  return { manifest: { pilotSessionId: sessionId, run: structuredClone(run), lifecycle: pilotTimingForPhase(policy, run.phase) },
    qualification: { valid: true, status: 'QUALIFIED', safety: { passed: true }, performance: { workloadCheckRate: 1, terminalCallbacksComplete: true } },
    telemetry: { transfers_pending: 0, transfers_failed: 0 }, cleanup: { passed: true }, controllerError: false,
    outcomes: { windowSeries: Array.from({ length: 20 }, (_, i) => ({ complete: true, underLoad: true,
      startAt: new Date(i * 30000).toISOString(), endAt: new Date((i + 1) * 30000).toISOString(), backlogAtEnd: 0, p95DurableCompletionMs: 50 })) } };
}
function fixture() {
  const f = { state: newPilotState(), protocol: structuredClone(protocol), time: Date.parse('2026-09-20T08:00:00Z'),
    events: [], saved: [], files: new Map(), evidence: new Map(), runIds: [], pauseOnRun: 1, request: null, stopped: false };
  f.pause = () => { f.request = { mode: 'after-pair', sessionId: f.state.sessionId, controllerPid: 123, requestedAt: new Date(f.time).toISOString() }; };
  f.options = {
    now: () => f.time, pid: 123, shouldStop: () => f.stopped,
    io: { save: (state) => f.saved.push(structuredClone(state)), log: (message) => f.events.push(message),
      write: (file, data) => f.files.set(file, structuredClone(data)), readPauseRequest: () => f.request,
      runExists: (id) => f.evidence.has(id), readEvidence: (id) => f.evidence.get(id) },
    prepare: () => { f.events.push('prepare'); f.time += 1000; },
    check: () => { f.events.push('check'); f.time += 250; },
    runTrial: async (file, run, sessionId) => {
      assert.ok(f.files.has(file));
      f.runIds.push(run.runId); f.time += 10000; f.evidence.set(run.runId, evidence(sessionId, run, f.protocol));
      if (f.pauseOnRun === f.runIds.length) f.pause();
      if (f.onRun) f.onRun(f.evidence.get(run.runId), run);
      return { code: 0 };
    },
    cleanup: () => { f.events.push(`cleanup:${f.state.status}`); f.time += 1000; return { passed: true }; },
    restore: () => { f.events.push(`restore:${f.state.status}`); f.time += 1000; return []; }
  };
  f.run = (resume = false) => executePilotSession({ ...f.options, state: f.state, protocol: f.protocol, resume });
  return f;
}

function calibrationFixture() {
  const f = fixture(); f.protocol = structuredClone(calibrationProtocol); f.pauseOnRun = null;
  f.onRun = data => Object.assign(data.outcomes, { timingCompletenessRatio: 1,
    transfers: [{ receivedAt: '2026-09-20T00:00:01.000Z', terminalAt: '2026-09-20T00:00:02.000Z' }] });
  return f;
}
test('calibration stops at exactly four, does not call capacity logic, and retains jitter descriptively', async () => {
  const f = calibrationFixture(), populate = f.onRun;
  f.onRun = data => { populate(data); data.outcomes.windowSeries.at(-1).p95DurableCompletionMs = 10000; };
  assert.deepEqual(await f.run(), { failed: false, status: 'CALIBRATION_COMPLETE_REVIEW_REQUIRED' });
  assert.equal(f.runIds.length, 4); assert.equal(f.state.batches.length, 1);
  assert.equal(f.state.capacityDecision, undefined); assert.equal(f.state.calibrationDecision.capacityEstablished, false);
  assert.ok(f.state.records.every(r => r.calibration.passed && r.stability === null));
  assert.equal(f.state.cleanup.passed, true); assert.deepEqual(f.state.restoreErrors, []);
  assert.ok(f.state.sessions[0].endedAt); assert.equal(f.state.confirmatoryFrozen, false);
  assert.throws(() => assertPilotCanStart(f.state, { resume: true }), /clean PAUSED/);
});
test('calibration pauses after a pair and resumes only the remaining two runs', async () => {
  const f = calibrationFixture(); f.pauseOnRun = 1;
  assert.equal((await f.run()).status, 'PAUSED'); assert.equal(f.runIds.length, 2);
  f.time += 3600_000; f.pauseOnRun = null;
  assert.equal((await f.run(true)).status, 'CALIBRATION_COMPLETE_REVIEW_REQUIRED');
  assert.equal(f.runIds.length, 4); assert.equal(new Set(f.runIds).size, 4);
});
test('calibration correctness failure stops before the next run and restores services', async () => {
  const f = calibrationFixture(), populate = f.onRun;
  f.onRun = data => { populate(data); data.telemetry.transfers_failed = 1; };
  assert.equal((await f.run()).status, 'REVIEW_REQUIRED'); assert.equal(f.runIds.length, 1);
  assert.ok(f.events.includes('restore:REVIEW_REQUIRED'));
});
test('calibration resume revalidates descriptive assessments and frozen provenance', async () => {
  const f = calibrationFixture(), populate = f.onRun, freeze = { sourceSha256: 'source', frozenComposeSha256: 'images' };
  f.pauseOnRun = 1;
  f.onRun = data => { populate(data); Object.assign(data.manifest, {
    study: { pilotProtocolId: f.protocol.protocolId }, checksums: { sourceSnapshotSha256: 'source', frozenComposeSha256: 'images' }
  }); };
  await f.run();
  const verify = readEvidence => assertPilotEvidence({ state: f.state, protocol: f.protocol, freeze, readBatch: name => f.files.get(name), readEvidence });
  assert.doesNotThrow(() => verify(f.options.io.readEvidence));
  assert.throws(() => verify(id => { const data = structuredClone(f.evidence.get(id)); data.outcomes.windowSeries[0].p95DurableCompletionMs++; return data; }), /not resumable/);
});

test('pause after the first architecture finishes its pair, not the entire multi-pair batch', async () => {
  const f = fixture(); f.protocol.screeningReplicates = 3;
  assert.deepEqual(await f.run(), { failed: false, status: 'PAUSED' });
  assert.equal(f.runIds.length, 2); assert.equal(f.state.batches[0].runs.length, 6);
  assert.deepEqual(new Set(f.state.records.map((r) => r.conditionId)), new Set(['R-A', 'K-A']));
  assert.equal(new Set(f.state.records.map((r) => r.sessionId)).size, 1);
  assert.equal(atPairBoundary(f.state), true); assert.equal(f.state.currentRun, null);
  assert.deepEqual(f.events.filter((e) => e.startsWith('cleanup:') || e.startsWith('restore:')), ['cleanup:PAUSING', 'restore:PAUSING']);
  assert.equal(f.saved.findIndex((s) => s.status === 'PAUSED'), f.saved.length - 1);
  assert.equal(f.state.sessions[0].status, 'PAUSED');
  assert.equal(f.state.timing.activeMs, f.time - Date.parse(f.state.startedAt));
  assert.equal(f.state.timing.activeSince, null); assert.equal(f.state.timing.pausedSince, new Date(f.time).toISOString());
});

test('overnight explicit resume preserves completed runs, ignores the old request, and excludes only paused time', async () => {
  const f = fixture(); f.protocol.screeningReplicates = 3;
  await f.run();
  const firstIds = [...f.runIds], activeBefore = f.state.timing.activeMs, firstSession = f.state.sessionId;
  f.state = JSON.parse(JSON.stringify(f.state)); // Reload a persisted checkpoint, not live references.
  f.time += 12 * 3600_000;
  assert.equal(pilotTiming(f.state, f.time).activeMs, activeBefore);
  assert.equal(pilotTiming(f.state, f.time).pausedMs, 12 * 3600_000);
  f.pauseOnRun = 3;
  assert.deepEqual(await f.run(true), { failed: false, status: 'PAUSED' });
  assert.equal(f.runIds.length, 4); assert.equal(new Set(f.runIds).size, 4);
  assert.deepEqual(f.runIds.slice(0, 2), firstIds);
  assert.notEqual(f.state.sessionId, firstSession);
  assert.equal(f.state.records[2].sessionId, f.state.records[3].sessionId);
  assert.equal(f.state.sessions.length, 2); assert.equal(f.state.sessions[1].resumed, true);
  assert.equal(f.state.timing.activeMs, activeBefore + f.state.sessions[1].activeMs);
  assert.equal(f.state.timing.pausedMs, 12 * 3600_000);
  assert.equal(f.state.batches.length, 1); assertPilotCanStart(f.state, { resume: true });
});

test('a pause during the second member stops at that pair without scheduling another batch', async () => {
  const f = fixture(); f.pauseOnRun = 2;
  await f.run();
  assert.equal(f.state.status, 'PAUSED'); assert.equal(f.runIds.length, 2); assert.equal(f.state.batches.length, 1);
});

test('a request during preparation can pause before any run and still performs cleanup/restoration', async () => {
  const f = fixture(); f.options.prepare = () => f.pause();
  await f.run();
  assert.equal(f.state.status, 'PAUSED'); assert.equal(f.runIds.length, 0); assert.equal(f.state.batches.length, 0);
  assertPilotCanStart(f.state, { resume: true });
  assert.ok(f.events.includes('restore:PAUSING'));
});

test('an ordinary unstable result is retained and its counterpart still completes before pause', async () => {
  const f = fixture();
  f.onRun = (data) => { data.outcomes.windowSeries.at(-1).p95DurableCompletionMs = 100; };
  await f.run();
  assert.equal(f.state.status, 'PAUSED'); assert.equal(f.runIds.length, 2);
  assert.ok(f.state.records.every((r) => r.stability.status === 'UNSTABLE'));
});

for (const kind of ['safety', 'instrumentation', 'cleanup', 'controller']) {
  test(`${kind} failure overrides a pause request without running the counterpart`, async () => {
    const f = fixture();
    f.onRun = (data) => {
      if (kind === 'safety') data.qualification.safety.passed = false;
      if (kind === 'instrumentation') data.qualification.valid = false;
      if (kind === 'cleanup') data.cleanup.passed = false;
      if (kind === 'controller') data.controllerError = true;
    };
    assert.equal((await f.run()).failed, true);
    assert.equal(f.runIds.length, 1); assert.equal(f.state.status, 'REVIEW_REQUIRED');
    assert.equal(f.state.timing.pausedSince, null);
    assert.throws(() => assertPilotCanStart(f.state, { resume: true }), /clean PAUSED/);
    assert.ok(f.events.includes('restore:REVIEW_REQUIRED'));
  });
}

test('cleanup failure still attempts restoration but cannot advertise a clean pause', async () => {
  const f = fixture(); f.options.cleanup = () => { throw new Error('leftover worker'); };
  await f.run();
  assert.equal(f.state.status, 'REVIEW_REQUIRED'); assert.equal(f.state.cleanup.passed, false);
  assert.match(f.state.error, /leftover worker/); assert.ok(f.events.includes('restore:REVIEW_REQUIRED'));
});

test('restoration failure cannot advertise a clean pause', async () => {
  const f = fixture(); f.options.restore = () => [{ container: 'external-container-a', message: 'start failed' }];
  await f.run();
  assert.equal(f.state.status, 'REVIEW_REQUIRED'); assert.equal(f.state.containersRestoredAt, null);
  assert.equal(f.state.restoreErrors.length, 1); assert.equal(f.state.timing.pausedSince, null);
});

test('a process interruption retains its unfinished run and cannot be resumed automatically', async () => {
  const f = fixture(); f.onRun = () => { f.stopped = true; };
  await f.run();
  assert.equal(f.state.status, 'INTERRUPTED'); assert.equal(f.runIds.length, 1);
  assert.ok(f.state.currentRun); assert.equal(f.state.records.length, 0);
  assert.equal(f.state.cleanup.passed, true);
  assert.throws(() => assertPilotCanStart(f.state, { resume: true }), /clean PAUSED/);
});

test('active-time and run budgets accumulate across pauses and reject exhausted resume before preparation', async () => {
  const f = fixture(); await f.run();
  const active = f.state.timing.activeMs;
  f.time += 36 * 3600_000;
  assert.doesNotThrow(() => assertPilotBudget(f.state, f.protocol, f.time));
  f.protocol.maximumHours = active / 3600_000;
  const saved = structuredClone(f.state), events = f.events.length;
  await assert.rejects(f.run(true), /active-time ceiling/);
  assert.deepEqual(f.state, saved); assert.equal(f.events.length, events);
  f.protocol.maximumHours = 24; f.protocol.maximumRuns = 2;
  await assert.rejects(f.run(true), /run\/active-time ceiling/);
  assert.deepEqual(f.state, saved);
});

test('a run crossing the time ceiling completes but no further trial is started', async () => {
  const f = fixture(); f.protocol.maximumHours = 5000 / 3600_000;
  await f.run();
  assert.equal(f.runIds.length, 1); assert.equal(f.state.records.length, 1);
  assert.equal(f.state.status, 'REVIEW_REQUIRED'); assert.match(f.state.error, /ceiling/);
});

test('resume refuses partial/duplicate/cross-session/changed checkpoint pairs and unmatched session history', async () => {
  const f = fixture(); await f.run();
  for (const corrupt of [
    (s) => s.records.pop(),
    (s) => s.records.push(s.records[0]),
    (s) => { s.records[0].sessionId = 'another-session'; },
    (s) => { s.records[0].rate += 1; },
    (s) => { s.records[0].runId = 'unplanned'; },
    (s) => { s.currentRun = s.batches[0].runs[0]; },
    (s) => { s.batches.push(s.batches[0]); },
    (s) => { s.sessions[0].runIds = []; }
  ]) {
    const state = structuredClone(f.state); corrupt(state);
    assert.throws(() => assertPilotCanStart(state, { resume: true }), /checkpoint|boundary/);
  }
});

test('resume is explicit; legacy, unfinished, and review states are never silently migrated', async () => {
  const f = fixture(); await f.run();
  assert.throws(() => assertPilotCanStart(f.state), /Use --resume/);
  assert.throws(() => assertPilotCanStart({ schemaVersion: 1 }), /Legacy/);
  assert.throws(() => assertPilotCanStart(newPilotState(), { resume: true }), /clean PAUSED/);
  for (const status of ['INTERRUPTED', 'REVIEW_REQUIRED', 'REVIEW', 'PILOT_COMPLETE_REVIEW_REQUIRED']) {
    assert.throws(() => assertPilotCanStart({ ...f.state, status }, { resume: true }), /clean PAUSED/);
  }
  f.state.sessions[0].endedAt = null;
  assert.throws(() => assertPilotCanStart(f.state, { resume: true }), /Unfinished session/);
});

test('backwards clock changes fail closed rather than inventing negative consumed time', async () => {
  const f = fixture(); await f.run(); f.time -= 1000;
  await assert.rejects(f.run(true), /clock moved backwards/);
  assert.equal(f.state.status, 'PAUSED');
});

test('a resumed checkpoint cannot reset consumed budgets or contradict its session timestamps', async () => {
  const f = fixture(); await f.run();
  for (const corrupt of [
    (s) => { s.timing.activeMs = 0; },
    (s) => { s.timing.pausedMs = 1; },
    (s) => { s.sessions[0].activeMs += 1; },
    (s) => { s.sessions[0].startedAt = null; },
    (s) => { s.timing.pausedSince = new Date(f.time + 1).toISOString(); }
  ]) {
    const state = structuredClone(f.state); corrupt(state);
    assert.throws(() => assertPilotCanStart(state, { resume: true }), /timing and consumed budget/);
  }
});

test('resume revalidates saved batches, run identity, frozen provenance and stability against evidence', async () => {
  const f = fixture(), freeze = { sourceSha256: 'source-hash', frozenComposeSha256: 'image-override-hash' };
  f.onRun = (data, run) => Object.assign(data.manifest, {
    run: structuredClone(run), study: { pilotProtocolId: protocol.protocolId },
    checksums: { sourceSnapshotSha256: freeze.sourceSha256, frozenComposeSha256: freeze.frozenComposeSha256 }
  });
  await f.run();
  const verify = (readEvidence = f.options.io.readEvidence) => assertPilotEvidence({ state: f.state, protocol, freeze,
    readBatch: (name) => f.files.get(name), readEvidence });
  assert.doesNotThrow(() => verify());
  for (const corrupt of [
    (e) => { e.cleanup.passed = false; },
    (e) => { e.controllerError = true; },
    (e) => { e.qualification.valid = false; },
    (e) => { e.qualification.safety.passed = false; },
    (e) => { e.qualification.status = 'OTHER'; },
    (e) => { e.manifest.pilotSessionId = 'wrong-session'; },
    (e) => { e.manifest.checksums.sourceSnapshotSha256 = 'changed'; },
    (e) => { e.manifest.checksums.frozenComposeSha256 = 'changed'; },
    (e) => { e.manifest.study.pilotProtocolId = 'different-protocol'; },
    (e) => { e.manifest.run.offeredRate += 1; },
    (e) => { e.manifest.run.randomSeed = 'different-seed'; },
    (e) => { e.manifest.run.phase = 'confirmation'; },
    (e) => { e.manifest.lifecycle.measurementDuration = '10m'; },
    (e) => { e.manifest.lifecycle.drainSeconds = 10; },
    (e) => { e.outcomes.windowSeries.at(-1).p95DurableCompletionMs = 100; }
  ]) {
    assert.throws(() => verify((id) => { const data = structuredClone(f.evidence.get(id)); corrupt(data); return data; }), /not resumable/);
  }
  f.files.get(f.state.batches[0].file).runs.reverse();
  assert.throws(() => verify(), /Saved batch changed/);
});

test('wrong phase duration stops a live session before the result can become a capacity record', async () => {
  const f = fixture();
  f.onRun = (data) => { data.manifest.lifecycle.measurementDuration = '10m'; };
  assert.equal((await f.run()).status, 'REVIEW_REQUIRED');
  assert.equal(f.state.records.length, 0);
  assert.match(f.state.error, /Wrong phase or lifecycle timing/);
  assert.ok(f.events.includes('restore:REVIEW_REQUIRED'));
});

test('preparation, cleanup and logging failures do not prevent approved-service restoration', async () => {
  const f = fixture(), restored = [];
  f.options.prepare = () => { f.state.pausedContainers = [{ name: 'approved-container', id: 'approved-id' }]; throw new Error('preparation failed'); };
  f.options.cleanup = () => { throw new Error('cleanup failed'); };
  f.options.io.log = () => { throw new Error('log unavailable'); };
  f.options.restore = () => { restored.push(...f.state.pausedContainers); return []; };
  assert.equal((await f.run()).failed, true);
  assert.equal(f.state.status, 'REVIEW_REQUIRED'); assert.equal(f.state.logError, 'log unavailable');
  assert.deepEqual(restored, [{ name: 'approved-container', id: 'approved-id' }]);
  assert.equal(f.state.sessions[0].pausedContainers.length, 1);
});

test('without a pause request the adaptive controller continues to its normal rate-ceiling review', async () => {
  const f = fixture(); f.pauseOnRun = 0;
  await f.run();
  assert.equal(f.state.status, 'REVIEW'); assert.equal(f.runIds.length, 14);
  assert.equal(f.state.timing.pausedSince, null); assert.equal(f.state.capacityDecision.action, 'REVIEW');
  assert.ok(f.events.includes('cleanup:REVIEW')); assert.ok(f.events.includes('restore:REVIEW'));
});
