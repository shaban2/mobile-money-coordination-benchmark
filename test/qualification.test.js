import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyRun } from '../src/experiment/qualification.js';
import { resourceServicesFor } from '../src/experiment/compose-lifecycle.js';
const iso = (s) => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString();
function fixture() {
  return { manifest: { study: { fixedClientMode: 'async' }, run: { runId: 'test', conditionId: 'R-A', faultScenario: 'none', offeredRate: 1 }, checksums: { composeSha256: 'hash' }, resourceServices: ['rest-async'] },
    composeHash: 'hash', invariants: { passed: true }, telemetry: { transfers_pending: 0, transfers_failed: 0 }, traces: { events: [] },
    summary: { metrics: { checks: { values: { rate: 1 } }, workload_unique_creates: { values: { count: 2 } } } },
    callbacks: { deliveries: [{ body: { transferId: 'a', status: 'COMPLETED' } }, { body: { transferId: 'b', status: 'COMPLETED' } }] },
    attempts: { attempts: [{ attemptId: '1', idempotencyKey: 'a', transferId: 'a', httpStatus: 202 }, { attemptId: '2', idempotencyKey: 'b', transferId: 'b', httpStatus: 202 }] },
    outcomes: { schemaVersion: 2, measurementStart: iso(0), measurementEnd: iso(2), measurementSeconds: 2, timingCompletenessRatio: 1,
      transfers: [{ transferId: 'a', idempotencyKey: 'a', terminalState: 'FULFILLED' }, { transferId: 'b', idempotencyKey: 'b', terminalState: 'FULFILLED' }] },
    resources: [0, 1, 2].map((s) => ({ capturedAt: iso(s), commandStatus: 0, containers: [{ Service: 'rest-async' }] })) };
}
test('complete evidence qualifies', () => assert.equal(qualifyRun(fixture()).status, 'QUALIFIED'));
test('workload checks use inclusive 99.5% and delivered-load boundary rejects shortfall', () => {
  for (const rate of [.994999, .995, .995001]) {
    const d = fixture(); d.summary.metrics.checks.values.rate = rate;
    assert.equal(qualifyRun(d).performance.passed, rate >= .995);
  }
  const d = fixture();
  for (const seconds of [2 / .995 - .000001, 2 / .995, 2 / .995 + .000001]) {
    d.outcomes.measurementSeconds = seconds;
    assert.equal(qualifyRun(d).gates.offeredLoadDelivered, 2 >= seconds * .995);
  }
});
test('accepted requests just outside the measured cohort remain accounted for', () => {
  const data = fixture();
  data.outcomes.observedTransferIds = ['a', 'b'];
  data.outcomes.transfers.pop();
  assert.equal(qualifyRun(data).status, 'QUALIFIED');
});
test('duplicate callbacks do not replace missing transfer delivery', () => {
  const data = fixture(); data.callbacks.deliveries[1] = data.callbacks.deliveries[0];
  const result = qualifyRun(data);
  assert.equal(result.valid, true);
  assert.equal(result.status, 'PERFORMANCE_FAILURE');
  assert.equal(result.eligibleToLead, false);
});
test('valid non-recovery remains censored, rather than excluded', () => {
  const data = fixture(); data.telemetry.transfers_pending = 1; data.outcomes.transfers[1].terminalState = 'PREPARED';
  assert.equal(qualifyRun(data).status, 'CENSORED');
  assert.equal(qualifyRun(data).valid, true);
});
test('safety failures remain valid observations and cannot lead', () => {
  const data = fixture(); data.invariants.passed = false;
  const result = qualifyRun(data);
  assert.equal(result.status, 'SAFETY_FAILURE'); assert.equal(result.valid, true); assert.equal(result.eligibleToLead, false);
});
test('a single resource sample and missing client attempts invalidate evidence', () => {
  const data = fixture(); data.resources.length = 1; data.attempts.attempts.pop();
  const result = qualifyRun(data);
  assert.equal(result.status, 'INVALID'); assert.equal(result.gates.resourceCoverageComplete, false); assert.equal(result.gates.clientAttemptsAccountedFor, false);
});
test('k6 check failure exit code is preserved as a performance result', () => {
  const data = fixture(); data.exitCode = 99; data.summary.metrics.checks.values.rate = .5;
  assert.equal(qualifyRun(data).status, 'PERFORMANCE_FAILURE');
});
test('dropped arrival-rate iterations invalidate the claimed common offered load', () => {
  const data = fixture(); data.summary.metrics.dropped_iterations = { values: { count: 1 } };
  assert.equal(qualifyRun(data).status, 'INVALID');
});
test('manifest v4 requires end-of-run hashes and rejects source changes', () => {
  const data = fixture(); data.manifest.schemaVersion = 4;
  data.manifest.checksums.sourceSnapshotSha256 = 'before';
  assert.equal(qualifyRun(data).status, 'INVALID');
  data.endChecksums = { composeSha256: 'hash', sourceSnapshotSha256: 'after' };
  assert.equal(qualifyRun(data).status, 'INVALID');
  data.endChecksums.sourceSnapshotSha256 = 'before';
  assert.equal(qualifyRun(data).status, 'QUALIFIED');
});

