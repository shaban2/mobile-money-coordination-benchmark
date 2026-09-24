// No Docker, historical run inputs, config changes, or live execution.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { classifyBacklog } from '../src/experiment/capacity-queue.js';
import { describeQueueObservation, referenceV1, revalidationCases } from './lib/capacity-rule-revalidation.js';

const cases = revalidationCases(), families = {}, differences = [], exemplars = [];
let observedCycles = 0, v1CycleFlags = 0, candidateCycleSignals = 0;
for (const c of cases) {
  const legacy = classifyBacklog(c.boundaries), reference = referenceV1(c.boundaries);
  if (legacy.status !== reference.status || legacy.whole.sign !== reference.wholeSign || legacy.recent.sign !== reference.recentSign
    || JSON.stringify(legacy.persistentGrowthAt) !== JSON.stringify(reference.increasingEnds)) differences.push(c.id);
  const candidate = describeQueueObservation(c.boundaries);
  const family = families[c.family] ??= { count: 0, v1: {}, candidate: {} };
  family.count++;
  family.v1[legacy.status] = (family.v1[legacy.status] ?? 0) + 1;
  family.candidate[candidate.status] = (family.candidate[candidate.status] ?? 0) + 1;
  if (c.multipleCyclesVisible) {
    observedCycles++;
    if (legacy.status === 'NOT_SUSTAINED_QUEUE_GROWTH') v1CycleFlags++;
    if (candidate.status === 'CONSISTENT_BLOCK_GROWTH_OBSERVED') candidateCycleSignals++;
  }
  if (legacy.status === 'NOT_SUSTAINED_QUEUE_GROWTH' && c.multipleCyclesVisible && exemplars.length < 3) {
    exemplars.push({ ...c, v1: legacy, candidate });
  }
}
const prefix = [5,5,5,6,8,10,12,14];
// Two possible futures share exactly the same observed data. Any deterministic
// classifier receiving only the prefix MUST return the same answer for both.
const ambiguousPrefix = {
  observed: prefix,
  boundedFuture: [...prefix, ...Array.from({ length: 40 }, (_, i) => i % 2 ? 5 : 15)],
  accumulatingFuture: [...prefix, ...Array.from({ length: 40 }, (_, i) => 15 + i)],
  v1Observed: classifyBacklog(prefix), candidateObserved: describeQueueObservation(prefix)
};
const files = ['src/experiment/capacity-queue.js', 'scripts/lib/capacity-rule-revalidation.js', 'scripts/revalidate-capacity-rule.mjs'];
const result = {
  schemaVersion: 1, status: 'REVALIDATED_LAUNCH_HOLD_REMAINS', syntheticOnly: true,
  candidateAdopted: false, historicalRunsRescored: false, totalCases: cases.length,
  fixtureSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
  fileSha256: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])),
  implementationReferenceMismatches: differences,
  repeatedCycleSubset: { cases: observedCycles, v1GrowthFailureLabels: v1CycleFlags, candidateGrowthSignals: candidateCycleSignals },
  families, exemplars, ambiguousPrefix,
  limits: [
    'Synthetic/adversarial cases are not estimates of real-world error rates.',
    'The candidate describes observed block patterns; it supplies neither an automatic capacity pass nor a failure boundary.',
    'Slow bounded rising arcs and true accumulation can have identical finite prefixes.',
    'Four equal blocks are an assistant-proposed descriptive construction, not a standard or researcher-approved cutoff.',
    'No latency gate, real-run rescoring, threshold fitting to calibration, or live launch occurred.'
  ]
};
console.log(JSON.stringify(result, null, 2));
// Successful execution of the audit is distinct from operational launch readiness.
process.exitCode = differences.length ? 1 : 2;
