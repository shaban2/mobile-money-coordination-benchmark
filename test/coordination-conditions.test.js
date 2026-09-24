import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystem } from '../src/system.js';

const conditions = ['rest', 'kafka'];

function command(providerProfile = 'A', reference = 'ORDER-1') {
  return {
    payerId: 'payer-1',
    payeeId: 'payee-1',
    amount: 2500,
    currency: 'UGX',
    clientReference: reference,
    providerProfile
  };
}

for (const coordinationMode of conditions) {
  test(`${coordinationMode} coordination completes the same asynchronous transfer correctly`, async () => {
    const system = createSystem({ coordinationMode, clientMode: 'async', providerDelayMs: 2 });
    const result = await system.application.submit(
      command(coordinationMode === 'rest' ? 'A' : 'B'),
      `${coordinationMode}-async-1`
    );
    assert.equal(result.httpStatus, 202);
    assert.equal(result.body.status, 'PENDING');

    const terminal = await system.application.waitForTerminal(result.body.transferId);
    assert.equal(terminal.status, 'COMPLETED');
    assert.equal(await system.ledger.balance('payer-1'), '99997500');
    assert.equal(await system.ledger.balance('payee-1'), '2500');
    assert.equal((await system.application.invariants()).passed, true);
    assert.equal(system.callbackSink.list().length, 1);
  });
}

test('both adapters preserve the same asynchronous public outcome', async () => {
  const outcomes = [];
  for (const profile of ['A', 'B']) {
    const system = createSystem({ coordinationMode: 'rest', clientMode: 'async' });
    const accepted = await system.application.submit(command(profile, `ORDER-${profile}`), `profile-${profile}`);
    const terminal = await system.application.waitForTerminal(accepted.body.transferId);
    outcomes.push({ status: terminal.status, amount: terminal.amount, currency: terminal.currency });
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('REST and Kafka produce equivalent mappings, states, ledger postings, and callbacks for a fixed corpus', async () => {
  const observations = [];
  for (const coordinationMode of conditions) {
    const system = createSystem({ coordinationMode, clientMode: 'async' });
    for (const profile of ['A', 'B']) for (const outcome of ['SUCCESS', 'DECLINE']) {
      const input = command(profile, `${profile}-${outcome}`);
      const key = `${profile}-${outcome}`;
      await system.application.submit(input, key);
      await system.application.drain();
      const replay = await system.application.submit(input, key);
      assert.equal(replay.replayed, true);
    }
    const transfers = await system.persistence.list();
    const keys = new Map(transfers.map((t) => [t.transferId, t.idempotencyKey]));
    const traces = await system.persistence.listTraceEvents();
    assert.ok(transfers.every((t) => ['API_RECEIVED', 'COMMIT_CONFIRMED', 'FINAL_RESULT_DELIVERY']
      .every((type) => traces.some((e) => e.transferId === t.transferId && e.eventType === type))));
    assert.equal((await system.application.invariants()).passed, true);
    observations.push({
      states: transfers.map((t) => ({ key: t.idempotencyKey, state: t.internalState, history: t.history.map((h) => h.state), providerReference: t.providerReference })),
      mappings: system.provider.calls,
      ledger: (await system.persistence.entries()).map(({ transferId, ...entry }) => ({ key: keys.get(transferId), ...entry })),
      callbacks: system.callbackSink.list().map((d) => ({ key: keys.get(d.transferId), status: d.payload.status })),
      balances: await system.persistence.listAccounts()
    });
  }
  assert.deepEqual(observations[0], observations[1]);
});
