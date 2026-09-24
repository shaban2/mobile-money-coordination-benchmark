import { DomainError } from '../domain/errors.js';
import { PUBLIC_STATUS, publicTransfer } from '../domain/transfer.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class PaymentApplication {
  constructor({ persistence, coordinator, callbackSink, metrics, clientMode }) {
    Object.assign(this, { persistence, coordinator, callbackSink, metrics, clientMode });
    this.backgroundTasks = new Set();
    this.inFlight = new Map();
  }

  process(record) {
    if (this.inFlight.has(record.transferId)) return this.inFlight.get(record.transferId);
    const task = Promise.resolve().then(async () => {
      const completed = record.publicStatus === 'PENDING' ? await this.coordinator.execute(record.transferId) : record;
      if (!completed || completed.publicStatus === 'PENDING') return completed;
      const delivery = await this.callbackSink.deliver(completed);
      this.metrics.increment(delivery.delivered ? 'final_results_delivered_total' : 'final_result_delivery_failures_total');
      return completed;
    });
    this.inFlight.set(record.transferId, task);
    this.backgroundTasks.add(task);
    task.catch((error) => {
      this.metrics.increment('background_processing_failures_total');
      process.stderr.write(`Recoverable background failure: ${error.message}\n`);
    }).finally(() => { this.inFlight.delete(record.transferId); this.backgroundTasks.delete(task); });
    return task;
  }

  async recover() {
    for (const record of await this.persistence.recoveryCandidates()) this.process(record);
  }

  async submit(command, idempotencyKey, { receivedAt = new Date().toISOString() } = {}) {
    const requestStartedAt = performance.now();
    const { record, created } = await this.persistence.createOrGet(command, idempotencyKey, {
      receivedAt,
      initialOutboxTopic: this.persistence.supportsOutbox
        ? this.coordinator.initialOutboxTopic
        : null
    });
    this.metrics.increment('transfer_requests_total');

    if (!created) {
      this.metrics.increment('idempotent_replays_total');
      return {
        httpStatus: record.publicStatus === PUBLIC_STATUS.PENDING ? 202 : 200,
        replayed: true,
        body: publicTransfer(record)
      };
    }

    if (this.clientMode === 'async') {
      this.process(record);
      await this.persistence.recordTraceEvent(
        record.transferId,
        'client-api',
        'INITIAL_RESPONSE',
        { clientMode: 'async', httpStatus: 202 }
      );
      this.metrics.observe('initial_response_latency', performance.now() - requestStartedAt);
      return { httpStatus: 202, replayed: false, body: publicTransfer(record) };
    }

    const completed = await this.coordinator.execute(record.transferId);
    await this.persistence.recordTraceEvent(
      completed.transferId,
      'client-api',
      'INITIAL_RESPONSE',
      { clientMode: 'sync', httpStatus: 200 }
    );
    await this.persistence.recordTraceEvent(
      completed.transferId,
      'client-api',
      'FINAL_RESULT_DELIVERY',
      { clientMode: 'sync', httpStatus: 200 }
    );
    this.metrics.observe('initial_response_latency', performance.now() - requestStartedAt);
    this.metrics.observe('final_result_delivery_latency', performance.now() - requestStartedAt);
    return { httpStatus: 200, replayed: false, body: publicTransfer(completed) };
  }

  async get(transferId) {
    const record = await this.persistence.get(transferId);
    if (!record) {
      throw new DomainError('TRANSFER_NOT_FOUND', 'Transfer was not found.', 404);
    }
    if (record.publicStatus !== PUBLIC_STATUS.PENDING) {
      await this.persistence.recordTraceEvent(
        record.transferId,
        'client-status',
        'FINAL_RESULT_DELIVERY',
        { delivery: 'status-retrieval' }
      );
    }
    return publicTransfer(record);
  }

  async drain() {
    while (this.backgroundTasks.size) await Promise.allSettled([...this.backgroundTasks]);
  }

  async waitForTerminal(transferId, { timeoutMs = 5_000, pollMs = 5 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const record = await this.persistence.get(transferId);
      if (record && record.publicStatus !== PUBLIC_STATUS.PENDING) {
        return publicTransfer(record);
      }
      await wait(pollMs);
    }
    throw new Error(`Transfer ${transferId} did not reach a terminal status within ${timeoutMs} ms.`);
  }

  async invariants({ persist = true, experimentRunId = null } = {}) {
    const transfers = await this.persistence.list();
    const ledgerEntries = await this.persistence.entries();
    const entriesByTransfer = new Map(ledgerEntries.map((entry) => [entry.transferId, entry]));
    const transfersById = new Map(transfers.map((transfer) => [transfer.transferId, transfer]));
    const terminalStatesNeverReversed = transfers.every((transfer) => {
      const terminalIndex = transfer.history.findIndex(({ state }) => ['FULFILLED', 'FAILED'].includes(state));
      return terminalIndex < 0 || terminalIndex === transfer.history.length - 1;
    });
    const fulfilledHaveOneLedgerEntry = transfers
      .filter(({ publicStatus }) => publicStatus === PUBLIC_STATUS.COMPLETED)
      .every(({ transferId }) => entriesByTransfer.has(transferId));
    const failedHaveNoLedgerEntry = transfers
      .filter(({ publicStatus }) => publicStatus === PUBLIC_STATUS.FAILED)
      .every(({ transferId }) => !entriesByTransfer.has(transferId));
    const uniqueLedgerEntries = new Set(ledgerEntries.map(({ transferId }) => transferId)).size === ledgerEntries.length;
    const balancedLedgerEntries = ledgerEntries.every((entry) =>
      entry.debit.amount !== null && entry.credit.amount !== null && entry.debit.amount === entry.credit.amount
    );
    const ledgerMatchesTransfers = ledgerEntries.every((entry) => {
      const transfer = transfersById.get(entry.transferId);
      return transfer
        && transfer.publicStatus === PUBLIC_STATUS.COMPLETED
        && transfer.payerId === entry.debit.accountId
        && transfer.payeeId === entry.credit.accountId
        && transfer.amount === entry.debit.amount
        && transfer.amount === entry.credit.amount
        && (entry.amount === undefined || transfer.amount === entry.amount)
        && [entry.debit, entry.credit].every((posting) =>
          (posting.currency === undefined || posting.currency === transfer.currency)
          && (posting.transferId === undefined || posting.transferId === transfer.transferId))
        && transfer.currency === entry.currency;
    });
    const conservation = await this.persistence.checkConservation();
    const accountPostings = await this.persistence.checkAccountPostings?.() ?? { passed: true };
    const checks = {
      terminalStatesNeverReversed,
      fulfilledHaveOneLedgerEntry,
      failedHaveNoLedgerEntry,
      uniqueLedgerEntries,
      balancedLedgerEntries,
      ledgerMatchesTransfers,
      valueConserved: conservation.passed,
      accountBalancesMatchPostings: accountPostings.passed,
      uniqueIdempotencyKeys: new Set(transfers.map((t) => t.idempotencyKey)).size === transfers.length
    };
    const report = {
      passed: Object.values(checks).every(Boolean),
      checks,
      conservation,
      transferCount: transfers.length,
      ledgerEntryCount: ledgerEntries.length,
      accountPostings,
      reconciledTransferIds: Object.values(checks).every(Boolean) ? transfers.filter((t) => t.publicStatus === 'COMPLETED').map((t) => t.transferId) : []
    };
    if (persist) await this.persistence.recordReconciliation(report, experimentRunId);
    return report;
  }
}
