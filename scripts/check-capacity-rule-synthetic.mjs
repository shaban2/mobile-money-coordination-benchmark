// Read-only adversarial validation. Nonzero exit deliberately blocks launch;
// a test suite can pass while a faithfully implemented scientific rule fails.
import { classifyBacklog } from '../src/experiment/capacity-queue.js';
const results = [];
for (const windows of [8, 20, 60, 120]) {
  const decisions = {}, counterexamples = [];
  for (const period of [2, 4, 8, 16, 32]) for (let shift = 0; shift < period; shift++) {
    const boundaries = Array.from({ length: windows }, (_, i) => Math.round(10 + 5 * Math.sin(2 * Math.PI * (i + shift) / period)));
    const decision = classifyBacklog(boundaries);
    decisions[decision.status] = (decisions[decision.status] ?? 0) + 1;
    if (decision.status === 'NOT_SUSTAINED_QUEUE_GROWTH') counterexamples.push({ period, shift, ...decision });
  }
  results.push({ windows, decisions, counterexamples });
}
console.log(JSON.stringify({ status: 'BLOCKED_RULE_VALIDATION', ruleVersion: 'queue-growth-v1',
  syntheticOnly: true, limitation: 'Adversarial fixtures, not estimates of real-world error rates. No finite horizon proves infinite-horizon stability.', results }, null, 2));
process.exitCode = 2;
