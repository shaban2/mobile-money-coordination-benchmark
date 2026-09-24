import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertPilotEvidence, atPairBoundary } from './pilot-session.js';
import { capacityRuleIdentity, validateQueueCapacityProtocol } from './capacity-queue.js';
import { assertDeepDiagnosticEvidence } from './deep-diagnostic-evidence.js';
import { fileHash, sourceSnapshotSha256 } from './provenance.js';
import { rebuildsImplementation } from './queue-observation.js';

export function evidenceInventory(root) {
  const files = {};
  const visit = relative => {
    const file = path.join(root, relative);
    if (statSync(file).isDirectory()) for (const name of readdirSync(file).sort()) visit(path.join(relative, name));
    else files[relative] = fileHash(file);
  };
  visit(''); return files;
}

// Read-only re-evaluation. A successful report is not itself permission to launch.
export function inspectCompletedObservationPair(root) {
  const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const state = read('pilot-state.json'), protocol = read('pilot-protocol.json'), freeze = read('freeze.json');
  validateQueueCapacityProtocol(protocol);
  assert.ok(['SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED', 'EXPLORATORY_PAIR_COMPLETE_REVIEW_REQUIRED'].includes(state.status), 'Pair must finish at review.');
  assert.equal(state.records.length, 2); assert.equal(atPairBoundary(state), true);
  assert.equal(state.currentRun, null); assert.equal(existsSync(path.join(root, 'pilot.lock')), false);
  assert.equal(state.cleanup?.passed, true); assert.deepEqual(state.restoreErrors, []);
  assert.equal(state.sessions.length, 1);
  const session = state.sessions[0];
  assert.ok(session.endedAt && session.cleanup?.passed); assert.deepEqual(session.restoreErrors, []);
  assert.equal(session.status, state.status); assert.equal(session.sessionId, state.sessionId);
  assert.deepEqual(session.runIds, state.records.map(r => r.runId));
  assert.equal(session.activeMs, Date.parse(session.endedAt) - Date.parse(session.startedAt));
  assert.equal(state.timing.activeSince, null); assert.equal(state.timing.activeMs, session.activeMs);
  assert.equal(fileHash(path.join(root, 'pilot-protocol.json')), freeze.protocolSha256);
  assert.equal(fileHash(path.join(root, 'frozen-compose.json')), freeze.frozenComposeSha256);
  assert.equal(fileHash(path.join(root, 'source-snapshot.tar.gz')), read('archive-checksum.json').sha256);
  const readEvidence = id => {
    const manifest = read(`${id}/manifest.json`);
    return { manifest, qualification: read(`${id}/qualification.json`), outcomes: read(`${id}/run-outcomes.json`),
      telemetry: read(`${id}/telemetry.json`), cleanup: read(`${id}/cleanup.json`),
      databaseDiagnostics: read(`${id}/database-diagnostics.json`), resourceJsonl: readFileSync(path.join(root, id, 'docker-stats.jsonl'), 'utf8'),
      controllerError: existsSync(path.join(root, id, 'controller-error.json')),
      ...(manifest.run.phase === 'fault' ? { fault: read(`${id}/fault-evidence.json`) } : {}) };
  };
  assertPilotEvidence({ state, protocol, freeze, readBatch: read, readEvidence });
  const runs = state.records.map(record => {
    const id = record.runId, e = readEvidence(id), d = read(`${id}/diagnostics.json`);
    assert.equal(record.stability.status, 'OBSERVATION_RECORDED');
    assert.deepEqual(read(`${id}/pilot-stability.json`), record);
    assert.deepEqual(e.manifest.checksums, read(`${id}/end-checksums.json`));
    assert.deepEqual(e.manifest.study.capacityRule, capacityRuleIdentity(protocol));
    assert.equal(read(`${id}/measurement-clock.json`).measurementStartedAt, e.outcomes.measurementStart);
    assert.equal(read(`${id}/controller-state.json`).currentStatus, record.status);
    assertDeepDiagnosticEvidence(e.databaseDiagnostics, e.resourceJsonl);
    for (const key of ['recordingErrors', 'overwrittenSpans', 'overwrittenSamples']) assert.equal(d[key], 0);
    for (const c of read(`${id}/container-inspect.json`)) assert.equal(c.Image, freeze.images[c.Config.Labels['com.docker.compose.service']]?.id);
    const callbacks = read(`${id}/callbacks.json`).deliveries;
    const transfers = new Map(read(`${id}/transfers.json`).transfers.map(t => [t.transferId, t]));
    for (const cb of callbacks) {
      const t = transfers.get(cb.body.transferId); assert.ok(t);
      for (const k of ['payerId', 'payeeId', 'amount', 'currency', 'clientReference', 'providerReference']) assert.equal(String(cb.body[k]), String(t[k]));
      assert.equal(cb.body.status, t.publicStatus);
    }
    assert.ok(e.outcomes.transfers.every(t => callbacks.some(c => c.body.transferId === t.transferId && c.body.status === 'COMPLETED')));
    return { runId: id, conditionId: record.conditionId, rate: record.rate, phase: record.phase, faultScenario: record.faultScenario,
      status: record.status, checks: record.stability.checks, queue: record.stability.queue,
      counts: e.outcomes.terminalCounts, goodput: e.outcomes.correctGoodput, latency: e.outcomes.durableCompletionMs,
      fault: e.outcomes.faultAnalysis, completedDuringDrain: e.outcomes.completedDuringDrain };
  });
  const events = readFileSync(path.join(root, 'isolation-events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(events.length > 0 && events.every(e => e.foreign === false));
  const pause = existsSync(path.join(root, 'pause-request.json')) ? read('pause-request.json') : null;
  return { root: path.resolve(root), protocolId: protocol.protocolId, sourceSha256: freeze.sourceSha256,
    status: state.status, sessionId: state.sessionId, endedAt: session.endedAt,
    pausedByUser: Boolean(state.pauseRequested || (pause?.sessionId === state.sessionId && pause?.controllerPid === state.pid)),
    runs, capacityEstablished: false, files: evidenceInventory(root) };
}

export function predecessorReviewPath(protocol) {
  return path.join('.research', 'exploratory-reviews', `${protocol.exploratoryPair.key}.json`);
}

export function assertPredecessorReview(protocol, receipt) {
  validateQueueCapacityProtocol(protocol);
  const scope = protocol.exploratoryPair;
  assert.ok(scope && receipt?.decision === 'APPROVED_NEXT_EXPLORATORY_PAIR' && receipt.note?.trim(), 'An explicit recorded review is required.');
  assert.equal(receipt.nextProtocolId, protocol.protocolId);
  assert.equal(receipt.currentSourceSha256, sourceSnapshotSha256(), 'Source changed after review.');
  const report = inspectCompletedObservationPair(scope.predecessorRoot);
  assert.equal(report.protocolId, scope.predecessorProtocolId);
  assert.equal(report.pausedByUser, false, 'User requested a pause; do not start another stage.');
  assert.deepEqual(receipt.predecessor, report, 'Predecessor evidence changed after review.');
  if (!rebuildsImplementation(protocol)) assert.equal(report.sourceSha256, receipt.currentSourceSha256, 'Follow-up stages must share the frozen implementation.');
  // Conservative review routing only, NOT an overload or capacity verdict.
  assert.ok(report.runs.every(r => r.status === 'QUALIFIED' && (r.phase === 'fault'
    || r.queue.status === 'NO_INCREASE_AT_SAMPLED_BOUNDARIES')), 'Ambiguous queue or censored fault evidence needs a new user decision.');
  return true;
}

export function assertExploratoryRootReview(root, protocol, freeze) {
  if (!protocol.exploratoryPair) return;
  assert.equal(path.resolve(root), path.resolve(protocol.exploratoryPair.root), 'Use the exact approved evidence root.');
  const file = path.join(root, 'prerequisite-review.json');
  assert.equal(fileHash(file), freeze.prerequisiteReviewSha256, 'Frozen prerequisite review changed.');
  assertPredecessorReview(protocol, JSON.parse(readFileSync(file, 'utf8')));
}