test('complete resource coverage does not excuse an extra architecture, broker, or duplicate replica', () => {
  for (const Service of ['kafka-async', 'gateway-kafka-async', 'redpanda', 'rest-async']) {
    const data = fixture(); data.resources[1].containers.push({ Service });
    const result = qualifyRun(data);
    assert.equal(result.gates.resourceCoverageComplete, true);
    assert.equal(result.gates.architectureIsolated, false);
    assert.equal(result.status, 'INVALID');
  }
});
test('legacy sampled names reveal a leftover architecture instead of passing qualification', () => {
  const data = fixture();
  data.resources.forEach((s) => { s.composeProject = 'pilot'; s.containers = [{ Name: 'pilot-rest-async-1' }, { Name: 'pilot-k6-run-ab123' }]; });
  assert.equal(qualifyRun(data).status, 'QUALIFIED');
  data.resources[1].containers.push({ Name: 'pilot-kafka-async-1' });
  assert.equal(qualifyRun(data).status, 'INVALID');
});

function isolatedFixture() {
  const data = fixture();
  Object.assign(data.manifest, { schemaVersion: 5, composeProject: 'pilot' });
  data.manifest.run.composeProfile = 'rest-async';
  const expected = resourceServicesFor(data.manifest.run);
  data.manifest.resourceServices = expected;
  data.endChecksums = { composeSha256: 'hash' };
  const containers = expected.map((Service) => ({ Service, ComposeProject: 'pilot', OneOff: false }));
  data.resources.forEach((s) => { s.containers = structuredClone(containers); });
  data.cleanStart = { passed: true, project: 'pilot', remainingContainers: [] };
  data.isolation = { snapshots: ['before-warmup', 'before-measurement', 'after-observation'].map((phase) => ({ phase, passed: true, project: 'pilot', containers: structuredClone(containers) })) };
  data.resolvedCompose = { services: Object.fromEntries([...expected, 'toxiproxy-init'].map((s) => [s, {}])) };
  return data;
}
test('manifest v5 requires clean start, lifecycle inventories and actual resolved services', () => {
  assert.equal(qualifyRun(isolatedFixture()).status, 'QUALIFIED');
  for (const field of ['cleanStart', 'isolation', 'resolvedCompose']) {
    const data = isolatedFixture(); delete data[field];
    assert.equal(qualifyRun(data).gates.architectureIsolated, false);
  }
  const empty = isolatedFixture(); empty.resolvedCompose.services = {};
  assert.equal(qualifyRun(empty).status, 'INVALID');
});
test('a claimed passed snapshot cannot hide an extra worker or a changed expected-service list', () => {
  const data = isolatedFixture();
  data.isolation.snapshots[0].containers.push({ Service: 'kafka-async', ComposeProject: 'pilot' });
  assert.equal(qualifyRun(data).status, 'INVALID');
  const changed = isolatedFixture(); changed.manifest.resourceServices.push('kafka-async');
  assert.equal(qualifyRun(changed).gates.architectureIsolated, false);
});
test('adapter fault permits only the missing adapter within its documented interval', () => {
  const data = isolatedFixture(); data.manifest.run.faultScenario = 'adapter-crash';
  data.fault = { injectedAt: iso(1), clearedAt: iso(1), completed: true };
  data.manifest.qualification = { maxResourceGapMs: 1000 };
  data.resources[1].containers = data.resources[1].containers.filter((c) => c.Service !== 'adapter-service');
  assert.equal(qualifyRun(data).status, 'QUALIFIED');
  data.resources[1].containers = data.resources[1].containers.filter((c) => c.Service !== 'postgres');
  assert.equal(qualifyRun(data).status, 'INVALID');
});
