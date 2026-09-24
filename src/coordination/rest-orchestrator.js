import { INTERNAL_STATE } from '../domain/transfer.js';
import { WorkLimiter } from '../infrastructure/work-limiter.js';
import { callProvider } from './workflow-steps.js';
export class RestOrchestrator {
  constructor({ persistence, adapterBoundary, metrics, providerRetryPolicy, workflowTimeoutMs, workerConcurrency = 4 }) {
    Object.assign(this, { persistence, adapterBoundary, metrics, providerRetryPolicy, workflowTimeoutMs });
    this.workers = new WorkLimiter(workerConcurrency);
  }
  async execute(transferId) {
    return this.workers.run(async () => {
      let record = await this.persistence.get(transferId);
      if (record.internalState === INTERNAL_STATE.RECEIVED) record = await this.persistence.transition(record, INTERNAL_STATE.VALIDATED);
      if (record.internalState === INTERNAL_STATE.VALIDATED) record = await this.persistence.transition(record, INTERNAL_STATE.PREPARED);
      if (record.publicStatus !== 'PENDING') return record;
      const result = await callProvider({ record, adapterBoundary: this.adapterBoundary,
        persistence: this.persistence, retryPolicy: this.providerRetryPolicy, workflowTimeoutMs: this.workflowTimeoutMs });
      if (result.status !== 'COMPLETED') return this.persistence.fail(record, Object.assign(new Error(result.failureMessage), { code: result.failureCode }));
      try { return await this.persistence.fulfill(record, { providerReference: result.providerReference }); }
      catch (error) {
        if (error.code !== 'INSUFFICIENT_FUNDS') throw error;
        return this.persistence.fail(record, error);
      }
    });
  }
}
