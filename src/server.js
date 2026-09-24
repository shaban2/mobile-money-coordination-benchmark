import http from 'node:http';
import { asErrorBody } from './domain/errors.js';
import { createSystem } from './system.js';

const port = Number(process.env.PORT ?? 8080);
const system = createSystem({
  coordinationMode: process.env.COORDINATION_MODE ?? 'rest',
  clientMode: process.env.CLIENT_MODE ?? 'async',
  providerDelayMs: Number(process.env.PROVIDER_DELAY_MS ?? 25),
  sendHttpCallbacks: process.env.SEND_HTTP_CALLBACKS === 'true',
  eventBusType: process.env.EVENT_BUS_TYPE ?? process.env.EVENT_BUS ?? 'memory',
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'redpanda:9092').split(','),
  eventNamespace: process.env.EVENT_NAMESPACE,
  persistenceType: process.env.PERSISTENCE_TYPE ?? 'memory',
  databaseUrl: process.env.DATABASE_URL,
  defaultPayerBalance: BigInt(process.env.DEFAULT_PAYER_BALANCE ?? '100000000'),
  adapterBaseUrl: process.env.ADAPTER_BASE_URL,
  providerRetryMaxAttempts: Number(process.env.PROVIDER_RETRY_MAX_ATTEMPTS ?? 1),
  providerRetryDelayMs: Number(process.env.PROVIDER_RETRY_DELAY_MS ?? 0),
  workflowTimeoutMs: Number(process.env.WORKFLOW_TIMEOUT_MS ?? 30_000),
  callbackMaxAttempts: Number(process.env.CALLBACK_MAX_ATTEMPTS ?? 1),
  callbackRetryDelayMs: Number(process.env.CALLBACK_RETRY_DELAY_MS ?? 0),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  diagnosticsEnabled: process.env.DIAGNOSTICS_ENABLED === 'true',
  databaseDiagnosticsEnabled: process.env.DATABASE_DIAGNOSTICS_ENABLED === 'true'
});

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (chunks.reduce((size, item) => size + item.length, 0) > 1_000_000) {
      const error = new Error('Request body is too large.');
      error.httpStatus = 413;
      throw error;
    }
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.code = 'INVALID_JSON';
    error.httpStatus = 400;
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const receivedAt = new Date().toISOString();
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { status: 'UP', condition: system.config });
    }
    if (request.method === 'GET' && url.pathname === '/config') {
      return sendJson(response, 200, system.config);
    }
    if (request.method === 'GET' && url.pathname === '/admin/database-diagnostics') {
      return sendJson(response, 200, system.databaseDiagnostics.snapshot());
    }
    if (request.method === 'GET' && url.pathname === '/metrics') {
      const metrics = system.metrics.toPrometheus(await system.telemetry());
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      return response.end(metrics);
    }
    if (request.method === 'POST' && url.pathname === '/v1/transfers') {
      const body = await readJson(request);
      const result = await system.application.submit(body, request.headers['idempotency-key'], { receivedAt });
      return sendJson(response, result.httpStatus, result.body, {
        'idempotent-replay': String(result.replayed),
        location: `/v1/transfers/${result.body.transferId}`
      });
    }

    const transferMatch = url.pathname.match(/^\/v1\/transfers\/([^/]+)$/);
    if (request.method === 'GET' && transferMatch) {
      return sendJson(response, 200, await system.application.get(decodeURIComponent(transferMatch[1])));
    }
    if (request.method === 'GET' && url.pathname === '/admin/invariants') {
      return sendJson(response, 200, await system.application.invariants({
        experimentRunId: url.searchParams.get('experimentRunId')
      }));
    }
    if (request.method === 'GET' && url.pathname === '/admin/callbacks') {
      return sendJson(response, 200, { deliveries: system.callbackSink.list() });
    }
    if (request.method === 'GET' && url.pathname === '/admin/storage') {
      return sendJson(response, 200, {
        persistence: system.config.persistenceType,
        tables: await system.persistence.listTables()
      });
    }
    if (request.method === 'GET' && url.pathname === '/admin/accounts') {
      return sendJson(response, 200, { accounts: await system.persistence.listAccounts() });
    }
    if (request.method === 'GET' && url.pathname === '/admin/provider-attempts') {
      return sendJson(response, 200, { attempts: await system.persistence.listProviderAttempts() });
    }
    if (request.method === 'GET' && url.pathname === '/admin/outbox') {
      return sendJson(response, 200, { events: await system.persistence.listOutbox() });
    }
    if (request.method === 'GET' && url.pathname === '/admin/traces') {
      return sendJson(response, 200, { events: await system.persistence.listTraceEvents() });
    }
    if (request.method === 'GET' && url.pathname === '/admin/transfers') {
      return sendJson(response, 200, { transfers: await system.persistence.list() });
    }
    if (request.method === 'GET' && url.pathname === '/admin/dead-letters') {
      return sendJson(response, 200, { events: await system.persistence.listDeadLetters() });
    }
    if (request.method === 'GET' && url.pathname === '/admin/telemetry') {
      return sendJson(response, 200, await system.telemetry());
    }
    if (request.method === 'GET' && url.pathname === '/admin/diagnostics') {
      return sendJson(response, 200, system.diagnostics.snapshot());
    }
    if (request.method === 'POST' && url.pathname === '/admin/experiment-runs') {
      const body = await readJson(request);
      const conditionId = `${system.config.coordinationMode === 'rest' ? 'R' : 'K'}-${
        system.config.clientMode === 'sync' ? 'S' : 'A'
      }`;
      const run = await system.persistence.createExperimentRun({
        ...body,
        conditionId,
        coordinationMode: system.config.coordinationMode,
        clientMode: system.config.clientMode,
        configuration: { ...system.config, ...(body.configuration ?? {}) }
      });
      return sendJson(response, 201, run);
    }
    const runMatch = url.pathname.match(/^\/admin\/experiment-runs\/([^/]+)$/);
    if (request.method === 'PATCH' && runMatch) {
      const body = await readJson(request);
      const run = await system.persistence.finishExperimentRun(
        decodeURIComponent(runMatch[1]),
        { status: body.status, exclusionReason: body.exclusionReason }
      );
      if (!run) return sendJson(response, 404, {
        error: { code: 'EXPERIMENT_RUN_NOT_FOUND', message: 'Experiment run was not found.' }
      });
      return sendJson(response, 200, run);
    }
    if (request.method === 'POST' && url.pathname === '/admin/reset') {
      await system.reset();
      return sendJson(response, 200, { reset: true });
    }
    if (request.method === 'POST' && url.pathname === '/admin/provider-availability') {
      const body = await readJson(request);
      system.adapterBoundary.setAvailable(Boolean(body.available));
      return sendJson(response, 200, { available: system.adapterBoundary.available });
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  } catch (error) {
    const status = error.httpStatus ?? 500;
    const body = error.code ? asErrorBody(error) : {
      error: { code: 'INTERNAL_ERROR', message: status < 500 ? error.message : 'The request could not be completed.' }
    };
    return sendJson(response, status, body);
  }
});

await system.start();
server.listen(port, () => {
  console.log(JSON.stringify({
    event: 'server.started',
    port,
    ...system.config,
    note: system.config.coordinationMode === 'kafka' && system.config.eventBusType === 'memory'
      ? 'Prototype mode uses the in-memory event bus; set EVENT_BUS_TYPE=kafka before confirmatory measurement.'
      : undefined
  }));
});

async function shutdown() {
  server.close();
  await system.stop();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
