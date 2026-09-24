import { createHash } from 'node:crypto';
import { durationSeconds } from './outcomes.js';
import { assertDeepDiagnosticEvidence } from './deep-diagnostic-evidence.js';
import { OBSERVATION_RULE_VERSION, approvedObservationProtocols, observationPairScope, isQueueObservation, describeQueueObservation } from './queue-observation.js';

export const CAPACITY_RULE_VERSION = 'queue-growth-v1';
export function assertCapacityRuleLaunchReady(rule) {
  const approved = approvedObservationProtocols.find(p => rule?.version === OBSERVATION_RULE_VERSION
    && rule.policySha256 === capacityRuleIdentity(p).policySha256);
  if (approved) return approved;
  // Implementation correctness is not scientific validation. Keep this draft
  // inspectable/testable, but never execute it after the bounded-queue failure.
  throw new Error(`Capacity rule ${rule?.version ?? 'unknown'} is blocked: bounded-oscillation validation requires review before live runs.`);
}
export const isQueueCapacity = p => p.kind === 'CAPACITY_QUEUE_PILOT';
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const capacityRuleIdentity = p => ({ version: p.ruleVersion ?? CAPACITY_RULE_VERSION,
  policySha256: createHash('sha256').update(JSON.stringify(canonical(p))).digest('hex') });

export function validateQueueCapacityProtocol(p) {
  if (isQueueObservation(p)) {
    if (!approvedObservationProtocols.some(approved => JSON.stringify(canonical(p)) === JSON.stringify(canonical(approved)))) {
      throw new Error('Descriptive screening protocol differs from the approved two-run scope.');
    }
    return;
  }
  // This authorization is deliberately narrower than the future adaptive search.
  if (!isQueueCapacity(p) || p.schemaVersion !== 2 || p.ruleVersion !== CAPACITY_RULE_VERSION
    || p.executionScope !== 'FIRST_SCREENING_PAIR_ONLY' || p.startRate !== 4 || p.maximumRate !== 4
    || p.screeningReplicates !== 1 || p.maximumRuns !== 2 || p.maximumHours !== 2
    || p.screening?.warmupDuration !== '2m' || p.screening?.measurementDuration !== '4m'
    || p.warmupDuration !== '5m' || p.measurementDuration !== '10m' || p.drainSeconds !== 600
    || p.deepDiagnostics !== true || p.timeBudgetBasis !== 'active-sessions' || p.pauseBoundary !== 'matched-pair'
    || p.stability?.windowSeconds !== 30 || p.stability?.lastCompleteWindows !== 6
    || p.stability?.maximumBacklogSlopePerSecond !== 0 || p.stability?.minimumWorkloadCheckRate !== .995
    || p.stability?.persistentMinuteIncreases !== 3 || p.stability?.timingCompletenessRatio !== 1
    || p.stability?.minimumOfferedLoadDelivery !== .995 || p.stability?.maximumDroppedIterations !== 0
    || p.latencyRole !== 'DESCRIPTIVE_NOT_A_CAPACITY_GATE') {
    throw new Error('Queue capacity protocol differs from the approved first pair; review required.');
  }
}

// The low-level controller must enforce the same exact scope as the pilot.
export function assertObservationBatchScope(matrix, lifecycle, deepDiagnostics) {
  const protocol = assertCapacityRuleLaunchReady(matrix.capacityRule), scope = observationPairScope(protocol);
  const timing = scope.phase === 'screening' ? protocol.screening : protocol;
  if (matrix.protocolId !== protocol.protocolId || matrix.expectedRunCount !== 2 || matrix.runs?.length !== 2
    || new Set(matrix.runs.map(r => r.runId)).size !== 2
    || ['R-A', 'K-A'].some(c => matrix.runs.filter(r => r.conditionId === c).length !== 1)
    || matrix.runs.some((r, i) => r.phase !== scope.phase || r.offeredRate !== scope.rate || r.faultScenario !== scope.faultScenario
      || r.repetition !== 1 || r.sequence !== i + 1 || !r.runId || !r.randomSeed || !r.executionBlock)
    || matrix.runs[0].randomSeed !== matrix.runs[1].randomSeed || matrix.runs[0].executionBlock !== matrix.runs[1].executionBlock
    || lifecycle.warmupDuration !== timing.warmupDuration || lifecycle.measurementDuration !== timing.measurementDuration
    || lifecycle.drainSeconds !== protocol.drainSeconds || !deepDiagnostics
    || (scope.phase === 'fault' && ['faultAtSeconds', 'adapterCrashSeconds', 'databaseFaultSeconds', 'databaseLatencyMs']
      .some((k, i) => lifecycle[k] !== protocol.faults[['atSeconds', 'adapterCrashSeconds', 'databaseDelaySeconds', 'databaseLatencyMs'][i]]))) {
    throw new Error('Descriptive pair differs from its approved rate, fault, timing, identity or two-run scope.');
  }
  return protocol;
}

