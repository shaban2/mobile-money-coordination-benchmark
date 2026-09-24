import { checkContainerSet, resourceServicesFor } from './compose-lifecycle.js';

export function qualifyRun({ manifest, invariants, telemetry, summary, callbacks, outcomes, traces, attempts, resources,
  fault, composeHash, endChecksums, isolation, cleanStart, resolvedCompose, exitCode = 0 }) {
  const count = (name) => Number(summary?.metrics?.[name]?.values?.count ?? summary?.metrics?.[name]?.count ?? 0);
  const checks = Number(summary?.metrics?.checks?.values?.rate ?? summary?.metrics?.checks?.value ?? 0);
  const operations = count('workload_unique_creates') + count('workload_replay_creates') + count('workload_status_retrievals');
  const creates = count('workload_unique_creates') + count('workload_replay_creates');
  const share = (n, d) => d ? n / d : 0;
  const statusShare = share(count('workload_status_retrievals'), operations);
  const replayShare = share(count('workload_replay_creates'), creates);
  const providerShare = share(count('workload_provider_a_requests'), creates);
  const start = Date.parse(outcomes?.measurementStart), end = Date.parse(outcomes?.measurementEnd);
  const samples = resources.filter((s) => s.commandStatus === 0 && s.containers?.length)
    .map((s) => Date.parse(s.capturedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const maxGapMs = manifest?.qualification?.maxResourceGapMs ?? 5000;
  const coverage = samples.length >= 2 && samples[0] <= start + maxGapMs && samples.at(-1) >= end - maxGapMs
    && samples.every((t, i) => !i || t - samples[i - 1] <= maxGapMs);
  const transfers = outcomes?.transfers ?? [];
  const delivered = new Map((callbacks?.deliveries ?? []).map((d) => [d.body?.transferId, d.body?.status]));
  const callbackComplete = transfers.filter((t) => ['FULFILLED', 'FAILED'].includes(t.terminalState))
    .every((t) => delivered.get(t.transferId) === (t.terminalState === 'FULFILLED' ? 'COMPLETED' : 'FAILED'));
  const attemptRows = attempts?.attempts ?? [];
  const attemptedKeys = new Set(attemptRows.map((a) => a.idempotencyKey));
  const known = new Set(outcomes?.observedTransferIds ?? transfers.map((t) => t.transferId));
  const acknowledged = attemptRows.filter((a) => a.operation !== 'status_retrieval' && [200, 202].includes(a.httpStatus));
  const expectedServices = manifest?.resourceServices ?? [];
  const containerReports = resources.filter((s) => s.commandStatus === 0).map((s) => checkContainerSet(s.containers, expectedServices, {
    project: manifest?.composeProject ?? s.composeProject, allowK6: true,
    optionalServices: manifest?.run?.faultScenario === 'adapter-crash'
      && Date.parse(s.capturedAt) >= Date.parse(fault?.injectedAt) - maxGapMs
      && Date.parse(s.capturedAt) <= Date.parse(fault?.clearedAt) + maxGapMs ? ['adapter-service'] : []
  }));
  const containersComplete = containerReports.length > 0 && containerReports.every((r) => !r.missing.length);
  const containersIsolated = containerReports.length > 0 && containerReports.every((r) => !r.unexpected.length && !r.duplicates.length);
  let lifecycleIsolation = true;
  if (manifest?.schemaVersion >= 5) {
    let canonicalServices = [];
    try { canonicalServices = resourceServicesFor(manifest.run); } catch {}
    const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((v) => b.includes(v));
    lifecycleIsolation = Boolean(manifest.composeProject) && sameSet(expectedServices, canonicalServices)
      && cleanStart?.passed === true && cleanStart.project === manifest.composeProject && cleanStart.remainingContainers?.length === 0
      && ['before-warmup', 'before-measurement', 'after-observation'].every((phase) => {
        const snapshot = isolation?.snapshots?.find((s) => s.phase === phase);
        return snapshot?.project === manifest.composeProject && snapshot.passed === true
          && checkContainerSet(snapshot.containers, canonicalServices, { project: manifest.composeProject }).passed;
      })
      && sameSet(Object.keys(resolvedCompose?.services ?? {}), [...canonicalServices, 'toxiproxy-init']);
  }
  const gates = {
    artifactsPresent: Boolean(manifest && invariants && telemetry && summary && callbacks && outcomes && traces && attempts),
    supportedMeasurementSchema: outcomes?.schemaVersion === 2,
    workloadCompositionWithinTolerance: operations < 100 || (statusShare >= .18 && statusShare <= .22 && replayShare >= .04 && replayShare <= .06 && providerShare >= .48 && providerShare <= .52),
    clientAttemptsAccountedFor: attemptRows.length === operations && new Set(attemptRows.map((a) => a.attemptId)).size === operations
      && acknowledged.every((a) => known.has(a.transferId))
      && transfers.every((t) => attemptedKeys.has(t.idempotencyKey)),
    timingEvidenceComplete: (outcomes?.timingCompletenessRatio ?? 0) >= .995,
    resourceCoverageComplete: coverage && containersComplete,
    architectureIsolated: containersIsolated && lifecycleIsolation,
    offeredLoadDelivered: count('dropped_iterations') === 0 && operations >= (manifest?.run?.offeredRate ?? Infinity) * (outcomes?.measurementSeconds ?? 0) * .995,
    generatorCompleted: [0, 99].includes(exitCode),
    faultEvidenceComplete: manifest?.run?.faultScenario === 'none' || fault?.completed === true,
    fixedAsyncClientMode: manifest?.study?.fixedClientMode === 'async' && ['R-A', 'K-A'].includes(manifest?.run?.conditionId),
    configurationUnchanged: manifest?.checksums?.composeSha256 === (endChecksums?.composeSha256 ?? composeHash)
      && (manifest?.schemaVersion < 4 || !manifest?.schemaVersion || Boolean(endChecksums))
      && (!endChecksums || Object.entries(manifest?.checksums ?? {}).every(([key, value]) => endChecksums[key] === value))
  };
  const valid = Object.values(gates).every(Boolean);
  const safetyPassed = invariants?.passed === true;
  const performancePassed = checks >= .995 && callbackComplete && Number(telemetry?.transfers_failed ?? 0) === 0;
  const censored = Number(telemetry?.transfers_pending ?? 0) > 0 || outcomes?.faultAnalysis?.recoveryCensored === true || outcomes?.faultAnalysis?.backlogClearanceCensored === true;
  const status = !valid ? 'INVALID' : !safetyPassed ? 'SAFETY_FAILURE' : censored ? 'CENSORED' : !performancePassed ? 'PERFORMANCE_FAILURE' : 'QUALIFIED';
  return { schemaVersion: 2, runId: manifest?.run?.runId, qualified: valid, valid, status, gates,
    eligibleToLead: valid && safetyPassed && performancePassed && !censored,
    safety: { passed: safetyPassed, checks: invariants?.checks },
    performance: { passed: performancePassed, workloadCheckRate: checks, terminalCallbacksComplete: callbackComplete, censored },
    observed: { workloadComposition: { totalOperations: operations, statusShare, replayShareWithinCreateAttempts: replayShare, providerAShare: providerShare },
      resourceSampleLines: samples.length, uniqueCallbackTransfers: delivered.size, pending: telemetry?.transfers_pending },
    qualifiedAt: new Date().toISOString() };
}
