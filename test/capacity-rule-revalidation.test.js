import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBacklog, assertCapacityRuleLaunchReady } from '../src/experiment/capacity-queue.js';
import { describeQueueObservation, referenceV1, revalidationCases } from '../scripts/lib/capacity-rule-revalidation.js';
import { describeQueueObservation as describeApprovedObservation } from '../src/experiment/queue-observation.js';

const cases = revalidationCases();
test('approved descriptive implementation preserves every candidate classification and block across 2,400 cases', () => {
  for (const c of cases) {
    const approved = describeApprovedObservation(c.boundaries), candidate = describeQueueObservation(c.boundaries);
    assert.equal(approved.status, candidate.status, c.id);
    assert.deepEqual(approved.blocks, candidate.blocks, c.id);
    assert.equal(approved.capacityEstablished, false); assert.equal(approved.automaticBoundaryDecision, null);
    assert.equal('stable' in approved, false);
  }
});
test('v1 independently matches pairwise-covariance oracle across the expanded deterministic suite', () => {
  for (const c of cases) {
    const actual = classifyBacklog(c.boundaries), expected = referenceV1(c.boundaries);
    assert.equal(actual.status, expected.status, c.id);
    assert.equal(actual.whole.sign, expected.wholeSign, c.id);
    assert.equal(actual.recent.sign, expected.recentSign, c.id);
    assert.deepEqual(actual.persistentGrowthAt, expected.increasingEnds, c.id);
  }
});
test('observation candidate handles basic controls without making capacity claims', () => {
  assert.equal(describeQueueObservation(Array(8).fill(0)).status, 'NO_INCREASE_AT_SAMPLED_BOUNDARIES');
  assert.equal(describeQueueObservation([8,7,6,5,4,3,2,1]).status, 'NO_INCREASE_AT_SAMPLED_BOUNDARIES');
  assert.equal(describeQueueObservation([1,2,3,4,5,6,7,8]).status, 'CONSISTENT_BLOCK_GROWTH_OBSERVED');
  assert.equal(describeQueueObservation([0,0,0,0,0,0,0,1]).status, 'INCONCLUSIVE_GROWTH_PATTERN');
  assert.equal(describeQueueObservation([0,10,0,0,0,0,0,0]).status, 'MIXED_RISES_AND_FALLS_REVIEW');
  for (const c of cases) {
    const result = describeQueueObservation(c.boundaries);
    assert.equal(result.capacityEstablished, false, c.id);
    assert.equal(result.automaticBoundaryDecision, null, c.id);
    assert.equal('stable' in result, false);
  }
});
test('candidate does not call the multi-cycle periodic fixtures consistent block growth', () => {
  for (const c of cases.filter(c => c.multipleCyclesVisible)) {
    assert.notEqual(describeQueueObservation(c.boundaries).status, 'CONSISTENT_BLOCK_GROWTH_OBSERVED', c.id);
  }
});
test('same observed prefix cannot distinguish a future bounded queue from an accumulating one', () => {
  const prefix = [5,5,5,6,8,10,12,14];
  const bounded = [...prefix, 15, 5, 15, 5], growing = [...prefix, 15,16,17,18];
  assert.deepEqual(describeQueueObservation(bounded.slice(0, 8)), describeQueueObservation(growing.slice(0, 8)));
  assert.deepEqual(classifyBacklog(bounded.slice(0, 8)), classifyBacklog(growing.slice(0, 8)));
  assert.equal(describeQueueObservation(prefix).automaticBoundaryDecision, null);
});
test('candidate rejects incomplete/noninteger series; launch still rejects both versions', () => {
  for (const b of [[], Array(6).fill(0), Array(9).fill(0), [0,0,0,0,0,0,0,-1], [0,0,0,0,0,0,0,.1], Array(8)]) {
    assert.throws(() => describeQueueObservation(b));
  }
  for (const version of ['queue-growth-v1', 'queue-observation-v2-candidate']) assert.throws(() => assertCapacityRuleLaunchReady({ version }), /blocked/);
});
