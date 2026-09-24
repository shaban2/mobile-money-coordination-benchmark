import { randomUUID } from 'node:crypto';
import { INTERNAL_STATE, transitionTransfer } from '../domain/transfer.js';
import { InMemoryLedger } from './in-memory-ledger.js';
import { InMemoryTransferRepository } from './in-memory-transfer-repository.js';

export class InMemoryPersistence {
  constructor(options = {}) {
    this.repository = new InMemoryTransferRepository();
    this.ledger = new InMemoryLedger(options);
    this.providerAttempts = [];
    this.providerCommands = new Map();
    this.callbackDeliveries = [];
    this.outbox = [];
    this.inbox = new Set();
    this.experimentRuns = [];
    this.reconciliationResults = [];
    this.traceEvents = [];
    this.deadLetters = [];
    this.kind = 'memory';
    this.supportsOutbox = false;
  }

  async start() {}

  async stop() {}

  async createOrGet(command, idempotencyKey, { receivedAt = new Date().toISOString() } = {}) {
    const result = this.repository.createOrGet(command, idempotencyKey);
    if (result.created) await this.recordTraceEvent(result.record.transferId, 'client-api', 'API_RECEIVED', { receivedAt });
    return result;
  }

  async get(transferId) {
    return this.repository.get(transferId);
  }

  async list() {
    return this.repository.list();
  }

  async transition(record, nextState, patch = {}) {
    record = this.repository.get(record.transferId);
    if (record.internalState === nextState || record.publicStatus !== 'PENDING') return record;
    const saved = this.repository.save(transitionTransfer(record, nextState, patch));
    await this.recordTraceEvent(saved.transferId, 'workflow',
      ['FULFILLED', 'FAILED'].includes(saved.internalState) ? 'TERMINAL_STATE' : 'STATE_TRANSITION',
      { nextState: saved.internalState });
    if (saved.publicStatus !== 'PENDING') {
      await this.recordTraceEvent(saved.transferId, 'persistence', 'COMMIT_CONFIRMED', { state: saved.internalState, confirmedAt: new Date().toISOString(), recovered: false });
      this.terminalNotifier?.notify(saved);
    }
    return saved;
  }

  async fulfill(record, patch = {}) {
    record = this.repository.get(record.transferId);
    if (record.publicStatus !== 'PENDING') return record;
    this.ledger.applyTransfer(record);
    return this.transition(record, INTERNAL_STATE.FULFILLED, patch);
  }

  async fail(record, error) {
    if (!record || [INTERNAL_STATE.FULFILLED, INTERNAL_STATE.FAILED].includes(record.internalState)) {
      return record;
    }
    return this.transition(record, INTERNAL_STATE.FAILED, {
      failureCode: error?.code ?? 'WORKFLOW_ERROR',
      failureMessage: error?.message ?? 'The transfer workflow failed.'
    });
  }

  async seed(accountId, amount) {
    this.ledger.seed(accountId, amount);
  }

  async balance(accountId) {
    return this.ledger.balance(accountId);
  }

  async entries() {
    return this.ledger.entries();
  }

  async checkConservation() {
    return this.ledger.checkConservation();
  }

  async checkAccountPostings() {
    const expected = new Map(this.ledger.openingBalances);
    for (const entry of this.ledger.entries()) {
      expected.set(entry.debit.accountId, (expected.get(entry.debit.accountId) ?? 0n) - BigInt(entry.debit.amount));
      expected.set(entry.credit.accountId, (expected.get(entry.credit.accountId) ?? 0n) + BigInt(entry.credit.amount));
    }
    return { passed: [...this.ledger.balances].every(([id, amount]) => expected.get(id) === amount) };
  }

  async ensureProviderCommand(record) {
    if (!this.providerCommands.has(record.transferId)) this.providerCommands.set(record.transferId, null);
    return structuredClone(this.providerCommands.get(record.transferId));
  }

  async recordProviderAttempt(attempt, { result = null } = {}) {
    if (result) this.providerCommands.set(attempt.transferId, structuredClone(result));
    this.providerAttempts.push(structuredClone(attempt));
    await this.recordTraceEvent(attempt.transferId, 'provider-adapter', 'PROVIDER_ATTEMPT', {
      outcome: attempt.outcome
    });
  }

  async recordCallbackDelivery(delivery) {
    this.callbackDeliveries.push(structuredClone(delivery));
    await this.recordTraceEvent(delivery.transferId, 'client-callback',
      delivery.delivered ? 'FINAL_RESULT_DELIVERY' : 'CALLBACK_ATTEMPT', {
      delivered: delivery.delivered
    });
  }

  async recordTraceEvent(transferId, boundary, eventType, details = {}) {
    const transfer = this.repository.get(transferId);
    if (!transfer) return;
    this.traceEvents.push({
      traceEventId: this.traceEvents.length + 1,
      traceId: transfer.traceId,
      transferId,
      boundary,
      eventType,
      details: structuredClone(details),
      occurredAt: new Date().toISOString()
    });
  }

