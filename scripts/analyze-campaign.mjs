#!/usr/bin/env node
// Revision campaign analysis. Read-only on evidence: never runs Docker, k6 or a controller.
// Usage: node scripts/analyze-campaign.mjs [root ...]
// Default roots: results-revision-campaign-v2 results-revision-extension-v1
// Output: .research/revision-v2/campaign-analysis.json and campaign-runs.csv
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { quantile } from '../src/experiment/outcomes.js';
import { pairedContrast, holm } from '../src/experiment/analysis.js';

const cwd = process.cwd();
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['results-revision-campaign-v2', 'results-revision-extension-v1'];
const outDir = path.join(cwd, '.research/revision-v2');
const at = (v) => Date.parse(v);
const round = (v, d = 3) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const median = (xs) => (xs.length ? quantile(xs, 0.5) : null);
const readJson = (dir, name) => {
  const plain = path.join(dir, name), gz = `${plain}.gz`;
  if (existsSync(plain)) return JSON.parse(readFileSync(plain, 'utf8'));
  if (existsSync(gz)) return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'));
  return null;
};
const readJsonl = (dir, name) => {
  const gz = path.join(dir, `${name}.gz`), plain = path.join(dir, name);
  const text = existsSync(gz) ? gunzipSync(readFileSync(gz)).toString('utf8') : existsSync(plain) ? readFileSync(plain, 'utf8') : '';
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const memoryMiB = (usage) => {
  const m = String(usage).split('/')[0].trim().match(/^([\d.]+)\s*([KMG]i?B|B)$/);
  if (!m) return 0;
  const f = { B: 1 / 2 ** 20, KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }[m[2]];
  return Number(m[1]) * f;
};
const timeWeighted = (pts) => {
  if (pts.length < 2) return pts[0]?.v ?? null;
  let area = 0;
  for (let i = 1; i < pts.length; i++) area += ((pts[i].v + pts[i - 1].v) / 2) * (pts[i].at - pts[i - 1].at);
  return area / (pts.at(-1).at - pts[0].at);
};

// Power source from the macOS power log (extracted to power-log.txt, one "date time AC|Batt charge" per line).
const powerFile = path.join(outDir, 'power-log.txt');
const power = existsSync(powerFile)
  ? readFileSync(powerFile, 'utf8').trim().split('\n').map((l) => { const [d, t, s] = l.split(' '); return { t: Date.parse(`${d}T${t}+07:00`), s }; }).sort((a, b) => a.t - b.t)
  : [];
const powerAt = (t) => { let s = null; for (const p of power) { if (p.t <= t) s = p.s; else break; } return s; };

const HOPS = [['API_RECEIVED', 'STATE_TRANSITION:VALIDATED'], ['STATE_TRANSITION:VALIDATED', 'STATE_TRANSITION:PREPARED'],
  ['STATE_TRANSITION:PREPARED', 'PROVIDER_ATTEMPT'], ['PROVIDER_ATTEMPT', 'TERMINAL_STATE'], ['TERMINAL_STATE', 'COMMIT_CONFIRMED']];
const STAGES = ['STATE_TRANSITION:VALIDATED', 'STATE_TRANSITION:PREPARED', 'PROVIDER_ATTEMPT', 'TERMINAL_STATE'];

function traceStages(dir) {
  const traces = readJson(dir, 'traces.json');
  const byTransfer = new Map();
  if (!traces) return byTransfer;
  for (const e of traces.events) {
    const name = e.event_type === 'STATE_TRANSITION' ? `STATE_TRANSITION:${e.details?.nextState}` : e.event_type;
    if (!byTransfer.has(e.transfer_id)) byTransfer.set(e.transfer_id, new Map());
    const s = byTransfer.get(e.transfer_id);
    if (!s.has(name)) s.set(name, at(e.occurred_at));
  }
  return byTransfer;
}

function hops(stages, correctIds) {
  return HOPS.map(([from, to]) => {
    const gaps = [...stages.entries()].filter(([id, s]) => correctIds.has(id) && s.has(from) && s.has(to)).map(([, s]) => s.get(to) - s.get(from));
    return { from, to, medianMs: round(median(gaps), 1), p95Ms: round(quantile(gaps, 0.95), 1) };
  });
}

function resources(dir, manifest, o) {
  const start = at(o.measurementStart), end = at(o.measurementEnd);
  const services = manifest.resourceServices;
  const samples = readJsonl(dir, 'docker-stats.jsonl').filter((s) => at(s.capturedAt) >= start && at(s.capturedAt) < end && s.commandStatus === 0);
  const per = Object.fromEntries(services.map((sv) => [sv, { cpu: [], mem: [] }]));
  for (const s of samples) {
    const t = at(s.capturedAt);
    for (const sv of services) {
      const c = s.containers.find((x) => x.Service === sv && !x.OneOff);
      per[sv].cpu.push({ at: t, v: c ? Number.parseFloat(c.CPUPerc) / 100 : 0 });
      per[sv].mem.push({ at: t, v: c ? memoryMiB(c.MemUsage) : 0 });
    }
  }
  const serviceMeans = Object.fromEntries(services.map((sv) => [sv, { cpuCores: round(timeWeighted(per[sv].cpu), 4), memoryMiB: round(timeWeighted(per[sv].mem), 1) }]));
  const sum = (k) => round(Object.values(serviceMeans).reduce((a, b) => a + (b[k] ?? 0), 0), k === 'cpuCores' ? 4 : 1);
  return { samples: samples.length, cpuCores: sum('cpuCores'), memoryMiB: sum('memoryMiB'), serviceMeans };
}

function faultMeasures(o, fe, stages, attempts) {
  const injected = at(fe.injectedAt), cleared = at(fe.clearedAt);
  const correct = o.transfers.filter((t) => t.correct && t.terminalAt);
  const done = (t) => at(t.terminalAt), recv = (t) => at(t.receivedAt);
  const fa = o.faultAnalysis ?? {};
  const inside = o.windowSeries.filter((w) => at(w.endAt) > injected && at(w.endAt) <= cleared);
  const arrivals = o.transfers.filter((t) => recv(t) >= injected && recv(t) <= cleared);
  // Backlog at 1 s resolution: accepted and not yet terminal.
  let peak = 0;
  for (let t = injected - 1000; t <= cleared + 120000; t += 1000) {
    const b = o.transfers.filter((x) => recv(x) <= t && (!x.terminalAt || done(x) > t)).length;
    if (b > peak) peak = b;
  }
  const faultEra = o.transfers.filter((t) => recv(t) <= cleared);
  const lastFaultEra = Math.max(...faultEra.map((t) => (t.terminalAt ? done(t) : Infinity)));
  // Arrival-based latency recovery at 1 s steps: first t >= cleared where the p95 of arrivals in [t, t+10 s) is within 10 % of the pre-fault p95.
  const pre = correct.filter((t) => recv(t) >= injected - 60000 && recv(t) < injected).map((t) => t.latencyMs);
  const baseP95 = quantile(pre, 0.95), baseRate = pre.length / 60;
  let latencyRestored = null, rateRestored = null;
  for (let t = cleared; t <= at(o.measurementEnd) - 10000; t += 1000) {
    const lat = correct.filter((x) => recv(x) >= t && recv(x) < t + 10000).map((x) => x.latencyMs);
    if (latencyRestored == null && lat.length >= 10 && quantile(lat, 0.95) <= 1.1 * baseP95) latencyRestored = (t - cleared) / 1000;
    const comp = correct.filter((x) => done(x) >= t && done(x) < t + 10000).length;
    if (rateRestored == null && comp >= 0.9 * baseRate * 10) rateRestored = (t - cleared) / 1000;
    if (latencyRestored != null && rateRestored != null) break;
  }
  // Stage reached at fault end by fault-era transfers that were not yet terminal.
  const unfinished = { notStarted: 0, validated: 0, prepared: 0, providerDone: 0, terminal: 0 };
  for (const t of faultEra.filter((x) => !x.terminalAt || done(x) > cleared)) {
    const s = stages.get(t.transferId);
    const reached = s ? STAGES.filter((k) => s.has(k) && s.get(k) <= cleared).length : 0;
    unfinished[['notStarted', 'validated', 'prepared', 'providerDone', 'terminal'][reached]]++;
  }
  // Client-visible unavailability from failed requests.
  const failed = (attempts ?? []).filter((a) => !(a.httpStatus >= 200 && a.httpStatus < 300) && !(a.httpStatus === 404 && a.operation !== 'transfer_create'));
  const outage = failed.length ? round((Math.max(...failed.map((a) => at(a.responseAt ?? a.sentAt))) - Math.min(...failed.map((a) => at(a.sentAt)))) / 1000, 1) : 0;
  return {
    scenario: fe.scenario, injectedAt: fe.injectedAt, clearedAt: fe.clearedAt, durationSeconds: round((cleared - injected) / 1000, 2),
    doneExactInterval: correct.filter((t) => done(t) >= injected && done(t) <= cleared).length,
    doneWindowBased: Math.round(inside.reduce((s, w) => s + w.correctGoodput * 30, 0)), windowsEndingInside: inside.length,
    arrivedInFault: arrivals.length, arrivedInFaultDoneAfter: arrivals.filter((t) => !t.terminalAt || done(t) > cleared).length,
    peakBacklog1s: peak, longestFaultEraSeconds: round(Math.max(...faultEra.filter((t) => t.terminalAt && done(t) >= injected).map((t) => t.latencyMs)) / 1000, 1),
    faultEraClearedSeconds: Number.isFinite(lastFaultEra) ? round((lastFaultEra - cleared) / 1000, 1) : null,
    rateRestoredSeconds: rateRestored, latencyRestoredSeconds: latencyRestored,
    windowRecoverySeconds: round(fa.recoveryTimeSeconds, 1), windowRecoveryCensored: fa.recoveryCensored ?? null,
    windowBacklogClearanceSeconds: round(fa.backlogClearanceSeconds, 1),
    failedRequests: failed.length, clientOutageSeconds: outage, unfinishedAtFaultEnd: unfinished,
  };
}

const runs = [];
for (const root of roots) {
  const log = existsSync(path.join(root, 'campaign-log.jsonl')) ? readJsonl(root, 'campaign-log.jsonl') : [];
  for (const d of readdirSync(root).sort()) {
    const m = d.match(/^CAMP-(.+)-([RK])-(\d+)$/);
    const dir = path.join(root, d);
    if (!m || !(existsSync(path.join(dir, 'run-outcomes.json')) || existsSync(path.join(dir, 'run-outcomes.json.gz')))) {
      if (m) runs.push({ runId: d, root, cell: m[1], arch: m[2] === 'R' ? 'REST' : 'Kafka', rep: Number(m[3]), status: 'FAILED', note: 'setup failure before measurement' });
      continue;
    }
    const o = readJson(dir, 'run-outcomes.json'), q = readJson(dir, 'qualification.json'), manifest = readJson(dir, 'manifest.json');
    const k6 = readJson(dir, 'measurement-summary.json')?.metrics ?? {};
    const fe = readJson(dir, 'fault-evidence.json');
    const start = at(o.measurementStart), end = at(o.measurementEnd);
    let batt = 0, n = 0;
    for (let t = start; t <= end; t += 10000) { n++; if (powerAt(t) === 'Batt') batt++; }
    const correct = o.transfers.filter((t) => t.correct);
    const correctIds = new Set(correct.map((t) => t.transferId));
    const isFault = fe && fe.injectedAt && fe.scenario;
    const needStages = isFault || /NOFAULT/.test(m[1]);
    const stages = needStages ? traceStages(dir) : new Map();
    const attempts = isFault ? readJson(dir, 'client-attempts.json')?.attempts : null;
    const sequence = log.find((e) => e.event === 'START' && e.runId === d)?.sequence ?? null;
    runs.push({
      runId: d, root, cell: m[1], arch: m[2] === 'R' ? 'REST' : 'Kafka', rep: Number(m[3]), sequence,
      status: q.status, failedGates: Object.entries(q.gates).filter(([, v]) => !v).map(([k]) => k), safetyPassed: q.safety?.passed ?? null,
      measurementStart: o.measurementStart, offeredRate: o.offeredRate, measurementSeconds: o.measurementSeconds,
      batteryFraction: power.length ? round(batt / n, 2) : null,
      completed: o.terminalCounts.completed, failed: o.terminalCounts.failed, pendingAfterDrain: o.terminalCounts.pendingAfterDrain,
      correctGoodput: round(o.correctGoodput, 3),
      medianMs: o.durableCompletionMs.median, p95Ms: round(o.durableCompletionMs.p95, 1), p99Ms: round(o.durableCompletionMs.p99, 1),
      k6: { requests: k6.http_reqs?.count ?? null, failedRequests: k6.http_req_failed?.passes ?? null, droppedIterations: k6.dropped_iterations?.count ?? 0,
        newTransfers: k6.workload_unique_creates?.count ?? null, statusReads: k6.workload_status_retrievals?.count ?? null, replays: k6.workload_replay_creates?.count ?? null },
      hops: /NOFAULT/.test(m[1]) ? hops(stages, correctIds) : null,
      fault: isFault ? faultMeasures(o, fe, stages, attempts) : null,
      resources: resources(dir, manifest, o),
    });
  }
}

// Cells, pairs, statistics.
const summarize = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? { n: v.length, median: round(median(v), 3), min: Math.min(...v), max: Math.max(...v) } : null; };
const EXCLUDED = new Set(['grafana', 'prometheus', 'adapter-service']);
const sutSum = (r, k) => (r.resources ? Object.entries(r.resources.serviceMeans).filter(([sv]) => !EXCLUDED.has(sv)).reduce((a, [, v]) => a + (v[k] ?? 0), 0) : null);
const METRICS = {
  medianMs: (r) => r.medianMs, p95Ms: (r) => r.p95Ms, correctGoodput: (r) => r.correctGoodput,
  doneExactInterval: (r) => r.fault?.doneExactInterval, doneWindowBased: (r) => r.fault?.doneWindowBased,
  peakBacklog1s: (r) => r.fault?.peakBacklog1s, faultEraClearedSeconds: (r) => r.fault?.faultEraClearedSeconds,
  latencyRestoredSeconds: (r) => r.fault?.latencyRestoredSeconds, rateRestoredSeconds: (r) => r.fault?.rateRestoredSeconds,
  windowRecoverySeconds: (r) => r.fault?.windowRecoverySeconds, failedRequests: (r) => r.fault?.failedRequests,
  clientOutageSeconds: (r) => r.fault?.clientOutageSeconds, faultDurationSeconds: (r) => r.fault?.durationSeconds,
  longestFaultEraSeconds: (r) => r.fault?.longestFaultEraSeconds,
  cpuCores: (r) => r.resources?.cpuCores, memoryMiB: (r) => r.resources?.memoryMiB,
  // System under test without the monitoring stack and the shared adapter, whose memory varies 37-462 MiB in both designs.
  sutCpuCores: (r) => sutSum(r, 'cpuCores'), sutMemoryMiB: (r) => sutSum(r, 'memoryMiB'),
  appCpuCores: (r) => r.resources?.serviceMeans?.[r.arch === 'REST' ? 'rest-async' : 'kafka-async']?.cpuCores,
  appMemoryMiB: (r) => r.resources?.serviceMeans?.[r.arch === 'REST' ? 'rest-async' : 'kafka-async']?.memoryMiB,
  brokerMemoryMiB: (r) => r.resources?.serviceMeans?.redpanda?.memoryMiB, brokerCpuCores: (r) => r.resources?.serviceMeans?.redpanda?.cpuCores,
  postgresCpuCores: (r) => r.resources?.serviceMeans?.postgres?.cpuCores,
};
const measured = runs.filter((r) => r.status !== 'FAILED');
const cells = {};
for (const r of measured) (cells[`${r.cell}|${r.arch}`] ??= []).push(r);
const cellSummary = Object.fromEntries(Object.entries(cells).sort().map(([k, rs]) => [k, {
  runs: rs.length, statuses: Object.fromEntries([...new Set(rs.map((r) => r.status))].map((s) => [s, rs.filter((r) => r.status === s).length])),
  safetyFailures: rs.filter((r) => r.safetyPassed === false).length,
  ...Object.fromEntries(Object.entries(METRICS).map(([name, f]) => [name, summarize(rs.map(f))]).filter(([, v]) => v)),
}]));

