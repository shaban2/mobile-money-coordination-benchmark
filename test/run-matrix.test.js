import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const matrix = JSON.parse(readFileSync(new URL('../config/run-matrix.json', import.meta.url), 'utf8'));

test('confirmatory matrix contains only the 96 coordination runs', () => {
  assert.equal(matrix.schemaVersion, 2);
  assert.equal(matrix.runs.length, 96);
  assert.deepEqual([...new Set(matrix.runs.map(({ conditionId }) => conditionId))].sort(), ['K-A', 'R-A']);
  assert.deepEqual(matrix.countsByBlock, { LOAD: 64, FAULT: 32 });
  assert.ok(matrix.runs.every(({ networkProfile }) => networkProfile === 'standard'));
});

test('each architecture and study cell has eight independent runs', () => {
  for (const conditionId of ['R-A', 'K-A']) {
    for (const offeredLoadPercent of [25, 50, 75, 90]) {
      assert.equal(matrix.runs.filter((run) => (
        run.block === 'LOAD'
        && run.conditionId === conditionId
        && run.offeredLoadPercent === offeredLoadPercent
      )).length, 8);
    }
    for (const faultScenario of ['adapter-crash', 'database-delay']) {
      assert.equal(matrix.runs.filter((run) => (
        run.block === 'FAULT'
        && run.conditionId === conditionId
        && run.faultScenario === faultScenario
      )).length, 8);
    }
  }
});
