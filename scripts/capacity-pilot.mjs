import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, createWriteStream, existsSync, openSync, readFileSync, renameSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, totalmem } from 'node:os';
import path from 'node:path';
import { nextPilotStep } from '../src/experiment/pilot.js';
import { assertPilotCanStart, assertPilotEvidence, executePilotSession, newPilotState, pilotTiming } from '../src/experiment/pilot-session.js';
import { fileHash, sourceSnapshotSha256 } from '../src/experiment/provenance.js';
import { inspectProject, stopComposeProject } from '../src/experiment/compose-lifecycle.js';
import { pilotTimingEnvironment, pilotTimingForPhase } from '../src/experiment/pilot-timing.js';
import { assertRestorablePilotContainer } from '../src/experiment/pilot-containers.js';
import { isCalibration } from '../src/experiment/calibration.js';
import { assertDeepDiagnosticEvidence } from '../src/experiment/deep-diagnostic-evidence.js';
import { isQueueCapacity, validateQueueCapacityProtocol, capacityRuleIdentity, assertCapacityRuleLaunchReady } from '../src/experiment/capacity-queue.js';
import { observePilotIsolation } from '../src/experiment/pilot-isolation-guard.js';
import { assertExploratoryRootReview } from '../src/experiment/exploratory-review.js';

