import { sameProxyConfiguration } from '../src/experiment/proxy-config.js';

const action = process.argv[2] ?? 'configure';
const apiUrl = process.env.TOXIPROXY_URL ?? 'http://127.0.0.1:8474';
const proxyName = process.env.TOXIPROXY_NAME ?? 'postgres';
const listen = process.env.TOXIPROXY_LISTEN ?? '0.0.0.0:15432';
const upstream = process.env.POSTGRES_UPSTREAM ?? 'postgres:5432';
const latencyMs = Number(process.env.DATABASE_LATENCY_MS ?? 100);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, options = {}, accepted = [200, 201, 204]) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  if (!accepted.includes(response.status)) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function waitUntilReady() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await request('/version');
      return;
    } catch (error) {
      lastError = error;
      await wait(500);
    }
  }
  throw lastError;
}

async function configure() {
  const existing = await fetch(`${apiUrl}/proxies/${proxyName}`);
  if (existing.status === 404) {
    await request('/proxies', {
      method: 'POST',
      body: JSON.stringify({ name: proxyName, listen, upstream, enabled: true })
    });
  } else if (existing.ok) {
    const current = await existing.json();
    if (!sameProxyConfiguration(current, { listen, upstream })) {
      await request(`/proxies/${proxyName}`, {
        method: 'PATCH',
        body: JSON.stringify({ listen, upstream, enabled: true })
      });
    }
  } else {
    throw new Error(`Could not inspect proxy ${proxyName}: HTTP ${existing.status}`);
  }
  process.stdout.write(`Toxiproxy ${proxyName}: ${listen} -> ${upstream}\n`);
}

async function clearLatency() {
  const response = await fetch(`${apiUrl}/proxies/${proxyName}/toxics/database-latency`, {
    method: 'DELETE'
  });
  if (![204, 404].includes(response.status)) {
    throw new Error(`Could not remove database latency: HTTP ${response.status}`);
  }
  process.stdout.write('Database latency fault is clear.\n');
}

await waitUntilReady();
if (action === 'configure') await configure();
else {
  // The API canonicalizes an all-interface listener as [::]. Re-PATCHing a
  // live proxy to 0.0.0.0 resets its connections, contaminating a latency-only
  // fault. Fault operations validate topology and never reconfigure it.
  const current = await request(`/proxies/${proxyName}`);
  if (!sameProxyConfiguration(current, { listen, upstream })) throw new Error('Proxy configuration differs from the frozen fault target; run configure before the trial.');
}

if (action === 'add-latency') {
  await clearLatency();
  await request(`/proxies/${proxyName}/toxics`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'database-latency',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1,
      attributes: { latency: latencyMs, jitter: 0 }
    })
  });
  process.stdout.write(`Added ${latencyMs} ms database-response latency.\n`);
} else if (action === 'clear-latency') {
  await clearLatency();
} else if (action !== 'configure') {
  throw new Error(`Unknown action: ${action}`);
}
