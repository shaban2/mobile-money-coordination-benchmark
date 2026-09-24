// Read-only evidence analysis. Never runs Docker, k6, or an experiment controller.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCompletedObservationPair, evidenceInventory } from '../src/experiment/exploratory-review.js';
import { deriveOutcomes, quantile } from '../src/experiment/outcomes.js';
import { fileHash } from '../src/experiment/provenance.js';

// Public-evidence mode: PUBLIC_EVIDENCE=<dir> points at the redacted export produced by
// scripts/export-public-evidence.mjs. Evidence roots are then read from that directory,
// the private-only integrity chain is replaced by verification against EXPORT-MANIFEST.json,
// and the application-only source archive is used for file comparison. All numbers are
// computed by the same code paths as in private mode.
export const publicEvidenceDir = process.env.PUBLIC_EVIDENCE ? path.resolve(process.env.PUBLIC_EVIDENCE) : null;
export const evidencePath = (repo, name) => path.join(publicEvidenceDir ?? repo, name);
export const snapshotArchive = root => ['source-snapshot.tar.gz', 'source-snapshot-application.tar.gz'].map(n => path.join(root, n)).find(f => existsSync(f));
let exportManifestCache = null;
export function exportManifest() {
  assert.ok(publicEvidenceDir, 'PUBLIC_EVIDENCE is not set');
  exportManifestCache ??= JSON.parse(readFileSync(path.join(publicEvidenceDir, 'EXPORT-MANIFEST.json'), 'utf8'));
  return exportManifestCache;
}
export function verifyExportedRoot(rootName) {
  const files = {};
  for (const entry of exportManifest().files.filter(f => f.path.startsWith(`${rootName}/`))) {
    const file = path.join(publicEvidenceDir, entry.path);
    assert.ok(existsSync(file), `Exported file missing: ${entry.path}`);
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.equal(digest, entry.exportedSha256, `Exported file changed since export: ${entry.path}`);
    files[entry.path.slice(rootName.length + 1)] = digest;
  }
  assert.ok(Object.keys(files).length > 0, `No exported files for ${rootName}`);
  return files;
}
// Lighter counterpart of inspectCompletedObservationPair for the redacted export.
export function inspectPublicRoot(root) {
  const rootName = path.basename(root);
  const files = verifyExportedRoot(rootName);
  const read = name => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
  const state = read('pilot-state.json'), freeze = read('freeze.json'), protocol = read('pilot-protocol.json');
  assert.equal(fileHash(path.join(root, 'pilot-protocol.json')), freeze.protocolSha256, 'Protocol changed since freeze');
  assert.ok(/COMPLETE|REVIEW/.test(state.status), `Unexpected pilot state ${state.status}`);
  const runs = state.records.map(r => ({ runId: r.runId, conditionId: r.conditionId, phase: r.phase, status: r.status }));
  for (const run of runs) assert.equal(read(path.join(run.runId, 'qualification.json')).status, 'QUALIFIED', `${run.runId} not qualified`);
  return { root, protocolId: protocol.protocolId, sourceSha256: freeze.sourceSha256, status: state.status, runs, files, publicEvidence: true };
}
export const selections = [
  { key: 'screening', label: 'No fault at 8 operations/s', root: 'results-queue-screening-r8-v2' },
  { key: 'adapter', label: 'Adapter outage at 4 operations/s', root: 'results-exploratory-adapter-r4-v1' },
  { key: 'database', label: 'Database delay at 4 operations/s', root: 'results-exploratory-database-r4-v1' }
];
export function memoryMiB(value) {
  const m = String(value).split('/')[0].trim().match(/^([\d.]+)\s*(B|kB|KB|MB|GB|KiB|MiB|GiB)$/);
  assert.ok(m, `Unrecognized Docker memory value: ${value}`);
  return Number(m[1]) * { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[m[2]] / 1024 ** 2;
}
export function timeWeightedMean(points, field) {
  assert.ok(points.length >= 2);
  let area = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].at - points[i - 1].at;
    assert.ok(dt > 0 && dt <= 5000, 'Non-increasing or excessive resource sample gap');
    assert.ok(Number.isFinite(points[i][field]) && Number.isFinite(points[i - 1][field]));
    area += dt * (points[i][field] + points[i - 1][field]) / 2;
  }
  return area / (points.at(-1).at - points[0].at);
}
export function latencySummary(sortedMs) {
  assert.ok(sortedMs.length > 0);
  for (let i = 1; i < sortedMs.length; i++) assert.ok(sortedMs[i] >= sortedMs[i - 1], 'Latencies must be sorted');
  return { min: sortedMs[0], p50: quantile(sortedMs, .5), p75: quantile(sortedMs, .75), p90: quantile(sortedMs, .9),
    p95: quantile(sortedMs, .95), p99: quantile(sortedMs, .99), max: sortedMs.at(-1),
    mean: sortedMs.reduce((a, b) => a + b, 0) / sortedMs.length };
}
export function faultWindowSummary(windows, fault, measurementStart) {
  if (!fault) return null;
  const injectedSeconds = (Date.parse(fault.injectedAt) - Date.parse(measurementStart)) / 1000;
  const after = windows.filter(w => w.endSeconds > injectedSeconds);
  assert.ok(after.length > 0);
  const p95s = after.map(w => w.p95DurableCompletionMs).filter(v => v !== null);
  return { injectedSeconds, windowsAfterInjection: after.length,
    minGoodputAfterInjection: Math.min(...after.map(w => w.correctGoodput)),
    windowsWithoutCompletion: after.filter(w => w.p95DurableCompletionMs === null).length,
    maxWindowP95Ms: p95s.length ? Math.max(...p95s) : null,
    maxWindowGoodputAfterInjection: Math.max(...after.map(w => w.correctGoodput)) };
}
export function clientSummary(summary) {
  const m = summary.metrics, d = m.http_req_duration;
  assert.ok(d && Number.isFinite(d['p(95)']));
  return { httpRequests: m.http_reqs.count, httpRequestFailedRate: m.http_req_failed.value,
    vusMax: m.vus_max.value, iterations: m.iterations.count,
    httpReqDurationMs: { median: d.med, p90: d['p(90)'], p95: d['p(95)'], max: d.max } };
}
export function summarizeResources(samples, manifest, outcomes) {
  const start = Date.parse(outcomes.measurementStart), end = Date.parse(outcomes.measurementEnd);
  const included = samples.filter(s => Date.parse(s.capturedAt) >= start && Date.parse(s.capturedAt) < end);
  const services = manifest.resourceServices;
  const absent = [];
  const points = included.map(s => {
    assert.equal(s.commandStatus, 0);
    const byService = {};
    for (const service of services) {
      const found = s.containers.filter(c => c.Service === service && !c.OneOff);
      assert.ok(found.length <= 1, `Duplicate sampled service ${service}`);
      if (!found.length) {
        // Docker inventory/stats span ~2 s, so tolerate one sample cycle either side.
        const f = outcomes.faultAnalysis, at = Date.parse(s.capturedAt);
        assert.ok(service === 'adapter-service' && f?.scenario === 'adapter-crash'
          && at >= Date.parse(f.injectedAt) - 5000 && at <= Date.parse(f.clearedAt) + 5000,
        `Unexpected missing service ${service}`);
        absent.push({ at: s.capturedAt, service });
        byService[service] = { cpuCores: 0, memoryMiB: 0 };
      } else {
        assert.match(found[0].CPUPerc, /^[\d.]+%$/);
        byService[service] = { cpuCores: Number.parseFloat(found[0].CPUPerc) / 100, memoryMiB: memoryMiB(found[0].MemUsage) };
      }
    }
    const app = byService[manifest.run.conditionId === 'R-A' ? 'rest-async' : 'kafka-async'];
    return { at: Date.parse(s.capturedAt), relativeSeconds: (Date.parse(s.capturedAt) - start) / 1000, byService,
      cpuCores: Object.values(byService).reduce((a, b) => a + b.cpuCores, 0),
      memoryMiB: Object.values(byService).reduce((a, b) => a + b.memoryMiB, 0),
      appCpuCores: app.cpuCores, appMemoryMiB: app.memoryMiB,
      brokerCpuCores: byService.redpanda?.cpuCores ?? 0, brokerMemoryMiB: byService.redpanda?.memoryMiB ?? 0 };
  });
  assert.ok(points.length >= 2 && points[0].at - start < 5000 && end - points.at(-1).at < 5000);
  const means = Object.fromEntries(['cpuCores', 'memoryMiB', 'appCpuCores', 'appMemoryMiB', 'brokerCpuCores', 'brokerMemoryMiB']
    .map(k => [k, timeWeightedMean(points, k)]));
  const serviceMeans = Object.fromEntries(services.map(service => [service, {
    cpuCores: timeWeightedMean(points.map(p => ({ at: p.at, v: p.byService[service].cpuCores })), 'v'),
    memoryMiB: timeWeightedMean(points.map(p => ({ at: p.at, v: p.byService[service].memoryMiB })), 'v') }]));
  return { services, means, serviceMeans, peakSampledMemoryMiB: Math.max(...points.map(p => p.memoryMiB)),
    samples: points.length, coverageSeconds: (points.at(-1).at - points[0].at) / 1000,
    leadingUnobservedSeconds: (points[0].at - start) / 1000,
    trailingUnobservedSeconds: (end - points.at(-1).at) / 1000,
    maxGapSeconds: Math.max(...points.slice(1).map((p, i) => (p.at - points[i].at) / 1000)),
    absentDuringAdapterOutage: absent, points: points.map(({ byService: _omit, ...p }) => p) };
}

