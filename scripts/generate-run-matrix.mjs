import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const seed = process.env.RANDOM_SEED ?? 'lubanga-coordination-confirmatory-v1';
const outputPath = process.argv[2] ?? 'config/run-matrix.json';
const conditions = [
  { conditionId: 'R-A', composeProfile: 'rest-async', gatewayPort: 8182, apiPort: 8082 },
  { conditionId: 'K-A', composeProfile: 'kafka-async', gatewayPort: 8184, apiPort: 8084 }
];

function seededUnit(label) {
  const bytes = createHash('sha256').update(`${seed}:${label}`).digest();
  return bytes.readUInt32BE(0) / 0x1_0000_0000;
}

function shuffle(rows, block) {
  return rows
    .map((row, index) => ({ row, order: seededUnit(`${block}:${index}:${row.runId}`) }))
    .sort((left, right) => left.order - right.order)
    .map(({ row }) => row);
}

function cells(block, values, repetitions, primary = true) {
  const rows = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const condition of conditions) {
      for (const value of values) {
        const suffix = [
          condition.conditionId,
          `L${value.offeredLoadPercent}`,
          `N${value.networkProfile}`,
          `F${value.faultScenario}`,
          `R${String(repetition).padStart(2, '0')}`
        ].join('-');
        rows.push({
          runId: `${block}-${suffix}`,
          block,
          primary,
          repetition,
          executionBlock: `${block}-${String(repetition).padStart(2, '0')}`,
          randomSeed: [
            seed,
            block,
            value.offeredLoadPercent,
            value.networkProfile,
            value.faultScenario,
            repetition
          ].join(':'),
          ...condition,
          ...value
        });
      }
    }
  }
  return Array.from({ length: repetitions }, (_, i) => shuffle(rows.filter((row) => row.repetition === i + 1), `${block}-${i + 1}`)).flat();
}

const load = cells('LOAD', [25, 50, 75, 90].map((offeredLoadPercent) => ({
  offeredLoadPercent,
  networkProfile: 'standard',
  faultScenario: 'none'
})), 8);
const fault = cells('FAULT', ['adapter-crash', 'database-delay'].map((faultScenario) => ({
  offeredLoadPercent: 90,
  networkProfile: 'standard',
  faultScenario
})), 8);

const runs = [...load, ...fault]
  .map((run, index) => ({ ...run, sequence: index + 1 }));
const matrix = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  seed,
  studyFactor: 'coordination architecture',
  factorLevels: ['REST orchestration', 'Kafka choreography'],
  fixedClientMode: 'async',
  expectedRunCount: 96,
  primaryRunCount: runs.length,
  secondaryRunCount: 0,
  countsByBlock: Object.fromEntries(
    ['LOAD', 'FAULT'].map((block) => [
      block,
      runs.filter((run) => run.block === block).length
    ])
  ),
  runs
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
process.stdout.write(`Wrote ${runs.length} runs (${matrix.primaryRunCount} primary) to ${outputPath}.\n`);