// Paired contrasts over valid runs (QUALIFIED or CENSORED), paired by repetition number.
const valid = (r) => r && (r.status === 'QUALIFIED' || r.status === 'CENSORED');
const contrast = (cell, metric) => {
  const f = METRICS[metric];
  const pairs = [];
  const reps = [...new Set((cells[`${cell}|REST`] ?? []).map((r) => r.rep))].sort((a, b) => a - b);
  for (const rep of reps) {
    const r = cells[`${cell}|REST`].find((x) => x.rep === rep), k = cells[`${cell}|Kafka`]?.find((x) => x.rep === rep);
    if (valid(r) && valid(k) && Number.isFinite(f(r)) && Number.isFinite(f(k))) pairs.push([f(r), f(k)]);
  }
  const res = pairedContrast(pairs);
  return { cell, metric, pairs: pairs.length, restWins: pairs.filter(([a, b]) => (metric.startsWith('done') ? a > b : a < b)).length,
    ties: pairs.filter(([a, b]) => a === b).length, values: pairs, ...res };
};
const primary = [['A-NOFAULT-R8', 'medianMs'], ['A-NOFAULT-R8', 'p95Ms'], ['A-DATABASE-R4', 'doneExactInterval'], ['A-ADAPTER-R4', 'doneExactInterval'], ['C-WORKERS8-DATABASE-R4', 'doneExactInterval']].map(([c, m]) => contrast(c, m));
const adj = holm(primary.map((p) => (p.estimable ? p.pValue : 1)));
primary.forEach((p, i) => { p.holmAdjustedPValue = adj[i]; });
const secondary = [['A-NOFAULT-R8', 'sutCpuCores'], ['A-NOFAULT-R8', 'sutMemoryMiB'], ['A-NOFAULT-R8', 'cpuCores'], ['A-NOFAULT-R8', 'memoryMiB'], ['A-DATABASE-R4', 'peakBacklog1s'], ['E-APPKILL-R4', 'failedRequests'], ['E-APPKILL-R4', 'clientOutageSeconds'],
  ['E-PARTITION-R4', 'failedRequests'], ['E-PGRESTART-R4', 'failedRequests'], ['A-ADAPTER-R4', 'peakBacklog1s'], ['A-DATABASE-R4', 'faultEraClearedSeconds']].map(([c, m]) => contrast(c, m));

