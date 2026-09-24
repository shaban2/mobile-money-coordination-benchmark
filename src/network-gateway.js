import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.GATEWAY_PORT ?? 8070);
const apiUpstream = new URL(process.env.API_UPSTREAM ?? 'http://rest-async:8080');
const callbackUpstream = new URL(process.env.CALLBACK_UPSTREAM ?? 'http://callback-receiver:8090');

function selectUpstream(pathname) {
  return pathname.startsWith('/callbacks/') || pathname.startsWith('/deliveries')
    ? callbackUpstream
    : apiUpstream;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host ?? 'gateway'}`);
  if (request.method === 'GET' && requestUrl.pathname === '/_gateway/health') {
    return sendJson(response, 200, {
      status: 'UP',
      apiUpstream: apiUpstream.origin,
      callbackUpstream: callbackUpstream.origin
    });
  }

  const upstream = selectUpstream(requestUrl.pathname);
  const requestId = String(request.headers['x-request-id'] ?? randomUUID());
  const startedAt = Date.now();
  const headers = {
    ...request.headers,
    host: upstream.host,
    'x-request-id': requestId,
    'x-forwarded-host': request.headers.host ?? '',
    'x-forwarded-proto': 'http'
  };

  const upstreamRequest = http.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path: `${requestUrl.pathname}${requestUrl.search}`,
    headers
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, {
      ...upstreamResponse.headers,
      'x-request-id': requestId
    });
    upstreamResponse.pipe(response);
    upstreamResponse.on('end', () => {
      process.stdout.write(`${JSON.stringify({
        event: 'gateway.request.completed',
        requestId,
        method: request.method,
        path: requestUrl.pathname,
        route: upstream === callbackUpstream ? 'callback' : 'api',
        statusCode: upstreamResponse.statusCode,
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString()
      })}\n`);
    });
  });

  upstreamRequest.setTimeout(Number(process.env.GATEWAY_TIMEOUT_MS ?? 60_000), () => {
    upstreamRequest.destroy(new Error('Gateway upstream timeout.'));
  });
  upstreamRequest.on('error', (error) => {
    if (!response.headersSent) {
      sendJson(response, 502, {
        error: { code: 'GATEWAY_UPSTREAM_ERROR', message: 'The upstream service was unavailable.' },
        requestId
      });
    } else {
      response.destroy(error);
    }
    process.stderr.write(`${JSON.stringify({
      event: 'gateway.request.failed',
      requestId,
      method: request.method,
      path: requestUrl.pathname,
      route: upstream === callbackUpstream ? 'callback' : 'api',
      error: error.message,
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString()
    })}\n`);
  });
  request.pipe(upstreamRequest);
});

server.listen(port, () => {
  process.stdout.write(`${JSON.stringify({
    event: 'gateway.started',
    port,
    apiUpstream: apiUpstream.origin,
    callbackUpstream: callbackUpstream.origin
  })}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
