import { createHash } from 'node:crypto';
import { quantile } from './outcomes.js';
import { pilotLifecycleMatches } from './pilot-timing.js';
import { isCalibration, validateCalibrationProtocol } from './calibration.js';
import { isQueueCapacity, validateQueueCapacityProtocol, evaluateQueueCapacityRun, capacityRuleIdentity } from './capacity-queue.js';
import { observationPairScope } from './queue-observation.js';

export const conditions = [
  { conditionId: 'R-A', composeProfile: 'rest-async', gatewayPort: 8182, apiPort: 8082 },
  { conditionId: 'K-A', composeProfile: 'kafka-async', gatewayPort: 8184, apiPort: 8084 }
];

export function evaluatePilotRun(evidence, protocol, phase = evidence.manifest?.run?.phase) {
  const { qualification, outcomes, telemetry, manifest } = evidence;
  if (isQueueCapacity(protocol)) return evaluateQueueCapacityRun(evidence, protocol, phase, pilotLifecycleMatches(manifest, protocol, phase));
  const windows = (outcomes?.windowSeries ?? []).filter((w) => w.complete && w.underLoad).slice(-protocol.stability.lastCompleteWindows);
  const times = windows.map((w) => Date.parse(w.endAt) / 1000);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const origin = times[0];
  const x = times.map((t) => t - origin), y = windows.map((w) => w.backlogAtEnd);
  const denominator = x.reduce((sum, t) => sum + (t - mean(x)) ** 2, 0);
  const slope = denominator ? x.reduce((sum, t, i) => sum + (t - mean(x)) * (y[i] - mean(y)), 0) / denominator : null;
  const p95s = windows.map((w) => w.p95DurableCompletionMs);
  const medianP95 = quantile(p95s, .5);
  const checks = {
    // Historical key retained; means the full prescribed duration for THIS phase.
    fullDuration: pilotLifecycleMatches(manifest, protocol, phase),
    evidenceValid: qualification?.valid === true,
    safetyPassed: qualification?.safety?.passed === true,
    workloadChecks: qualification?.performance?.workloadCheckRate >= protocol.stability.minimumWorkloadCheckRate,
    noFailedTransfers: Number(telemetry?.transfers_failed) === 0,
    noPendingAfterDrain: Number(telemetry?.transfers_pending) === 0,
    terminalCallbacks: qualification?.performance?.terminalCallbacksComplete === true,
    sixCompleteWindows: windows.length === protocol.stability.lastCompleteWindows
      && windows.every((w) => Date.parse(w.endAt) - Date.parse(w.startAt) === protocol.stability.windowSeconds * 1000),
    backlogNotGrowing: Number.isFinite(slope) && slope <= protocol.stability.maximumBacklogSlopePerSecond + 1e-12,
    p95Stable: medianP95 > 0 && p95s.every((p) => Number.isFinite(p) && p <= medianP95 * protocol.stability.maximumP95ToMedianRatio)
  };
  const status = !checks.safetyPassed ? 'SAFETY_FAILURE'
    : !checks.evidenceValid || !checks.fullDuration ? 'INVALID_OR_HARNESS_LIMIT'
    : Object.values(checks).every(Boolean) ? 'STABLE' : 'UNSTABLE';
  return { status, stable: status === 'STABLE', checks, backlogSlopePerSecond: slope, medianWindowP95Ms: medianP95, windows };
}

