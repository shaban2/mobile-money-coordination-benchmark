import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystem } from '../src/system.js';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.POSTGRES_TEST_URL;
const expectedTables = [
  'accounts',
  'callback_deliveries',
  'dead_letter_events',
  'experiment_runs',
  'inbox_events',
  'ledger_postings',
  'ledger_transactions',
  'outbox_events',
  'provider_attempts',
  'provider_commands',
  'reconciliation_results',
  'schema_migrations',
  'trace_events',
  'transfers'
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('PostgreSQL stores a transfer, ledger, callback, and reconciliation durably', {
  skip: !databaseUrl
}, async () => {
  let system = createSystem({
    coordinationMode: 'rest',
    clientMode: 'async',
    persistenceType: 'postgres',
    databaseUrl,
    providerDelayMs: 5,
    diagnosticsEnabled: true
  });
  await system.start();
  await system.reset();

  // A checked-out connection can die between queries, not only in pool.query.
  const disconnected = await system.persistence.pool.connect();
  const disconnectedEvent = new Promise((resolve) => disconnected.once('error', resolve));
  await system.persistence.pool.query('SELECT pg_terminate_backend($1)', [disconnected.processID]);
  await disconnectedEvent;
  await assert.rejects(disconnected.query('SELECT 1'));
  disconnected.release();
  assert.equal((await system.persistence.pool.query('SELECT 1 AS healthy')).rows[0].healthy, 1);
  const diagnosticClient = await system.persistence.pool.connect();
  try { await diagnosticClient.query('SELECT pg_sleep(0.04)'); }
  finally { diagnosticClient.release(); }
  assert.ok(system.diagnostics.snapshot().aggregates['db.query.SELECT'].maxMs >= 35);

  const created = await system.application.submit({
    payerId: 'postgres-payer',
    payeeId: 'postgres-payee',
    amount: '1250',
    currency: 'UGX',
    clientReference: 'POSTGRES-PERSISTENCE-TEST',
    providerProfile: 'A'
  }, 'postgres-idempotency-key');
  assert.equal(created.httpStatus, 202);
  const terminal = await system.application.waitForTerminal(created.body.transferId);
  assert.equal(terminal.status, 'COMPLETED');

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const callbackCount = await system.persistence.pool.query(
      'SELECT COUNT(*)::int AS count FROM callback_deliveries'
    );
    if (callbackCount.rows[0].count === 1) break;
    await wait(10);
  }
  assert.equal((await system.application.invariants()).passed, true);
  assert.ok(system.diagnostics.snapshot().aggregates['db.query.COMMIT'].count > 0);
  assert.ok(system.diagnostics.snapshot().aggregates['db.acquire'].count > 0);
  assert.equal(system.diagnostics.snapshot().recordingErrors, 0);
  assert.equal(await system.ledger.balance('postgres-payer'), '99998750');
  assert.equal(await system.ledger.balance('postgres-payee'), '1250');

  const tableResult = await system.persistence.pool.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name
  `);
  assert.deepEqual(tableResult.rows.map(({ table_name }) => table_name), expectedTables);
  await system.stop();

  system = createSystem({
    coordinationMode: 'rest',
    clientMode: 'async',
    persistenceType: 'postgres',
    databaseUrl
  });
  await system.start();
  const afterRestart = await system.application.get(created.body.transferId);
  assert.equal(afterRestart.status, 'COMPLETED');

  const replay = await system.application.submit({
    payerId: 'postgres-payer',
    payeeId: 'postgres-payee',
    amount: '1250',
    currency: 'UGX',
    clientReference: 'POSTGRES-PERSISTENCE-TEST',
    providerProfile: 'A'
  }, 'postgres-idempotency-key');
  assert.equal(replay.replayed, true);

  await system.persistence.seed('underfunded-payer', 100, 'UGX');
  const failed = await system.application.submit({
    payerId: 'underfunded-payer',
    payeeId: 'unpaid-payee',
    amount: '500',
    currency: 'UGX',
    clientReference: 'ATOMIC-ROLLBACK-TEST',
    providerProfile: 'B'
  }, 'postgres-insufficient-funds');
  const failedTerminal = await system.application.waitForTerminal(failed.body.transferId);
  assert.equal(failedTerminal.status, 'FAILED');
  assert.equal(failedTerminal.failure.code, 'INSUFFICIENT_FUNDS');
  await system.application.drain();
  assert.equal(await system.ledger.balance('underfunded-payer'), '100');
  assert.equal(await system.ledger.balance('unpaid-payee'), '0');

  const counts = await system.persistence.pool.query(`
    SELECT
      (SELECT COUNT(*) FROM transfers)::int AS transfers,
      (SELECT COUNT(*) FROM ledger_transactions)::int AS ledger_transactions,
      (SELECT COUNT(*) FROM ledger_postings)::int AS ledger_postings,
      (SELECT COUNT(*) FROM provider_attempts)::int AS provider_attempts,
      (SELECT COUNT(*) FROM callback_deliveries)::int AS callback_deliveries,
      (SELECT COUNT(*) FROM reconciliation_results)::int AS reconciliations
  `);
  assert.deepEqual(counts.rows[0], {
    transfers: 2,
    ledger_transactions: 1,
    ledger_postings: 2,
    provider_attempts: 2,
    callback_deliveries: 2,
    reconciliations: 1
  });
  assert.equal((await system.application.invariants({ persist: false })).passed, true);

  // Audit the actual posting amounts, rather than copies of the transaction amount.
  await system.persistence.pool.query("UPDATE ledger_postings SET amount = amount + 1 WHERE entry_type = 'CREDIT'");
  const corrupt = await system.application.invariants({ persist: false });
  assert.equal(corrupt.checks.balancedLedgerEntries, false);
  assert.equal(corrupt.checks.accountBalancesMatchPostings, false);
  await system.persistence.pool.query("UPDATE ledger_postings SET amount = amount - 1 WHERE entry_type = 'CREDIT'");

  // An inbox insertion must roll back when the transition cannot commit.
  let { record } = await system.persistence.createOrGet({
    payerId: 'resume-payer', payeeId: 'resume-payee', amount: '10', currency: 'UGX', clientReference: 'RESUME', providerProfile: 'A'
  }, 'resume-key');
  const inbox = { eventId: randomUUID(), topic: 'transfer.received', payload: { transferId: record.transferId } };
  await assert.rejects(system.persistence.transition(record, 'FULFILLED', {}, { inbox }));
  assert.equal(await system.persistence.isInboxProcessed(inbox.eventId), false);
  record = await system.persistence.transition(record, 'VALIDATED', {}, { inbox, outbox: { topic: 'transfer.validated', payload: { transferId: record.transferId } } });
  assert.equal(await system.persistence.isInboxProcessed(inbox.eventId), true);
  record = await system.persistence.transition(record, 'PREPARED');
  await system.persistence.ensureProviderCommand(record);
  await system.persistence.pool.query('UPDATE provider_commands SET result = $2::jsonb WHERE transfer_id = $1',
    [record.transferId, JSON.stringify({ status: 'COMPLETED', providerReference: 'saved-provider-effect' })]);
  await system.stop();
  system = createSystem({ coordinationMode: 'rest', clientMode: 'async', persistenceType: 'postgres', databaseUrl });
  await system.start();
  await system.application.drain();
  assert.equal((await system.persistence.get(record.transferId)).publicStatus, 'COMPLETED');
  assert.equal(system.provider.calls.length, 0);
  const commitTrace = (await system.persistence.listTraceEvents()).find((event) => event.transfer_id === record.transferId && event.event_type === 'COMMIT_CONFIRMED');
  assert.ok(commitTrace.details.confirmedAt);
  await system.reset();
  await system.stop();
});