// Archived no-fault pairs at 4 operations/s. They were collected under earlier
// experiment-harness revisions and are reported as separately labelled
// supplementary observations, never pooled with the reporting set.
export const archivedNoFaultRoots = [
  { key: 'calibration-1', label: 'Calibration pair 1', root: 'results-calibration-v1' },
  { key: 'calibration-2', label: 'Calibration pair 2', root: 'results-calibration-v1-continuation-1' },
  { key: 'screening-r4', label: 'Screening pair', root: 'results-queue-screening-v2' },
  { key: 'pilot-v5', label: 'Pilot v5 pair', root: 'results-capacity-pilot-v5' }
];
// Files that define the system under test, as opposed to the experiment
// harness (src/experiment, scripts, tests, docs and protocol JSON).
export function isApplicationFile(name) {
  const n = name.replace(/^\.\//, '');
  if (/(^|\/)\._/.test(n)) return false;
  if (n.startsWith('src/experiment/')) return false;
  if (n.startsWith('src/')) return true;
  if (n.startsWith('migrations/') || n.startsWith('contracts/') || n.startsWith('infra/') || n.startsWith('config/conditions/')) return true;
  return ['compose.yaml', 'Dockerfile', 'Dockerfile.gateway', 'package.json', 'package-lock.json', '.env.example'].includes(n);
}
export function snapshotDigests(archive) {
  const dir = mkdtempSync(path.join(tmpdir(), 'snapshot-'));
  try {
    const r = spawnSync('tar', ['-xzf', archive, '-C', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const digests = {};
    const walk = (d, rel) => {
      for (const entry of readdirSync(d)) {
        const full = path.join(d, entry), name = rel ? `${rel}/${entry}` : entry;
        if (statSync(full).isDirectory()) walk(full, name);
        else if (isApplicationFile(name)) digests[name] = createHash('sha256').update(readFileSync(full)).digest('hex');
      }
    };
    walk(dir, '');
    return digests;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export function compareApplicationFiles(base, other) {
  const names = [...new Set([...Object.keys(base), ...Object.keys(other)])].sort();
  const differing = names.filter(n => base[n] !== other[n]);
  return { compared: names.length, differing };
}
// Additive per-run database statement counts from the diagnostic aggregates.
// Counts are additive; nested span durations are not.
export function statementCounts(aggregates) {
  const sum = prefix => Object.entries(aggregates).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v.count, 0);
  const transaction = sum('db.query.'), pool = sum('db.pool_query.');
  const byKind = Object.fromEntries(Object.entries(aggregates).filter(([k]) => k.startsWith('db.query.') || k.startsWith('db.pool_query.')).map(([k, v]) => [k, v.count]));
  return { transactionStatements: transaction, poolStatements: pool, total: transaction + pool,
    gcCycles: aggregates['runtime.gc']?.count ?? 0, byKind };
}
// Window-level description of the fault interval and of the first complete
// post-clearance window that already met the pre-fault baseline.
export function faultIntervalSummary(windows, fault, measurementStart) {
  if (!fault) return null;
  const start = Date.parse(measurementStart);
  const injected = (Date.parse(fault.injectedAt) - start) / 1000, cleared = (Date.parse(fault.clearedAt) - start) / 1000;
  // Windows whose end boundary was sampled while the fault was active.
  const during = windows.filter(w => w.endSeconds > injected && w.endSeconds <= cleared);
  assert.ok(during.length > 0);
  const after = windows.filter(w => w.endSeconds > cleared);
  const baseline = fault.baseline;
  const meets = w => w.correctGoodput >= .9 * baseline.correctGoodput && w.p95DurableCompletionMs !== null && w.p95DurableCompletionMs <= 1.1 * baseline.p95DurableCompletionMs;
  const describe = w => ({ endSeconds: w.endSeconds, correctGoodput: w.correctGoodput, backlogAtEnd: w.backlogAtEnd, p95DurableCompletionMs: w.p95DurableCompletionMs });
  const firstFullyAfter = after.find(w => w.endSeconds - 30 >= cleared);
  return { injectedSeconds: injected, clearedSeconds: cleared,
    duringFaultWindows: during.map(describe),
    completionsDuringFault: Math.round(during.reduce((n, w) => n + w.correctGoodput * 30, 0)),
    meanGoodputDuringFault: during.reduce((n, w) => n + w.correctGoodput, 0) / during.length,
    catchUpWindow: after.length ? describe(after[0]) : null,
    firstWindowFullyAfterClearanceMeetsBaseline: firstFullyAfter ? meets(firstFullyAfter) : null,
    firstWindowFullyAfterClearanceEndSeconds: firstFullyAfter ? firstFullyAfter.endSeconds : null,
    allWindowsFullyAfterClearanceMeetBaseline: after.filter(w => w.endSeconds - 30 >= cleared).every(meets) };
}
export function analyzeArchivedNoFault(repo, baseDigests) {
  const runs = [];
  for (const selection of archivedNoFaultRoots) {
    const root = evidencePath(repo, selection.root);
    if (publicEvidenceDir) verifyExportedRoot(selection.root);
    const freeze = JSON.parse(readFileSync(path.join(root, 'freeze.json'), 'utf8'));
    const summary = JSON.parse(readFileSync(path.join(root, 'experiment-summary.json'), 'utf8'));
    // A continuation root reuses its parent's frozen source; locate that archive by identical source hash.
    const archive = [selection.root, ...archivedNoFaultRoots.map(r => r.root)].map(r => evidencePath(repo, r))
      .find(r => snapshotArchive(r) && JSON.parse(readFileSync(path.join(r, 'freeze.json'), 'utf8')).sourceSha256 === freeze.sourceSha256);
    assert.ok(archive, `No source archive found for ${selection.root} (${freeze.sourceSha256})`);
    const diff = compareApplicationFiles(baseDigests, snapshotDigests(snapshotArchive(archive)));
    const records = summary.runs.filter(r => r.status === 'QUALIFIED' && r.sequence !== undefined && r.sequence !== null);
    assert.equal(records.length, 2, `${selection.root} must hold exactly one qualified pair`);
    const ordered = [...records].sort((a, b) => a.sequence - b.sequence);
    for (const record of ordered) {
      const dir = path.join(root, record.runId);
      const read = name => JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));
      const manifest = read('manifest'), outcomes = read('run-outcomes'), qualified = read('qualification'), invariant = read('invariants');
      assert.equal(qualified.status, 'QUALIFIED');
      assert.equal(manifest.run.faultScenario, 'none');
      assert.equal(manifest.checksums.sourceSnapshotSha256, freeze.sourceSha256);
      const latenciesMs = outcomes.transfers.filter(t => t.correct && Date.parse(t.terminalAt) < Date.parse(outcomes.measurementEnd)).map(t => t.latencyMs).sort((a, b) => a - b);
      assert.equal(quantile(latenciesMs, .95), outcomes.durableCompletionMs.p95);
      assert.ok(Object.values(invariant.checks).every(Boolean));
      const windows = outcomes.windowSeries.filter(w => w.complete && w.underLoad);
      runs.push({ key: selection.key, label: selection.label, evidenceRoot: selection.root, runId: record.runId,
        architecture: record.conditionId === 'R-A' ? 'REST' : 'Kafka', sequence: record.sequence,
        firstInPair: record.sequence === ordered[0].sequence,
        offeredRate: manifest.run.offeredRate, warmupDuration: manifest.lifecycle.warmupDuration, measurementDuration: manifest.lifecycle.measurementDuration,
        sourceSha256: freeze.sourceSha256, sourceArchiveRoot: path.basename(archive), applicationFilesCompared: diff.compared, applicationFilesDiffering: diff.differing,
        counts: outcomes.terminalCounts, goodput: outcomes.correctGoodput, completedDuringDrain: outcomes.completedDuringDrain,
        latency: { ...outcomes.durableCompletionMs, ...latencySummary(latenciesMs) },
        maxSampledBacklog: Math.max(...windows.map(w => w.backlogAtEnd)), windows: windows.length });
    }
  }
  return runs;
}

export const freshFaultSelections = [
  { key: 'adapter', label: 'Adapter outage at 4 operations/s, fresh Kafka-first pair', root: 'results-exploratory-adapter-k4-v1', stage: 'adapter-k4' },
  { key: 'database', label: 'Database delay at 4 operations/s, fresh Kafka-first pair', root: 'results-exploratory-database-k4-v1', stage: 'database-k4' }
];
// One qualified run of a completed observation pair, recomputed exactly from its evidence.
export function analyzeObservationRun(root, selection, record) {
  const dir = path.join(root, record.runId);
  const read = name => JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const manifest = read('manifest'), outcomes = read('run-outcomes'), fault = manifest.run.faultScenario === 'none' ? null : read('fault-evidence');
  const recomputed = deriveOutcomes({ manifest, telemetry: read('telemetry'), traces: read('traces'),
    controller: read('controller-state'), invariants: read('invariants'), snapshot: read('transfers'),
    clock: read('measurement-clock'), fault });
  assert.deepEqual(recomputed, outcomes, 'Archived outcomes must recompute exactly');
  const qualified = read('qualification');
  assert.equal(qualified.status, 'QUALIFIED');
  const latenciesMs = outcomes.transfers.filter(t => t.correct && Date.parse(t.terminalAt) < Date.parse(outcomes.measurementEnd)).map(t => t.latencyMs).sort((a, b) => a - b);
  assert.equal(quantile(latenciesMs, .95), outcomes.durableCompletionMs.p95);
  const diagnostics = read('diagnostics');
  const invariant = read('invariants');
  const attempts = read('client-attempts').attempts;
  const windows = outcomes.windowSeries.filter(w => w.complete && w.underLoad).map(w => ({ ...w, endSeconds: (Date.parse(w.endAt) - Date.parse(outcomes.measurementStart)) / 1000 }));
  return { key: selection.key, scenario: selection.label, evidenceRoot: selection.root,
    architecture: record.conditionId === 'R-A' ? 'REST' : 'Kafka', runId: record.runId,
    sequence: manifest.run.sequence, firstInPair: manifest.run.sequence === 1,
    manifest: { run: manifest.run, lifecycle: manifest.lifecycle, host: manifest.host, tools: manifest.tools, checksums: manifest.checksums },
    status: qualified.status, checks: invariant.checks, counts: outcomes.terminalCounts,
    clientOperations: { total: attempts.length, ...Object.fromEntries(['transfer_create', 'transfer_replay', 'status_retrieval']
      .map(operation => [operation, attempts.filter(a => a.operation === operation).length])) },
    allStoredTransfers: invariant.transferCount, allStoredLedgerEntries: invariant.ledgerEntryCount,
    goodput: outcomes.correctGoodput, eventualGoodput: outcomes.eventualCorrectCompletionRate,
    completedDuringDrain: outcomes.completedDuringDrain, timingCompletenessRatio: outcomes.timingCompletenessRatio,
    latency: { ...outcomes.durableCompletionMs, ...latencySummary(latenciesMs) }, latenciesMs,
    client: clientSummary(read('measurement-summary')), fault: outcomes.faultAnalysis,
    faultDurationSeconds: fault ? (Date.parse(fault.clearedAt) - Date.parse(fault.injectedAt)) / 1000 : null,
    measurementStart: outcomes.measurementStart, measurementEnd: outcomes.measurementEnd,
    windows, maxSampledBacklog: Math.max(...windows.map(w => w.backlogAtEnd)),
    faultWindows: faultWindowSummary(windows, outcomes.faultAnalysis, outcomes.measurementStart),
    faultInterval: faultIntervalSummary(windows, outcomes.faultAnalysis, outcomes.measurementStart),
    statements: statementCounts(diagnostics.aggregates),
    diagnostics: { startedAt: diagnostics.startedAt, capturedAt: diagnostics.capturedAt,
      scope: 'Instrumentation interval, not exactly the measured arrival cohort; includes setup/boundary operations. Nested spans are not additive.',
      aggregates: diagnostics.aggregates },
    resources: summarizeResources(readFileSync(path.join(dir, 'docker-stats.jsonl'), 'utf8').trim().split('\n').map(JSON.parse), manifest, outcomes) };
}
function analyzePairs(repo, list, collection) {
  const runs = [], provenance = [];
  for (const selection of list) {
    const root = evidencePath(repo, selection.root);
    const report = publicEvidenceDir ? inspectPublicRoot(root) : inspectCompletedObservationPair(root);
    provenance.push({ collection, root: selection.root, protocolId: report.protocolId, sourceSha256: report.sourceSha256, files: report.files });
    for (const record of report.runs) runs.push(analyzeObservationRun(root, selection, record));
    assert.deepEqual(publicEvidenceDir ? verifyExportedRoot(selection.root) : evidenceInventory(root), report.files, 'Evidence changed during analysis');
  }
  assert.equal(new Set(provenance.map(p => p.sourceSha256)).size, 1, `${collection} must share one source identity`);
  assert.equal(runs.length, 2 * list.length);
  return { runs, provenance };
}
// Fresh Kafka-first fault pairs collected on 22 September 2026 after the repository rename.
// Their application files are compared with the reporting-set archive; only the package name may differ.
export function analyzeFreshFaultPairs(repo, baseDigests) {
  const { runs, provenance } = analyzePairs(repo, freshFaultSelections, 'fresh-fault-pairs');
  const diff = compareApplicationFiles(baseDigests, snapshotDigests(snapshotArchive(evidencePath(repo, freshFaultSelections[0].root))));
  assert.deepEqual(diff.differing, ['package-lock.json', 'package.json'], 'Fresh pairs must run the same application apart from the package name');
  for (const run of runs) { run.sourceSha256 = provenance[0].sourceSha256; run.applicationFilesCompared = diff.compared; run.applicationFilesDiffering = diff.differing; }
  for (const selection of freshFaultSelections) {
    const pair = runs.filter(r => r.key === selection.key);
    assert.equal(pair.find(r => r.firstInPair).architecture, 'Kafka', `${selection.stage} was seeded Kafka first`);
  }
  return { runs, provenance };
}
export function analyze(repo) {
  const { runs, provenance } = analyzePairs(repo, selections, 'reporting-set');
  assert.equal(runs.length, 6);
  const baseDigests = snapshotDigests(snapshotArchive(evidencePath(repo, selections[0].root)));
  const archivedNoFaultRuns = analyzeArchivedNoFault(repo, baseDigests);
  const fresh = analyzeFreshFaultPairs(repo, baseDigests);
  const summary = { schemaVersion: 4, analysisVersion: 'exploratory-paper-v4',
    scope: 'Post-data exploratory reporting of three separately approved pairs. One execution per architecture per scenario. No capacity or confirmatory inference.',
    resourceMethod: 'Trapezoidal time-weighted means between first and last in-window Docker samples, without boundary extrapolation. Sum manifest.resourceServices; exclude k6, controller and host/VM overhead. A missing stopped adapter is zero with up to 5 s sampling-boundary tolerance. Peak is sampled aggregate memory, not sum of individual peaks.',
    sourceSha256: provenance[0].sourceSha256, measuredCompletions: runs.reduce((n, r) => n + r.counts.completed, 0),
    runs,
    archivedNoFaultScope: 'Supplementary archived 4 operations/s no-fault pairs collected under earlier experiment-harness revisions. Application files are compared against the reporting-set source archive; each pair is labelled with its own source identity and realized order. Not pooled with the reporting set and not an independent-replication estimate.',
    archivedNoFaultRuns,
    freshFaultScope: 'Two fresh fault pairs at 4 operations/s collected on 22 September 2026, each seeded so the Kafka condition ran first, under a rebuilt implementation whose application files differ from the reporting set only in the package name. Reported beside the original REST-first pairs as separately labelled observations; one pair per order per scenario, no interval derived.',
    freshFaultSourceSha256: fresh.provenance[0].sourceSha256,
    freshFaultRuns: fresh.runs };
  return { summary, provenance: [...provenance, ...fresh.provenance] };
}
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.join(repo, '.research/exploratory-paper-v1');
  const { summary, provenance } = analyze(repo);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'analysis.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(out, 'evidence-inventory.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(JSON.stringify({ output: out, measuredCompletions: summary.measuredCompletions,
    runs: summary.runs.map(r => ({ scenario: r.key, architecture: r.architecture, p95Ms: r.latency.p95, resourceMeans: r.resources.means, resourceCoverage: r.resources.coverageSeconds })) }, null, 2));
}