function slope(values, windowSeconds) {
  // Exact integer sign: no epsilon silently permits positive queue growth.
  const n = BigInt(values.length), xs = values.map((_, i) => BigInt(i + 1));
  const ys = values.map(BigInt), sum = a => a.reduce((s, v) => s + v, 0n);
  const numerator = n * sum(xs.map((x, i) => x * ys[i])) - sum(xs) * sum(ys);
  const denominator = n * sum(xs.map(x => x * x)) - sum(xs) ** 2n;
  return { sign: numerator > 0n ? 1 : numerator < 0n ? -1 : 0,
    transfersPerSecond: Number(numerator) / Number(denominator) / windowSeconds };
}

export function classifyBacklog(boundaries) {
  if (boundaries.length < 6 || !boundaries.every(v => Number.isSafeInteger(v) && v >= 0)) {
    throw new Error('Expected at least six nonnegative integer backlog boundaries.');
  }
  const whole = slope(boundaries, 30), recent = slope(boundaries.slice(-6), 30);
  const b = [0, ...boundaries], persistentGrowthAt = [];
  for (let k = 6; k < b.length; k++) {
    if (b[k] > b[k - 2] && b[k - 2] > b[k - 4] && b[k - 4] > b[k - 6]) persistentGrowthAt.push(k);
  }
  const status = whole.sign <= 0 && recent.sign <= 0 && persistentGrowthAt.length === 0 ? 'SUSTAINED'
    : whole.sign > 0 && recent.sign > 0 && persistentGrowthAt.includes(boundaries.length)
      ? 'NOT_SUSTAINED_QUEUE_GROWTH' : 'INCONCLUSIVE';
  return { status, whole, recent, persistentGrowthAt, boundaries: b };
}