// Drift: Spearman correlation of run start time with median latency, per no-fault cell and architecture.
const spearman = (xs, ys) => {
  const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = []; s.forEach(([, i], k) => { r[i] = k + 1; }); return r; };
  const rx = rank(xs), ry = rank(ys), n = xs.length, mx = (n + 1) / 2;
  const num = rx.reduce((s, v, i) => s + (v - mx) * (ry[i] - mx), 0), den = Math.sqrt(rx.reduce((s, v) => s + (v - mx) ** 2, 0) * ry.reduce((s, v) => s + (v - mx) ** 2, 0));
  return den ? num / den : null;
};
const drift = Object.entries(cells).filter(([k]) => /NOFAULT/.test(k) || /A-DATABASE/.test(k)).map(([k, rs]) => {
  const v = rs.filter(valid);
  const metric = /DATABASE/.test(k) ? 'doneExactInterval' : 'medianMs';
  return { cell: k, metric, n: v.length, spearmanVsStartTime: round(spearman(v.map((r) => at(r.measurementStart)), v.map((r) => METRICS[metric](r))), 3) };
});
const battery = Object.entries(cells).map(([k, rs]) => {
  const metric = rs[0].fault && /DATABASE|ADAPTER|WORKERS8|BATCHED|POLL.*DATABASE/.test(k) ? 'doneExactInterval' : 'medianMs';
  const b = rs.filter((r) => valid(r) && r.batteryFraction > 0.5).map(METRICS[metric]), a = rs.filter((r) => valid(r) && r.batteryFraction <= 0.5).map(METRICS[metric]);
  return { cell: k, metric, battery: summarize(b), ac: summarize(a), batteryInsideAcRange: b.length && a.length ? b.every((x) => x >= Math.min(...a) && x <= Math.max(...a)) : null };
}).filter((x) => x.battery);