const args = process.argv.slice(2);
const root = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? 'results-capacity-pilot-v3');
const execute = args.includes('--execute'), resume = args.includes('--resume');
if (execute && existsSync(path.join(root, 'DO_NOT_RESUME.json'))) throw new Error('This evidence root is paused/retired. Preserve it and prepare a fresh pilot after explicit approval.');
const read = (name) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
const write = (name, value) => {
  const destination = path.join(root, name), temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, destination);
};
const freeze = read('freeze.json'), protocol = read('pilot-protocol.json');
if (isQueueCapacity(protocol)) validateQueueCapacityProtocol(protocol);
if (execute && isQueueCapacity(protocol)) assertCapacityRuleLaunchReady(capacityRuleIdentity(protocol));
const state = existsSync(path.join(root, 'pilot-state.json')) ? read('pilot-state.json') : newPilotState();
if (!execute) {
  const executionHold = existsSync(path.join(root, 'DO_NOT_RESUME.json')) ? read('DO_NOT_RESUME.json') : null;
  const next = executionHold ? { action: 'DO_NOT_RESUME' } : state.status === 'PAUSED' ? { action: 'PAUSED', resumeRequired: true }
    : ['INTERRUPTED', 'REVIEW_REQUIRED', 'REVIEW', 'PILOT_COMPLETE_REVIEW_REQUIRED', 'CALIBRATION_COMPLETE_REVIEW_REQUIRED', 'SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED', 'EXPLORATORY_PAIR_COMPLETE_REVIEW_REQUIRED'].includes(state.status)
      ? { action: state.status } : nextPilotStep(state.records, protocol);
  process.stdout.write(`${JSON.stringify({ state, executionHold, timing: pilotTiming(state), next }, null, 2)}\n`);
  process.exit(0);
}
assertPilotCanStart(state, { resume });
for (const phase of isCalibration(protocol) ? ['calibration'] : ['screening', 'confirmation', 'fault']) pilotTimingForPhase(protocol, phase);
if (protocol.schemaVersion !== 2 || protocol.timeBudgetBasis !== 'active-sessions' || protocol.pauseBoundary !== 'matched-pair') {
  throw new Error('Prepare a fresh v2 protocol freeze; legacy frozen time rules must not be changed in place.');
}
const lockPath = path.join(root, 'pilot.lock');
if (existsSync(lockPath)) throw new Error('Pilot lock exists. Verify its process is gone before explicitly removing only that stale lock.');
const lock = openSync(lockPath, 'wx'); writeFileSync(lock, String(process.pid)); closeSync(lock);
const log = (message) => {
  const line = `${new Date().toISOString()} ${message}\n`;
  appendFileSync(path.join(root, 'pilot.log'), line); process.stdout.write(line);
};
function command(program, commandArgs) {
  const result = spawnSync(program, commandArgs, { encoding: 'utf8', env: { ...process.env, COMPOSE_PROFILES: '', POSTGRES_PORT: String(freeze.postgresPort) } });
  if (result.error || result.status !== 0) throw new Error(`${program} ${commandArgs.join(' ')}: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout;
}
let child, stopping = false, sleepGuard, isolationGuard, isolationError;
const assertIsolationObserver = () => { if (isolationError) throw new Error(isolationError); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  if (child?.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {}
});
function assertFrozen({ allowApproved = false } = {}) {
  assertExploratoryRootReview(root, protocol, freeze);
  if (sourceSnapshotSha256() !== freeze.sourceSha256 || fileHash(path.join(root, 'pilot-protocol.json')) !== freeze.protocolSha256
    || fileHash(path.join(root, 'frozen-compose.json')) !== freeze.frozenComposeSha256) throw new Error('Frozen source, protocol, or images override changed. Stop and review; never silently restart with a different treatment.');
  if (freeze.siteApprovalSha256 && fileHash(path.join(root, 'site-approval.json')) !== freeze.siteApprovalSha256) throw new Error('Frozen site approval changed.');
  const info = JSON.parse(command('docker', ['info', '--format', '{{json .}}']));
  if (hostname() !== freeze.host.hostname || totalmem() !== freeze.host.totalMemoryBytes || info.ID !== freeze.host.dockerId
    || info.NCPU !== freeze.host.dockerCPUs || info.MemTotal !== freeze.host.dockerMemoryBytes || info.ServerVersion !== freeze.host.dockerVersion) throw new Error('Frozen host or Docker configuration changed.');
  const leftovers = inspectProject(command, freeze.project);
  if (leftovers.length) throw new Error(`Pilot project is not clean between trials: ${leftovers.map((c) => c.Name).join(', ')}`);
  const running = command('docker', ['ps', '--no-trunc', '--format', '{{json .}}']).trim().split('\n').filter(Boolean).map(JSON.parse);
  const other = running.filter((c) => !allowApproved || !freeze.pauseContainers.some((approved) => approved.id === c.ID && approved.name === c.Names));
  if (other.length) throw new Error(`Competing containers are running: ${other.map((c) => c.Names).join(', ')}`);
  if (allowApproved) for (const container of freeze.pauseContainers) {
    assertRestorablePilotContainer(JSON.parse(command('docker', ['inspect', container.id]))[0], container);
  }
  const disk = statfsSync(root);
  if (disk.bavail * disk.bsize / 2 ** 30 < protocol.minimumFreeDiskGiB) throw new Error('Pilot free-disk safety floor reached.');
}
function readEvidence(runId) {
  assertIsolationObserver();
  const deep = isCalibration(protocol) || protocol.deepDiagnostics === true;
  const databaseDiagnostics = deep ? read(`${runId}/database-diagnostics.json`) : undefined;
  const resourceJsonl = deep ? readFileSync(path.join(root, runId, 'docker-stats.jsonl'), 'utf8') : undefined;
  if (deep) assertDeepDiagnosticEvidence(databaseDiagnostics, resourceJsonl);
  const manifest = read(`${runId}/manifest.json`);
  if (isQueueCapacity(protocol)) {
    const planned = state.batches.flatMap(b => b.runs).find(r => r.runId === runId);
    if (!planned || ['runId', 'conditionId', 'offeredRate', 'randomSeed', 'executionBlock', 'phase', 'faultScenario'].some(k => manifest.run?.[k] !== planned[k])
      || manifest.checksums?.sourceSnapshotSha256 !== freeze.sourceSha256
      || manifest.checksums?.frozenComposeSha256 !== freeze.frozenComposeSha256) throw new Error('Run identity or frozen provenance changed; review required.');
  }
  return { qualification: read(`${runId}/qualification.json`), outcomes: read(`${runId}/run-outcomes.json`),
    telemetry: read(`${runId}/telemetry.json`), manifest,
    ...(manifest.run.phase === 'fault' ? { fault: read(`${runId}/fault-evidence.json`) } : {}),
    ...(deep ? { databaseDiagnostics, resourceJsonl } : {}),
    cleanup: read(`${runId}/cleanup.json`), controllerError: existsSync(path.join(root, runId, 'controller-error.json')) };
}
async function runTrial(batchFile, run, sessionId) {
  assertIsolationObserver();
  const file = createWriteStream(path.join(root, `${run.runId}-controller.log`), { flags: 'a' });
  const trialArgs = ['scripts/run-experiment.mjs', '--execute', '--pilot-spec', path.join(root, batchFile), '--run-id', run.runId, '--results', root];
  const env = { ...process.env, COMPOSE_PROJECT_NAME: freeze.project, POSTGRES_PORT: String(freeze.postgresPort),
    DEEP_DIAGNOSTICS: String(isCalibration(protocol) || protocol.deepDiagnostics === true),
    APP_CPUS: '2', APP_MEMORY: '1g', PILOT_SESSION_ID: sessionId,
    FROZEN_COMPOSE_OVERRIDE: path.join(root, 'frozen-compose.json'), ...pilotTimingEnvironment(protocol, run.phase),
    FAULT_AT_SECONDS: String(protocol.faults.atSeconds), ADAPTER_CRASH_SECONDS: String(protocol.faults.adapterCrashSeconds),
    DATABASE_FAULT_SECONDS: String(protocol.faults.databaseDelaySeconds), DATABASE_LATENCY_MS: String(protocol.faults.databaseLatencyMs), KEEP_SERVICES: 'false' };
  try {
    return await new Promise((resolve, reject) => {
      child = spawn(process.execPath, trialArgs, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(file, { end: false }); child.stderr.pipe(file, { end: false });
      const deadline = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 45 * 60 * 1000);
      child.once('error', (error) => { clearTimeout(deadline); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(deadline); child = null; resolve({ code, signal }); });
    });
  } finally { file.end(); }
}

try {
  // Preflight must not alter a clean paused checkpoint or stop other services.
  assertFrozen({ allowApproved: true });
  if (resume) assertPilotEvidence({ state, protocol, freeze, readBatch: read, readEvidence });
  const result = await executePilotSession({
    state, protocol, resume, shouldStop: () => stopping,
    io: { save: (value) => write('pilot-state.json', value), log, write, readEvidence,
      runExists: (id) => existsSync(path.join(root, id)),
      readPauseRequest: () => existsSync(path.join(root, 'pause-request.json')) ? read('pause-request.json') : null },
    prepare: () => {
      // Restore only services that THIS session actually found running.
      state.pausedContainers = []; write('pilot-state.json', state);
      for (const container of freeze.pauseContainers) {
        const current = JSON.parse(command('docker', ['inspect', container.id]))[0];
        assertRestorablePilotContainer(current, container);
        if (current.State.Running) {
          state.pausedContainers.push(container); write('pilot-state.json', state);
          command('docker', ['stop', container.id]);
        }
      }
      if (isQueueCapacity(protocol)) isolationGuard = observePilotIsolation({ project: freeze.project,
        record: event => appendFileSync(path.join(root, 'isolation-events.jsonl'), `${JSON.stringify(event)}\n`),
        abort: reason => { isolationError ??= reason; if (child?.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
      });
      assertFrozen(); assertIsolationObserver();
      if (process.platform === 'darwin') {
        sleepGuard = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
        sleepGuard.on('error', (error) => log(`Sleep inhibition unavailable: ${error.message}`));
      }
    },
    check: () => { assertFrozen(); assertIsolationObserver(); }, runTrial,
    cleanup: async () => {
      const result = stopComposeProject({ command, project: freeze.project, override: path.join(root, 'frozen-compose.json') });
      await isolationGuard?.stop(); assertIsolationObserver(); return result;
    },
    restore: async () => {
      await isolationGuard?.stop();
      const errors = [];
      for (const container of state.pausedContainers ?? []) {
        try {
          const current = JSON.parse(command('docker', ['inspect', container.id]))[0];
          if (current.Name !== `/${container.name}`) throw new Error('Approved container identity changed; not restarting it.');
          if (!current.State.Running) command('docker', ['start', container.id]);
          const restored = JSON.parse(command('docker', ['inspect', container.id]))[0];
          if (restored.Name !== `/${container.name}` || !restored.State.Running) throw new Error('Approved container did not remain running after restoration.');
        } catch (error) { errors.push({ container: container.name, error: error.message }); }
      }
      return errors;
    }
  });
  if (result.failed) process.exitCode = 2;
} finally {
  await isolationGuard?.stop();
  sleepGuard?.kill(); unlinkSync(lockPath);
}
