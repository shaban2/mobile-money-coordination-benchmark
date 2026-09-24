import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { RuntimeDiagnostics, instrumentMethods } from '../src/infrastructure/runtime-diagnostics.js';
import { instrumentPool } from '../src/infrastructure/postgres/diagnostic-pool.js';
import { createHostResourceSampler } from '../src/experiment/host-resource-sampler.js';
import { createSystem } from '../src/system.js';

function fixture(options = {}) {
  let time = 0;
  const diagnostics = new RuntimeDiagnostics({ enabled: true, slowMs: 10,
    clock: () => time, wallClock: () => 1_700_000_000_000 + time, ...options });
  return { diagnostics, advance: (ms) => { time += ms; } };
}

test('monotonic spans preserve results, errors, aggregates and do not record sensitive errors', async () => {
  const { diagnostics: d, advance } = fixture();
  assert.equal(await d.measure('provider.execute', { transferId: 'transfer-1' }, async () => { advance(25); return 42; }), 42);
  const error = new Error('secret credentials and payload');
  await assert.rejects(d.measure('db.query.SELECT', {}, async () => { advance(1); throw error; }), (e) => e === error);
  const s = d.snapshot();
  assert.equal(s.aggregates['provider.execute'].maxMs, 25);
  assert.equal(s.aggregates['db.query.SELECT'].errors, 1);
  assert.equal(s.spans.length, 2); // Failure retained even below threshold.
  assert.equal(s.spans[0].transferId, 'transfer-1');
  assert.equal(JSON.stringify(s).includes('secret'), false);
});

test('slow-detail rings are bounded and report overwritten records without losing aggregate counts', async () => {
  const { diagnostics: d, advance } = fixture({ maxSpans: 2, maxSamples: 2 });
  for (let i = 0; i < 5; i++) {
    await d.measure('work', { transferId: String(i) }, async () => advance(11));
    d.sample();
  }
  const s = d.snapshot();
  assert.equal(s.aggregates.work.count, 5);
  assert.equal(s.overwrittenSpans, 3); assert.equal(s.overwrittenSamples, 3);
  assert.deepEqual(s.spans.map((e) => e.transferId), ['3', '4']);
  assert.equal(s.runtimeSamples.length, 2);
});

test('reset discards warm-up records and in-flight old-generation spans', async () => {
  const { diagnostics: d, advance } = fixture();
  const old = d.begin('old'); advance(30); d.reset(); d.finish(old);
  assert.deepEqual(d.snapshot().aggregates, {});
  await d.measure('new', {}, async () => advance(15));
  assert.equal(d.snapshot().spans[0].label, 'new');
});

test('parallel async contexts retain their own transfer identity and parent span', async () => {
  const { diagnostics: d } = fixture({ slowMs: 0 });
  await Promise.all(['A', 'B'].map((transferId) => d.measure('parent', { transferId }, async () => {
    await delay(2);
    await d.measure('child', {}, async () => delay(1));
  })));
  const spans = d.snapshot().spans;
  for (const child of spans.filter((s) => s.label === 'child')) {
    assert.equal(spans.find((s) => s.spanId === child.parentSpanId).transferId, child.transferId);
  }
});

test('disabled diagnostics preserve the original pool and methods', async () => {
  const d = new RuntimeDiagnostics();
  const target = { async work() { return this; } }, original = target.work;
  instrumentMethods(target, d, ['work'], 'test');
  assert.equal(target.work, original); assert.equal(instrumentPool(target, d), target);
  assert.equal(await d.measure('off', {}, () => target.work()), target);
  assert.deepEqual(d.snapshot().aggregates, {});
});

test('diagnostic recording failure never replaces the original application failure', async () => {
  const { diagnostics: d } = fixture();
  d.aggregates.set = () => { throw new Error('diagnostics broke'); };
  const original = new Error('original');
  await assert.rejects(d.measure('error', {}, async () => { throw original; }), (e) => e === original);
  assert.equal(d.recordingErrors, 1);
});

