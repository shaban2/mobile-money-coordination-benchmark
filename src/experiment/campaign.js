import { createHash } from 'node:crypto';

// The replicated campaign. Every run shares one source and image identity, and
// variants differ only by environment, so nothing is rebuilt between conditions.
const CONDITIONS = { R: { conditionId: 'R-A', composeProfile: 'rest-async', gatewayPort: 8182, apiPort: 8082 },
  K: { conditionId: 'K-A', composeProfile: 'kafka-async', gatewayPort: 8184, apiPort: 8084 } };
export const DEFAULT_VARIANT = Object.freeze({ outboxPollMs: 50, outboxDispatchMode: 'serial', workerConcurrency: 4 });
export const LADDER_RATES = Object.freeze([8, 16, 32, 64, 128, 256]);
export const TIMING = Object.freeze({ short: { warmupDuration: '2m', measurementDuration: '4m' }, long: { warmupDuration: '5m', measurementDuration: '10m' } });

const hash = (text) => createHash('sha256').update(text).digest('hex');
const shuffled = (items, seed, key) => [...items].sort((a, b) => hash(`${seed}:${key(a)}`).localeCompare(hash(`${seed}:${key(b)}`)));

function makeRun({ cell, block, arch, repetition, rate, fault = 'none', timing, variant = DEFAULT_VARIANT, seed }) {
  return { ...CONDITIONS[arch], runId: `CAMP-${cell}-${arch}-${String(repetition).padStart(2, '0')}`, block: 'CAMPAIGN', studyBlock: block, cell,
    phase: fault === 'none' ? 'screening' : 'fault', offeredRate: rate, offeredLoadPercent: null, repetition, executionBlock: `${cell}-${repetition}`,
    networkProfile: 'standard', faultScenario: fault, randomSeed: `${seed}:${cell}:${repetition}`, timing, variant };
}

// One unit runs back to back: a matched pair, a single Kafka run, or a load series.
function pairUnits({ cell, block, rate, fault, timing, repetitions, seed, variant }) {
  const firsts = shuffled(Array.from({ length: repetitions }, (_, i) => i + 1), seed, (r) => `${cell}:order:${r}`);
  const kafkaFirst = new Set(firsts.slice(0, Math.floor(repetitions / 2) + (parseInt(hash(`${seed}:${cell}`).slice(0, 2), 16) % 2 ? repetitions % 2 : 0)));
  return Array.from({ length: repetitions }, (_, i) => {
    const repetition = i + 1;
    const runs = ['R', 'K'].map((arch) => makeRun({ cell, block, arch, repetition, rate, fault, timing, seed, variant }));
    return { key: `${cell}:${repetition}`, runs: kafkaFirst.has(repetition) ? runs.reverse() : runs };
  });
}
function kafkaUnits({ cell, block, rate, fault, timing, variant, repetitions, seed }) {
  return Array.from({ length: repetitions }, (_, i) => ({ key: `${cell}:${i + 1}`,
    runs: [makeRun({ cell, block, arch: 'K', repetition: i + 1, rate, fault, timing, variant, seed })] }));
}

export function buildCampaign({ seed, replication = 10, secondary = 5, ladderRepetitions = 3 }) {
  if (!seed) throw new Error('A campaign seed is required.');
  const { short, long } = TIMING;
  const units = [
    ...pairUnits({ cell: 'A-NOFAULT-R8', block: 'A', rate: 8, timing: short, repetitions: replication, seed }),
    ...pairUnits({ cell: 'A-ADAPTER-R4', block: 'A', rate: 4, fault: 'adapter-crash', timing: long, repetitions: replication, seed }),
    ...pairUnits({ cell: 'A-DATABASE-R4', block: 'A', rate: 4, fault: 'database-delay', timing: long, repetitions: replication, seed })
  ];
  for (const outboxPollMs of [5, 10, 25]) {
    const variant = { ...DEFAULT_VARIANT, outboxPollMs };
    units.push(...kafkaUnits({ cell: `B-POLL${outboxPollMs}-NOFAULT-R8`, block: 'B', rate: 8, timing: short, variant, repetitions: secondary, seed }),
      ...kafkaUnits({ cell: `B-POLL${outboxPollMs}-DATABASE-R4`, block: 'B', rate: 4, fault: 'database-delay', timing: long, variant, repetitions: secondary, seed }));
  }
  const batched = { ...DEFAULT_VARIANT, outboxDispatchMode: 'batched' };
  units.push(...kafkaUnits({ cell: 'C-BATCHED-NOFAULT-R8', block: 'C', rate: 8, timing: short, variant: batched, repetitions: secondary, seed }),
    ...kafkaUnits({ cell: 'C-BATCHED-DATABASE-R4', block: 'C', rate: 4, fault: 'database-delay', timing: long, variant: batched, repetitions: secondary, seed }),
    // Eight stays under the pool limit of ten, so the pool does not become a second variable.
    ...pairUnits({ cell: 'C-WORKERS8-DATABASE-R4', block: 'C', rate: 4, fault: 'database-delay', timing: long, variant: { ...DEFAULT_VARIANT, workerConcurrency: 8 }, repetitions: secondary, seed }));
  for (const arch of ['R', 'K']) for (let repetition = 1; repetition <= ladderRepetitions; repetition += 1) {
    units.push({ key: `D-${arch}:${repetition}`, runs: LADDER_RATES.map((rate) => makeRun({ cell: `D-LADDER-R${rate}`, block: 'D', arch, repetition, rate, timing: short, seed })) });
  }
  for (const [cell, fault] of [['E-APPKILL-R4', 'app-kill'], ['E-PGRESTART-R4', 'postgres-restart'], ['E-PARTITION-R4', 'database-partition']]) {
    units.push(...pairUnits({ cell, block: 'E', rate: 4, fault, timing: long, repetitions: secondary, seed }));
  }
  units.push(...kafkaUnits({ cell: 'E-BROKER-R4', block: 'E', rate: 4, fault: 'broker-stop', timing: long, repetitions: secondary, seed }));
  const runs = shuffled(units, seed, (u) => u.key).flatMap((u) => u.runs).map((run, i) => ({ ...run, sequence: i + 1 }));
  return { schemaVersion: 1, kind: 'REVISION_CAMPAIGN', protocolId: `revision-campaign-${seed}`, expectedRunCount: runs.length, runs };
}

