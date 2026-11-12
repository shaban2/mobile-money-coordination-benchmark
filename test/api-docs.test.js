import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { applyLocalCors, handleDocs } from '../src/http/api-docs.js';

function fakeResponse() {
  const headers = {};
  return {
    headers, status: null, body: null,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(status, extra = {}) {
      this.status = status;
      for (const [k, v] of Object.entries(extra)) headers[k.toLowerCase()] = v;
    },
    end(body) { this.body = body; }
  };
}

const req = (method, path, origin) => ({
  method, headers: origin ? { origin } : {}, url: path
});
const url = (path) => new URL(path, 'http://localhost:8082');

test('serves the Swagger UI page and the OpenAPI spec', async () => {
  const page = fakeResponse();
  assert.equal(await handleDocs(req('GET', '/docs'), url('/docs'), page), true);
  assert.equal(page.status, 200);
  assert.match(String(page.body), /SwaggerUIBundle/);

  const spec = fakeResponse();
  assert.equal(await handleDocs(req('GET', '/openapi.yaml'), url('/openapi.yaml'), spec), true);
  const onDisk = await readFile(new URL('../contracts/openapi.yaml', import.meta.url));
  assert.deepEqual(Buffer.from(spec.body), onDisk);
});

test('leaves API routes to the main handler', async () => {
  const response = fakeResponse();
  assert.equal(await handleDocs(req('POST', '/v1/transfers'), url('/v1/transfers'), response), false);
  assert.equal(await handleDocs(req('GET', '/health'), url('/health'), response), false);
  assert.equal(response.status, null);
});

test('allows CORS only for localhost pages', () => {
  const local = fakeResponse();
  assert.equal(applyLocalCors(req('GET', '/', 'http://localhost:8084'), local), true);
  assert.equal(local.headers['access-control-allow-origin'], 'http://localhost:8084');
  assert.match(local.headers['access-control-allow-headers'], /idempotency-key/);

  const foreign = fakeResponse();
  assert.equal(applyLocalCors(req('GET', '/', 'https://example.com'), foreign), false);
  assert.equal(foreign.headers['access-control-allow-origin'], undefined);
});

test('the spec lists the REST and Kafka servers', async () => {
  const spec = await readFile(new URL('../contracts/openapi.yaml', import.meta.url), 'utf8');
  assert.match(spec, /url: http:\/\/localhost:8082/);
  assert.match(spec, /url: http:\/\/localhost:8084/);
  assert.match(spec, /\/admin\/invariants:/);
});
