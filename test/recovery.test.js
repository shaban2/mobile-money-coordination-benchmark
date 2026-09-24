import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSystem } from '../src/system.js';
import { ProviderSimulator } from '../src/providers/provider-simulator.js';
import { KafkaEventBus } from '../src/infrastructure/kafka-event-bus.js';
const command = { payerId: 'payer', payeeId: 'payee', amount: '5', currency: 'UGX', clientReference: 'recovery', providerProfile: 'A' };

for (const coordinationMode of ['rest', 'kafka']) test(`${coordinationMode} resumes PREPARED work using a saved provider result without calling the provider again`, async () => {
  const system = createSystem({ coordinationMode, clientMode: 'async' });
  let { record } = await system.persistence.createOrGet(command, 'resume');
  record = await system.persistence.transition(record, 'VALIDATED');
  record = await system.persistence.transition(record, 'PREPARED');
  await system.persistence.ensureProviderCommand(record);
  system.persistence.providerCommands.set(record.transferId, { status: 'COMPLETED', providerReference: 'saved-effect' });
  await system.application.recover(); await system.application.drain();
  assert.equal((await system.persistence.get(record.transferId)).publicStatus, 'COMPLETED');
  assert.equal(system.provider.calls.length, 0);
  assert.equal((await system.application.invariants()).passed, true);
});
test('failed in-memory Kafka dispatch does not leave a completion waiter behind', async () => {
  const system = createSystem({ coordinationMode: 'kafka', clientMode: 'async' });
  const { record } = await system.persistence.createOrGet(command, 'failed-dispatch');
  system.eventBus.publish = async () => { throw new Error('dispatch unavailable'); };
  await assert.rejects(system.application.coordinator.execute(record.transferId), /dispatch unavailable/);
  assert.equal(system.persistence.terminalNotifier.waiters.size, 0);
});
test('provider idempotency survives a restart and rejects changed payloads', async () => {
  const journalPath = path.join(mkdtempSync(path.join(tmpdir(), 'provider-recovery-')), 'effects.jsonl');
  const request = { requestKey: 'key', value: '5', clientReference: 'ref' };
  const first = new ProviderSimulator({ journalPath });
  const response = await first.submit('A', request);
  const restarted = new ProviderSimulator({ journalPath });
  assert.deepEqual(await restarted.submit('A', request), response);
  assert.equal(restarted.calls.length, 0);
  await assert.rejects(restarted.submit('A', { ...request, value: '6' }), { code: 'PROVIDER_IDEMPOTENCY_CONFLICT' });
});
for (const coordinationMode of ['rest', 'kafka']) test(`${coordinationMode} reconciles provider acceptance followed by response loss without a second effect`, async () => {
  const system = createSystem({ coordinationMode, clientMode: 'async', providerRetryMaxAttempts: 2 });
  const execute = system.adapterBoundary.execute.bind(system.adapterBoundary);
  let calls = 0;
  system.adapterBoundary.execute = async (record) => {
    const result = await execute(record);
    if (++calls === 1) throw Object.assign(new Error('Response lost after acceptance'), { code: 'ADAPTER_OUTCOME_UNKNOWN' });
    return result;
  };
  const accepted = await system.application.submit(command, 'lost-response');
  await system.application.drain();
  assert.equal((await system.persistence.get(accepted.body.transferId)).publicStatus, 'COMPLETED');
  assert.equal(calls, 2);
  assert.equal(system.provider.calls.length, 1);
  assert.equal((await system.persistence.entries()).length, 1);
  assert.equal((await system.application.invariants()).passed, true);
});
test('failed Kafka handling is retried on redelivery, while committed events are skipped', async () => {
  let deliver;
  class Broker {
    producer() { return { connect: async () => {}, disconnect: async () => {} }; }
    consumer() { return { connect: async () => {}, subscribe: async () => {}, disconnect: async () => {}, run: async ({ eachMessage }) => { deliver = eachMessage; } }; }
    admin() { return { connect: async () => {}, createTopics: async () => {}, disconnect: async () => {} }; }
  }
  let committed = false, calls = 0;
  const bus = new KafkaEventBus({ namespace: 'test', kafkaFactory: Broker, deduplicator: { isInboxProcessed: async () => committed } });
  bus.subscribe('received', async () => { calls++; if (calls === 1) throw new Error('transient'); committed = true; });
  await bus.start();
  const message = { topic: 'test.received', message: { value: Buffer.from(JSON.stringify({ eventId: 'same' })) } };
  await assert.rejects(deliver(message), /transient/);
  await deliver(message); await deliver(message);
  assert.equal(calls, 2); await bus.stop();
});
test('ledger audit detects a corrupted posting and an account mismatch', async () => {
  const system = createSystem({ clientMode: 'async' });
  const transfer = await system.application.submit(command, 'corruption'); await system.application.drain();
  const entry = system.persistence.ledger.entriesByTransfer.get(transfer.body.transferId);
  entry.credit.amount = '4';
  const report = await system.application.invariants();
  assert.equal(report.passed, false); assert.equal(report.checks.balancedLedgerEntries, false);
  assert.equal(report.checks.accountBalancesMatchPostings, false);
});
