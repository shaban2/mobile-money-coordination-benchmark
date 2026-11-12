export class OutboxDispatcher {
  constructor({ persistence, eventBus, pollIntervalMs = 50, dispatchMode = 'serial' }) {
    if (!(Number.isFinite(pollIntervalMs) && pollIntervalMs >= 1)) throw new Error('pollIntervalMs must be at least 1.');
    if (!['serial', 'batched'].includes(dispatchMode)) throw new Error('dispatchMode must be serial or batched.');
    this.persistence = persistence;
    this.eventBus = eventBus;
    this.pollIntervalMs = pollIntervalMs;
    this.dispatchMode = dispatchMode;
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
    const events = await this.persistence.unpublishedOutbox(100);
    if (this.dispatchMode === 'batched') return this.publishThenMarkOnce(events);
    for (const event of events) {
      try {
        await this.eventBus.publish(event.topic, { ...event.payload, eventId: event.eventId });
        await this.persistence.markOutboxPublished(event.eventId);
      } catch (error) {
        await this.persistence.markOutboxFailed(event.eventId, error);
        throw error;
      }
    }
  }

  // Experimental variant: same publish order, but one database round trip marks
  // the whole batch. A crash before the mark republishes, which the inbox absorbs.
  async publishThenMarkOnce(events) {
    const published = [];
    try {
      for (const event of events) {
        try {
          await this.eventBus.publish(event.topic, { ...event.payload, eventId: event.eventId });
          published.push(event.eventId);
        } catch (error) {
          await this.persistence.markOutboxFailed(event.eventId, error);
          throw error;
        }
      }
    } finally {
      if (published.length) await this.persistence.markOutboxPublishedBatch(published);
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
