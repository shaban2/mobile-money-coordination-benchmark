import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOutcomes } from '../src/experiment/outcomes.js';
const iso = (s) => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString();
function fixture() {
  return { manifest: { run: { runId: 'test', conditionId: 'R-A', block: 'LOAD', offeredRate: 1 }, lifecycle: { measurementDuration: '60s' } },
    telemetry: {}, clock: { measurementStartedAt: iso(0) }, controller: { events: [{ status: 'OBSERVATION_ENDED', occurredAt: iso(120) }] },
    invariants: { passed: true, reconciledTransferIds: ['early', 'late'] }, fault: null,
    snapshot: { transfers: [
      { transferId: 'early', idempotencyKey: 'e', internalState: 'FULFILLED', publicStatus: 'COMPLETED' },
      { transferId: 'late', idempotencyKey: 'l', internalState: 'FULFILLED', publicStatus: 'COMPLETED' },
      { transferId: 'pending', idempotencyKey: 'p', internalState: 'PREPARED', publicStatus: 'PENDING' }] },
    traces: { events: [
      ...['early', 'late', 'pending'].map((transferId) => ({ transferId, eventType: 'API_RECEIVED', occurredAt: iso(2), details: { receivedAt: iso(1) } })),
      { transferId: 'early', eventType: 'TERMINAL_STATE', occurredAt: iso(2), details: { nextState: 'FULFILLED' } },
      { transferId: 'early', eventType: 'COMMIT_CONFIRMED', occurredAt: iso(4), details: { confirmedAt: iso(3), state: 'FULFILLED' } },
      { transferId: 'late', eventType: 'COMMIT_CONFIRMED', occurredAt: iso(76), details: { confirmedAt: iso(75), state: 'FULFILLED' } }
    ] } };
}
test('latency uses API ingress and post-commit acknowledgement, never the pre-commit terminal event', () => {
  const report = deriveOutcomes(fixture());
  assert.equal(report.durableCompletionMs.p95, 2000);
});
test('unfinished transfers remain in backlog and drain completions do not inflate measurement goodput', () => {
  const report = deriveOutcomes(fixture());
  assert.equal(report.windowSeries[0].backlogAtEnd, 2);
  assert.equal(report.windowSeries.at(-1).backlogAtEnd, 1);
  assert.equal(report.terminalCounts.pendingAfterDrain, 1);
  assert.equal(report.correctGoodput, 1 / 60);
  assert.equal(report.eventualCorrectCompletionRate, 2 / 60);
  assert.equal(report.completedDuringDrain, 1);
});
test('a terminal record without commit confirmation is missing evidence, not a fabricated latency', () => {
  const data = fixture();
  data.traces.events = data.traces.events.filter((e) => e.eventType !== 'COMMIT_CONFIRMED');
  const report = deriveOutcomes(data);
  assert.equal(report.correctGoodput, 0);
  assert.equal(report.durableCompletionMs.p95, null);
  assert.equal(report.timingCompletenessRatio, 1 / 3);
});
test('unreconciled transfers cannot count as correct goodput', () => {
  const data = fixture(); data.invariants.reconciledTransferIds = [];
  assert.equal(deriveOutcomes(data).correctGoodput, 0);
});
test('missing ingress evidence cannot silently remove a transfer from timing completeness', () => {
  const data = fixture();
  data.traces.events = data.traces.events.filter((e) => !(e.transferId === 'late' && e.eventType === 'API_RECEIVED'));
  const report = deriveOutcomes(data);
  assert.equal(report.unplaceableTransfers, 1);
  assert.equal(report.timingCompletenessRatio, 2 / 3);
});
test('a negative commit interval fails timing completeness', () => {
  const data = fixture();
  data.traces.events.find((e) => e.transferId === 'early' && e.eventType === 'COMMIT_CONFIRMED').details.confirmedAt = iso(0);
  assert.equal(deriveOutcomes(data).timingCompletenessRatio, 2 / 3);
});
test('partial observation windows cannot demonstrate fault recovery', () => {
  const data = fixture();
  data.fault = { completed: true, scenario: 'adapter-crash', injectedAt: iso(20), clearedAt: iso(30) };
  data.controller.events[0].occurredAt = iso(95);
  const report = deriveOutcomes(data);
  assert.equal(report.windowSeries.at(-1).complete, false);
  assert.equal(report.faultAnalysis.recoveryCensored, true);
  assert.equal(report.faultAnalysis.recoveryObservationSeconds, 30);
});
