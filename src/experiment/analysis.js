import { quantile } from './outcomes.js';
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function pairedContrast(pairs, { draws = 10000, seed = 20260920 } = {}) {
  if (pairs.length < 3 || pairs.some(([r, k]) => !Number.isFinite(r) || !Number.isFinite(k)) || mean(pairs.map(([r]) => r)) <= 0) return { estimable: false, reason: 'At least three complete finite pairs and a positive REST mean are required.' };
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const effect = (sample) => (mean(sample.map(([, k]) => k)) - mean(sample.map(([r]) => r))) / mean(sample.map(([r]) => r));
  const bootstrap = Array.from({ length: draws }, () => effect(Array.from({ length: pairs.length }, () => pairs[Math.floor(random() * pairs.length)]))).filter(Number.isFinite);
  const differences = pairs.map(([r, k]) => k - r);
  const observed = Math.abs(mean(differences));
  if (pairs.length > 20) throw new Error('Exact sign randomization is limited to 20 pairs.');
  let extreme = 0;
  for (let mask = 0; mask < 2 ** pairs.length; mask++) {
    const value = Math.abs(mean(differences.map((d, i) => (mask & (1 << i)) ? d : -d)));
    if (value >= observed - 1e-12) extreme++;
  }
  return { estimable: true, pairs: pairs.length, restMean: mean(pairs.map(([r]) => r)), kafkaMean: mean(pairs.map(([, k]) => k)),
    relativeEffect: effect(pairs), confidenceInterval95: [quantile(bootstrap, .025), quantile(bootstrap, .975)], pValue: extreme / 2 ** pairs.length,
    method: 'paired bootstrap of run pairs; exact paired sign randomization', draws, seed };
}
export function holm(pValues) {
  const ordered = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = [];
  let previous = 0;
  ordered.forEach(({ p, index }, rank) => { previous = Math.max(previous, Math.min(1, (pValues.length - rank) * p)); adjusted[index] = previous; });
  return adjusted;
}
export function decision(result, margin, higherIsBetter, safe = { rest: true, kafka: true }) {
  if (!result.estimable || margin === null) return 'inconclusive';
  const [lower, upper] = result.confidenceInterval95;
  if (lower >= -margin && upper <= margin && safe.rest && safe.kafka) return 'practically similar';
  if (result.adjustedPValue > .05) return 'inconclusive';
  const leader = lower > margin ? (higherIsBetter ? 'Kafka' : 'REST') : upper < -margin ? (higherIsBetter ? 'REST' : 'Kafka') : null;
  return leader && safe[leader.toLowerCase()] ? `${leader} leads` : 'inconclusive';
}
export function restrictedDuration(fault, metric, horizon) {
  if ((metric === 'recovery' ? fault.recoveryEstimable : fault.backlogEstimable) === false) return null;
  const observed = metric === 'recovery' ? fault.recoveryObservationSeconds : fault.backlogObservationSeconds;
  const event = metric === 'recovery' ? fault.recoveryTimeSeconds : fault.backlogClearanceSeconds;
  const censored = metric === 'recovery' ? fault.recoveryCensored : fault.backlogClearanceCensored;
  if (!(observed >= horizon) || !(horizon > 0)) return null;
  return censored ? horizon : Number.isFinite(event) ? Math.min(event, horizon) : null;
}
