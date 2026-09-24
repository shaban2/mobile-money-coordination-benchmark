import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrixPath = process.argv[2] ?? 'config/run-matrix.json';
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
const runs = matrix.runs ?? [];

assert.equal(matrix.schemaVersion, 2, 'The coordination-only matrix must use schema version 2.');
assert.equal(matrix.expectedRunCount, 96, 'The registered experiment must declare 96 runs.');
assert.equal(runs.length, 96, 'The matrix must contain exactly 96 runs.');
assert.equal(new Set(runs.map(({ runId }) => runId)).size, 96, 'Every run ID must be unique.');
assert.deepEqual([...new Set(runs.map(({ conditionId }) => conditionId))].sort(), ['K-A', 'R-A']);
assert.deepEqual([...new Set(runs.map(({ composeProfile }) => composeProfile))].sort(), ['kafka-async', 'rest-async']);
assert.deepEqual([...new Set(runs.map(({ networkProfile }) => networkProfile))], ['standard']);
assert.ok(runs.every(({ primary, repetition }) => primary === true && repetition >= 1 && repetition <= 8));
assert.equal(new Set(runs.map((run) => run.executionBlock)).size, 16);
for (const block of new Set(runs.map((run) => run.executionBlock))) {
  const rows = runs.filter((run) => run.executionBlock === block);
  assert.deepEqual([...new Set(rows.map((run) => run.conditionId))].sort(), ['K-A', 'R-A']);
  assert.equal(Math.max(...rows.map((r) => r.sequence)) - Math.min(...rows.map((r) => r.sequence)) + 1, rows.length);
}

const count = (predicate) => runs.filter(predicate).length;
for (const conditionId of ['R-A', 'K-A']) {
  for (const offeredLoadPercent of [25, 50, 75, 90]) {
    assert.equal(count((run) => (
      run.block === 'LOAD'
      && run.conditionId === conditionId
      && run.offeredLoadPercent === offeredLoadPercent
      && run.faultScenario === 'none'
    )), 8, `${conditionId} at ${offeredLoadPercent}% must have eight load runs.`);
  }
  for (const faultScenario of ['adapter-crash', 'database-delay']) {
    assert.equal(count((run) => (
      run.block === 'FAULT'
      && run.conditionId === conditionId
      && run.offeredLoadPercent === 90
      && run.faultScenario === faultScenario
    )), 8, `${conditionId} with ${faultScenario} must have eight fault runs.`);
  }
}

assert.deepEqual(runs.map(({ sequence }) => sequence), Array.from({ length: 96 }, (_, index) => index + 1));
process.stdout.write(`Validated ${runs.length} coordination-only runs in ${matrixPath}.\n`);
