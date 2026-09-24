import { INTERNAL_STATE } from '../domain/transfer.js';
import { WorkLimiter } from '../infrastructure/work-limiter.js';
import { callProvider } from './workflow-steps.js';
const TOPIC = { RECEIVED: 'transfer.received', VALIDATED: 'transfer.validated', PREPARED: 'transfer.prepared',
  PROVIDER_COMPLETED: 'provider.completed', PROVIDER_FAILED: 'provider.failed', FULFILLED: 'transfer.fulfilled', FAILED: 'transfer.failed' };
export class KafkaChoreography {
  constructor(dependencies) {
    Object.assign(this, dependencies);
    this.initialOutboxTopic = TOPIC.RECEIVED;
    this.workers = new WorkLimiter(dependencies.workerConcurrency ?? 4);
    this.registerHandlers();
  }
  registerHandlers() {
    for (const topic of [TOPIC.FULFILLED, TOPIC.FAILED]) this.eventBus.subscribe(topic, async ({ transferId }) => {
      this.persistence.terminalNotifier.notify(await this.persistence.get(transferId));
    });
    this.eventBus.subscribe(TOPIC.RECEIVED, (payload, inbox) => this.transition(payload, inbox, INTERNAL_STATE.VALIDATED, TOPIC.VALIDATED));
    this.eventBus.subscribe(TOPIC.VALIDATED, (payload, inbox) => this.transition(payload, inbox, INTERNAL_STATE.PREPARED, TOPIC.PREPARED));
    this.eventBus.subscribe(TOPIC.PREPARED, (payload, inbox) => this.workers.run(async () => {
      const record = await this.persistence.get(payload.transferId);
      if (record.publicStatus !== 'PENDING') return;
      const result = await callProvider({ record, adapterBoundary: this.adapterBoundary,
        persistence: this.persistence, retryPolicy: this.providerRetryPolicy, workflowTimeoutMs: this.workflowTimeoutMs });
      const topic = result.status === 'COMPLETED' ? TOPIC.PROVIDER_COMPLETED : TOPIC.PROVIDER_FAILED;
      const outbox = { topic, payload: { transferId: record.transferId, result } };
      if (this.persistence.supportsOutbox) await this.persistence.completeProviderEvent(record, result, inbox, outbox);
      else await this.eventBus.publish(topic, outbox.payload);
    }));
    this.eventBus.subscribe(TOPIC.PROVIDER_COMPLETED, async ({ transferId, result }, inbox) => {
      const record = await this.persistence.get(transferId);
      try {
        await this.persistence.fulfill(record, { providerReference: result.providerReference }, {
          inbox, outbox: { topic: TOPIC.FULFILLED, payload: { transferId } }
        });
      } catch (error) {
        if (error.code !== 'INSUFFICIENT_FUNDS') throw error;
        await this.persistence.fail(record, error, { inbox, outbox: { topic: TOPIC.FAILED, payload: { transferId } } });
      }
    });
    this.eventBus.subscribe(TOPIC.PROVIDER_FAILED, async ({ transferId, result }, inbox) => {
      const record = await this.persistence.get(transferId);
      await this.persistence.fail(record, Object.assign(new Error(result.failureMessage), { code: result.failureCode }), {
        inbox, outbox: { topic: TOPIC.FAILED, payload: { transferId } }
      });
    });
  }
  async transition(payload, inbox, nextState, topic) {
    const record = await this.persistence.get(payload.transferId);
    await this.persistence.transition(record, nextState, {}, { inbox, outbox: { topic, payload } });
    if (!this.persistence.supportsOutbox) await this.eventBus.publish(topic, payload);
  }
  async execute(transferId) {
    if (this.persistence.supportsOutbox) await this.outboxDispatcher.dispatchOnce();
    else {
      const record = await this.persistence.get(transferId);
      const topic = { RECEIVED: TOPIC.RECEIVED, VALIDATED: TOPIC.VALIDATED, PREPARED: TOPIC.PREPARED }[record.internalState];
      if (topic) await this.eventBus.publish(topic, { transferId });
    }
    // wait() registers before reading current state, so a completion during
    // dispatch cannot be missed. Failed dispatch does not leak a wait timer.
    return this.persistence.terminalNotifier.wait(this.persistence, transferId, this.workflowTimeoutMs);
  }
}
