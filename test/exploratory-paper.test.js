import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryMiB, timeWeightedMean, summarizeResources, latencySummary, faultWindowSummary, clientSummary } from '../scripts/analyze-exploratory-paper.mjs';

test('Docker memory units are normalized without mixing MB and MiB', () => {
  assert.equal(memoryMiB('1GiB / 2GiB'), 1024);
  assert.equal(memoryMiB('12MiB / 1GiB'), 12);
  assert.equal(memoryMiB('1048576B / 2GiB'), 1);
  assert.equal(memoryMiB('1MB / 2GB'), 1e6 / 1024 ** 2);
  assert.throws(() => memoryMiB('--'));
});
test('Irregular samples use trapezoidal time weighting', () => {
  assert.equal(timeWeightedMean([{ at: 0, x: 0 }, { at: 1000, x: 2 }, { at: 4000, x: 4 }], 'x'), 2.5);
  assert.throws(() => timeWeightedMean([{ at: 0, x: 0 }, { at: 6000, x: 2 }], 'x'));
});
test('Resource sums exclude k6 and out-of-window empty cleanup records', () => {
  const manifest = { resourceServices: ['rest-async'], run: { conditionId: 'R-A' } };
  const outcomes = { measurementStart: '2026-01-01T00:00:00Z', measurementEnd: '2026-01-01T00:00:05Z', faultAnalysis: null };
  const samples = [1, 3].map(s => ({ capturedAt: `2026-01-01T00:00:0${s}Z`, commandStatus: 0,
    containers: [{ Service: 'rest-async', CPUPerc: '25%', MemUsage: '10MiB / 1GiB' }, { Service: 'k6', CPUPerc: '99%', MemUsage: '500MiB / 1GiB' }] }));
  samples.push({ capturedAt: '2026-01-01T00:00:06Z', commandStatus: 0, containers: [] });
  const r = summarizeResources(samples, manifest, outcomes);
  assert.equal(r.means.cpuCores, .25); assert.equal(r.means.memoryMiB, 10);
  assert.equal(r.coverageSeconds, 2); assert.equal(r.samples, 2);
  assert.throws(() => summarizeResources(samples.map(s => ({ ...s, containers: [] })), manifest, outcomes));
});

test('Missing adapter is zero only near an explicitly recorded adapter outage', () => {
  const manifest = { resourceServices: ['rest-async', 'adapter-service'], run: { conditionId: 'R-A' } };
  const outcomes = { measurementStart: '2026-01-01T00:00:00Z', measurementEnd: '2026-01-01T00:00:05Z',
    faultAnalysis: { scenario: 'adapter-crash', injectedAt: '2026-01-01T00:00:00Z', clearedAt: '2026-01-01T00:00:04Z' } };
  const samples = [1, 3].map(s => ({ capturedAt: `2026-01-01T00:00:0${s}Z`, commandStatus: 0,
    containers: [{ Service: 'rest-async', CPUPerc: '25%', MemUsage: '10MiB / 1GiB' }] }));
  const r = summarizeResources(samples, manifest, outcomes);
  assert.equal(r.absentDuringAdapterOutage.length, 2); assert.equal(r.means.memoryMiB, 10);
  assert.throws(() => summarizeResources(samples, manifest, { ...outcomes, faultAnalysis: null }));
  assert.throws(() => summarizeResources(samples, manifest, { ...outcomes,
    faultAnalysis: { ...outcomes.faultAnalysis, scenario: 'database-delay' } }));
});

