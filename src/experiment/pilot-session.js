import { randomUUID } from 'node:crypto';
import { evaluatePilotRun, makePilotBatch, nextPilotStep } from './pilot.js';
import { pilotLifecycleMatches } from './pilot-timing.js';
import { isCalibration, evaluateCalibrationRun } from './calibration.js';
import { isQueueCapacity } from './capacity-queue.js';

export function newPilotState() {
  return { schemaVersion: 2, startedAt: null, status: 'PREPARED', records: [], batches: [], currentRun: null,
    sessions: [], timing: { activeMs: 0, pausedMs: 0, activeSince: null, pausedSince: null } };
}

function elapsed(since, now) {
  if (since == null) return 0;
  const value = now - Date.parse(since);
  if (!Number.isFinite(value) || value < 0) throw new Error('Pilot clock moved backwards or timing evidence is invalid; review required.');
  return value;
}

export function pilotTiming(state, now = Date.now()) {
  if (!state.timing) return { basis: 'legacy-wall-clock', wallMs: elapsed(state.startedAt, now) };
  return { basis: 'active-sessions', activeMs: state.timing.activeMs + elapsed(state.timing.activeSince, now),
    pausedMs: state.timing.pausedMs + elapsed(state.timing.pausedSince, now), wallMs: elapsed(state.startedAt, now) };
}

export function atPairBoundary(state) {
  if (state.currentRun) return false;
  const completed = new Set(state.records.map((r) => r.runId));
  if (completed.size !== state.records.length) return false;
  const pairs = new Map();
  for (const batch of state.batches) for (const run of batch.runs) {
    const pair = pairs.get(run.executionBlock) ?? [];
    pair.push(run); pairs.set(run.executionBlock, pair);
  }
  const planned = new Set([...pairs.values()].flat().map((r) => r.runId));
  const runs = state.batches.flatMap((b) => b.runs);
  return planned.size === runs.length && state.records.every((r, index) => r.runId === runs[index]?.runId
    && r.executionBlock === runs[index].executionBlock && r.conditionId === runs[index].conditionId
    && r.rate === runs[index].offeredRate && r.phase === runs[index].phase) && [...pairs.values()].every((pair) => {
    const n = pair.filter((r) => completed.has(r.runId)).length;
    const sessions = pair.map((r) => state.records.find((record) => record.runId === r.runId)?.sessionId);
    return pair.length === 2 && new Set(pair.map((r) => r.conditionId)).size === 2
      && pair.every((r) => ['R-A', 'K-A'].includes(r.conditionId))
      && pair[0].offeredRate === pair[1].offeredRate && pair[0].randomSeed === pair[1].randomSeed
      && (n === 0 || (n === 2 && sessions[0] && sessions[0] === sessions[1]));
  });
}