  async listTraceEvents() {
    return structuredClone(this.traceEvents);
  }

  async telemetrySnapshot() {
    const transfers = this.repository.list();
    const complete = transfers.filter((transfer) => {
      const types = new Set(this.traceEvents
        .filter((event) => event.transferId === transfer.transferId)
        .map((event) => event.eventType));
      return ['API_RECEIVED', 'INITIAL_RESPONSE', 'TERMINAL_STATE', 'PROVIDER_ATTEMPT', 'FINAL_RESULT_DELIVERY']
        .every((type) => types.has(type));
    }).length;
    return {
      transfers_total: transfers.length,
      transfers_pending: transfers.filter(({ publicStatus }) => publicStatus === 'PENDING').length,
      transfers_completed: transfers.filter(({ publicStatus }) => publicStatus === 'COMPLETED').length,
      transfers_failed: transfers.filter(({ publicStatus }) => publicStatus === 'FAILED').length,
      correct_transfers: transfers.filter(({ publicStatus }) => publicStatus === 'COMPLETED').length,
      outbox_pending: this.outbox.filter(({ publishedAt }) => !publishedAt).length,
      provider_attempts: this.providerAttempts.length,
      callbacks_delivered: this.callbackDeliveries.filter(({ delivered }) => delivered).length,
      callbacks_failed: this.callbackDeliveries.filter(({ delivered }) => !delivered).length,
      ledger_transactions: this.ledger.entries().length,
      trace_events: this.traceEvents.length,
      dead_letters: this.deadLetters.length,
      trace_completeness_ratio: transfers.length === 0 ? 1 : complete / transfers.length
    };
  }

  async recordDeadLetter(transferId, category, error, details = {}) {
    this.deadLetters.push({
      deadLetterId: this.deadLetters.length + 1,
      transferId,
      category,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? 'Unknown workflow error.',
      details: structuredClone(details),
      recordedAt: new Date().toISOString()
    });
  }

  async listDeadLetters() {
    return structuredClone(this.deadLetters);
  }

  async enqueueOutbox(topic, payload) {
    const eventId = payload.eventId ?? randomUUID();
    this.outbox.push({ eventId, topic, payload: { ...structuredClone(payload), eventId } });
    return eventId;
  }

  async unpublishedOutbox(limit = 100) {
    return structuredClone(this.outbox.filter(({ publishedAt }) => !publishedAt).slice(0, limit));
  }

  async markOutboxPublished(eventId) {
    const event = this.outbox.find((item) => item.eventId === eventId);
    if (event) event.publishedAt = new Date().toISOString();
  }

  async markOutboxFailed(eventId, error) {
    const event = this.outbox.find((item) => item.eventId === eventId);
    if (event) event.lastError = error.message;
  }

  async claimInbox(eventId) {
    if (this.inbox.has(eventId)) return false;
    this.inbox.add(eventId);
    return true;
  }

  async createExperimentRun(run) {
    const record = {
      experiment_run_id: randomUUID(),
      ...structuredClone(run),
      started_at: new Date().toISOString()
    };
    this.experimentRuns.push(record);
    return structuredClone(record);
  }

  async finishExperimentRun(experimentRunId, { status, exclusionReason = null }) {
    const run = this.experimentRuns.find((item) => item.experiment_run_id === experimentRunId);
    if (!run) return null;
    run.qualification_status = status;
    run.exclusion_reason = exclusionReason;
    run.completed_at = new Date().toISOString();
    return structuredClone(run);
  }

  async recordReconciliation(report, experimentRunId = null) {
    this.reconciliationResults.push({
      experimentRunId,
      checkedAt: new Date().toISOString(),
      ...structuredClone(report)
    });
  }

  async listTables() {
    return [
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
      'trace_events',
      'transfers'
    ];
  }

  async listAccounts() {
    return [...this.ledger.balances].map(([accountId, balance]) => ({
      accountId,
      currency: 'UGX',
      balance: String(balance),
      openingBalance: String(this.ledger.openingBalances.get(accountId) ?? 0n)
    }));
  }

  async listProviderAttempts() {
    return structuredClone(this.providerAttempts);
  }

  async listOutbox() {
    return structuredClone(this.outbox);
  }

  async recoveryCandidates() {
    return this.repository.list().filter((t) => t.publicStatus === 'PENDING'
      || !this.callbackDeliveries.some((d) => d.transferId === t.transferId && d.delivered));
  }

  async reset() {
    this.repository.reset();
    this.ledger.reset();
    this.providerAttempts.length = 0;
    this.providerCommands.clear();
    this.callbackDeliveries.length = 0;
    this.outbox.length = 0;
    this.inbox.clear();
    this.experimentRuns.length = 0;
    this.reconciliationResults.length = 0;
    this.traceEvents.length = 0;
    this.deadLetters.length = 0;
  }
}
