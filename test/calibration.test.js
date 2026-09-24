import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluateCalibrationRun, validateCalibrationProtocol } from '../src/experiment/calibration.js';
import { makePilotBatch, nextPilotStep } from '../src/experiment/pilot.js';
import { pilotTimingForPhase } from '../src/experiment/pilot-timing.js';
const protocol = JSON.parse(readFileSync(new URL('../config/calibration-protocol.json', import.meta.url)));
const evidence = () => ({ qualification: { valid: true, safety: { passed: true }, performance: { workloadCheckRate: 1, terminalCallbacksComplete: true } },
  telemetry: { transfers_failed: 0, transfers_pending: 0 }, outcomes: { timingCompletenessRatio: 1,
    transfers: [{ receivedAt: '2026-09-20T00:00:01Z', terminalAt: '2026-09-20T00:00:02Z' }],
    windowSeries: [{ complete: true, underLoad: true, startAt: '2026-09-20T00:00:00Z', endAt: '2026-09-20T00:00:30Z', backlogAtEnd: 0, p95DurableCompletionMs: 999 }] } });
test('calibration is four no-fault 4/s runs with counterbalanced pairs and 5m/10m timing', () => {
  validateCalibrationProtocol(protocol);
  const batch = makePilotBatch(nextPilotStep([], protocol), protocol, 1);
  assert.equal(batch.kind, 'DIAGNOSTIC_CALIBRATION'); assert.equal(batch.runs.length, 4);
  assert.deepEqual(batch.runs.slice(0, 2).map(r => r.conditionId), batch.runs.slice(2).map(r => r.conditionId).reverse());
  assert.ok(batch.runs.every(r => r.offeredRate === 4 && r.faultScenario === 'none'));
  assert.deepEqual(pilotTimingForPhase(protocol, 'calibration'), { warmupDuration: '5m', measurementDuration: '10m', drainSeconds: 600 });
  assert.throws(() => validateCalibrationProtocol({ ...protocol, maximumRuns: 6 }));
});
test('latency and queue descriptions cannot silently establish capacity or cause an overload failure', () => {
  const e = evidence(), result = evaluateCalibrationRun(e);
  assert.equal(result.passed, true); assert.equal(result.sustainedLoad.capacityEstablished, false);
  assert.equal(result.sustainedLoad.maximumOutstanding, 1); assert.equal(result.sustainedLoad.windows[0].arrivals, 1);
  e.outcomes.windowSeries[0].backlogAtEnd = 100;
  assert.equal(evaluateCalibrationRun(e).passed, true); // Must be reviewed, never an automatic capacity verdict.
  const rows = Array.from({ length: 4 }, () => ({ phase: 'calibration', rate: 4, calibration: result }));
  assert.equal(nextPilotStep(rows, protocol).action, 'CALIBRATION_COMPLETE_REVIEW_REQUIRED');
  assert.throws(() => nextPilotStep([...rows, rows[0]], protocol));
});
test('correctness, callbacks, generator validity and complete timing remain hard gates', () => {
  for (const mutate of [e => e.qualification.valid = false, e => e.qualification.safety.passed = false,
    e => e.qualification.performance.workloadCheckRate = .99, e => e.qualification.performance.terminalCallbacksComplete = false,
    e => e.telemetry.transfers_failed = 1, e => e.telemetry.transfers_pending = 1, e => e.outcomes.timingCompletenessRatio = .99]) {
    const e = evidence(); mutate(e); assert.equal(evaluateCalibrationRun(e).passed, false);
  }
});
