import http from 'node:http';

const port = Number(process.env.CALLBACK_PORT ?? 8090);
const deliveries = [];
http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ status: 'UP' }));
  }
  if (request.method === 'GET' && request.url === '/deliveries') {
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ deliveries }));
  }
  if (request.method === 'POST' && request.url === '/reset') {
    deliveries.length = 0;
    response.writeHead(204);
    return response.end();
  }
  if (request.method !== 'POST' || request.url !== '/callbacks/transfers') {
    response.writeHead(404);
    return response.end();
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  deliveries.push({
    receivedAt: new Date().toISOString(),
    requestId: request.headers['x-request-id'] ?? null,
    body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
  });
  response.writeHead(204);
  response.end();
}).listen(port, () => process.stdout.write(`Callback receiver listening on ${port}\n`));
