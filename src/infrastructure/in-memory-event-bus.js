export class InMemoryEventBus {
  constructor() {
    this.handlers = new Map();
    this.events = [];
  }

  subscribe(topic, handler) {
    const handlers = this.handlers.get(topic) ?? [];
    handlers.push(handler);
    this.handlers.set(topic, handlers);
  }

  async publish(topic, payload) {
    this.events.push({ topic, payload: structuredClone(payload), at: new Date().toISOString() });
    for (const handler of this.handlers.get(topic) ?? []) {
      await handler(structuredClone(payload));
    }
  }

  async start() {}

  async stop() {}

  reset() {
    this.events.length = 0;
  }
}