// Reduced functional check of every new code path. Never reported as evidence.
export function buildPilot({ seed }) {
  const timing = { warmupDuration: '1m', measurementDuration: '5m' };
  const pair = (cell, fault) => ['R', 'K'].map((arch) => makeRun({ cell, block: 'PILOT', arch, repetition: 1, rate: 4, fault, timing, seed }));
  const runs = [...pair('P-APPKILL', 'app-kill'), ...pair('P-PGRESTART', 'postgres-restart'), ...pair('P-PARTITION', 'database-partition'),
    makeRun({ cell: 'P-BROKER', block: 'PILOT', arch: 'K', repetition: 1, rate: 4, fault: 'broker-stop', timing, seed }),
    makeRun({ cell: 'P-BATCHED', block: 'PILOT', arch: 'K', repetition: 1, rate: 4, fault: 'database-delay', timing, seed, variant: { ...DEFAULT_VARIANT, outboxDispatchMode: 'batched' } }),
    makeRun({ cell: 'P-POLL5', block: 'PILOT', arch: 'K', repetition: 1, rate: 8, timing: { warmupDuration: '1m', measurementDuration: '2m' }, seed, variant: { ...DEFAULT_VARIANT, outboxPollMs: 5 } }),
    makeRun({ cell: 'P-WORKERS8', block: 'PILOT', arch: 'K', repetition: 1, rate: 8, timing: { warmupDuration: '1m', measurementDuration: '2m' }, seed, variant: { ...DEFAULT_VARIANT, workerConcurrency: 8 } }),
    ...['R', 'K'].map((arch) => makeRun({ cell: 'P-LADDER-R128', block: 'D', arch, repetition: 1, rate: 128, timing: { warmupDuration: '1m', measurementDuration: '2m' }, seed }))
  ].map((run, i) => ({ ...run, sequence: i + 1 }));
  return { schemaVersion: 1, kind: 'REVISION_CAMPAIGN', protocolId: `revision-pilot-${seed}`, expectedRunCount: runs.length, runs };
}

// A ladder step is saturated if it fell behind the offered transfers by the end.
export function ladderSaturated(outcomes, droppedIterations = 0) {
  const windows = (outcomes?.windowSeries ?? []).filter((w) => w.complete && w.underLoad);
  const last = windows.at(-1);
  const offeredTransfers = outcomes.offeredRate * .76;
  // A few drops as k6 ramps its virtual users are not saturation.
  const offeredOperations = outcomes.offeredRate * (outcomes.measurementSeconds ?? 0);
  return droppedIterations > .01 * offeredOperations || !last || last.backlogAtEnd > Math.max(10, outcomes.offeredRate)
    || outcomes.correctGoodput < .95 * offeredTransfers;
}

// Higher steps are skipped once two consecutive steps of the same series saturate.
export function ladderSkip(run, resultsByRunId, schedule) {
  if (run.studyBlock !== 'D') return false;
  const series = schedule.runs.filter((r) => r.studyBlock === 'D' && r.conditionId === run.conditionId && r.repetition === run.repetition && r.offeredRate < run.offeredRate)
    .sort((a, b) => a.offeredRate - b.offeredRate).map((r) => resultsByRunId.get(r.runId));
  return series.some((r, i) => i > 0 && r?.saturated === true && series[i - 1]?.saturated === true);
}

export function environmentFor(run) {
  return { WARMUP_DURATION: run.timing.warmupDuration, MEASUREMENT_DURATION: run.timing.measurementDuration, DRAIN_SECONDS: '600',
    FAULT_AT_SECONDS: run.timing.measurementDuration === '5m' ? '120' : '240', ADAPTER_CRASH_SECONDS: '30', DATABASE_FAULT_SECONDS: '60',
    DATABASE_LATENCY_MS: '100', FAULT_SECONDS: '30', OUTBOX_POLL_MS: String(run.variant.outboxPollMs), OUTBOX_DISPATCH_MODE: run.variant.outboxDispatchMode,
    WORKER_CONCURRENCY: String(run.variant.workerConcurrency) };
}