export function nextPilotStep(records, protocol) {
  if (isQueueCapacity(protocol)) {
    validateQueueCapacityProtocol(protocol);
    const identity = capacityRuleIdentity(protocol);
    const scope = observationPairScope(protocol);
    if (records.length > 2 || records.some(r => r.phase !== scope.phase || r.rate !== scope.rate
      || !['R-A', 'K-A'].includes(r.conditionId) || r.faultScenario !== scope.faultScenario
      || r.stability?.rule?.policySha256 !== identity.policySha256 || r.stability?.rule?.version !== identity.version)
      || new Set(records.map(r => r.conditionId)).size !== records.length) throw new Error('Queue pair record/protocol mismatch; review required.');
    return records.length === 2
      ? { action: scope.phase === 'fault' ? 'EXPLORATORY_PAIR_COMPLETE_REVIEW_REQUIRED' : 'SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED', capacityEstablished: false }
      : { action: 'RUN', phase: scope.phase, rate: scope.rate, repetitions: 1,
        ...(scope.faultScenario !== 'none' ? { faultScenario: scope.faultScenario } : {}) };
  }
  if (isCalibration(protocol)) {
    validateCalibrationProtocol(protocol);
    if (records.some(r => r.phase !== 'calibration' || r.rate !== protocol.rate || !r.calibration?.passed)
      || records.length > protocol.maximumRuns) throw new Error('Invalid calibration record; review required.');
    return records.length === protocol.maximumRuns
      ? { action: 'CALIBRATION_COMPLETE_REVIEW_REQUIRED', capacityEstablished: false }
      : { action: 'RUN', phase: 'calibration', rate: protocol.rate, repetitions: protocol.pairs };
  }
  const boundaries = {};
  for (const { conditionId } of conditions) {
    const rows = records.filter((r) => r.conditionId === conditionId && r.phase !== 'fault');
    const failed = rows.filter((r) => r.stability?.status === 'UNSTABLE').map((r) => r.rate);
    const upper = failed.length ? Math.min(...failed) : null;
    const stable = rows.filter((r) => r.stability?.stable && (upper === null || r.rate < upper)).map((r) => r.rate);
    const lower = stable.length ? Math.max(...stable) : 0;
    const confirmed = records.filter((r) => r.phase === 'confirmation' && r.conditionId === conditionId && r.rate === lower && r.stability?.stable);
    boundaries[conditionId] = { lower, upper, confirmedRuns: confirmed.length,
      resolved: lower > 0 && upper !== null && (upper - lower) / lower <= protocol.boundaryRelativeWidth };
  }
  for (const { conditionId } of conditions) {
    const b = boundaries[conditionId];
    if (b.upper !== null && b.lower === 0) return { action: 'REVIEW', reason: `No stable rate established for ${conditionId}.`, boundaries };
    if (b.resolved && b.confirmedRuns >= protocol.boundaryReplicates) continue;
    if (b.resolved) return { action: 'RUN', phase: 'confirmation', rate: b.lower, repetitions: protocol.boundaryReplicates, boundaries };
    const rate = b.upper === null ? (b.lower ? b.lower * 2 : protocol.startRate) : Math.floor((b.lower + b.upper) / 2);
    if (rate > protocol.maximumRate || rate === b.lower) return { action: 'REVIEW', reason: `Rate ceiling or integer resolution reached for ${conditionId}; no capacity claim.`, boundaries };
    return { action: 'RUN', phase: 'screening', rate, repetitions: protocol.screeningReplicates, boundaries };
  }
  const sharedRate = Math.min(...Object.values(boundaries).map((b) => b.lower));
  const absoluteRates = protocol.confirmatoryLoadPercentages.map((p) => Math.round(sharedRate * p / 100));
  if (absoluteRates.some((r) => r <= 0) || new Set(absoluteRates).size !== absoluteRates.length) return { action: 'REVIEW', reason: 'Shared rate produces a duplicate or nonpositive confirmatory load grid.', boundaries };
  for (const faultScenario of ['adapter-crash', 'database-delay']) {
    const complete = conditions.every(({ conditionId }) => records.filter((r) => r.phase === 'fault' && r.conditionId === conditionId && r.faultScenario === faultScenario).length >= protocol.faultReplicates);
    if (!complete) return { action: 'RUN', phase: 'fault', rate: Math.round(sharedRate * protocol.faults.offeredLoadPercent / 100), repetitions: protocol.faultReplicates, faultScenario, sharedRate, absoluteRates, boundaries };
  }
  return { action: 'PILOT_COMPLETE_REVIEW_REQUIRED', sharedRate, absoluteRates, boundaries };
}

export function makePilotBatch(step, protocol, batchNumber) {
  const calibration = isCalibration(protocol);
  if (isQueueCapacity(protocol)) {
    validateQueueCapacityProtocol(protocol);
    const scope = observationPairScope(protocol);
    if (step.phase !== scope.phase || step.rate !== scope.rate || step.repetitions !== 1 || batchNumber !== 1
      || (step.faultScenario ?? 'none') !== scope.faultScenario) {
      throw new Error('Only the exact approved descriptive pair is authorized.');
    }
  }
  if (calibration) validateCalibrationProtocol(protocol);
  const label = `${calibration ? 'CAL' : 'PILOT'}-${String(batchNumber).padStart(3, '0')}-${step.phase}-R${step.rate}`;
  const runs = [];
  let firstOrder;
  for (let repetition = 1; repetition <= step.repetitions; repetition++) {
    const seed = `${protocol.randomSeed}:${label}:${repetition}`;
    let ordered = [...conditions].sort((a, b) => createHash('sha256').update(`${seed}:${a.conditionId}`).digest('hex').localeCompare(createHash('sha256').update(`${seed}:${b.conditionId}`).digest('hex')));
    if (calibration) { firstOrder ??= ordered; ordered = repetition === 1 ? firstOrder : [...firstOrder].reverse(); }
    for (const condition of ordered) runs.push({ ...condition, runId: `${label}-${condition.conditionId}-${repetition}`, block: calibration ? 'CALIBRATION' : 'PILOT', phase: step.phase,
      offeredRate: step.rate, offeredLoadPercent: null, repetition, executionBlock: `${label}-${repetition}`,
      networkProfile: 'standard', faultScenario: step.faultScenario ?? 'none', randomSeed: seed, sequence: runs.length + 1 });
  }
  return { schemaVersion: 1, kind: calibration ? 'DIAGNOSTIC_CALIBRATION' : 'CAPACITY_PILOT', protocolId: protocol.protocolId,
    ...(isQueueCapacity(protocol) ? { capacityRule: capacityRuleIdentity(protocol) } : {}), expectedRunCount: runs.length, runs };
}
