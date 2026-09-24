import { ProfileAAdapter } from './adapters/profile-a-adapter.js';
import { ProfileBAdapter } from './adapters/profile-b-adapter.js';
import { HttpAdapterBoundary } from './adapters/http-adapter-boundary.js';
import { InProcessAdapterBoundary } from './adapters/in-process-adapter-boundary.js';
import { ProviderAdapterRouter } from './adapters/provider-adapter.js';
import { CallbackSink } from './application/callback-sink.js';
import { PaymentApplication } from './application/payment-application.js';
import { KafkaChoreography } from './coordination/kafka-choreography.js';
import { RestOrchestrator } from './coordination/rest-orchestrator.js';
import { InMemoryEventBus } from './infrastructure/in-memory-event-bus.js';
import { InMemoryPersistence } from './infrastructure/in-memory-persistence.js';
import { KafkaEventBus } from './infrastructure/kafka-event-bus.js';
import { Metrics } from './infrastructure/metrics.js';
import { OutboxDispatcher } from './infrastructure/outbox-dispatcher.js';
import { PostgresPersistence } from './infrastructure/postgres/postgres-persistence.js';
import { ProviderSimulator } from './providers/provider-simulator.js';
import { TerminalNotifier } from './infrastructure/terminal-notifier.js';
import { RuntimeDiagnostics, instrumentMethods } from './infrastructure/runtime-diagnostics.js';
import { DatabaseDiagnostics } from './infrastructure/postgres/database-diagnostics.js';

