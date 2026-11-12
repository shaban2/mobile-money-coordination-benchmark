#!/usr/bin/env node
// node scripts/campaign.mjs freeze <root> [--pilot]    build images and record identity
// node scripts/campaign.mjs run <root> [--allow-competing]  run or resume the schedule
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { cpus, hostname, loadavg, totalmem } from 'node:os';
import path from 'node:path';
import { buildCampaign, buildPilot, environmentFor, ladderSaturated, ladderSkip } from '../src/experiment/campaign.js';
import { inspectProject } from '../src/experiment/compose-lifecycle.js';
import { fileHash, sourceSnapshotSha256 } from '../src/experiment/provenance.js';

const [mode, rootArgument, ...flags] = process.argv.slice(2);
const root = path.resolve(rootArgument ?? 'results-revision-campaign-v2');
const project = 'lubanga-coordination-revision';
const seed = 'lubanga-revision-v2';
const minimumFreeDiskGiB = 8;
const maximumConsecutiveFailures = 3;
const baseEnvironment = { POSTGRES_PORT: '25432', APP_CPUS: '2', APP_MEMORY: '1g' };
const json = (name, value) => writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const read = (name) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...baseEnvironment } });
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed: ${result.stderr || result.error || result.status}`);
  return result.stdout;
}
const running = () => command('docker', ['ps', '--no-trunc', '--format', '{{json .}}']).trim().split('\n').filter(Boolean).map(JSON.parse);
const log = (event) => appendFileSync(path.join(root, 'campaign-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);

function freeze() {
  if (existsSync(root)) throw new Error(`Refusing to overwrite ${root}.`);
  mkdirSync(root, { recursive: true });
  const compose = (...args) => ['compose', '-p', project, ...args];
  const config = JSON.parse(command('docker', compose('--profile', '*', 'config', '--format', 'json')));
  command('docker', compose('--profile', '*', 'build', ...Object.entries(config.services).filter(([, s]) => s.build).map(([name]) => name)));
  const images = {}, overrides = { services: {} };
  for (const [service, definition] of Object.entries(config.services)) {
    const reference = definition.image ?? `${project}-${service}:latest`;
    const inspected = JSON.parse(command('docker', ['image', 'inspect', reference]))[0];
    images[service] = { reference, id: inspected.Id };
    overrides.services[service] = { image: inspected.Id, pull_policy: 'never' };
    if (['rest-async', 'kafka-async'].includes(service)) overrides.services[service].environment = { DATABASE_DIAGNOSTICS_ENABLED: 'true' };
    if (service === 'postgres') overrides.services[service].command = ['postgres', '-c', 'track_io_timing=on', '-c', 'track_wal_io_timing=on'];
  }
  json('frozen-compose.json', overrides);
  const skipped = flags.find((f) => f.startsWith('--skip='))?.split('=')[1]?.split(',') ?? [];
  if (skipped.length && !flags.includes('--pilot')) throw new Error('--skip is for pilots only.');
  const schedule = flags.includes('--pilot') ? buildPilot({ seed }) : buildCampaign({ seed });
  schedule.runs = schedule.runs.filter((r) => !skipped.includes(r.cell)).map((r, i) => ({ ...r, sequence: i + 1 }));
  schedule.expectedRunCount = schedule.runs.length;
  json('campaign-schedule.json', schedule);
  const info = JSON.parse(command('docker', ['info', '--format', '{{json .}}']));
  json('freeze.json', { schemaVersion: 1, stage: flags.includes('--pilot') ? 'FUNCTIONAL_PILOT_NOT_EVIDENCE' : 'REVISION_CAMPAIGN', frozenAt: new Date().toISOString(), project, seed,
    sourceSha256: sourceSnapshotSha256(), scheduleSha256: fileHash(path.join(root, 'campaign-schedule.json')), frozenComposeSha256: fileHash(path.join(root, 'frozen-compose.json')), images,
    host: { hostname: hostname(), cpuModel: cpus()[0]?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem(), dockerId: info.ID, dockerVersion: info.ServerVersion, dockerCPUs: info.NCPU, dockerMemoryBytes: info.MemTotal } });
  command('tar', ['-czf', path.join(root, 'source-snapshot.tar.gz'), 'src', 'scripts', 'infra', 'migrations', 'contracts', 'config', 'package.json', 'package-lock.json', 'compose.yaml', 'Dockerfile', 'Dockerfile.gateway', '.dockerignore']);
  process.stdout.write(`Frozen ${read('campaign-schedule.json').expectedRunCount} runs in ${root}. Nothing has been measured.\n`);
}

function assertFrozen(frozen, allowCompeting) {
  if (sourceSnapshotSha256() !== frozen.sourceSha256) throw new Error('Source changed since the freeze. Results would mix versions, so stopping.');
  if (fileHash(path.join(root, 'campaign-schedule.json')) !== frozen.scheduleSha256 || fileHash(path.join(root, 'frozen-compose.json')) !== frozen.frozenComposeSha256) throw new Error('Schedule or image override changed.');
  const info = JSON.parse(command('docker', ['info', '--format', '{{json .}}']));
  if (hostname() !== frozen.host.hostname || info.ID !== frozen.host.dockerId || info.NCPU !== frozen.host.dockerCPUs || info.MemTotal !== frozen.host.dockerMemoryBytes || info.ServerVersion !== frozen.host.dockerVersion) throw new Error('Host or Docker configuration changed.');
  const leftovers = inspectProject((program, args) => command(program, args), project);
  if (leftovers.length) throw new Error(`Project is not clean: ${leftovers.map((c) => c.Name).join(', ')}`);
  // Other containers are never stopped from here. That is the operator's decision.
  const others = running();
  if (others.length && !allowCompeting) throw new Error(`Competing containers are running: ${others.map((c) => c.Names).join(', ')}`);
  const disk = statfsSync(root);
  if (disk.bavail * disk.bsize / 2 ** 30 < minimumFreeDiskGiB) throw new Error('Free disk fell below the safety floor.');
}

// High-rate runs are large. Compress bulk evidence once qualified, and keep the
// files that resume and first-pass analysis read as plain JSON.
const bulkEvidence = ['traces.json', 'measurement-metrics.json', 'client-attempts.json', 'callbacks.json', 'transfers.json', 'compose.log', 'docker-stats.jsonl', 'measurement.log', 'warmup.log', 'invariants.json', 'provider-attempt-timings.json', 'database-diagnostics.json'];
function compressEvidence(run) {
  for (const name of bulkEvidence) {
    const file = path.join(root, run.runId, name);
    if (existsSync(file)) spawnSync('gzip', ['-6', file]);
  }
}

const hostSnapshot = () => ({ loadAverage: loadavg(), thermal: spawnSync('pmset', ['-g', 'therm'], { encoding: 'utf8' }).stdout?.trim() ?? null });

function runTrial(run, schedulePath) {
  const output = createWriteStream(path.join(root, `${run.runId}-controller.log`), { flags: 'a' });
  const env = { ...process.env, ...baseEnvironment, ...environmentFor(run), COMPOSE_PROJECT_NAME: project, DEEP_DIAGNOSTICS: 'true',
    FROZEN_COMPOSE_OVERRIDE: path.join(root, 'frozen-compose.json'), KEEP_SERVICES: 'false', PILOT_SESSION_ID: `campaign-${process.pid}` };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/run-experiment.mjs', '--execute', '--pilot-spec', schedulePath, '--run-id', run.runId, '--results', root],
      { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    const deadline = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 45 * 60 * 1000);
    child.once('error', (error) => { clearTimeout(deadline); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(deadline); output.end(); resolve({ code, signal }); });
  });
}

function resultOf(run) {
  const directory = path.join(root, run.runId), file = (name) => path.join(directory, name);
  if (!existsSync(file('qualification.json'))) return { status: existsSync(directory) ? 'FAILED' : null };
  const qualification = JSON.parse(readFileSync(file('qualification.json'), 'utf8'));
  const outcomes = JSON.parse(readFileSync(file('run-outcomes.json'), 'utf8'));
  const summary = JSON.parse(readFileSync(file('measurement-summary.json'), 'utf8'));
  const dropped = Number(summary?.metrics?.dropped_iterations?.values?.count ?? summary?.metrics?.dropped_iterations?.count ?? 0);
  return { status: qualification.status, saturated: run.studyBlock === 'D' ? ladderSaturated(outcomes, dropped) : false };
}

async function execute() {
  const frozen = read('freeze.json'), schedule = read('campaign-schedule.json');
  const schedulePath = path.join(root, 'campaign-schedule.json');
  const allowCompeting = flags.includes('--allow-competing');
  if (allowCompeting && frozen.stage !== 'FUNCTIONAL_PILOT_NOT_EVIDENCE') throw new Error('--allow-competing is for functional pilots only.');
  const sleepGuard = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore', detached: true });
  sleepGuard.unref();
  const results = new Map();
  let failures = 0;
  for (const run of schedule.runs) {
    const previous = resultOf(run);
    if (previous.status) { results.set(run.runId, previous); continue; }
    if (ladderSkip(run, results, schedule)) { log({ event: 'SKIPPED_AFTER_SATURATION', runId: run.runId }); continue; }
    assertFrozen(frozen, allowCompeting);
    log({ event: 'START', runId: run.runId, sequence: run.sequence, host: hostSnapshot() });
    const exit = await runTrial(run, schedulePath);
    const result = resultOf(run);
    results.set(run.runId, result);
    compressEvidence(run);
    log({ event: 'END', runId: run.runId, exit, ...result, host: hostSnapshot() });
    process.stdout.write(`${run.sequence}/${schedule.runs.length} ${run.runId} ${result.status}\n`);
    failures = result.status === 'FAILED' ? failures + 1 : 0;
    if (failures >= maximumConsecutiveFailures) throw new Error(`${failures} controller failures in a row. Stopping for review.`);
  }
  log({ event: 'COMPLETE' });
}

if (mode === 'freeze') freeze();
else if (mode === 'run') await execute();
else throw new Error('Usage: campaign.mjs freeze|run <root>');