test('pool facade times acquisition and transaction queries, preserving receiver, result and release', async () => {
  const { diagnostics: d, advance } = fixture({ slowMs: 0 });
  const result = { rows: [{ ok: true }] }; let released = false;
  const client = { processID: 123, async query(...args) { assert.equal(this, client); advance(20); return result; },
    release() { assert.equal(this, client); released = true; } };
  const pool = { totalCount: 1, idleCount: 0, waitingCount: 2,
    async connect() { assert.equal(this, pool); advance(15); return client; },
    async query() { assert.equal(this, pool); advance(30); return result; } };
  const wrapped = instrumentPool(pool, d);
  await d.measure('persistence.transition', { transferId: 'T' }, async () => {
    const c = await wrapped.connect();
    assert.equal(c.processID, 123);
    assert.equal(await c.query('COMMIT'), result);
    c.release();
  });
  assert.equal(await wrapped.query('SELECT $1', ['secret']), result);
  assert.equal(released, true); assert.equal(wrapped.waitingCount, 2);
  const s = d.snapshot();
  assert.equal(s.aggregates['db.acquire'].maxMs, 15);
  assert.equal(s.aggregates['db.query.COMMIT'].maxMs, 20);
  assert.equal(s.aggregates['db.pool_query.SELECT'].maxMs, 30);
  assert.equal(s.spans.find((x) => x.label === 'db.query.COMMIT').transferId, 'T');
  assert.equal(JSON.stringify(s).includes('secret'), false);
});

test('pool facade preserves rejection and delegates callback/query-object forms without wrapping them', async () => {
  const { diagnostics: d } = fixture(); const original = new Error('query rejected');
  const sentinel = {}, callback = () => {}, queryObject = { submit() {} };
  const client = { query(...args) { return args.some((a) => a === callback) || args[0] === queryObject ? sentinel : Promise.reject(original); } };
  const pool = { connect(cb) { return cb ? sentinel : Promise.resolve(client); }, query: client.query };
  const p = instrumentPool(pool, d), c = await p.connect();
  assert.equal(p.connect(callback), sentinel);
  assert.equal(p.query('SELECT 1', callback), sentinel);
  assert.equal(c.query(queryObject), sentinel);
  await assert.rejects(c.query('SELECT 1'), (e) => e === original);
  await assert.rejects(p.query('SELECT 1'), (e) => e === original);
});

test('runtime sampler records event-loop, CPU and pool observations and stops cleanly', async () => {
  const d = new RuntimeDiagnostics({ enabled: true, intervalMs: 100 });
  try {
    d.start(() => ({ total: 1, idle: 1, waiting: 0 })); await delay(140);
    const samples = d.snapshot().runtimeSamples;
    assert.ok(samples.length >= 1);
    assert.ok(samples[0].eventLoopDelayMs.max >= 0);
    assert.ok(samples[0].intervalMs >= 50);
    assert.equal(samples[0].pool.total, 1);
    assert.ok(Number.isFinite(samples[0].majorPageFaults));
  } finally { d.stop(); }
  assert.equal(d.timer, null);
});

test('host samples identify their scope and retain finite counters', async () => {
  const sample = createHostResourceSampler(); await delay(10); const s = sample();
  assert.equal(s.scope, 'controller-host-not-docker-vm');
  assert.ok(s.intervalMs > 0); assert.ok(s.totalMemoryBytes > 0);
  assert.ok(s.cpuBusyFraction === null || s.cpuBusyFraction >= 0 && s.cpuBusyFraction <= 1);
});

for (const coordinationMode of ['rest', 'kafka']) test(`enabled diagnostics preserve ${coordinationMode} outcomes and reset semantics`, async () => {
  const system = createSystem({ coordinationMode, clientMode: 'async', diagnosticsEnabled: true, providerDelayMs: 12 });
  try {
    await system.start();
    const r = await system.application.submit({ payerId: 'payer', payeeId: 'payee', amount: '12', currency: 'UGX',
      providerProfile: 'A', clientReference: 'diagnostic-test' }, 'key');
    const terminal = await system.application.waitForTerminal(r.body.transferId);
    assert.equal(terminal.status, 'COMPLETED'); await system.application.drain();
    assert.equal((await system.application.invariants()).passed, true);
    assert.equal(system.diagnostics.snapshot().aggregates['provider.execute'].count, 1);
    await system.reset(); assert.deepEqual(system.diagnostics.snapshot().aggregates, {});
  } finally { await system.stop(); }
});