export function assertPilotCanStart(state, { resume = false } = {}) {
  if (state.schemaVersion !== 2 || !state.timing || !Array.isArray(state.sessions)) throw new Error('Legacy pilot state requires review and a fresh evidence root; no implicit timing migration.');
  if (state.timing.activeSince || state.sessions.some((s) => !s.endedAt)) throw new Error('Unfinished session exists; inspect it rather than automatically resuming.');
  if (![state.timing.activeMs, state.timing.pausedMs].every((v) => Number.isFinite(v) && v >= 0)) throw new Error('Invalid pilot time accounting.');
  if (resume) {
    if (state.status !== 'PAUSED' || !state.timing.pausedSince || state.cleanup?.passed !== true
      || !Array.isArray(state.restoreErrors) || state.restoreErrors.length || !atPairBoundary(state)) {
      throw new Error('Resume requires a clean PAUSED checkpoint at a complete pair boundary. Failed/interrupted runs require review.');
    }
    const sessionRuns = state.sessions.flatMap((s) => s.runIds);
    if (state.sessions.length === 0 || state.sessions.at(-1).status !== 'PAUSED'
      || JSON.stringify(sessionRuns) !== JSON.stringify(state.records.map((r) => r.runId))
      || state.records.some((r) => !state.sessions.some((s) => s.sessionId === r.sessionId && s.runIds.includes(r.runId)))) {
      throw new Error('Session history and completed run checkpoint disagree; review required.');
    }
    const activeMs = state.sessions.reduce((sum, s) => sum + s.activeMs, 0);
    const pausedMs = state.sessions.slice(1).reduce((sum, s, i) => sum + elapsed(state.sessions[i].endedAt, Date.parse(s.startedAt)), 0);
    if (state.sessions.some((s) => s.status !== 'PAUSED' || !s.startedAt || s.activeMs !== elapsed(s.startedAt, Date.parse(s.endedAt)))
      || new Set(state.sessions.map((s) => s.sessionId)).size !== state.sessions.length
      || state.sessionId !== state.sessions.at(-1).sessionId || state.startedAt !== state.sessions[0].startedAt
      || state.timing.pausedSince !== state.sessions.at(-1).endedAt
      || activeMs !== state.timing.activeMs || pausedMs !== state.timing.pausedMs) {
      throw new Error('Session timing and consumed budget disagree; review required.');
    }
  } else if (state.status !== 'PREPARED' || state.records.length || state.batches.length || state.sessions.length) {
    throw new Error('Existing pilot state cannot be started afresh. Use --resume only for a clean PAUSED checkpoint.');
  }
}

export function assertPilotBudget(state, protocol, now = Date.now()) {
  if (state.records.length >= protocol.maximumRuns || pilotTiming(state, now).activeMs >= protocol.maximumHours * 3600_000) {
    throw new Error('Prespecified pilot run/active-time ceiling reached; review required.');
  }
}

export function assertPilotEvidence({ state, protocol, freeze, readBatch, readEvidence }) {
  for (const batch of state.batches) {
    if (JSON.stringify(readBatch(batch.file)) !== JSON.stringify(batch)) throw new Error(`Saved batch changed: ${batch.file}; review required.`);
  }
  const planned = new Map(state.batches.flatMap((b) => b.runs).map((r) => [r.runId, r]));
  for (const record of state.records) {
    const evidence = readEvidence(record.runId), run = planned.get(record.runId);
    const manifest = evidence.manifest;
    const stability = (record.phase === 'fault' && !isQueueCapacity(protocol)) || isCalibration(protocol) ? null : evaluatePilotRun(evidence, protocol, record.phase);
    const calibration = isCalibration(protocol) ? evaluateCalibrationRun(evidence) : undefined;
    if (evidence.cleanup?.passed !== true || evidence.controllerError || evidence.qualification?.valid !== true
      || evidence.qualification?.safety?.passed !== true || evidence.qualification.status !== record.status
      || manifest?.checksums?.sourceSnapshotSha256 !== freeze.sourceSha256
      || manifest?.checksums?.frozenComposeSha256 !== freeze.frozenComposeSha256
      || manifest?.study?.pilotProtocolId !== protocol.protocolId || manifest?.pilotSessionId !== record.sessionId
      || !run || ['runId', 'conditionId', 'offeredRate', 'randomSeed', 'executionBlock', 'phase', 'faultScenario'].some((key) => manifest?.run?.[key] !== run[key])
      || !pilotLifecycleMatches(manifest, protocol, record.phase)
      || JSON.stringify(stability) !== JSON.stringify(record.stability)
      || (isCalibration(protocol) && (!calibration.passed || JSON.stringify(calibration) !== JSON.stringify(record.calibration)))) throw new Error(`Recorded evidence is not resumable: ${record.runId}.`);
  }
}