export function createSystem({
  coordinationMode = 'rest',
  clientMode = 'sync',
  providerDelayMs = 0,
  sendHttpCallbacks = false,
  eventBusType = 'memory',
  kafkaBrokers = ['redpanda:9092'],
  eventNamespace = `${coordinationMode}-${clientMode}`,
  persistenceType = 'memory',
  databaseUrl = null,
  defaultPayerBalance = 100_000_000n,
  adapterBaseUrl = null,
  providerRetryMaxAttempts = 1,
  providerRetryDelayMs = 0,
  workflowTimeoutMs = 30_000,
  callbackMaxAttempts = 1,
  callbackRetryDelayMs = 0,
  workerConcurrency = 4,
  recoveryIntervalMs = 1000,
  diagnosticsEnabled = false,
  databaseDiagnosticsEnabled = false
} = {}) {
  if (!['rest', 'kafka'].includes(coordinationMode)) {
    throw new Error('coordinationMode must be rest or kafka.');
  }
  if (!['sync', 'async'].includes(clientMode)) {
    throw new Error('clientMode must be sync or async.');
  }

  if (!['memory', 'postgres'].includes(persistenceType)) {
    throw new Error('persistenceType must be memory or postgres.');
  }
  const diagnostics = new RuntimeDiagnostics({ enabled: diagnosticsEnabled });
  const databaseDiagnostics = new DatabaseDiagnostics({ enabled: databaseDiagnosticsEnabled && persistenceType === 'postgres', connectionString: databaseUrl });
  const persistence = persistenceType === 'postgres'
    ? new PostgresPersistence({
        connectionString: databaseUrl,
        defaultPayerBalance,
        diagnostics
      })
    : new InMemoryPersistence({ defaultPayerBalance });
  persistence.terminalNotifier = new TerminalNotifier();
  instrumentMethods(persistence, diagnostics, ['createOrGet', 'get', 'transition', 'fulfill', 'fail',
    'ensureProviderCommand', 'recordProviderAttempt', 'completeProviderEvent'], 'persistence', (name, args) => ({
      transferId: name === 'createOrGet' ? null : typeof args[0] === 'string' ? args[0] : args[0]?.transferId ?? null,
      ...(name === 'transition' ? { nextState: args[1] } : {})
    }));
  const eventBus = eventBusType === 'kafka'
    ? new KafkaEventBus({
        brokers: kafkaBrokers,
        namespace: eventNamespace,
        deduplicator: persistence,
        concurrency: workerConcurrency
      })
    : new InMemoryEventBus();
  const metrics = new Metrics();
  const outboxDispatcher = new OutboxDispatcher({ persistence, eventBus });
  const provider = new ProviderSimulator({ delayMs: providerDelayMs });
  const callbackSink = new CallbackSink({
    sendHttp: sendHttpCallbacks,
    persistence,
    maxAttempts: callbackMaxAttempts,
    retryDelayMs: callbackRetryDelayMs
  });
  const adapterRouter = new ProviderAdapterRouter([new ProfileAAdapter(), new ProfileBAdapter()]);
  const adapterBoundary = adapterBaseUrl
    ? new HttpAdapterBoundary({ baseUrl: adapterBaseUrl })
    : new InProcessAdapterBoundary({ adapterRouter, provider });
  instrumentMethods(adapterBoundary, diagnostics, ['execute'], 'provider', (_name, args) => ({ transferId: args[0].transferId }));
  const dependencies = {
    persistence,
    adapterBoundary,
    eventBus,
    outboxDispatcher,
    metrics,
    providerRetryPolicy: {
      maxAttempts: providerRetryMaxAttempts,
      delayMs: providerRetryDelayMs
    },
    workflowTimeoutMs,
    workerConcurrency
  };
  const coordinator = coordinationMode === 'rest'
    ? new RestOrchestrator(dependencies)
    : new KafkaChoreography(dependencies);
  const application = new PaymentApplication({
    persistence,
    coordinator,
    callbackSink,
    metrics,
    clientMode
  });

  let recoveryTimer;
  let recovering;
  return {
    config: {
      coordinationMode,
      clientMode,
      eventBusType,
      eventNamespace,
      persistenceType,
      adapterMode: adapterBoundary.kind,
      providerRetryMaxAttempts,
      providerRetryDelayMs,
      workflowTimeoutMs,
      callbackMaxAttempts,
      callbackRetryDelayMs,
      workerConcurrency, recoveryIntervalMs, diagnosticsEnabled, databaseDiagnosticsEnabled
    },
    application,
    persistence,
    repository: persistence,
    ledger: persistence,
    eventBus,
    metrics,
    diagnostics,
    databaseDiagnostics,
    provider,
    adapterBoundary,
    callbackSink,
    outboxDispatcher,
    async start() {
      await persistence.start();
      await eventBus.start();
      if (coordinationMode === 'kafka') await outboxDispatcher.start();
      await application.recover();
      recoveryTimer = setInterval(() => {
        if (recovering) return;
        recovering = application.recover().catch((error) => process.stderr.write(`Recovery scan failed: ${error.message}\n`)).finally(() => { recovering = null; });
      }, recoveryIntervalMs);
      recoveryTimer.unref();
      diagnostics.start(() => persistence.pool ? { total: persistence.pool.totalCount,
        idle: persistence.pool.idleCount, waiting: persistence.pool.waitingCount } : null);
      await databaseDiagnostics.start();
    },
    async stop() {
      diagnostics.stop();
      await databaseDiagnostics.stop();
      clearInterval(recoveryTimer);
      await recovering;
      await application.drain();
      await outboxDispatcher.stop();
      await eventBus.stop();
      await persistence.stop();
    },
    async reset() {
      await application.drain();
      await persistence.reset();
      eventBus.reset();
      metrics.reset();
      callbackSink.reset();
      provider.calls.length = 0;
      provider.results.clear();
      provider.setAvailable(true);
      diagnostics.reset();
      databaseDiagnostics.reset();
    },
    async telemetry() {
      const persistenceMetrics = await persistence.telemetrySnapshot();
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage();
      return {
        ...persistenceMetrics,
        process_resident_memory_bytes: memory.rss,
        process_heap_used_bytes: memory.heapUsed,
        process_cpu_user_seconds_total: cpu.user / 1_000_000,
        process_cpu_system_seconds_total: cpu.system / 1_000_000,
        application_background_tasks: application.backgroundTasks.size
      };
    }
  };
}