test('Latency summary uses (n - 1)p interpolation over sorted values only', () => {
  const s = latencySummary([10, 20, 30, 40]);
  assert.equal(s.min, 10); assert.equal(s.max, 40); assert.equal(s.mean, 25);
  assert.equal(s.p50, 25); assert.equal(s.p95, 38.5); assert.ok(Math.abs(s.p99 - 39.7) < 1e-9);
  assert.throws(() => latencySummary([20, 10]));
  assert.throws(() => latencySummary([]));
});
test('Per-service resource means are reported next to the service-set totals', () => {
  const manifest = { resourceServices: ['rest-async', 'postgres'], run: { conditionId: 'R-A' } };
  const outcomes = { measurementStart: '2026-01-01T00:00:00Z', measurementEnd: '2026-01-01T00:00:05Z', faultAnalysis: null };
  const samples = [1, 3].map(s => ({ capturedAt: `2026-01-01T00:00:0${s}Z`, commandStatus: 0,
    containers: [{ Service: 'rest-async', CPUPerc: '25%', MemUsage: '10MiB / 1GiB' }, { Service: 'postgres', CPUPerc: '5%', MemUsage: '30MiB / 1GiB' }] }));
  const r = summarizeResources(samples, manifest, outcomes);
  assert.equal(r.means.cpuCores, .3); assert.equal(r.means.memoryMiB, 40);
  assert.equal(r.serviceMeans.postgres.cpuCores, .05); assert.equal(r.serviceMeans.postgres.memoryMiB, 30);
  assert.equal(r.serviceMeans['rest-async'].memoryMiB, 10);
  assert.ok(!('byService' in r.points[0]));
});
test('Fault window summary only looks at windows ending after injection', () => {
  const windows = [0, 30, 60, 90].map(end => ({ endSeconds: end + 30, correctGoodput: end === 60 ? 0 : 4, p95DurableCompletionMs: end === 60 ? null : 50 + end }));
  const fault = { injectedAt: '2026-01-01T00:01:00Z' };
  const r = faultWindowSummary(windows, fault, '2026-01-01T00:00:00Z');
  assert.equal(r.injectedSeconds, 60); assert.equal(r.windowsAfterInjection, 2);
  assert.equal(r.minGoodputAfterInjection, 0); assert.equal(r.windowsWithoutCompletion, 1); assert.equal(r.maxWindowP95Ms, 140);
  assert.equal(faultWindowSummary(windows, null, '2026-01-01T00:00:00Z'), null);
});
test('Client summary extracts the k6 acknowledgement quantiles', () => {
  const c = clientSummary({ metrics: { http_reqs: { count: 10 }, http_req_failed: { value: 0 }, vus_max: { value: 20 }, iterations: { count: 9 },
    http_req_duration: { med: 29, 'p(90)': 33, 'p(95)': 35, max: 250 } } });
  assert.deepEqual(c.httpReqDurationMs, { median: 29, p90: 33, p95: 35, max: 250 }); assert.equal(c.vusMax, 20);
  assert.throws(() => clientSummary({ metrics: {} }));
});

import { isApplicationFile, compareApplicationFiles, statementCounts, faultIntervalSummary } from '../scripts/analyze-exploratory-paper.mjs';

test('Application files exclude the experiment harness, protocols and macOS resource forks', () => {
  assert.ok(isApplicationFile('src/server.js')); assert.ok(isApplicationFile('./migrations/001_initial_schema.sql'));
  assert.ok(isApplicationFile('compose.yaml')); assert.ok(isApplicationFile('infra/k6/load.js')); assert.ok(isApplicationFile('config/conditions/rest-async.json'));
  assert.ok(!isApplicationFile('src/experiment/pilot.js')); assert.ok(!isApplicationFile('config/exploratory-adapter-r4-protocol.json'));
  assert.ok(!isApplicationFile('scripts/analyze-exploratory-paper.mjs')); assert.ok(!isApplicationFile('src/._server.js')); assert.ok(!isApplicationFile('docs/README.md'));
});
test('Application file comparison lists added, removed and changed files', () => {
  const r = compareApplicationFiles({ a: '1', b: '2', c: '3' }, { a: '1', b: 'x', d: '4' });
  assert.equal(r.compared, 4); assert.deepEqual(r.differing, ['b', 'c', 'd']);
});
test('Statement counts add transaction and pool statements but never span durations', () => {
  const r = statementCounts({ 'db.query.INSERT': { count: 10, totalMs: 5 }, 'db.query.COMMIT': { count: 4, totalMs: 9 },
    'db.pool_query.SELECT': { count: 7, totalMs: 1 }, 'provider.execute': { count: 3, totalMs: 90 }, 'runtime.gc': { count: 2 } });
  assert.equal(r.transactionStatements, 14); assert.equal(r.poolStatements, 7); assert.equal(r.total, 21); assert.equal(r.gcCycles, 2);
  assert.deepEqual(r.byKind, { 'db.query.INSERT': 10, 'db.query.COMMIT': 4, 'db.pool_query.SELECT': 7 });
});
test('Fault interval summary separates in-fault windows from the catch-up and baseline check', () => {
  const windows = [30, 60, 90, 120, 150].map(end => ({ endSeconds: end, correctGoodput: end === 90 ? 1 : end === 120 ? 5 : 4,
    backlogAtEnd: end === 90 ? 40 : 0, p95DurableCompletionMs: end === 90 ? 9000 : end === 120 ? 8000 : 50 }));
  const fault = { injectedAt: '2026-01-01T00:01:05Z', clearedAt: '2026-01-01T00:01:35Z', baseline: { correctGoodput: 4, p95DurableCompletionMs: 50 } };
  const r = faultIntervalSummary(windows, fault, '2026-01-01T00:00:00Z');
  assert.equal(r.injectedSeconds, 65); assert.equal(r.clearedSeconds, 95);
  assert.deepEqual(r.duringFaultWindows.map(w => w.endSeconds), [90]);
  assert.equal(r.completionsDuringFault, 30); assert.equal(r.meanGoodputDuringFault, 1);
  assert.equal(r.catchUpWindow.endSeconds, 120);
  assert.equal(r.firstWindowFullyAfterClearanceEndSeconds, 150); assert.equal(r.firstWindowFullyAfterClearanceMeetsBaseline, true);
  assert.equal(r.allWindowsFullyAfterClearanceMeetBaseline, true);
  assert.equal(faultIntervalSummary(windows, null, '2026-01-01T00:00:00Z'), null);
});