// Binary outcomes: database-restart hang and broker stuck transfer.
const fisherTwoSided = (a, b, c, d) => {
  const lf = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const p = (x) => Math.exp(lf(a + b) + lf(c + d) + lf(a + c) + lf(b + d) - lf(x) - lf(a + b - x) - lf(a + c - x) - lf(d - a + x) - lf(a + b + c + d));
  const obs = p(a), lo = Math.max(0, a + c - (c + d)), hi = Math.min(a + b, a + c);
  let s = 0; for (let x = lo; x <= hi; x++) { const v = p(x); if (v <= obs * (1 + 1e-9)) s += v; }
  return Math.min(1, s);
};
const hang = (r) => r.k6.droppedIterations > 0 && (r.k6.failedRequests ?? 0) < 10;
const pg = { REST: cells['E-PGRESTART-R4|REST'] ?? [], Kafka: cells['E-PGRESTART-R4|Kafka'] ?? [] };
const pgHang = { REST: pg.REST.filter(hang).length, Kafka: pg.Kafka.filter(hang).length, runsREST: pg.REST.length, runsKafka: pg.Kafka.length,
  hangRuns: [...pg.REST, ...pg.Kafka].filter(hang).map((r) => r.runId) };
pgHang.fisherTwoSidedP = round(fisherTwoSided(pgHang.Kafka, pgHang.runsKafka - pgHang.Kafka, pgHang.REST, pgHang.runsREST - pgHang.REST), 3);
const broker = cells['E-BROKER-R4|Kafka'] ?? [];
const brokerStuck = { runs: broker.length, withStuckTransfer: broker.filter((r) => r.pendingAfterDrain > 0).length, stuckPerRun: broker.map((r) => r.pendingAfterDrain),
  stuckRuns: broker.filter((r) => r.pendingAfterDrain > 0).map((r) => r.runId) };

