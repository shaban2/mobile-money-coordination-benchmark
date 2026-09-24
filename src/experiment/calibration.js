import { quantile } from './outcomes.js';

export const isCalibration = (protocol) => protocol.kind === 'DIAGNOSTIC_CALIBRATION';
export function validateCalibrationProtocol(p) {
  if (!isCalibration(p) || p.schemaVersion !== 2 || p.rate !== 4 || p.pairs !== 2 || p.maximumRuns !== 4
    || p.warmupDuration !== '5m' || p.measurementDuration !== '10m' || p.drainSeconds !== 600
    || p.minimumWorkloadCheckRate !== .995 || p.maximumHours !== 3
    || p.timeBudgetBasis !== 'active-sessions' || p.pauseBoundary !== 'matched-pair') {
    throw new Error('Calibration must match the approved four-run, 4 operations/s, 5m/10m scope.');
  }
}

// These are descriptions, not a replacement capacity threshold chosen after V5.
export function evaluateCalibrationRun({ qualification: q, telemetry, outcomes: o }) {
  const checks = {
    evidenceValid: q?.valid === true,
    safetyPassed: q?.safety?.passed === true,
    workloadChecks: q?.performance?.workloadCheckRate >= .995,
    terminalCallbacks: q?.performance?.terminalCallbacksComplete === true,
    noFailedTransfers: Number(telemetry?.transfers_failed) === 0,
    noPendingAfterDrain: Number(telemetry?.transfers_pending) === 0,
    outcomesPresent: Array.isArray(o?.transfers) && o.transfers.length > 0 && o.timingCompletenessRatio === 1
  };
  const windows = (o?.windowSeries ?? []).filter(w => w.complete && w.underLoad).map(w => ({
    ...w, arrivals: (o.transfers ?? []).filter(t => t.receivedAt >= w.startAt && t.receivedAt < w.endAt).length
  }));
  const events = (o?.transfers ?? []).flatMap(t => [
    { at: Date.parse(t.receivedAt), delta: 1 },
    ...(t.terminalAt ? [{ at: Date.parse(t.terminalAt), delta: -1 }] : [])
  ]).filter(e => Number.isFinite(e.at)).sort((a, b) => a.at - b.at || a.delta - b.delta);
  let outstanding = 0, maximumOutstanding = 0;
  for (const e of events) { outstanding += e.delta; maximumOutstanding = Math.max(maximumOutstanding, outstanding); }
  return { schemaVersion: 1, checks, passed: Object.values(checks).every(Boolean),
    correctness: Object.values(checks).every(Boolean) ? 'PASSED' : 'REVIEW_REQUIRED',
    sustainedLoad: { decision: 'DESCRIPTIVE_REVIEW_REQUIRED', capacityEstablished: false,
      measuredTransfers: o?.terminalCounts ?? null, correctGoodput: o?.correctGoodput ?? null,
      completedDuringDrain: o?.completedDuringDrain ?? null, maximumOutstanding, windows },
    latency: { role: 'DESCRIPTIVE_NOT_A_CAPACITY_GATE', overall: o?.durableCompletionMs ?? null,
      windowP95MedianMs: quantile(windows.map(w => w.p95DurableCompletionMs), .5),
      windowP95MaximumMs: windows.length ? Math.max(...windows.map(w => w.p95DurableCompletionMs)) : null } };
}
