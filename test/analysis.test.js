import assert from 'node:assert/strict';
import test from 'node:test';
import { pairedContrast, holm, restrictedDuration, decision } from '../src/experiment/analysis.js';
test('paired analysis retains all run pairs and rejects missing latency values', () => {
  assert.equal(pairedContrast([[1, 2], [2, null], [3, 4]]).estimable, false);
  const result = pairedContrast(Array.from({ length: 8 }, (_, i) => [i + 1, 2 * (i + 1)]), { draws: 1000 });
  assert.equal(result.relativeEffect, 1); assert.equal(result.pValue, 2 / 256);
  assert.deepEqual(result.confidenceInterval95, [1, 1]);
});
test('censored recovery contributes the administrative horizon, not zero or omission', () => {
  assert.equal(restrictedDuration({ recoveryObservationSeconds: 300, recoveryCensored: true, recoveryTimeSeconds: null }, 'recovery', 240), 240);
  assert.equal(restrictedDuration({ recoveryObservationSeconds: 120, recoveryCensored: true }, 'recovery', 240), null);
  assert.equal(restrictedDuration({ recoveryObservationSeconds: 300, recoveryCensored: true, recoveryEstimable: false }, 'recovery', 240), null);
});
test('Holm correction and safety gate prevent unsupported leaders', () => {
  assert.deepEqual(holm([.01, .04, .03]), [.03, .06, .06]);
  const result = { estimable: true, confidenceInterval95: [.2, .3], adjustedPValue: .01 };
  assert.equal(decision(result, .1, true), 'Kafka leads');
  assert.equal(decision(result, .1, true, { rest: true, kafka: false }), 'inconclusive');
});
