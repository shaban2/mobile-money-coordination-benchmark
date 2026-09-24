import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystem } from '../src/system.js';

const baseCommand = {
  payerId: 'payer-1',
  payeeId: 'payee-1',
  amount: 1000,
  currency: 'UGX',
  clientReference: 'ORDER-1',
  providerProfile: 'A'
};

test('an idempotent replay does not call the provider or post the ledger twice', async () => {
  const system = createSystem({ coordinationMode: 'rest', clientMode: 'async' });
  const first = await system.application.submit(baseCommand, 'same-key');
  await system.application.waitForTerminal(first.body.transferId);
  const second = await system.application.submit(baseCommand, 'same-key');
  assert.equal(first.body.transferId, second.body.transferId);
  assert.equal(second.replayed, true);
  assert.equal(system.provider.calls.length, 1);
  assert.equal((await system.ledger.entries()).length, 1);
  assert.equal((await system.application.invariants()).passed, true);
});

test('reuse of an idempotency key with a changed payload is rejected', async () => {
  const system = createSystem({ coordinationMode: 'rest', clientMode: 'async' });
  const accepted = await system.application.submit(baseCommand, 'conflict-key');
  await system.application.waitForTerminal(accepted.body.transferId);
  await assert.rejects(
    system.application.submit({ ...baseCommand, amount: 2000 }, 'conflict-key'),
    { code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409 }
  );
});

for (const coordinationMode of ['rest', 'kafka']) {
  test(`${coordinationMode} records an adapter outage as a failed transfer`, async () => {
    const system = createSystem({ coordinationMode, clientMode: 'async' });
    system.provider.setAvailable(false);
    const accepted = await system.application.submit(baseCommand, `outage-${coordinationMode}`);
    const result = await system.application.waitForTerminal(accepted.body.transferId);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.failure.code, 'ADAPTER_UNAVAILABLE');
    assert.equal((await system.ledger.entries()).length, 0);
    assert.equal((await system.application.invariants()).passed, true);
  });
}

test('a provider decline fails without moving value', async () => {
  const system = createSystem({ coordinationMode: 'kafka', clientMode: 'async' });
  const accepted = await system.application.submit(
    { ...baseCommand, clientReference: 'DECLINE-THIS' },
    'decline-key'
  );
  const result = await system.application.waitForTerminal(accepted.body.transferId);
  assert.equal(result.status, 'FAILED');
  assert.equal((await system.ledger.entries()).length, 0);
  assert.equal((await system.application.invariants()).passed, true);
});

for (const coordinationMode of ['rest', 'kafka']) {
  test(`${coordinationMode} recovers when the common adapter returns before retries are exhausted`, async () => {
    const system = createSystem({
      coordinationMode,
      clientMode: 'async',
      providerRetryMaxAttempts: 8,
      providerRetryDelayMs: 5,
      workflowTimeoutMs: 1_000
    });
    system.provider.setAvailable(false);
    setTimeout(() => system.provider.setAvailable(true), 20);
    const accepted = await system.application.submit(baseCommand, `retry-${coordinationMode}`);
    const result = await system.application.waitForTerminal(accepted.body.transferId);
    assert.equal(result.status, 'COMPLETED');
    assert.ok((await system.persistence.listProviderAttempts()).length > 1);
    assert.equal((await system.persistence.listDeadLetters()).length, 0);
    assert.equal((await system.application.invariants()).passed, true);
  });
}

test('a completed asynchronous transfer has a complete cross-boundary trace', async () => {
  const system = createSystem({ coordinationMode: 'rest', clientMode: 'async' });
  const accepted = await system.application.submit(baseCommand, 'complete-trace');
  await system.application.waitForTerminal(accepted.body.transferId);
  await system.application.drain();
  const telemetry = await system.telemetry();
  assert.equal(telemetry.trace_completeness_ratio, 1);
});

test('asynchronous callback delivery retries with the frozen common policy', async () => {
  let attempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts += 1;
    return { status: attempts < 3 ? 503 : 204, ok: attempts >= 3 };
  };
  const system = createSystem({
    coordinationMode: 'rest',
    clientMode: 'async',
    sendHttpCallbacks: true,
    callbackMaxAttempts: 3,
    callbackRetryDelayMs: 1
  });
  try {
    await system.application.submit({
      ...baseCommand,
      callbackUrl: 'http://callback.example/callbacks/transfers'
    }, 'callback-retry');
    await system.application.drain();
    assert.equal(attempts, 3);
    assert.equal(system.callbackSink.list().length, 3);
    assert.equal(system.callbackSink.list().at(-1).delivered, true);
    assert.equal((await system.telemetry()).trace_completeness_ratio, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