// Ladder.
const ladder = Object.entries(cells).filter(([k]) => k.startsWith('D-LADDER')).map(([k, rs]) => {
  const [cell, arch] = k.split('|');
  return { offeredRate: Number(cell.match(/R(\d+)/)[1]), arch, runs: rs.length, offeredTransfersPerSecond: round(Number(cell.match(/R(\d+)/)[1]) * 0.76, 2),
    goodput: summarize(rs.map((r) => r.correctGoodput)), medianMs: summarize(rs.map((r) => r.medianMs)), p95Ms: summarize(rs.map((r) => r.p95Ms)),
    droppedIterations: summarize(rs.map((r) => r.k6.droppedIterations)), cpuCores: summarize(rs.map((r) => r.resources.cpuCores)) };
}).sort((a, b) => a.offeredRate - b.offeredRate || a.arch.localeCompare(b.arch));

const statusCounts = Object.fromEntries([...new Set(runs.map((r) => r.status))].map((s) => [s, runs.filter((r) => r.status === s).length]));
const out = {
  generatedAt: new Date().toISOString(), roots, runCount: runs.length, statusCounts,
  safetyFailures: measured.filter((r) => r.safetyPassed === false).length,
  transfersMeasured: measured.reduce((s, r) => s + r.completed + r.failed + r.pendingAfterDrain, 0),
  nonQualified: runs.filter((r) => r.status !== 'QUALIFIED').map((r) => ({ runId: r.runId, root: r.root, status: r.status, failedGates: r.failedGates, pendingAfterDrain: r.pendingAfterDrain, k6: r.k6, note: r.note })),
  definitions: {
    validRun: 'QUALIFIED or CENSORED. CENSORED means a recovery criterion was not met within the observation window; measurement is otherwise valid.',
    doneExactInterval: 'Correct transfers whose terminal commit falls inside [injectedAt, clearedAt].',
    doneWindowBased: 'Sum over 30 s windows that end inside the fault interval (the v1 paper measure).',
    peakBacklog1s: 'Maximum, at 1 s steps from injection to clearance + 120 s, of accepted transfers not yet terminal.',
    faultEraClearedSeconds: 'Seconds after clearance until every transfer received before clearance was terminal.',
    latencyRestoredSeconds: 'First 1 s step after clearance where p95 latency of transfers arriving in the next 10 s is within 10% of the p95 of arrivals in the 60 s before injection (at least 10 arrivals).',
    rateRestoredSeconds: 'First 1 s step after clearance where completions in the next 10 s reach 90% of the pre-fault 60 s completion rate.',
    clientOutageSeconds: 'Span from the first failed client request sent to the last failed request answered.',
    pairs: 'REST and Kafka runs with the same repetition number; paired bootstrap of relative effect (Kafka-REST)/REST and exact sign randomization (src/experiment/analysis.js).',
    holm: 'Holm adjustment across the five primary contrasts.',
  },
  primaryContrasts: primary, secondaryContrasts: secondary, cells: cellSummary, ladder, pgRestartHang: pgHang, brokerStuck, drift, battery, runs,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'campaign-analysis.json'), `${JSON.stringify(out, null, 1)}\n`);
