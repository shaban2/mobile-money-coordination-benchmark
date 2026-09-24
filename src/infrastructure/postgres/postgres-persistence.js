import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DomainError } from '../../domain/errors.js';
import {
  INTERNAL_STATE,
  commandFingerprint,
  createTransferRecord,
  transitionTransfer,
  validateTransferCommand
} from '../../domain/transfer.js';
import { migrate } from './migrate.js';
import { instrumentPool } from './diagnostic-pool.js';

const require = createRequire(import.meta.url);

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function recordFromRow(row) {
  if (!row) return null;
  return {
    transferId: row.transfer_id,
    traceId: row.trace_id,
    idempotencyKey: row.idempotency_key,
    commandFingerprint: row.command_fingerprint,
    payerId: row.payer_id,
    payeeId: row.payee_id,
    amount: String(row.amount),
    currency: row.currency.trim(),
    clientReference: row.client_reference,
    providerProfile: row.provider_profile.trim(),
    callbackUrl: row.callback_url,
    providerReference: row.provider_reference,
    internalState: row.internal_state,
    publicStatus: row.public_status,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: iso(row.completed_at),
    history: typeof row.history === 'string' ? JSON.parse(row.history) : row.history
  };
}

async function updateTransfer(client, previousState, next) {
  const result = await client.query(
    `UPDATE transfers
       SET provider_reference = $1,
           internal_state = $2,
           public_status = $3,
           failure_code = $4,
           failure_message = $5,
           history = $6::jsonb,
           updated_at = $7,
           completed_at = $8
     WHERE transfer_id = $9 AND internal_state = $10
     RETURNING *`,
    [
      next.providerReference,
      next.internalState,
      next.publicStatus,
      next.failureCode,
      next.failureMessage,
      JSON.stringify(next.history),
      next.updatedAt,
      next.completedAt,
      next.transferId,
      previousState
    ]
  );
  if (result.rowCount === 0) {
    throw new DomainError(
      'CONCURRENT_STATE_CHANGE',
      `Transfer ${next.transferId} changed while it was being processed.`,
      409
    );
  }
  const saved = recordFromRow(result.rows[0]);
  await insertTrace(client, saved, 'workflow',
    ['FULFILLED', 'FAILED'].includes(saved.internalState) ? 'TERMINAL_STATE' : 'STATE_TRANSITION',
    { previousState, nextState: saved.internalState });
  return saved;
}

async function insertTrace(client, record, boundary, eventType, details = {}) {
  if (!record?.traceId || !record?.transferId) return;
  await client.query(
    `INSERT INTO trace_events(trace_id, transfer_id, boundary, event_type, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [record.traceId, record.transferId, boundary, eventType, JSON.stringify(details)]
  );
}

async function consumeInbox(client, inbox) {
  if (!inbox?.eventId) return true;
  const result = await client.query(
    `INSERT INTO inbox_events(event_id, topic, payload_hash) VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [inbox.eventId, inbox.topic, createHash('sha256').update(JSON.stringify(inbox.payload)).digest('hex')]
  );
  return result.rowCount === 1;
}

