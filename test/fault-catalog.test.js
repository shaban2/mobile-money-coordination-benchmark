import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFaultApplies, clientErrorSummary, faultFor, optionalServicesFor } from '../src/experiment/fault-catalog.js';
import { deriveOutcomes } from '../src/experiment/outcomes.js';

test('each fault names the service that may disappear', () => {
  assert.deepEqual(optionalServicesFor({ faultScenario: 'adapter-crash' }), ['adapter-service']);
  assert.deepEqual(optionalServicesFor({ faultScenario: 'app-kill', composeProfile: 'rest-async' }), ['rest-async']);
  assert.deepEqual(optionalServicesFor({ faultScenario: 'broker-stop' }), ['redpanda']);
  assert.deepEqual(optionalServicesFor({ faultScenario: 'database-partition' }), []);
  assert.deepEqual(optionalServicesFor({ faultScenario: 'none' }), []);
});

test('unknown faults are rejected instead of ignored', () => {
  assert.throws(() => faultFor('meteor'), /Unknown fault/);
});

test('original faults keep their strict diagnostic and client checks', () => {
  for (const name of ['adapter-crash', 'database-delay']) {
    assert.equal(faultFor(name).clientVisible, false);
    assert.notEqual(faultFor(name).disturbsDiagnostics, true);
  }
});

test('broker stop cannot be scheduled for REST', () => {
  assert.throws(() => assertFaultApplies({ faultScenario: 'broker-stop', conditionId: 'R-A' }), /only to the Kafka/);
  assert.doesNotThrow(() => assertFaultApplies({ faultScenario: 'broker-stop', conditionId: 'K-A' }));
});

test('client errors count against the run unless they sit around the fault', () => {
  const fault = { injectedAt: '2026-11-08T00:04:00.000Z', clearedAt: '2026-11-08T00:04:30.000Z' };
  const attempt = (sentAt, httpStatus) => ({ sentAt, httpStatus });
  const summary = clientErrorSummary([attempt('2026-11-08T00:04:10.000Z', 502), attempt('2026-11-08T00:04:33.000Z', 502),
    attempt('2026-11-08T00:01:00.000Z', 500), attempt('2026-11-08T00:04:10.000Z', 202)], fault);
  assert.deepEqual(summary, { total: 4, failed: 3, duringFault: 2, outsideFault: 1 });
});

test('a transfer confirmed only by recovery is complete, with its latency flagged as an upper bound', () => {
  const manifest = { lifecycle: { measurementDuration: '10m' }, run: { runId: 'r', conditionId: 'R-A', block: 'CAMPAIGN', executionBlock: 1, offeredRate: 4 } };
  const event = (event_type, occurred_at, details) => ({ transfer_id: 't1', event_type, occurred_at, details });
  const outcomes = deriveOutcomes({ manifest, telemetry: {}, clock: { measurementStartedAt: '2026-11-08T00:00:00.000Z' },
    controller: { events: [{ status: 'OBSERVATION_ENDED', occurredAt: '2026-11-08T00:10:00.000Z' }] },
    snapshot: { transfers: [{ transferId: 't1', idempotencyKey: 'k', internalState: 'FULFILLED', publicStatus: 'COMPLETED' }] },
    traces: { events: [event('API_RECEIVED', '2026-11-08T00:01:00.000Z', { receivedAt: '2026-11-08T00:01:00.000Z' }),
      event('COMMIT_CONFIRMED', '2026-11-08T00:01:40.000Z', { confirmedAt: '2026-11-08T00:01:40.000Z', recovered: true })] },
    invariants: { reconciledTransferIds: ['t1'] }, fault: null });
  assert.equal(outcomes.transfers[0].correct, true);
  assert.equal(outcomes.transfers[0].latencyUpperBound, true);
  assert.equal(outcomes.recoveredConfirmations, 1);
});
