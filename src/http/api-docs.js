import { readFile } from 'node:fs/promises';

// Interactive API documentation (Swagger UI) for local testing and demos.
// Not used by the experiment harness. Swagger UI loads from a CDN, so the
// browser needs internet access the first time the page is opened.

const SWAGGER_UI_VERSION = '5.17.14';
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;
const SPEC_PATH = new URL('../../contracts/openapi.yaml', import.meta.url);

const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>P2P Transfer API</title>
  <link rel="stylesheet" href="${CDN}/swagger-ui.css">
  <style>body { margin: 0; background: #fafafa; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${CDN}/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      tryItOutEnabled: true,
      displayRequestDuration: true,
      persistAuthorization: true
    });
  </script>
</body>
</html>`;

// Browsers on a localhost page may call either design (REST on 8082, Kafka
// on 8084) from the docs page. Other origins get no CORS headers.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function applyLocalCors(request, response) {
  const origin = request.headers.origin;
  if (!origin || !LOCAL_ORIGIN.test(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type, idempotency-key');
  response.setHeader('access-control-expose-headers', 'location, idempotent-replay');
  return true;
}

// Returns true when the request was a docs route and has been answered.
export async function handleDocs(request, url, response) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return true;
  }
  if (request.method !== 'GET') return false;
  if (url.pathname === '/docs' || url.pathname === '/docs/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(DOCS_HTML);
    return true;
  }
  if (url.pathname === '/openapi.yaml') {
    response.writeHead(200, { 'content-type': 'application/yaml; charset=utf-8' });
    response.end(await readFile(SPEC_PATH));
    return true;
  }
  return false;
}
