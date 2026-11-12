import test from 'node:test';
import assert from 'node:assert/strict';
import { OutboxDispatcher } from '../src/infrastructure/outbox-dispatcher.js';
import { statementCategory } from '../src/infrastructure/postgres/diagnostic-pool.js';
import { RuntimeDiagnostics } from '../src/infrastructure/runtime-diagnostics.js';

const events = ['a', 'b', 'c'].map((eventId) => ({ eventId, topic: 't', payload: {} }));
function fakes({ failOn = null } = {}) {
  const calls = [];
  return { calls,
    persistence: { supportsOutbox: true, unpublishedOutbox: async () => events,
      markOutboxPublished: async (id) => calls.push(`mark:${id}`),
      markOutboxPublishedBatch: async (ids) => calls.push(`batch:${ids.join(',')}`),
      markOutboxFailed: async (id) => calls.push(`fail:${id}`) },
    eventBus: { publish: async (_topic, { eventId }) => {
      if (eventId === failOn) throw new Error('broker down');
      calls.push(`pub:${eventId}`);
    } } };
}

test('serial dispatch stays the default and marks each event after publishing it', async () => {
  const f = fakes();
  await new OutboxDispatcher(f).dispatchOnce();
  assert.deepEqual(f.calls, ['pub:a', 'mark:a', 'pub:b', 'mark:b', 'pub:c', 'mark:c']);
});

test('batched dispatch publishes in order and marks once', async () => {
  const f = fakes();
  await new OutboxDispatcher({ ...f, dispatchMode: 'batched' }).dispatchOnce();
  assert.deepEqual(f.calls, ['pub:a', 'pub:b', 'pub:c', 'batch:a,b,c']);
});

test('batched dispatch keeps events published before a failure', async () => {
  const f = fakes({ failOn: 'b' });
  await assert.rejects(new OutboxDispatcher({ ...f, dispatchMode: 'batched' }).dispatchOnce(), /broker down/);
  assert.deepEqual(f.calls, ['pub:a', 'fail:b', 'batch:a']);
});

test('dispatcher rejects invalid settings', () => {
  assert.throws(() => new OutboxDispatcher({ ...fakes(), dispatchMode: 'parallel' }), /dispatchMode/);
  assert.throws(() => new OutboxDispatcher({ ...fakes(), pollIntervalMs: 0 }), /pollIntervalMs/);
});

test('statements are categorized by what they do', () => {
  const cases = { 'BEGIN': 'transaction', 'COMMIT': 'transaction',
    'SELECT event_id, topic, payload FROM outbox_events WHERE published_at IS NULL': 'outbox_poll',
    'UPDATE outbox_events SET published_at = now()': 'outbox_mark',
    'INSERT INTO outbox_events(event_id) VALUES ($1)': 'outbox_write',
    'INSERT INTO inbox_events(event_id) VALUES ($1)': 'inbox',
    'INSERT INTO trace_events(trace_id) VALUES ($1)': 'trace',
    'INSERT INTO callback_deliveries(transfer_id) VALUES ($1)': 'callback',
    'UPDATE accounts SET balance = balance - $1': 'ledger',
    'INSERT INTO provider_attempts(transfer_id) VALUES ($1)': 'provider',
    'SELECT * FROM transfers WHERE transfer_id = $1': 'transfer_state',
    "SELECT t.* FROM transfers t WHERE public_status = 'PENDING'\n      OR NOT EXISTS (SELECT 1 FROM callback_deliveries c)": 'recovery_scan',
    'SELECT (SELECT COUNT(*)::float8 FROM outbox_events WHERE published_at IS NULL) AS outbox_pending': 'telemetry' };
  for (const [sql, category] of Object.entries(cases)) assert.equal(statementCategory(sql), category, sql);
});

test('statement counts separate transfer work from background work and give per-sample deltas', async () => {
  const diagnostics = new RuntimeDiagnostics({ enabled: true });
  diagnostics.countStatement('outbox_poll');
  await diagnostics.measure('persistence.get', { transferId: 'x' }, async () => diagnostics.countStatement('transfer_state'));
  await diagnostics.measure('persistence.createOrGet', { transferWork: true }, async () => diagnostics.countStatement('trace'));
  assert.deepEqual(diagnostics.snapshot().statementCounts, { 'outbox_poll.background': 1, 'transfer_state.transfer': 1, 'trace.transfer': 1 });
  diagnostics.sample(); diagnostics.countStatement('outbox_poll'); diagnostics.sample();
  assert.deepEqual(diagnostics.snapshot().runtimeSamples.at(-1).statements, { 'outbox_poll.background': 1 });
});
