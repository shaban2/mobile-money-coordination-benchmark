import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaign, buildPilot, environmentFor, ladderSaturated, ladderSkip } from '../src/experiment/campaign.js';

const campaign = buildCampaign({ seed: 'test' });
const inBlock = (block) => campaign.runs.filter((r) => r.studyBlock === block);

test('the campaign has the planned size', () => {
  assert.deepEqual(['A', 'B', 'C', 'D', 'E'].map((b) => inBlock(b).length), [60, 30, 20, 36, 35]);
  assert.equal(campaign.expectedRunCount, 181);
  assert.equal(new Set(campaign.runs.map((r) => r.runId)).size, 181);
  assert.deepEqual(campaign.runs.map((r) => r.sequence), campaign.runs.map((_, i) => i + 1));
});

test('the schedule is reproducible from its seed and changes with it', () => {
  assert.deepEqual(buildCampaign({ seed: 'test' }), campaign);
  assert.notDeepEqual(buildCampaign({ seed: 'other' }).runs.map((r) => r.runId), campaign.runs.map((r) => r.runId));
});

test('pair order is balanced, and pairs run back to back with one shared seed', () => {
  const cells = [...new Set(campaign.runs.filter((r) => /^[AE]-/.test(r.cell) && r.cell !== 'E-BROKER-R4').map((r) => r.cell))];
  assert.equal(cells.length, 6);
  assert.ok(campaign.runs.some((r) => r.cell === 'C-WORKERS8-DATABASE-R4'));
  for (const cell of cells) {
    const runs = campaign.runs.filter((r) => r.cell === cell);
    const repetitions = [...new Set(runs.map((r) => r.repetition))];
    const kafkaFirst = repetitions.filter((rep) => {
      const [first, second] = runs.filter((r) => r.repetition === rep);
      assert.equal(second.sequence, first.sequence + 1);
      assert.equal(first.randomSeed, second.randomSeed);
      return first.conditionId === 'K-A';
    }).length;
    assert.ok(Math.abs(kafkaFirst * 2 - repetitions.length) <= 1, `${cell}: ${kafkaFirst}/${repetitions.length}`);
  }
});

test('blocks are interleaved so host drift does not line up with one condition', () => {
  const firstHalf = campaign.runs.slice(0, 82).map((r) => r.studyBlock);
  for (const block of ['A', 'B', 'C', 'D', 'E']) assert.ok(firstHalf.includes(block), block);
});

test('the sweep and dispatcher arms change only Kafka settings', () => {
  assert.ok(inBlock('B').every((r) => r.conditionId === 'K-A' && [5, 10, 25].includes(r.variant.outboxPollMs) && r.variant.outboxDispatchMode === 'serial'));
  assert.ok(inBlock('C').filter((r) => r.cell.startsWith('C-BATCHED')).every((r) => r.conditionId === 'K-A' && r.variant.outboxPollMs === 50 && r.variant.outboxDispatchMode === 'batched' && r.variant.workerConcurrency === 4));
  const workers = inBlock('C').filter((r) => r.cell === 'C-WORKERS8-DATABASE-R4');
  assert.equal(workers.length, 10);
  assert.ok(workers.every((r) => r.variant.workerConcurrency === 8 && r.variant.outboxDispatchMode === 'serial'));
  assert.ok(inBlock('A').every((r) => r.variant.outboxPollMs === 50 && r.variant.outboxDispatchMode === 'serial'));
});

test('the broker fault runs on Kafka only, and ladder series climb in rate', () => {
  assert.ok(campaign.runs.filter((r) => r.faultScenario === 'broker-stop').every((r) => r.conditionId === 'K-A'));
  const series = inBlock('D').filter((r) => r.conditionId === 'R-A' && r.repetition === 1);
  assert.deepEqual(series.map((r) => r.offeredRate), [8, 16, 32, 64, 128, 256]);
});

test('settings reach the run environment', () => {
  const run = campaign.runs.find((r) => r.cell === 'B-POLL5-DATABASE-R4');
  const env = environmentFor(run);
  assert.equal(env.OUTBOX_POLL_MS, '5');
  assert.equal(env.MEASUREMENT_DURATION, '10m');
  assert.equal(env.WORKER_CONCURRENCY, '4');
  assert.equal(env.FAULT_AT_SECONDS, '240');
  assert.equal(environmentFor(buildPilot({ seed: 't' }).runs[0]).FAULT_AT_SECONDS, '120');
});

test('saturation needs a real shortfall, and two saturated steps skip the rest', () => {
  const window = (backlogAtEnd) => ({ complete: true, underLoad: true, backlogAtEnd });
  assert.equal(ladderSaturated({ offeredRate: 8, correctGoodput: 6.08, windowSeries: [window(0)] }), false);
  assert.equal(ladderSaturated({ offeredRate: 128, measurementSeconds: 240, correctGoodput: 97, windowSeries: [window(4)] }, 44), false);
  assert.equal(ladderSaturated({ offeredRate: 128, measurementSeconds: 240, correctGoodput: 97, windowSeries: [window(4)] }, 900), true);
  assert.equal(ladderSaturated({ offeredRate: 64, correctGoodput: 48, windowSeries: [window(500)] }), true);
  assert.equal(ladderSaturated({ offeredRate: 64, correctGoodput: 30, windowSeries: [window(0)] }), true);
  const series = inBlock('D').filter((r) => r.conditionId === 'K-A' && r.repetition === 2);
  const results = new Map([[series[0].runId, { saturated: false }], [series[1].runId, { saturated: true }], [series[2].runId, { saturated: true }]]);
  assert.equal(ladderSkip(series[2], results, campaign), false);
  assert.equal(ladderSkip(series[3], results, campaign), true);
  assert.equal(ladderSkip(campaign.runs.find((r) => r.studyBlock === 'A'), results, campaign), false);
});