// Inject orchestration boundaries so pair pausing, cleanup failures, and overnight
// resume can be tested without starting Docker or waiting through real trials.
export async function executePilotSession({ state, protocol, resume = false, io, prepare, check, runTrial,
  cleanup, restore, shouldStop = () => false, now = Date.now, pid = process.pid }) {
  assertPilotCanStart(state, { resume });
  if (protocol.timeBudgetBasis !== 'active-sessions' || protocol.pauseBoundary !== 'matched-pair') throw new Error('Unsupported pilot session policy.');
  assertPilotBudget(state, protocol, now());
  const startedMs = now(), startedAt = new Date(startedMs).toISOString();
  state.timing.pausedMs += elapsed(state.timing.pausedSince, startedMs);
  state.timing.pausedSince = null; state.timing.activeSince = startedAt;
  state.startedAt ??= startedAt;
  const session = { sessionId: randomUUID(), startedAt, endedAt: null, pid, resumed: resume, runIds: [] };
  state.sessions.push(session); state.sessionId = session.sessionId; state.pid = pid;
  state.pauseRequested = null; state.status = 'PREPARING'; delete state.error;
  state.cleanup = null; state.restoreErrors = []; state.containersRestoredAt = null;
  const save = () => { state.updatedAt = new Date(now()).toISOString(); io.save(state); };
  // A secondary logging error must never prevent cleanup or restoration.
  const reportError = (message) => { try { io.log(message); } catch (error) { state.logError = error.message; } };
  const pauseAtBoundary = () => {
    const request = io.readPauseRequest();
    if (request?.sessionId === session.sessionId && request.controllerPid === pid) {
      if (request.mode !== 'after-pair') throw new Error('Unsupported pause request.');
      if (!state.pauseRequested) { state.pauseRequested = request; session.pauseRequest = request; save(); io.log('Pause requested; finishing the current matched pair.'); }
    }
    return Boolean(state.pauseRequested) && atPairBoundary(state);
  };
  let failed = false;
  save();
  try {
    await prepare(state, session); save();
    while (!shouldStop()) {
      if (isQueueCapacity(protocol) && state.records.length === 2) {
        if (!atPairBoundary(state)) throw new Error('Queue pair is not a complete matched checkpoint.');
        state.capacityDecision = nextPilotStep(state.records, protocol);
        state.status = state.capacityDecision.action; save(); io.log(state.status); break;
      }
      if (isCalibration(protocol) && state.records.length === protocol.maximumRuns) {
        state.calibrationDecision = nextPilotStep(state.records, protocol);
        state.status = state.calibrationDecision.action; save(); io.log(state.status); break;
      }
      assertPilotBudget(state, protocol, now());
      if (pauseAtBoundary()) { state.status = 'PAUSING'; save(); break; }
      await check();
      let batch = state.batches.find((b) => b.runs.some((r) => !state.records.some((record) => record.runId === r.runId)));
      if (!batch) {
        const step = nextPilotStep(state.records, protocol);
        if (isCalibration(protocol)) state.calibrationDecision = step;
        else state.capacityDecision = step;
        if (step.action !== 'RUN') { state.status = step.action; save(); io.log(`${step.action}: ${step.reason ?? JSON.stringify(step.boundaries)}`); break; }
        batch = makePilotBatch(step, protocol, state.batches.length + 1);
        batch.file = `pilot-batch-${String(state.batches.length + 1).padStart(3, '0')}.json`;
        io.write(batch.file, batch); state.batches.push(batch); save();
      }
      for (const run of batch.runs) {
        if (state.records.some((r) => r.runId === run.runId)) continue;
        if (shouldStop()) break;
        assertPilotBudget(state, protocol, now());
        if (pauseAtBoundary()) { state.status = 'PAUSING'; save(); break; }
        await check();
        if (io.runExists(run.runId)) throw new Error(`Unfinished prior evidence exists for ${run.runId}. Preserve it and review; no automatic overwrite or favorable rerun.`);
        state.status = 'RUNNING'; state.currentRun = run; save();
        io.log(`Starting ${run.runId} at ${run.offeredRate} operations/s (session ${session.sessionId}).`);
        const result = await runTrial(batch.file, run, session.sessionId);
        if (shouldStop()) throw new Error('Pilot interrupted by user or process signal.');
        if (![0, 2].includes(result.code)) throw new Error(`Controller failed for ${run.runId}: ${JSON.stringify(result)}. Evidence retained.`);
        const evidence = io.readEvidence(run.runId);
        if (evidence.cleanup?.passed !== true || evidence.controllerError) throw new Error(`Run cleanup/controller failure for ${run.runId}; review required.`);
        if (!pilotLifecycleMatches(evidence.manifest, protocol, run.phase)) throw new Error(`Wrong phase or lifecycle timing for ${run.runId}; review required.`);
        const stability = (run.phase === 'fault' && !isQueueCapacity(protocol)) || isCalibration(protocol) ? null : evaluatePilotRun(evidence, protocol, run.phase);
        const calibration = isCalibration(protocol) ? evaluateCalibrationRun(evidence) : undefined;
        const record = { runId: run.runId, conditionId: run.conditionId, phase: run.phase, rate: run.offeredRate,
          executionBlock: run.executionBlock, sessionId: session.sessionId, faultScenario: run.faultScenario,
          recordedAt: new Date(now()).toISOString(), status: evidence.qualification.status, stability,
          ...(calibration ? { calibration } : {}) };
        state.records.push(record); session.runIds.push(run.runId); state.currentRun = null; save();
        io.write(`${run.runId}/${calibration ? 'calibration-assessment' : 'pilot-stability'}.json`, record); io.log(`Finished ${run.runId}: ${calibration ? (calibration.passed ? 'CALIBRATION_RECORDED' : 'REVIEW_REQUIRED') : stability?.status ?? record.status}.`);
        if (!evidence.qualification.valid || !evidence.qualification.safety.passed || (calibration && !calibration.passed) || (stability && ['SAFETY_FAILURE', 'INVALID_OR_HARNESS_LIMIT', 'CORRECTNESS_REVIEW_REQUIRED'].includes(stability.status))) {
          throw new Error(`Review required after ${run.runId}: instrumentation, generator, or safety gate failed.`);
        }
      }
      if (state.status === 'PAUSING') break;
    }
    if (shouldStop()) throw new Error('Pilot interrupted by user or process signal.');
  } catch (error) {
    failed = true; state.status = shouldStop() ? 'INTERRUPTED' : 'REVIEW_REQUIRED'; state.error = error.message;
    reportError(error.message);
  } finally {
    // A clean pause is not advertised until teardown AND restoration succeed.
    try {
      state.cleanup = await cleanup();
      if (state.cleanup?.passed !== true) throw new Error('Cleanup did not verify an empty experiment project.');
    } catch (error) {
      failed = true; state.cleanup = { passed: false, message: error.message };
      state.status = 'REVIEW_REQUIRED'; state.error = `Cleanup failed: ${error.message}`; reportError(state.error);
    }
    try { state.restoreErrors = await restore(state); }
    catch (error) { state.restoreErrors = [{ message: error.message }]; }
    if (state.restoreErrors.length) {
      failed = true; state.status = 'REVIEW_REQUIRED'; state.error = 'Approved container restoration needs attention.'; reportError(state.error);
    }
    const endedMs = now(), endedAt = new Date(endedMs).toISOString();
    state.containersRestoredAt = state.restoreErrors.length ? null : endedAt;
    state.confirmatoryFrozen = false;
    try { session.activeMs = elapsed(state.timing.activeSince, endedMs); state.timing.activeMs += session.activeMs; }
    catch (error) { failed = true; state.status = 'REVIEW_REQUIRED'; state.error = error.message; }
    state.timing.activeSince = null; session.endedAt = endedAt;
    if (state.status === 'PAUSING' && !failed) { state.status = 'PAUSED'; state.timing.pausedSince = endedAt; }
    session.status = state.status; session.cleanup = state.cleanup; session.restoreErrors = state.restoreErrors;
    session.pausedContainers = structuredClone(state.pausedContainers ?? []);
    save(); reportError(state.status === 'PAUSED' ? 'PAUSED at a complete pair boundary. Resume requires an explicit command.' : `Session ended: ${state.status}.`);
  }
  return { failed, status: state.status };
}
