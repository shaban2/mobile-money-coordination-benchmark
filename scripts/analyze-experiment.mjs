import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pairedContrast, holm, decision, restrictedDuration } from '../src/experiment/analysis.js';
const root = path.resolve(process.argv[2] ?? 'results');
const read = (dir, name) => existsSync(path.join(dir, name)) ? JSON.parse(readFileSync(path.join(dir, name), 'utf8')) : null;
const runs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
  const dir = path.join(root, e.name); return { manifest: read(dir, 'manifest.json'), qualification: read(dir, 'qualification.json'), outcomes: read(dir, 'run-outcomes.json') };
}).filter((r) => r.manifest);
const definitions = [
  { metric: 'goodput', block: 'LOAD', margin: .10, higher: true, value: (o) => o.correctGoodput },
  { metric: 'latency', block: 'LOAD', margin: .15, higher: false, value: (o) => o.durableCompletionMs.p95 },
  { metric: 'recovery', block: 'FAULT', margin: .20, higher: false },
  { metric: 'backlog', block: 'FAULT', margin: null, higher: false }
];
const contrasts = [];
for (const definition of definitions) {
  const cells = definition.block === 'LOAD' ? [25, 50, 75, 90] : ['adapter-crash', 'database-delay'];
  const family = [];
  for (const cell of cells) {
    const selected = runs.filter((r) => r.manifest.run.block === definition.block && (definition.block === 'LOAD' ? r.manifest.run.offeredLoadPercent : r.manifest.run.faultScenario) === cell);
    const valid = selected.filter((r) => r.qualification?.valid && r.outcomes?.schemaVersion === 2);
    const grouped = new Map();
    for (const row of valid) {
      const block = row.manifest.run.executionBlock;
      if (!block) throw new Error('Execution-block IDs are required.');
      const pair = grouped.get(block) ?? {};
      if (pair[row.manifest.run.conditionId]) throw new Error(`Duplicate run in ${block}/${cell}.`);
      pair[row.manifest.run.conditionId] = row;
      grouped.set(block, pair);
    }
    const horizon = definition.block === 'FAULT' && valid.length ? Math.min(...valid.map((r) => definition.metric === 'recovery' ? r.outcomes.faultAnalysis?.recoveryObservationSeconds ?? 0 : r.outcomes.faultAnalysis?.backlogObservationSeconds ?? 0)) : null;
    const value = (row) => definition.value ? definition.value(row.outcomes) : restrictedDuration(row.outcomes.faultAnalysis ?? {}, definition.metric, horizon);
    const pairs = [...grouped.values()].filter((pair) => pair['R-A'] && pair['K-A']).map((pair) => [value(pair['R-A']), value(pair['K-A'])]);
    // Missing endpoint values make the contrast non-estimable; never discard
    // zero-completion latency runs or non-recovery to obtain a favorable estimate.
    const result = pairedContrast(pairs);
    const safe = { rest: !selected.some((r) => r.manifest.run.conditionId === 'R-A' && r.qualification?.safety?.passed === false),
      kafka: !selected.some((r) => r.manifest.run.conditionId === 'K-A' && r.qualification?.safety?.passed === false) };
    family.push({ ...result, metric: definition.metric, cell, horizonSeconds: horizon, safe, observedRuns: selected.length,
      validRuns: valid.length, incompletePairs: [...grouped.values()].filter((p) => !p['R-A'] || !p['K-A']).length,
      censoredRuns: valid.filter((r) => r.qualification.status === 'CENSORED').length });
  }
  // Keep all planned hypotheses in the family, including non-estimable cells.
  const adjusted = holm(family.map((r) => r.estimable ? r.pValue : 1));
  family.forEach((r, i) => { r.adjustedPValue = adjusted[i]; r.decision = decision(r, definition.margin, definition.higher, r.safe); });
  contrasts.push(...family);
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), source: root,
  families: 'Holm separately within goodput, latency, recovery, backlog',
  accounting: runs.map((r) => ({ runId: r.manifest.run.runId, status: r.qualification?.status ?? 'INCOMPLETE' })), contrasts };
writeFileSync(path.join(root, 'analysis.json'), JSON.stringify(report, null, 2));
process.stdout.write(`Wrote ${contrasts.length} planned contrasts to ${path.join(root, 'analysis.json')}\n`);