export function evaluateQueueCapacityRun(evidence, protocol, phase, lifecycleMatches) {
  validateQueueCapacityProtocol(protocol);
  const { qualification: q, outcomes: o, telemetry, manifest: m } = evidence;
  const rule = capacityRuleIdentity(protocol);
  const identity = m?.study?.capacityRule;
  const descriptive = isQueueObservation(protocol);
  const scope = observationPairScope(protocol);
  const faultRun = descriptive && scope.phase === 'fault';
  const timing = phase === 'screening' ? protocol.screening : protocol;
  const seconds = durationSeconds(timing.measurementDuration), start = Date.parse(o?.measurementStart);
  const end = Date.parse(o?.measurementEnd), observedEnd = Date.parse(o?.observationEnd);
  const windows = (o?.windowSeries ?? []).filter(w => w.complete && w.underLoad);
  const transfers = o?.transfers ?? [];
  let diagnosticsHealthy = false;
  try { diagnosticsHealthy = assertDeepDiagnosticEvidence(evidence.databaseDiagnostics, evidence.resourceJsonl); } catch {}
  const cohortComplete = transfers.length > 0 && o?.unplaceableTransfers === 0 && o?.timingCompletenessRatio === 1
    && new Set(transfers.map(t => t.transferId)).size === transfers.length
    && transfers.every(t => t.transferId && t.timingComplete === true && Date.parse(t.receivedAt) >= start
      && Date.parse(t.receivedAt) < end && (t.terminalAt == null
        ? !['FULFILLED', 'FAILED'].includes(t.terminalState)
        : Date.parse(t.terminalAt) >= Date.parse(t.receivedAt) && Date.parse(t.terminalAt) <= observedEnd));
  let previousBacklog = 0;
  const flow = windows.map(w => {
    const left = Date.parse(w.startAt), right = Date.parse(w.endAt);
    const arrivals = transfers.filter(t => Date.parse(t.receivedAt) >= left && Date.parse(t.receivedAt) < right).length;
    const terminalConfirmations = transfers.filter(t => t.terminalAt && Date.parse(t.terminalAt) >= left && Date.parse(t.terminalAt) < right).length;
    const backlog = transfers.filter(t => Date.parse(t.receivedAt) < right && (!t.terminalAt || Date.parse(t.terminalAt) >= right)).length;
    const balanced = previousBacklog + arrivals - terminalConfirmations === backlog && backlog === w.backlogAtEnd;
    const row = { ...w, backlogAtStart: previousBacklog, arrivals, terminalConfirmations, balanced };
    previousBacklog = backlog;
    return row;
  });
  const checks = {
    evidenceValid: q?.valid === true,
    fullDuration: lifecycleMatches && (!descriptive || (phase === scope.phase && m?.run?.offeredRate === scope.rate && m?.run?.faultScenario === scope.faultScenario))
      && o?.schemaVersion === 2 && o?.measurementSeconds === seconds
      && end - start === seconds * 1000 && observedEnd >= end,
    protocolIdentity: identity?.version === rule.version && identity?.policySha256 === rule.policySha256
      && m?.study?.pilotProtocolId === protocol.protocolId,
    diagnosticsHealthy: diagnosticsHealthy && m?.deepDiagnostics?.enabled === true,
    offeredLoadDelivered: q?.gates?.offeredLoadDelivered === true,
    completeTiming: cohortComplete,
    completeWindows: o?.windowSeconds === 30 && windows.length === seconds / 30
      && windows.every((w, i) => Date.parse(w.startAt) === start + i * 30000 && Date.parse(w.endAt) === start + (i + 1) * 30000),
    queueAccounting: flow.every(w => w.balanced),
    safetyPassed: q?.safety?.passed === true,
    workloadChecks: q?.performance?.workloadCheckRate >= protocol.stability.minimumWorkloadCheckRate,
    terminalCallbacks: q?.performance?.terminalCallbacksComplete === true,
    noFailedTransfers: Number(telemetry?.transfers_failed) === 0 && o?.terminalCounts?.failed === 0
      && transfers.every(t => t.terminalState !== 'FAILED'),
    noPendingAfterDrain: Number(telemetry?.transfers_pending) === 0 && o?.terminalCounts?.pendingAfterDrain === 0
      && transfers.every(t => ['FULFILLED', 'FAILED'].includes(t.terminalState)),
    correctCompletions: transfers.every(t => t.correct === true)
  };
  const eligibility = ['evidenceValid', 'fullDuration', 'protocolIdentity', 'diagnosticsHealthy',
    'offeredLoadDelivered', 'completeTiming', 'completeWindows', 'queueAccounting'];
  if (faultRun) {
    const fault = evidence.fault, analysis = o?.faultAnalysis;
    const requested = Date.parse(fault?.requestedAt), injected = Date.parse(fault?.injectedAt), cleared = Date.parse(fault?.clearedAt);
    checks.faultEvidence = q?.gates?.faultEvidenceComplete === true && fault?.completed === true
      && fault.scenario === scope.faultScenario && fault.scheduledAtMeasurementSecond === protocol.faults.atSeconds
      && requested >= start + protocol.faults.atSeconds * 1000 && injected >= requested && cleared > injected && cleared < end
      && cleared - injected >= (scope.faultScenario === 'adapter-crash' ? protocol.faults.adapterCrashSeconds : protocol.faults.databaseDelaySeconds) * 1000
      && analysis?.scenario === fault.scenario && analysis?.injectedAt === fault.injectedAt && analysis?.clearedAt === fault.clearedAt
      && analysis?.baseline?.windows === 3
      && ['faultAtSeconds', 'adapterCrashSeconds', 'databaseFaultSeconds', 'databaseLatencyMs']
        .every((k, i) => m?.lifecycle?.[k] === protocol.faults[['atSeconds', 'adapterCrashSeconds', 'databaseDelaySeconds', 'databaseLatencyMs'][i]]);
    eligibility.push('faultEvidence');
  }
  const correctness = ['workloadChecks', 'terminalCallbacks', 'noFailedTransfers', 'noPendingAfterDrain', 'correctCompletions'];
  const queue = checks.completeWindows && checks.queueAccounting
    ? (descriptive ? describeQueueObservation(windows.map(w => w.backlogAtEnd)) : classifyBacklog(windows.map(w => w.backlogAtEnd))) : null;
  if (faultRun && queue) queue.role = protocol.queueRole;
  const status = !checks.safetyPassed ? 'SAFETY_FAILURE'
    : !eligibility.every(k => checks[k]) ? 'INVALID_OR_HARNESS_LIMIT'
    : !correctness.every(k => checks[k]) ? (descriptive ? 'CORRECTNESS_REVIEW_REQUIRED' : 'NOT_CORRECTLY_SUSTAINED')
    : descriptive ? 'OBSERVATION_RECORDED' : queue.status;
  return { schemaVersion: 1, rule, status,
    ...(descriptive ? { role: protocol.queueRole, automaticBoundaryDecision: null } : { stable: status === 'SUSTAINED' }), capacityEstablished: false,
    checks, queue, windows: flow,
    latency: { role: protocol.latencyRole, overall: o?.durableCompletionMs ?? null },
    ...(faultRun ? { fault: { role: protocol.faultEndpointRole, ...o?.faultAnalysis } } : {}),
    completedDuringDrain: o?.completedDuringDrain ?? null };
}
