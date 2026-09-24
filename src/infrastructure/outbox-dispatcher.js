export class OutboxDispatcher {
  constructor({ persistence, eventBus, pollIntervalMs = 50 }) {
    this.persistence = persistence;
    this.eventBus = eventBus;
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
    this.running = null;
  }

  async start() {
    if (!this.persistence.supportsOutbox) return;
    await this.dispatchOnce();
    this.timer = setInterval(() => {
      this.dispatchOnce().catch((error) => {
        process.stderr.write(`Outbox dispatch failed: ${error.message}\n`);
      });
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  async dispatchOnce() {
    if (!this.persistence.supportsOutbox) return;
    if (this.running) return this.running;
    this.running = this.dispatchBatch();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  async dispatchBatch() {
    for (const event of await this.persistence.unpublishedOutbox(100)) {
      try {
        await this.eventBus.publish(event.topic, { ...event.payload, eventId: event.eventId });
        await this.persistence.markOutboxPublished(event.eventId);
      } catch (error) {
        await this.persistence.markOutboxFailed(event.eventId, error);
        throw error;
      }
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
