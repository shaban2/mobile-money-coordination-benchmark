// Offline research validation only. Nothing in the live controller imports this
// candidate, and it must not be interpreted as an approved capacity verdict.
export const OBSERVATION_CANDIDATE = 'queue-observation-v2-candidate';

export function describeQueueObservation(boundaries) {
  if (!Array.isArray(boundaries) || boundaries.length < 8 || boundaries.length % 4 !== 0
    || Array.from(boundaries).some(v => !Number.isSafeInteger(v) || v < 0)) {
    throw new Error('Expected a complete nonnegative integer series divisible into four equal blocks.');
  }
  const size = boundaries.length / 4;
  const blocks = Array.from({ length: 4 }, (_, i) => {
    const values = boundaries.slice(i * size, (i + 1) * size);
    return { firstBoundary: i * size + 1, lastBoundary: (i + 1) * size, min: Math.min(...values), max: Math.max(...values) };
  });
  const risesThroughout = blocks.slice(1).every((block, i) => block.min > blocks[i].min && block.max > blocks[i].max)
    && blocks.at(-1).min > blocks[0].max;
  const fallsOrFlatThroughout = boundaries.every((value, i) => i === 0 || value <= boundaries[i - 1]);
  const anyRise = boundaries.some((value, i) => i > 0 && value > boundaries[i - 1]);
  const anyFall = boundaries.some((value, i) => i > 0 && value < boundaries[i - 1]);
  const status = fallsOrFlatThroughout ? 'NO_INCREASE_AT_SAMPLED_BOUNDARIES'
    : risesThroughout ? 'CONSISTENT_BLOCK_GROWTH_OBSERVED'
    : anyRise && anyFall ? 'MIXED_RISES_AND_FALLS_REVIEW' : 'INCONCLUSIVE_GROWTH_PATTERN';
  return { version: OBSERVATION_CANDIDATE, status, blocks,
    role: 'DESCRIPTIVE_SCREENING_CANDIDATE_NOT_CAPACITY_DECISION',
    capacityEstablished: false, automaticBoundaryDecision: null };
}

// Independent mathematical reference: pairwise covariance rather than the
// production n*sum(x*y)-sum(x)*sum(y) calculation. Only signs affect v1.
export function referenceV1(boundaries) {
  const sign = values => {
    let numerator = 0n;
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
      numerator += BigInt(j - i) * (BigInt(values[j]) - BigInt(values[i]));
    }
    return numerator > 0n ? 1 : numerator < 0n ? -1 : 0;
  };
  const wholeSign = sign(boundaries), recentSign = sign(boundaries.slice(-6));
  const b = [0, ...boundaries], increasingEnds = [];
  for (let end = 6; end < b.length; end++) {
    const minutes = [b[end - 6], b[end - 4], b[end - 2], b[end]];
    if (minutes.slice(1).every((v, i) => v > minutes[i])) increasingEnds.push(end);
  }
  return { wholeSign, recentSign, increasingEnds,
    status: wholeSign <= 0 && recentSign <= 0 && !increasingEnds.length ? 'SUSTAINED'
      : wholeSign > 0 && recentSign > 0 && increasingEnds.includes(boundaries.length)
        ? 'NOT_SUSTAINED_QUEUE_GROWTH' : 'INCONCLUSIVE' };
}

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}

export function revalidationCases() {
  const cases = [];
  const add = (id, family, values, details = {}) => cases.push({ id, family, boundaries: values, ...details });
  for (const n of [8, 20, 60, 120]) {
    for (const level of [0, 1, 10, 100]) add(`constant-${n}-${level}`, 'constant', Array(n).fill(level));
    add(`draining-${n}`, 'draining', Array.from({ length: n }, (_, i) => n - i));
    for (const period of [2, 4, 8, 16, 32, 64]) for (let shift = 0; shift < period; shift++) {
      const phase = i => ((i + shift) % period) / period;
      const waves = {
        sine: i => Math.round(10 + 5 * Math.sin(2 * Math.PI * phase(i))),
        triangle: i => Math.round(5 + 10 * (1 - Math.abs(2 * phase(i) - 1))),
        sawtooth: i => Math.floor(5 + 10 * phase(i)),
        burst: i => phase(i) < .25 ? 15 : 5
      };
      for (const [wave, value] of Object.entries(waves)) add(`${wave}-${n}-${period}-${shift}`, 'bounded-periodic',
        Array.from({ length: n }, (_, i) => value(i)), { period, shift, wave, multipleCyclesVisible: n >= 2 * period });
    }
    for (let seed = 1; seed <= 32; seed++) {
      const next = random(seed);
      add(`bounded-noise-${n}-${seed}`, 'bounded-noise', Array.from({ length: n }, () => Math.floor(next() * 21)), { seed });
      const drift = random(seed);
      add(`drifting-noise-${n}-${seed}`, 'growing-with-noise', Array.from({ length: n }, (_, i) => i * 2 + Math.floor(drift() * 5)), { seed });
    }
    for (const rate of [.125, .25, .5, 1, 2, 4]) for (const delayFraction of [0, .25, .5, .75]) {
      add(`accumulation-${n}-${rate}-${delayFraction}`, 'accumulation',
        Array.from({ length: n }, (_, i) => Math.floor(Math.max(0, i - n * delayFraction) * rate)), { rate, delayFraction });
    }
    for (const startFraction of [0, .25, .5]) {
      const left = n * startFraction, right = left + n / 4;
      add(`cleared-burst-${n}-${startFraction}`, 'cleared-burst',
        Array.from({ length: n }, (_, i) => i >= left && i < right ? 10 : 0));
    }
  }
  return cases;
}
