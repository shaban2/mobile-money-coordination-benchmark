import http from 'node:http';
import { ProfileAAdapter } from './adapters/profile-a-adapter.js';
import { ProfileBAdapter } from './adapters/profile-b-adapter.js';
import { InProcessAdapterBoundary } from './adapters/in-process-adapter-boundary.js';
import { ProviderAdapterRouter } from './adapters/provider-adapter.js';
import { ProviderSimulator } from './providers/provider-simulator.js';

const port = Number(process.env.ADAPTER_PORT ?? 8095);
const provider = new ProviderSimulator({ delayMs: Number(process.env.PROVIDER_DELAY_MS ?? 25), journalPath: process.env.PROVIDER_JOURNAL_PATH ?? null });
const boundary = new InProcessAdapterBoundary({
  adapterRouter: new ProviderAdapterRouter([new ProfileAAdapter(), new ProfileBAdapter()]),
  provider
});

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return sendJson(response, 200, { status: 'UP', service: 'common-adapter' });
    }
    if (request.method === 'POST' && request.url === '/v1/provider-transfers') {
      return sendJson(response, 200, await boundary.execute(await readJson(request)));
    }
    return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  } catch (error) {
    return sendJson(response, 502, {
      error: { code: error.code ?? 'ADAPTER_ERROR', message: error.message }
    });
  }
});

server.listen(port, () => {
  process.stdout.write(`${JSON.stringify({ event: 'adapter.started', port })}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
