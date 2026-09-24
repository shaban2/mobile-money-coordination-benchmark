import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);

export class KafkaEventBus {
  constructor({
    brokers = ['redpanda:9092'],
    clientId = 'lubanga-experiment',
    namespace = 'default',
    deduplicator = null,
    concurrency = 4,
    kafkaFactory = null
  } = {}) {
    this.brokers = brokers;
    this.clientId = clientId;
    this.namespace = namespace;
    this.deduplicator = deduplicator;
    this.concurrency = concurrency;
    this.kafkaFactory = kafkaFactory;
    this.handlers = new Map();
    this.events = [];
    this.kafka = null;
    this.producer = null;
    this.consumer = null;
  }

  subscribe(topic, handler) {
    const handlers = this.handlers.get(topic) ?? [];
    handlers.push(handler);
    this.handlers.set(topic, handlers);
  }

  async start() {
    const Kafka = this.kafkaFactory ?? require('kafkajs').Kafka;
    this.kafka = new Kafka({ clientId: this.clientId, brokers: this.brokers });
    this.producer = this.kafka.producer({ allowAutoTopicCreation: false });
    this.consumer = this.kafka.consumer({
      groupId: `${this.clientId}-${this.namespace}-workflow`,
      sessionTimeout: 120_000
    });
    const admin = this.kafka.admin();
    await admin.connect();
    await admin.createTopics({
      waitForLeaders: true,
      topics: [...this.handlers.keys()].map((topic) => ({
        topic: this.physicalTopic(topic),
        numPartitions: this.concurrency,
        replicationFactor: 1
      }))
    });
    await admin.disconnect();
    await this.producer.connect();
    await this.consumer.connect();
    for (const topic of this.handlers.keys()) {
      await this.consumer.subscribe({ topic: this.physicalTopic(topic), fromBeginning: false });
    }
    await this.consumer.run({
      partitionsConsumedConcurrently: this.concurrency,
      eachMessage: async ({ topic, message, heartbeat = async () => {} }) => {
        const payload = JSON.parse(message.value.toString('utf8'));
        const logicalTopic = topic.slice(`${this.namespace}.`.length);
        if (this.deduplicator && payload.eventId) {
          if (await this.deduplicator.isInboxProcessed(payload.eventId)) return;
        }
        const timer = setInterval(() => heartbeat().catch(() => {}), 3000);
        try {
          for (const handler of this.handlers.get(logicalTopic) ?? []) await handler(payload, { eventId: payload.eventId, topic: logicalTopic, payload });
        } finally { clearInterval(timer); }
      }
    });
  }

  async publish(topic, payload) {
    if (!this.producer) throw new Error('KafkaEventBus.start() must be called before publish().');
    const eventPayload = { ...payload, eventId: payload.eventId ?? randomUUID() };
    this.events.push({ topic, payload: structuredClone(eventPayload), at: new Date().toISOString() });
    await this.producer.send({
      topic: this.physicalTopic(topic),
      messages: [{ key: payload.transferId, value: JSON.stringify(eventPayload) }]
    });
  }

  async stop() {
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }

  reset() {
    this.events.length = 0;
  }

  physicalTopic(logicalTopic) {
    return `${this.namespace}.${logicalTopic}`;
  }
}