async function insertOutbox(client, aggregateId, event) {
  if (!event) return;
  const eventId = event.eventId ?? randomUUID();
  await client.query(
    `INSERT INTO outbox_events(event_id, aggregate_id, topic, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, aggregateId, event.topic, JSON.stringify({ ...event.payload, eventId })]
  );
}

export class PostgresPersistence {
  constructor({
    connectionString,
    defaultPayerBalance = 100_000_000n,
    poolOptions = {},
    diagnostics = null
  }) {
    if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL persistence.');
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString, max: 10, ...poolOptions });
    // Pool error handlers only cover idle pooled clients. Checked-out clients
    // can also disconnect between queries; their failed queries still reject,
    // but the background error event must not terminate the application.
    this.pool.on('connect', (client) => client.on('error', (error) => {
      process.stderr.write(`PostgreSQL client connection error: ${error.message}\n`);
    }));
    this.pool.on('error', (error) => {
      process.stderr.write(`PostgreSQL pool connection error: ${error.message}\n`);
    });
    this.pool = instrumentPool(this.pool, diagnostics);
    this.defaultPayerBalance = BigInt(defaultPayerBalance);
    this.kind = 'postgres';
    this.supportsOutbox = true;
  }

  async start() {
    await migrate(this.pool);
  }

  async stop() {
    await this.pool.end();
  }

  async createOrGet(command, idempotencyKey, { initialOutboxTopic = null, receivedAt = new Date().toISOString() } = {}) {
    if (!idempotencyKey) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.', 400);
    }
    const normalized = validateTransferCommand(command);
    const candidate = createTransferRecord(normalized, idempotencyKey);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO transfers(
           transfer_id, trace_id, idempotency_key, command_fingerprint, payer_id, payee_id,
           amount, currency, client_reference, provider_profile, callback_url,
           provider_reference, internal_state, public_status, failure_code,
           failure_message, history, created_at, updated_at, completed_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20
         )
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          candidate.transferId,
          candidate.traceId,
          candidate.idempotencyKey,
          candidate.commandFingerprint,
          candidate.payerId,
          candidate.payeeId,
          candidate.amount,
          candidate.currency,
          candidate.clientReference,
          candidate.providerProfile,
          candidate.callbackUrl,
          candidate.providerReference,
          candidate.internalState,
          candidate.publicStatus,
          candidate.failureCode,
          candidate.failureMessage,
          JSON.stringify(candidate.history),
          candidate.createdAt,
          candidate.updatedAt,
          candidate.completedAt
        ]
      );

      if (inserted.rowCount > 0) {
        await insertTrace(client, candidate, 'client-api', 'API_RECEIVED', {
          idempotencyKey: candidate.idempotencyKey, receivedAt
        });
        if (initialOutboxTopic) {
          await insertOutbox(client, candidate.transferId, {
            topic: initialOutboxTopic,
            payload: { transferId: candidate.transferId }
          });
        }
        await client.query('COMMIT');
        return { record: recordFromRow(inserted.rows[0]), created: true };
      }

      const existingResult = await client.query(
        'SELECT * FROM transfers WHERE idempotency_key = $1 FOR UPDATE',
        [String(idempotencyKey)]
      );
      const existing = recordFromRow(existingResult.rows[0]);
      if (existing.commandFingerprint !== commandFingerprint(normalized)) {
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was already used for a different transfer.',
          409
        );
      }
      await client.query('COMMIT');
      return { record: existing, created: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(transferId) {
    const result = await this.pool.query('SELECT * FROM transfers WHERE transfer_id = $1', [transferId]);
    return recordFromRow(result.rows[0]);
  }

  async list() {
    const result = await this.pool.query('SELECT * FROM transfers ORDER BY created_at, transfer_id');
    return result.rows.map(recordFromRow);
  }

  async transition(record, nextState, patch = {}, { outbox = null, inbox = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const fresh = recordFromRow((await client.query('SELECT * FROM transfers WHERE transfer_id = $1 FOR UPDATE', [record.transferId])).rows[0]);
      const claimed = await consumeInbox(client, inbox);
      if (!claimed || fresh.internalState === nextState || fresh.publicStatus !== 'PENDING') {
        await client.query('COMMIT');
        return fresh;
      }
      const next = transitionTransfer(fresh, nextState, patch);
      const saved = await updateTransfer(client, fresh.internalState, next);
      await insertOutbox(client, record.transferId, outbox);
      await client.query('COMMIT');
      await this.confirmTerminal(client, saved);
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fulfill(record, patch = {}, { outbox = null, inbox = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockedResult = await client.query(
        'SELECT * FROM transfers WHERE transfer_id = $1 FOR UPDATE',
        [record.transferId]
      );
      const locked = recordFromRow(lockedResult.rows[0]);
      if (!locked) throw new DomainError('TRANSFER_NOT_FOUND', 'Transfer was not found.', 404);
      const claimed = await consumeInbox(client, inbox);
      if (!claimed || locked.publicStatus !== 'PENDING') {
        await client.query('COMMIT');
        await this.confirmTerminal(client, locked, true);
        return locked;
      }

      const next = transitionTransfer(locked, INTERNAL_STATE.FULFILLED, patch);
      await client.query(
        `INSERT INTO accounts(account_id, currency, opening_balance, balance)
         VALUES ($1, $2, $3, $3), ($4, $2, 0, 0)
         ON CONFLICT (account_id, currency) DO NOTHING`,
        [locked.payerId, locked.currency, String(this.defaultPayerBalance), locked.payeeId]
      );
      const accounts = await client.query(
        `SELECT account_id, balance FROM accounts
          WHERE currency = $3 AND account_id IN ($1, $2)
          ORDER BY account_id FOR UPDATE`,
        [locked.payerId, locked.payeeId, locked.currency]
      );
      const balances = new Map(accounts.rows.map((row) => [row.account_id, BigInt(row.balance)]));
      const amount = BigInt(locked.amount);
      if ((balances.get(locked.payerId) ?? 0n) < amount) {
        throw new DomainError('INSUFFICIENT_FUNDS', 'The payer has insufficient synthetic funds.', 422);
      }

      await client.query(
        `UPDATE accounts SET balance = balance - $1, updated_at = clock_timestamp()
          WHERE account_id = $2 AND currency = $3`,
        [locked.amount, locked.payerId, locked.currency]
      );
      await client.query(
        `UPDATE accounts SET balance = balance + $1, updated_at = clock_timestamp()
          WHERE account_id = $2 AND currency = $3`,
        [locked.amount, locked.payeeId, locked.currency]
      );
      const ledgerTransaction = await client.query(
        `INSERT INTO ledger_transactions(transfer_id, amount, currency)
         VALUES ($1, $2, $3)
         RETURNING ledger_transaction_id`,
        [locked.transferId, locked.amount, locked.currency]
      );
      const ledgerTransactionId = ledgerTransaction.rows[0].ledger_transaction_id;
      await client.query(
        `INSERT INTO ledger_postings(
           ledger_transaction_id, transfer_id, account_id, currency, entry_type, amount
         ) VALUES
           ($1, $2, $3, $4, 'DEBIT', $5),
           ($1, $2, $6, $4, 'CREDIT', $5)`,
        [
          ledgerTransactionId,
          locked.transferId,
          locked.payerId,
          locked.currency,
          locked.amount,
          locked.payeeId
        ]
      );
      const saved = await updateTransfer(client, locked.internalState, next);
      await insertOutbox(client, locked.transferId, outbox);
      await client.query('COMMIT');
      await this.confirmTerminal(client, saved);
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(record, error, { outbox = null, inbox = null } = {}) {
    if (!record || [INTERNAL_STATE.FULFILLED, INTERNAL_STATE.FAILED].includes(record.internalState)) {
      return record;
    }
    return this.transition(record, INTERNAL_STATE.FAILED, {
      failureCode: error?.code ?? 'WORKFLOW_ERROR',
      failureMessage: error?.message ?? 'The transfer workflow failed.'
    }, { outbox, inbox });
  }

  async confirmTerminal(client, record, recovered = false) {
    if (record.publicStatus === 'PENDING') return;
    const confirmedAt = new Date().toISOString();
    await client.query(`INSERT INTO trace_events(trace_id, transfer_id, boundary, event_type, details)
      SELECT $1, $2, 'persistence', 'COMMIT_CONFIRMED', $3::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM trace_events WHERE transfer_id = $2 AND event_type = 'COMMIT_CONFIRMED')`,
    [record.traceId, record.transferId, JSON.stringify({ state: record.internalState, confirmedAt, recovered })]);
    this.terminalNotifier?.notify(record);
  }

  async ensureProviderCommand(record) {
    const result = await this.pool.query(`INSERT INTO provider_commands(transfer_id, request_key) VALUES ($1, $2)
      ON CONFLICT (transfer_id) DO UPDATE SET request_key = provider_commands.request_key RETURNING result`,
    [record.transferId, record.idempotencyKey]);
    return result.rows[0].result;
  }

  async isInboxProcessed(eventId) {
    return (await this.pool.query('SELECT 1 FROM inbox_events WHERE event_id = $1', [eventId])).rowCount > 0;
  }

  async completeProviderEvent(record, result, inbox, outbox) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (await consumeInbox(client, inbox)) await insertOutbox(client, record.transferId, outbox);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async seed(accountId, amount, currency = 'UGX') {
    await this.pool.query(
      `INSERT INTO accounts(account_id, currency, opening_balance, balance)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (account_id, currency) DO UPDATE
         SET opening_balance = EXCLUDED.opening_balance,
             balance = EXCLUDED.balance,
             updated_at = clock_timestamp()`,
      [String(accountId), currency, String(amount)]
    );
  }

  async balance(accountId, currency = 'UGX') {
    const result = await this.pool.query(
      'SELECT balance FROM accounts WHERE account_id = $1 AND currency = $2',
      [String(accountId), currency]
    );
    return String(result.rows[0]?.balance ?? 0);
  }

  async entries() {
    const result = await this.pool.query(
      `SELECT lt.transfer_id, lt.currency, lt.amount,
              debit.account_id AS debit_account_id,
              credit.account_id AS credit_account_id,
              debit.amount AS debit_amount, credit.amount AS credit_amount,
              debit.currency AS debit_currency, credit.currency AS credit_currency,
              debit.transfer_id AS debit_transfer_id, credit.transfer_id AS credit_transfer_id
         FROM ledger_transactions lt
         LEFT JOIN ledger_postings debit
           ON debit.ledger_transaction_id = lt.ledger_transaction_id
          AND debit.entry_type = 'DEBIT'
         LEFT JOIN ledger_postings credit
           ON credit.ledger_transaction_id = lt.ledger_transaction_id
          AND credit.entry_type = 'CREDIT'
        ORDER BY lt.created_at, lt.transfer_id`
    );
    return result.rows.map((row) => ({
      transferId: row.transfer_id,
      currency: row.currency.trim(),
      amount: String(row.amount),
      debit: { accountId: row.debit_account_id, amount: row.debit_amount === null ? null : String(row.debit_amount), currency: row.debit_currency?.trim(), transferId: row.debit_transfer_id },
      credit: { accountId: row.credit_account_id, amount: row.credit_amount === null ? null : String(row.credit_amount), currency: row.credit_currency?.trim(), transferId: row.credit_transfer_id }
    }));
  }

  async checkConservation() {
    const result = await this.pool.query(
      `SELECT currency, COALESCE(SUM(opening_balance), 0)::text AS opening,
              COALESCE(SUM(balance), 0)::text AS current
         FROM accounts GROUP BY currency`
    );
    return { passed: result.rows.every(({ opening, current }) => opening === current), currencies: result.rows };
  }

  async checkAccountPostings() {
    const result = await this.pool.query(`SELECT a.account_id, a.currency FROM accounts a
      LEFT JOIN ledger_postings p ON p.account_id = a.account_id AND p.currency = a.currency
      GROUP BY a.account_id, a.currency, a.opening_balance, a.balance
      HAVING a.balance <> a.opening_balance + COALESCE(SUM(CASE p.entry_type WHEN 'CREDIT' THEN p.amount ELSE -p.amount END), 0)`);
    return { passed: result.rowCount === 0, mismatches: result.rows };
  }

  async recordProviderAttempt(attempt, { outbox = null, inbox = null, result = null } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT transfer_id FROM transfers WHERE transfer_id = $1 FOR UPDATE', [attempt.transferId]);
      if (!await consumeInbox(client, inbox)) { await client.query('COMMIT'); return; }
      await client.query(
        `INSERT INTO provider_attempts(
         transfer_id, attempt_number, provider_profile, request_payload,
         response_payload, outcome, failure_code, started_at, completed_at
       ) VALUES (
         $1,
         (SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM provider_attempts WHERE transfer_id = $1),
         $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8
       )`,
        [
          attempt.transferId,
          attempt.providerProfile,
          JSON.stringify(attempt.requestPayload),
          attempt.responsePayload ? JSON.stringify(attempt.responsePayload) : null,
          attempt.outcome,
          attempt.failureCode ?? null,
          attempt.startedAt,
          attempt.completedAt ?? null
        ]
      );
      await insertTrace(client, recordFromRow((await client.query(
        'SELECT * FROM transfers WHERE transfer_id = $1', [attempt.transferId]
      )).rows[0]), 'provider-adapter', 'PROVIDER_ATTEMPT', {
        outcome: attempt.outcome,
        failureCode: attempt.failureCode ?? null
      });
      await insertOutbox(client, attempt.transferId, outbox);
      if (result) await client.query('UPDATE provider_commands SET result = $2::jsonb, resolved_at = clock_timestamp() WHERE transfer_id = $1', [attempt.transferId, JSON.stringify(result)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordCallbackDelivery(delivery) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
      `INSERT INTO callback_deliveries(
         transfer_id, callback_url, payload, attempt_number, delivered,
         http_status, error_message, attempted_at
       ) VALUES (
         $1, $2, $3::jsonb,
         (SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM callback_deliveries WHERE transfer_id = $1),
         $4, $5, $6, $7
       )`,
      [
        delivery.transferId,
        delivery.callbackUrl,
        JSON.stringify(delivery.payload),
        delivery.delivered,
        delivery.httpStatus,
        delivery.error,
        delivery.deliveredAt
      ]
      );
      const transfer = recordFromRow((await client.query(
        'SELECT * FROM transfers WHERE transfer_id = $1', [delivery.transferId]
      )).rows[0]);
      await insertTrace(client, transfer, 'client-callback',
        delivery.delivered ? 'FINAL_RESULT_DELIVERY' : 'CALLBACK_ATTEMPT', {
        delivered: delivery.delivered,
        httpStatus: delivery.httpStatus ?? null
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordTraceEvent(transferId, boundary, eventType, details = {}) {
    const client = await this.pool.connect();
    try {
      const transfer = recordFromRow((await client.query(
        'SELECT * FROM transfers WHERE transfer_id = $1', [transferId]
      )).rows[0]);
      await insertTrace(client, transfer, boundary, eventType, details);
    } finally {
      client.release();
    }
  }

  async listTraceEvents() {
    const result = await this.pool.query(
      `SELECT trace_event_id, trace_id, transfer_id, boundary, event_type, details, occurred_at
         FROM trace_events ORDER BY trace_event_id`
    );
    return result.rows;
  }

  async telemetrySnapshot() {
    const [workflow, infrastructure, database] = await Promise.all([
      this.pool.query(`
        SELECT
          COUNT(*)::float8 AS transfers_total,
          COUNT(*) FILTER (WHERE public_status = 'PENDING')::float8 AS transfers_pending,
          COUNT(*) FILTER (WHERE public_status = 'COMPLETED')::float8 AS transfers_completed,
          COUNT(*) FILTER (WHERE public_status = 'FAILED')::float8 AS transfers_failed,
          COUNT(*) FILTER (WHERE public_status = 'COMPLETED')::float8 AS correct_transfers
        FROM transfers
      `),
      this.pool.query(`
        WITH complete_traces AS (
          SELECT transfer_id
          FROM trace_events
          GROUP BY transfer_id
          HAVING bool_or(event_type = 'API_RECEIVED')
             AND bool_or(event_type = 'INITIAL_RESPONSE')
             AND bool_or(event_type = 'TERMINAL_STATE')
             AND bool_or(event_type = 'PROVIDER_ATTEMPT')
             AND bool_or(event_type = 'FINAL_RESULT_DELIVERY')
        )
        SELECT
          (SELECT COUNT(*)::float8 FROM outbox_events WHERE published_at IS NULL) AS outbox_pending,
          (SELECT COUNT(*)::float8 FROM provider_attempts) AS provider_attempts,
          (SELECT COUNT(*)::float8 FROM callback_deliveries WHERE delivered) AS callbacks_delivered,
          (SELECT COUNT(*)::float8 FROM callback_deliveries WHERE NOT delivered) AS callbacks_failed,
          (SELECT COUNT(*)::float8 FROM ledger_transactions) AS ledger_transactions,
          (SELECT COUNT(*)::float8 FROM trace_events) AS trace_events,
          (SELECT COUNT(*)::float8 FROM dead_letter_events) AS dead_letters,
          COALESCE((SELECT COUNT(*)::float8 FROM complete_traces)
            / NULLIF((SELECT COUNT(*)::float8 FROM transfers), 0), 1) AS trace_completeness_ratio
      `),
      this.pool.query(`
        SELECT xact_commit::float8, blks_read::float8, blks_hit::float8,
               tup_inserted::float8, tup_updated::float8, tup_deleted::float8,
               temp_bytes::float8
          FROM pg_stat_database WHERE datname = current_database()
      `)
    ]);
    return {
      ...workflow.rows[0],
      ...infrastructure.rows[0],
      ...database.rows[0]
    };
  }

  async enqueueOutbox(topic, payload) {
    const eventId = payload.eventId ?? randomUUID();
    await this.pool.query(
      `INSERT INTO outbox_events(event_id, aggregate_id, topic, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, payload.transferId, topic, JSON.stringify({ ...payload, eventId })]
    );
    return eventId;
  }

  async recordDeadLetter(transferId, category, error, details = {}) {
    await this.pool.query(
      `INSERT INTO dead_letter_events(
         transfer_id, category, error_code, error_message, details
       ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        transferId,
        category,
        error?.code ?? null,
        error?.message ?? 'Unknown workflow error.',
        JSON.stringify(details)
      ]
    );
  }

  async listDeadLetters() {
    const result = await this.pool.query(
      'SELECT * FROM dead_letter_events ORDER BY dead_letter_id'
    );
    return result.rows;
  }

  async unpublishedOutbox(limit = 100) {
    const result = await this.pool.query(
      `SELECT event_id, topic, payload FROM outbox_events
        WHERE published_at IS NULL
          AND next_attempt_at <= clock_timestamp()
        ORDER BY created_at
        LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      topic: row.topic,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    }));
  }

  async markOutboxPublished(eventId) {
    await this.pool.query(
      `UPDATE outbox_events
          SET published_at = clock_timestamp(),
              publish_attempts = publish_attempts + 1,
              last_error = NULL
        WHERE event_id = $1`,
      [eventId]
    );
  }

  async markOutboxFailed(eventId, error) {
    await this.pool.query(
      `UPDATE outbox_events
          SET publish_attempts = publish_attempts + 1,
              last_error = $2,
              next_attempt_at = clock_timestamp()
                + make_interval(secs => LEAST(30, POWER(2, publish_attempts)::integer))
        WHERE event_id = $1`,
      [eventId, error.message]
    );
  }

  async claimInbox(eventId, topic, payload) {
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const result = await this.pool.query(
      `INSERT INTO inbox_events(event_id, topic, payload_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, topic, payloadHash]
    );
    return result.rowCount === 1;
  }

  async createExperimentRun(run) {
    const result = await this.pool.query(
      `INSERT INTO experiment_runs(
         condition_id, coordination_mode, client_mode, offered_load,
         network_profile, fault_scenario, random_seed, configuration, manifest
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
       RETURNING *`,
      [
        run.conditionId,
        run.coordinationMode,
        run.clientMode,
        run.offeredLoad ?? null,
        run.networkProfile ?? null,
        run.faultScenario ?? null,
        run.randomSeed ?? null,
        JSON.stringify(run.configuration ?? {}),
        JSON.stringify(run.manifest ?? {})
      ]
    );
    return result.rows[0];
  }

  async finishExperimentRun(experimentRunId, { status, exclusionReason = null }) {
    if (!['QUALIFIED', 'EXCLUDED', 'FAILED'].includes(status)) {
      throw new DomainError(
        'INVALID_RUN_STATUS',
        'Run status must be QUALIFIED, EXCLUDED, or FAILED.',
        400
      );
    }
    const result = await this.pool.query(
      `UPDATE experiment_runs
          SET qualification_status = $2,
              exclusion_reason = $3,
              completed_at = clock_timestamp()
        WHERE experiment_run_id = $1
        RETURNING *`,
      [experimentRunId, status, exclusionReason]
    );
    return result.rows[0] ?? null;
  }

  async recordReconciliation(report, experimentRunId = null) {
    await this.pool.query(
      `INSERT INTO reconciliation_results(
         experiment_run_id, passed, transfer_count, ledger_transaction_count, checks, conservation
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        experimentRunId,
        report.passed,
        report.transferCount,
        report.ledgerEntryCount,
        JSON.stringify(report.checks),
        JSON.stringify(report.conservation)
      ]
    );
  }

  async listTables() {
    const result = await this.pool.query(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name
    `);
    return result.rows.map(({ table_name }) => table_name);
  }

  async listAccounts() {
    const result = await this.pool.query(`
      SELECT account_id, currency, opening_balance, balance, created_at, updated_at
        FROM accounts ORDER BY account_id, currency
    `);
    return result.rows.map((row) => ({
      accountId: row.account_id,
      currency: row.currency.trim(),
      openingBalance: String(row.opening_balance),
      balance: String(row.balance),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    }));
  }

  async listProviderAttempts() {
    const result = await this.pool.query(`
      SELECT * FROM provider_attempts ORDER BY provider_attempt_id
    `);
    return result.rows;
  }

  async listOutbox() {
    const result = await this.pool.query(`
      SELECT event_id, aggregate_id, topic, payload, created_at,
             published_at, publish_attempts, last_error, next_attempt_at
        FROM outbox_events ORDER BY created_at, event_id
    `);
    return result.rows;
  }

  async recoveryCandidates() {
    const result = await this.pool.query(`SELECT t.* FROM transfers t WHERE public_status = 'PENDING'
      OR NOT EXISTS (SELECT 1 FROM callback_deliveries c WHERE c.transfer_id = t.transfer_id AND c.delivered)
      ORDER BY created_at`);
    return result.rows.map(recordFromRow);
  }

  async reset() {
    await this.pool.query(`
      TRUNCATE TABLE
        dead_letter_events,
        trace_events,
        reconciliation_results,
        experiment_runs,
        callback_deliveries,
        inbox_events,
        outbox_events,
        provider_attempts,
        provider_commands,
        ledger_postings,
        ledger_transactions,
        accounts,
        transfers
      RESTART IDENTITY CASCADE
    `);
  }
}
