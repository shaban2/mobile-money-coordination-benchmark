#!/usr/bin/env node
// Phase 1 of the revision. Recomputes the added measures (exact fault intervals, recovery, step times)
// from the archived v1 evidence. Read-only on evidence and fails if it cannot
// first reproduce the published analysis.json values for the same runs.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { quantile } from '../src/experiment/outcomes.js';

const root = process.cwd();
const published = JSON.parse(readFileSync(path.join(root, '.research/exploratory-paper-v1/analysis.json'), 'utf8'));
const outDir = path.join(root, '.research/revision-v2');
const at = (value) => Date.parse(value);
const read = (dir, name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
const round = (value, digits = 3) => (value == null ? null : Number(value.toFixed(digits)));
const median = (values) => quantile(values, .5);

const HOPS = [['API_RECEIVED', 'STATE_TRANSITION:VALIDATED'], ['STATE_TRANSITION:VALIDATED', 'STATE_TRANSITION:PREPARED'],
  ['STATE_TRANSITION:PREPARED', 'PROVIDER_ATTEMPT'], ['PROVIDER_ATTEMPT', 'TERMINAL_STATE'], ['TERMINAL_STATE', 'COMMIT_CONFIRMED']];

function hopBreakdown(dir, transfers) {
  const wanted = new Set(transfers.filter((t) => t.correct).map((t) => t.transferId));
  const byTransfer = new Map();
  for (const event of read(dir, 'traces.json').events) {
    if (!wanted.has(event.transfer_id)) continue;
    const details = event.details ?? {};
    const name = event.event_type === 'STATE_TRANSITION'
      ? `STATE_TRANSITION:${details.to ?? details.state ?? details.nextState}` : event.event_type;
    if (!byTransfer.has(event.transfer_id)) byTransfer.set(event.transfer_id, new Map());
    const stages = byTransfer.get(event.transfer_id);
    if (!stages.has(name)) stages.set(name, at(event.occurred_at));
  }
  return HOPS.map(([from, to]) => {
    const gaps = [...byTransfer.values()].filter((s) => s.has(from) && s.has(to)).map((s) => s.get(to) - s.get(from));
    return { from, to, count: gaps.length, medianMs: round(median(gaps), 1), p95Ms: round(quantile(gaps, .95), 1) };
  });
}

function faultMeasures(run, outcomes) {
  const injected = at(run.fault.injectedAt), cleared = at(run.fault.clearedAt);
  const correct = outcomes.transfers.filter((t) => t.correct);
  const done = (t) => at(t.terminalAt);
  const windows = outcomes.windowSeries;
  const inside = windows.filter((w) => at(w.endAt) > injected && at(w.endAt) <= cleared);
  const arrivals = correct.filter((t) => at(t.receivedAt) >= injected && at(t.receivedAt) < cleared);
  const completions = correct.filter((t) => done(t) >= injected && done(t) < cleared);
  const fa = outcomes.faultAnalysis;
  const post = windows.filter((w) => w.complete && w.underLoad && at(w.startAt) >= cleared);
  const secondsToEnd = (w) => (w ? round((at(w.endAt) - cleared) / 1000) : null);
  const baseP95 = fa.baseline.p95DurableCompletionMs, baseRate = fa.baseline.correctGoodput;
  // Latency grouped by the arrival second, so a transfer accepted during the
  // fault counts against its arrival and not against the window it finished in.
  const arrivalBins = post.map((w) => ({ w, lat: correct.filter((t) => at(t.receivedAt) >= at(w.startAt) && at(t.receivedAt) < at(w.endAt)).map((t) => t.latencyMs) }));
  const firstNormalArrival = arrivalBins.find(({ lat }) => lat.length && quantile(lat, .95) <= 1.1 * baseP95);
  const beforeClear = correct.filter((t) => at(t.receivedAt) < cleared && done(t) >= injected);
  return {
    injectedAt: run.fault.injectedAt, clearedAt: run.fault.clearedAt, durationSeconds: round((cleared - injected) / 1000),
    windowsEndingInside: inside.length,
    doneWindowBased: Math.round(inside.reduce((sum, w) => sum + w.correctGoodput * 30, 0)),
    doneExactInterval: completions.length,
    exactRatePerSecond: round(completions.length / ((cleared - injected) / 1000)),
    arrivalsInFault: arrivals.length,
    arrivedAndDoneInFault: arrivals.filter((t) => done(t) < cleared).length,
    arrivedInFaultDoneAfter: arrivals.filter((t) => done(t) >= cleared).length,
    recovery: {
      baselineGoodput: round(baseRate), baselineP95Ms: round(baseP95, 1),
      completionRateRestoredSeconds: secondsToEnd(post.find((w) => w.correctGoodput >= .9 * baseRate)),
      faultCohortClearedSeconds: beforeClear.length ? round((Math.max(...beforeClear.map(done)) - cleared) / 1000) : 0,
      latencyRestoredByCompletionSeconds: secondsToEnd(post.find((w) => w.p95DurableCompletionMs !== null && w.p95DurableCompletionMs <= 1.1 * baseP95)),
      latencyRestoredByArrivalSeconds: secondsToEnd(firstNormalArrival?.w),
      sustainedThreeWindowSeconds: round(fa.recoveryTimeSeconds)
    }
  };
}

function dispatchMeasures(run, dir) {
  const injected = at(run.fault.injectedAt), cleared = at(run.fault.clearedAt);
  const spans = read(dir, 'diagnostics.json').spans.filter((s) => s.label.startsWith('db.') && at(s.startedAt) >= injected && at(s.startedAt) < cleared);
  const outboxMarks = spans.filter((s) => s.label === 'db.pool_query.UPDATE' && s.transferId === null);
  const seconds = (cleared - injected) / 1000;
  return { statementsOver10Ms: spans.length, linkedToTransfer: spans.filter((s) => s.transferId !== null).length,
    notLinkedToTransfer: spans.filter((s) => s.transferId === null).length,
    outboxMarks: outboxMarks.length, outboxMarksPerSecond: round(outboxMarks.length / seconds, 2),
    outboxMarkMedianMs: round(median(outboxMarks.map((s) => s.durationMs)), 1) };
}

const runs = [...published.runs.map((r) => ({ ...r, cohort: 'reporting' })), ...published.freshFaultRuns.map((r) => ({ ...r, cohort: 'fresh' }))];
const results = runs.map((run) => {
  const dir = path.join(root, run.evidenceRoot, run.runId);
  const outcomes = read(dir, 'run-outcomes.json');
  // Reproduction gate: nothing new is reported unless the published values return.
  assert.equal(outcomes.correctGoodput, run.goodput, `${run.runId} goodput`);
  assert.equal(outcomes.durableCompletionMs.p95, run.latency.p95, `${run.runId} p95`);
  assert.equal(outcomes.durableCompletionMs.count, run.latency.count, `${run.runId} count`);
  return { cohort: run.cohort, scenario: run.key, architecture: run.architecture, sequence: run.sequence, runId: run.runId, evidenceRoot: run.evidenceRoot,
    hops: hopBreakdown(dir, outcomes.transfers),
    fault: run.fault ? faultMeasures(run, outcomes) : null,
    dispatch: run.key === 'database' ? dispatchMeasures(run, dir) : null };
});

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'reanalysis-v1.json'), `${JSON.stringify({ schemaVersion: 1, sourceAnalysis: '.research/exploratory-paper-v1/analysis.json',
  note: 'Retrospective recomputation of the 10 v1 reporting and fresh runs. One run per cell, so no uncertainty is estimated.', runs: results }, null, 2)}\n`);
console.log(`reproduced published values for ${results.length} runs`);