const cols = ['runId', 'cell', 'arch', 'rep', 'status', 'batteryFraction', 'medianMs', 'p95Ms', 'correctGoodput', 'doneExact', 'doneWindow', 'arrived', 'peakBacklog', 'faultEraCleared', 'latencyRestored', 'failedReq', 'outageS', 'dropped', 'pending', 'cpu', 'memMiB'];
const csv = [cols.join(','), ...runs.filter((r) => r.status !== 'FAILED').map((r) => [r.runId, r.cell, r.arch, r.rep, r.status, r.batteryFraction, r.medianMs, r.p95Ms, r.correctGoodput,
  r.fault?.doneExactInterval ?? '', r.fault?.doneWindowBased ?? '', r.fault?.arrivedInFault ?? '', r.fault?.peakBacklog1s ?? '', r.fault?.faultEraClearedSeconds ?? '', r.fault?.latencyRestoredSeconds ?? '',
  r.fault?.failedRequests ?? '', r.fault?.clientOutageSeconds ?? '', r.k6.droppedIterations, r.pendingAfterDrain, r.resources.cpuCores, r.resources.memoryMiB].join(','))];
writeFileSync(path.join(outDir, 'campaign-runs.csv'), `${csv.join('\n')}\n`);
console.log(JSON.stringify({ runCount: out.runCount, statusCounts, safetyFailures: out.safetyFailures, transfersMeasured: out.transfersMeasured }));
