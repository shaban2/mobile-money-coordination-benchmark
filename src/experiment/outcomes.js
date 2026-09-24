export function quantile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
}
export function durationSeconds(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  return Number(match[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]];
}
const at = (value) => value ? Date.parse(value) : NaN;

export function deriveOutcomes({ manifest, telemetry, traces, controller, fault, invariants, snapshot, clock }) {
  const measurementStart = clock?.measurementStartedAt;
  if (!Number.isFinite(at(measurementStart))) throw new Error('A k6 measurement clock marker is required.');
  const start = at(measurementStart);
  const seconds = durationSeconds(manifest.lifecycle.measurementDuration);
  const end = start + seconds * 1000;
  const observationEnd = at(controller.events.findLast((e) => e.status === 'OBSERVATION_ENDED')?.occurredAt);
  if (!(observationEnd >= end)) throw new Error('Observation must extend through measurement end.');
  const grouped = new Map();
  for (const raw of traces.events) {
    const id = raw.transfer_id ?? raw.transferId;
    const event = { type: raw.event_type ?? raw.eventType, time: raw.occurred_at ?? raw.occurredAt, details: raw.details ?? {} };
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(event);
  }
  const reconciled = new Set(invariants?.reconciledTransferIds ?? []);
  const observedTransfers = snapshot.transfers.map((record) => {
    const events = grouped.get(record.transferId) ?? [];
    const received = events.find((e) => e.type === 'API_RECEIVED');
    const terminal = events.filter((e) => e.type === 'COMMIT_CONFIRMED' && !e.details.recovered)
      .sort((a, b) => at(a.details.confirmedAt) - at(b.details.confirmedAt))[0];
    const receivedAt = received?.details.receivedAt;
    const confirmedAt = terminal?.details.confirmedAt;
    const terminalState = record.internalState;
    return { transferId: record.transferId, idempotencyKey: record.idempotencyKey, receivedAt,
      terminalAt: confirmedAt ?? null, terminalState,
      correct: terminalState === 'FULFILLED' && reconciled.has(record.transferId) && Boolean(confirmedAt),
      latencyMs: terminal ? at(confirmedAt) - at(receivedAt) : null,
      timingComplete: Number.isFinite(at(receivedAt)) && (record.publicStatus === 'PENDING'
        || (Number.isFinite(at(confirmedAt)) && at(confirmedAt) >= at(receivedAt) && at(confirmedAt) <= observationEnd)) };
  });
  const unplaceableTransfers = observedTransfers.filter((t) => !Number.isFinite(at(t.receivedAt))).length;
  const transfers = observedTransfers.filter((t) => at(t.receivedAt) >= start && at(t.receivedAt) < end);
  const correct = transfers.filter((t) => t.correct && t.latencyMs >= 0);
  const measured = correct.filter((t) => at(t.terminalAt) < end);
  const windowSeconds = 30;
  const windows = [];
  for (let left = start; left < observationEnd; left += 30_000) {
    const right = Math.min(left + 30_000, observationEnd);
    const completed = correct.filter((t) => at(t.terminalAt) >= left && at(t.terminalAt) < right);
    windows.push({ startAt: new Date(left).toISOString(), endAt: new Date(right).toISOString(),
      complete: right - left === 30_000, underLoad: right <= end,
      correctGoodput: completed.length / ((right - left) / 1000),
      p95DurableCompletionMs: quantile(completed.map((t) => t.latencyMs), .95),
      // Include never-terminal transfers. Missing commit evidence remains pending
      // for this measurement instead of inferring a completion timestamp.
      backlogAtEnd: transfers.filter((t) => at(t.receivedAt) < right && (!t.terminalAt || at(t.terminalAt) >= right)).length });
  }
  let faultAnalysis = null;
  if (fault?.completed) {
    const injected = at(fault.injectedAt), cleared = at(fault.clearedAt);
    const baseline = windows.filter((w) => w.complete && w.underLoad && at(w.endAt) <= injected).slice(-3);
    const baselineGoodput = baseline.length === 3 ? baseline.reduce((sum, w) => sum + w.correctGoodput, 0) / 3 : null;
    const baselineP95 = baseline.length === 3 ? quantile(correct.filter((t) => at(t.terminalAt) >= at(baseline[0].startAt) && at(t.terminalAt) < at(baseline[2].endAt)).map((t) => t.latencyMs), .95) : null;
    const baselineBacklog = baseline.length === 3 ? Math.max(...baseline.map((w) => w.backlogAtEnd)) : null;
    const post = windows.filter((w) => w.complete && w.underLoad && at(w.startAt) >= cleared);
    let recovery = null;
    if (baselineGoodput > 0 && baselineP95 !== null) for (let i = 0; i <= post.length - 3; i++) {
      if (post.slice(i, i + 3).every((w) => w.correctGoodput >= .9 * baselineGoodput && w.p95DurableCompletionMs !== null && w.p95DurableCompletionMs <= 1.1 * baselineP95)) {
        recovery = (at(post[i + 2].endAt) - cleared) / 1000; break;
      }
    }
    const backlog = baselineBacklog === null ? null : windows.find((w) => w.complete && at(w.startAt) >= cleared && w.backlogAtEnd <= baselineBacklog);
    faultAnalysis = { scenario: fault.scenario, injectedAt: fault.injectedAt, clearedAt: fault.clearedAt,
      recoveryEstimable: baselineGoodput > 0 && baselineP95 !== null,
      backlogEstimable: baselineBacklog !== null,
      baseline: { windows: baseline.length, correctGoodput: baselineGoodput, p95DurableCompletionMs: baselineP95, backlogUpper: baselineBacklog },
      recoveryTimeSeconds: recovery, recoveryCensored: recovery === null,
      recoveryObservationSeconds: Math.max(0, (end - cleared) / 1000),
      backlogClearanceSeconds: backlog ? (at(backlog.endAt) - cleared) / 1000 : null,
      backlogClearanceCensored: !backlog, backlogObservationSeconds: Math.max(0, (observationEnd - cleared) / 1000) };
  }
  const times = measured.map((t) => t.latencyMs);
  return { schemaVersion: 2, runId: manifest.run.runId, conditionId: manifest.run.conditionId,
    block: manifest.run.block, executionBlock: manifest.run.executionBlock, offeredRate: manifest.run.offeredRate,
    measurementStart, measurementEnd: new Date(end).toISOString(), observationEnd: new Date(observationEnd).toISOString(), measurementSeconds: seconds,
    latencyDefinition: 'API ingress to application-observed COMMIT acknowledgement; excludes client network; same application clock',
    terminalCounts: { total: transfers.length, completed: transfers.filter((t) => t.terminalState === 'FULFILLED').length,
      failed: transfers.filter((t) => t.terminalState === 'FAILED').length,
      pendingAfterDrain: transfers.filter((t) => !['FULFILLED', 'FAILED'].includes(t.terminalState)).length },
    observedTransferIds: snapshot.transfers.map((t) => t.transferId),
    correctGoodput: measured.length / seconds, eventualCorrectCompletionRate: correct.length / seconds,
    completedDuringDrain: correct.length - measured.length,
    unplaceableTransfers,
    timingCompletenessRatio: transfers.length + unplaceableTransfers ? transfers.filter((t) => t.timingComplete).length / (transfers.length + unplaceableTransfers) : 1,
    durableCompletionMs: { count: times.length, median: quantile(times, .5), p95: quantile(times, .95), p99: quantile(times, .99) },
    eventualCompletionMs: { p95: quantile(correct.map((t) => t.latencyMs), .95) },
    faultAnalysis, windowSeconds, windowSeries: windows, transfers };
}
