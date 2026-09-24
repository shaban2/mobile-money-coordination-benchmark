import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluatePilotRun, makePilotBatch, nextPilotStep } from '../src/experiment/pilot.js';
import { pilotTimingForPhase, pilotTimingEnvironment, pilotLifecycleMatches } from '../src/experiment/pilot-timing.js';
const protocol = JSON.parse(readFileSync(new URL('../config/pilot-protocol.json', import.meta.url)));
function evidence(phase = 'confirmation') {
  return { manifest: { run: { phase }, lifecycle: pilotTimingForPhase(protocol, phase) },
    qualification: { valid: true, safety: { passed: true }, performance: { workloadCheckRate: 1, terminalCallbacksComplete: true } },
    telemetry: { transfers_pending: 0, transfers_failed: 0 },
    outcomes: { windowSeries: Array.from({ length: phase === 'screening' ? 8 : 20 }, (_, i) => ({ complete: true, underLoad: true,
      startAt: new Date(i * 30000).toISOString(), endAt: new Date((i + 1) * 30000).toISOString(), backlogAtEnd: 0, p95DurableCompletionMs: 50 })) } };
}
const row = (conditionId, rate, stable, phase = 'screening') => ({ conditionId, rate, phase, stability: { status: stable ? 'STABLE' : 'UNSTABLE', stable } });
test('pilot stability uses full durations and the final six complete windows', () => {
  const data = evidence();
  assert.equal(evaluatePilotRun(data, protocol).status, 'STABLE');
  data.outcomes.windowSeries.at(-1).backlogAtEnd = 3;
  assert.equal(evaluatePilotRun(data, protocol).checks.backlogNotGrowing, false);
  data.outcomes.windowSeries.at(-1).backlogAtEnd = 0;
  data.outcomes.windowSeries.at(-1).p95DurableCompletionMs = 60;
  assert.equal(evaluatePilotRun(data, protocol).checks.p95Stable, false);
  data.manifest.lifecycle.measurementDuration = '10s';
  assert.equal(evaluatePilotRun(data, protocol).status, 'INVALID_OR_HARNESS_LIMIT');
});
test('only exploratory screening uses 2m/4m; confirmation and faults retain 5m/10m and both drains', () => {
  assert.deepEqual(pilotTimingEnvironment(protocol, 'screening'), { WARMUP_DURATION: '2m', MEASUREMENT_DURATION: '4m', DRAIN_SECONDS: '600' });
  for (const phase of ['confirmation', 'fault']) {
    assert.deepEqual(pilotTimingEnvironment(protocol, phase), { WARMUP_DURATION: '5m', MEASUREMENT_DURATION: '10m', DRAIN_SECONDS: '600' });
  }
  const short = evidence('screening');
  assert.equal(evaluatePilotRun(short, protocol).status, 'STABLE');
  assert.equal(evaluatePilotRun(short, protocol).windows.length, 6);
  assert.equal(evaluatePilotRun(short, protocol, 'confirmation').status, 'INVALID_OR_HARNESS_LIMIT');
  short.manifest.run.phase = 'confirmation';
  assert.equal(evaluatePilotRun(short, protocol).status, 'INVALID_OR_HARNESS_LIMIT');
  const full = evidence('fault');
  assert.equal(pilotLifecycleMatches(full.manifest, protocol, 'fault'), true);
  full.manifest.lifecycle.measurementDuration = '4m';
  assert.equal(pilotLifecycleMatches(full.manifest, protocol, 'fault'), false);
});
test('phase timing fails closed for unknown phases, missing settings, too few windows, or truncated faults', () => {
  assert.throws(() => pilotTimingForPhase(protocol, 'other'), /Unknown pilot phase/);
  for (const change of [
    (p) => { p.screening.measurementDuration = '2m'; },
    (p) => { delete p.screening.warmupDuration; },
    (p) => { p.drainSeconds = -1; }
  ]) {
    const p = structuredClone(protocol); change(p);
    assert.throws(() => pilotTimingForPhase(p, 'screening'), /Invalid pilot timing/);
  }
  const p = structuredClone(protocol); p.measurementDuration = '5m';
  assert.throws(() => pilotTimingForPhase(p, 'fault'), /beyond injection/);
  delete p.screening; p.measurementDuration = '10m';
  assert.equal(pilotTimingForPhase(p, 'screening').measurementDuration, '10m');
});
test('invalid evidence and safety failures cannot become capacity observations', () => {
  const data = evidence(); data.qualification.valid = false;
  assert.equal(evaluatePilotRun(data, protocol).status, 'INVALID_OR_HARNESS_LIMIT');
  data.qualification.safety.passed = false;
  assert.equal(evaluatePilotRun(data, protocol).status, 'SAFETY_FAILURE');
});
test('capacity search doubles then bisects, without inventing a stable baseline', () => {
  assert.equal(nextPilotStep([], protocol).rate, 4);
  assert.equal(nextPilotStep([row('R-A', 4, true)], protocol).rate, 8);
  const result = nextPilotStep([row('R-A', 8, true), row('R-A', 16, false)], protocol);
  assert.equal(result.rate, 12);
  assert.equal(nextPilotStep([row('R-A', 4, false)], protocol).action, 'REVIEW');
});
test('narrow boundaries still require three fresh confirmation runs', () => {
  const records = [row('R-A', 20, true), row('R-A', 22, false), row('K-A', 10, true), row('K-A', 11, false)];
  assert.equal(nextPilotStep(records, protocol).phase, 'confirmation');
  for (let i = 0; i < 3; i++) { records.push(row('R-A', 20, true, 'confirmation')); records.push(row('K-A', 10, true, 'confirmation')); }
  const step = nextPilotStep(records, protocol);
  assert.equal(step.phase, 'fault'); assert.equal(step.sharedRate, 10); assert.deepEqual(step.absoluteRates, [3, 5, 8, 9]);
});
test('a failed boundary confirmation reduces the capacity bound', () => {
  const records = [row('R-A', 16, true), row('R-A', 20, true), row('R-A', 22, false), row('R-A', 20, false, 'confirmation')];
  assert.equal(nextPilotStep(records, protocol).rate, 18);
});
test('batch order is deterministic and paired seeds/rates match without touching the confirmatory matrix', () => {
  const step = { phase: 'confirmation', rate: 20, repetitions: 3 };
  const batch = makePilotBatch(step, protocol, 1);
  assert.deepEqual(batch, makePilotBatch(step, protocol, 1));
  assert.equal(batch.runs.length, 6);
  for (let i = 0; i < 6; i += 2) {
    assert.equal(batch.runs[i].randomSeed, batch.runs[i + 1].randomSeed);
    assert.notEqual(batch.runs[i].conditionId, batch.runs[i + 1].conditionId);
    assert.equal(batch.runs[i].offeredRate, 20);
  }
});
