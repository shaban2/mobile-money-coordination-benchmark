import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { cpus, freemem, hostname, platform, release, totalmem } from 'node:os';
import path from 'node:path';
import { sourceSnapshotSha256 } from '../src/experiment/provenance.js';
import { assertRunIsolation, composeArguments, resourceServicesFor, stopComposeProject } from '../src/experiment/compose-lifecycle.js';
import { captureCommandToFile, recordControllerFailure, collectFailureDiagnostics } from '../src/experiment/controller-diagnostics.js';
import { assertDeepDiagnosticEvidence } from '../src/experiment/deep-diagnostic-evidence.js';
import { assertCapacityRuleLaunchReady, assertObservationBatchScope } from '../src/experiment/capacity-queue.js';
import { assertExploratoryRootReview } from '../src/experiment/exploratory-review.js';

const arguments_ = process.argv.slice(2);
const execute = arguments_.includes('--execute');
const resume = arguments_.includes('--resume');
const runIdArgument = valueAfter('--run-id');
const blockArgument = valueAfter('--block');
const fromSequence = Number(valueAfter('--from-sequence') ?? 1);
const limit = Number(valueAfter('--limit') ?? (runIdArgument ? 1 : 0));
const pilotSpec = valueAfter('--pilot-spec');
const matrixPath = pilotSpec ?? valueAfter('--matrix') ?? 'config/run-matrix.json';
const frozenCompose = process.env.FROZEN_COMPOSE_OVERRIDE;
const frozenImages = Boolean(frozenCompose);
const resultsRoot = path.resolve(valueAfter('--results') ?? process.env.RESULTS_ROOT ?? 'results');
const composeProject = process.env.COMPOSE_PROJECT_NAME ?? 'lubanga-coordination';
const sustainableRate = Number(process.env.SUSTAINABLE_RATE ?? 0);
const warmupDuration = process.env.WARMUP_DURATION ?? '5m';
const measurementDuration = process.env.MEASUREMENT_DURATION ?? '10m';
const drainSeconds = Number(process.env.DRAIN_SECONDS ?? 600);
const faultAtSeconds = Number(process.env.FAULT_AT_SECONDS ?? 240);
const adapterCrashSeconds = Number(process.env.ADAPTER_CRASH_SECONDS ?? 30);
const databaseFaultSeconds = Number(process.env.DATABASE_FAULT_SECONDS ?? 60);
const databaseLatencyMs = Number(process.env.DATABASE_LATENCY_MS ?? 100);
const keepServices = process.env.KEEP_SERVICES === 'true';
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
if (execute && matrix.capacityRule) assertCapacityRuleLaunchReady(matrix.capacityRule);
const calibration = matrix.kind === 'DIAGNOSTIC_CALIBRATION';
const deepDiagnostics = calibration || process.env.DEEP_DIAGNOSTICS === 'true';
if (deepDiagnostics) {
  process.env.DEEP_DIAGNOSTICS = 'true';
  process.env.DATABASE_DIAGNOSTICS_ENABLED = 'true';
  process.env.POSTGRES_IO_TIMING = 'on';
}
if (execute && existsSync(path.join(resultsRoot, 'DO_NOT_RESUME.json'))) throw new Error('This evidence root is paused/retired. Use a new results root after explicit approval.');

function valueAfter(name) {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : null;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, COMPOSE_PROFILES: '', ...(options.env ?? {}) }
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.acceptFailure) {
    throw new Error(`${program} ${args.join(' ')} exited with ${result.status}: ${String(result.stderr ?? '').trim()}`);
  }
  return options.capture && result.status === 0 ? String(result.stdout ?? '') : '';
}

function capture(program, args) {
  return command(program, args, { capture: true, acceptFailure: true }).trim() || null;
}

function runProcess(program, args, { env = {}, logFile, acceptExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const output = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
    const child = spawn(program, args, {
      env: { ...process.env, COMPOSE_PROFILES: '', ...env },
      stdio: output ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    if (output) {
      child.stdout.pipe(output);
      child.stderr.pipe(output);
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      output?.end();
      acceptExitCodes.includes(code) ? resolve({ code, signal }) : reject(new Error(`${program} exited with ${code ?? signal}.`));
    });
  });
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url, options = {}, accepted = [200]) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!accepted.includes(response.status)) {
    throw new Error(`${options.method ?? 'GET'} ${url} returned ${response.status}: ${text}`);
  }
  return body;
}

function validateMatrix() {
  if (pilotSpec) {
    if (matrix.schemaVersion !== 1 || !['CAPACITY_PILOT', 'DIAGNOSTIC_CALIBRATION'].includes(matrix.kind) || !matrix.runs?.length
      || matrix.expectedRunCount !== matrix.runs.length || matrix.runs.some((r) => r.block !== (calibration ? 'CALIBRATION' : 'PILOT') || !(r.offeredRate > 0))) throw new Error('Invalid absolute-rate pilot specification.');
    if (matrix.capacityRule) {
      const protocol = assertObservationBatchScope(matrix, { warmupDuration, measurementDuration, drainSeconds,
        faultAtSeconds, adapterCrashSeconds, databaseFaultSeconds, databaseLatencyMs }, deepDiagnostics);
      if (execute && protocol.exploratoryPair) assertExploratoryRootReview(resultsRoot, protocol,
        JSON.parse(readFileSync(path.join(resultsRoot, 'freeze.json'), 'utf8')));
    }
    if (calibration && (matrix.runs.length !== 4 || matrix.runs.some(r => r.phase !== 'calibration' || r.offeredRate !== 4 || r.faultScenario !== 'none')
      || ['R-A', 'K-A'].some(c => matrix.runs.filter(r => r.conditionId === c).length !== 2)
      || warmupDuration !== '5m' || measurementDuration !== '10m' || drainSeconds !== 600)) throw new Error('Calibration scope or timing changed.');
  } else if (matrix.schemaVersion !== 2 || matrix.expectedRunCount !== 96 || matrix.runs?.length !== 96) {
    throw new Error('The coordination-only matrix must use schema version 2 and contain exactly 96 runs.');
  }
  for (const run of matrix.runs) {
    resourceServicesFor(run);
    if (!['R-A', 'K-A'].includes(run.conditionId) || !['rest-async', 'kafka-async'].includes(run.composeProfile)) {
      throw new Error(`Run ${run.runId} is not an approved asynchronous coordination condition.`);
    }
    if ((run.conditionId === 'R-A') !== (run.composeProfile === 'rest-async')) throw new Error('Condition/profile mismatch.');
    if (run.networkProfile !== 'standard') {
      throw new Error(`Run ${run.runId} varies the client network, which is outside this study.`);
    }
  }
}

async function waitForGateway(run) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await fetchJson(`http://127.0.0.1:${run.gatewayPort}/health`);
      if (health?.status !== 'UP') throw new Error('API health response was not UP.');
      const config = await fetchJson(`http://127.0.0.1:${run.apiPort}/config`);
      const expectedCoordination = run.conditionId === 'R-A' ? 'rest' : 'kafka';
      if (config?.clientMode !== 'async' || config?.coordinationMode !== expectedCoordination) {
        throw new Error(`Runtime configuration does not match ${run.conditionId}.`);
      }
      if (config.diagnosticsEnabled !== true) throw new Error('Diagnostic instrumentation is not enabled in the selected image.');
      if (deepDiagnostics && config.databaseDiagnosticsEnabled !== true) throw new Error('Database diagnostics are not enabled.');
      const callback = await fetchJson(`http://127.0.0.1:${run.gatewayPort}/deliveries`);
      if (!Array.isArray(callback?.deliveries)) throw new Error('Callback receiver was not ready.');
      return;
    } catch (error) {
      lastError = error;
      await wait(1_000);
    }
  }
  throw lastError;
}

function compose(...args) {
  return composeArguments(composeProject, frozenCompose, ...args);
}

function k6Arguments(run, rate, duration, phase) {
  const gatewayService = `gateway-${run.composeProfile}`;
  const containerResultDirectory = `/results/${run.runId}`;
  return compose(
    'run', '--rm', '-T',
    '-v', `${resultsRoot}:/results`,
    '-e', `BASE_URL=http://${gatewayService}:8070`,
    '-e', `OFFERED_RATE=${rate}`,
    '-e', `DURATION=${duration}`,
    '-e', `RUN_ID=${process.env.EVENT_NAMESPACE}-${phase}`,
    '-e', `RANDOM_SEED=${run.randomSeed}`,
    '-e', `CALLBACK_URL=http://${gatewayService}:8070/callbacks/transfers`,
    'k6', 'run',
    `--summary-export=${containerResultDirectory}/${phase}-summary.json`,
    ...(phase === 'measurement'
      ? ['--out', `json=${containerResultDirectory}/measurement-metrics.json`]
      : []),
    '/scripts/load.js'
  );
}

function durationSeconds(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) return Number.NaN;
  const multipliers = { ms: 0.001, s: 1, m: 60, h: 3600 };
  return Number(match[1]) * multipliers[match[2]];
}

function manifestFor(run, rate) {
  const imageLines = capture('docker', compose('images', '--format', 'json'))?.split('\n').filter(Boolean) ?? [];
  return {
    schemaVersion: 5,
    composeProject,
    pilotSessionId: process.env.PILOT_SESSION_ID ?? null,
    createdAt: new Date().toISOString(),
    study: {
      factor: 'coordination architecture',
      comparedLevels: ['REST orchestration', 'Kafka choreography'],
      fixedClientMode: 'async',
      fixedNetworkProfile: 'standard',
      stage: calibration ? 'CALIBRATION_ONLY_NOT_CAPACITY_EVIDENCE' : pilotSpec ? 'PILOT_ONLY' : 'CONFIRMATORY_CANDIDATE',
      plannedMeasuredRuns: pilotSpec ? matrix.expectedRunCount : 96,
      pilotProtocolId: pilotSpec ? matrix.protocolId : null,
      ...(matrix.capacityRule ? { capacityRule: matrix.capacityRule } : {})
    },
    run: { ...run, sustainableRate, offeredRate: rate },
    workloadNamespace: process.env.EVENT_NAMESPACE,
    resourceServices: resourceServicesFor(run),
    diagnostics: { schemaVersion: 1, enabled: true, slowMs: 10, maxSpans: 20000,
      intervalMs: 1000, eventLoopResolutionMs: 10, maxSamples: 4096,
      role: 'supplemental diagnostic timing; not a scientific endpoint or threshold' },
    deepDiagnostics: { enabled: deepDiagnostics, databaseIntervalMs: 250, cumulativeCounterIntervalMs: 1000,
      databaseObserverConnections: 1, databaseMaxSamples: 8192, linuxCapture: 'each docker-stats cycle, actual timestamps and collection cost recorded',
      scope: 'PostgreSQL plus Linux VM kernel and application-container cgroup, not macOS per-process pressure',
      limitation: 'Sampling can miss brief waits; observer adds overhead; cumulative statistics can lag. No causal attribution or capacity threshold.' },
    lifecycle: {
      warmupDuration,
      measurementDuration,
      drainSeconds,
      faultAtSeconds,
      adapterCrashSeconds,
      databaseFaultSeconds,
      databaseLatencyMs
    },
    checksums: {
      sourceSnapshotSha256: sourceSnapshotSha256(),
      matrixSha256: sha256(matrixPath),
      composeSha256: sha256('compose.yaml'),
      packageLockSha256: sha256('package-lock.json')
      ,...(frozenCompose ? { frozenComposeSha256: sha256(frozenCompose) } : {})
    },
    sourceRevision: capture('git', ['rev-parse', 'HEAD']),
    dirtyFiles: capture('git', ['status', '--short'])?.split('\n').filter(Boolean) ?? [],
    host: {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      cpuModel: cpus()[0]?.model ?? null,
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytesAtCapture: freemem()
    },
    clock: {
      latency: 'API ingress to COMMIT acknowledgement on application clock',
      workload: 'k6 scenario.startTime on shared Docker host',
      wallClockUtc: new Date().toISOString(),
      monotonicNanoseconds: process.hrtime.bigint().toString()
    },
    tools: {
      node: process.version,
      npm: capture('npm', ['--version']),
      docker: capture('docker', ['--version']),
      compose: capture('docker', ['compose', 'version']),
      k6Image: 'grafana/k6:1.8.0'
    },
    containerImages: imageLines.map((line) => {
      try { return JSON.parse(line); } catch { return line; }
    })
  };
}

function updateRunState(resultDirectory, status, details = {}) {
  const file = path.join(resultDirectory, 'controller-state.json');
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { events: [] };
  const event = { status, occurredAt: new Date().toISOString(), ...details };
  writeJson(file, { currentStatus: status, events: [...previous.events, event] });
  return event;
}

async function captureRuntimeDiagnostics(apiBase, resultDirectory, failure = false) {
  const snapshot = await fetchJson(`${apiBase}/admin/diagnostics`, { signal: AbortSignal.timeout(10_000) });
  const name = failure ? 'diagnostics-at-failure.json' : 'diagnostics.json';
  writeFileSync(path.join(resultDirectory, name), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  if (!failure && (snapshot.schemaVersion !== 1 || !snapshot.enabled || snapshot.recordingErrors
    || !snapshot.runtimeSamples?.length || !snapshot.aggregates?.['provider.execute']?.count)) {
    throw new Error('Diagnostic capture is missing or unhealthy; review before the next run.');
  }
}

async function captureDatabaseDiagnostics(apiBase, resultDirectory, failure = false) {
  if (!deepDiagnostics) return;
  const snapshot = await fetchJson(`${apiBase}/admin/database-diagnostics`, { signal: AbortSignal.timeout(10_000) });
  writeFileSync(path.join(resultDirectory, failure ? 'database-diagnostics-at-failure.json' : 'database-diagnostics.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  if (!failure) assertDeepDiagnosticEvidence(snapshot, readFileSync(path.join(resultDirectory, 'docker-stats.jsonl'), 'utf8'));
}

function startStatsCollector(resultDirectory) {
  const file = path.join(resultDirectory, 'docker-stats.jsonl');
  const log = createWriteStream(path.join(resultDirectory, 'docker-stats-collector.log'), { flags: 'a' });
  const child = spawn(process.execPath, ['scripts/collect-docker-stats.mjs', file], {
    env: { ...process.env, COMPOSE_PROJECT_NAME: composeProject },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      log.end();
      if ([0, null].includes(code) || signal === 'SIGTERM') resolve();
      else reject(new Error(`Docker stats collector exited with ${code ?? signal}.`));
    });
  });
  return {
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await completion;
    }
  };
}

function scheduleFault(run, resultDirectory, measurementStartedAt) {
  if (run.faultScenario === 'none') return { promise: Promise.resolve(null), cancel() {} };
  let timer;
  let resolveCancellation;
  let cancelled = false;
  let started = false;
  const promise = new Promise((resolve, reject) => {
    resolveCancellation = resolve;
    timer = setTimeout(() => {
      started = true;
      applyFault(run, resultDirectory).then(resolve, reject);
    }, Math.max(0, Date.parse(measurementStartedAt) + faultAtSeconds * 1000 - Date.now()));
  });
  return {
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (started) return;
      clearTimeout(timer);
      resolveCancellation(null);
    }
  };
}

async function waitForMeasurementClock(resultDirectory) {
  const file = path.join(resultDirectory, 'measurement-metrics.json');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
      let point;
      try { point = JSON.parse(line); } catch { continue; }
      if (point.type === 'Point' && point.metric === 'measurement_started_at') return new Date(point.data.value).toISOString();
    }
    await wait(200);
  }
  throw new Error('k6 did not publish its measurement clock marker.');
}

async function applyFault(run, resultDirectory) {
  const faultLog = path.join(resultDirectory, 'fault.log');
  const evidence = {
    scenario: run.faultScenario,
    scheduledAtMeasurementSecond: faultAtSeconds,
    requestedAt: new Date().toISOString(),
    injectedAt: null,
    clearedAt: null,
    completed: false
  };
  writeJson(path.join(resultDirectory, 'fault-evidence.json'), evidence);
  if (run.faultScenario === 'adapter-crash') {
    await runProcess('node', ['scripts/adapter-crash-controller.mjs'], {
      env: { COMPOSE_PROJECT_NAME: composeProject, ADAPTER_CRASH_SECONDS: String(adapterCrashSeconds), FAULT_EVIDENCE_PATH: path.join(resultDirectory, 'adapter-fault-timing.json') },
      logFile: faultLog
    });
    Object.assign(evidence, JSON.parse(readFileSync(path.join(resultDirectory, 'adapter-fault-timing.json'), 'utf8')));
  } else if (run.faultScenario === 'database-delay') {
    await runProcess('node', ['scripts/toxiproxy-controller.mjs', 'add-latency'], {
      env: { DATABASE_LATENCY_MS: String(databaseLatencyMs) },
      logFile: faultLog
    });
    evidence.injectedAt = new Date().toISOString();
    evidence.timingDefinition = 'controller observation of toxic-add and toxic-remove command acknowledgements';
    writeJson(path.join(resultDirectory, 'fault-evidence.json'), evidence);
    await wait(databaseFaultSeconds * 1_000);
    await runProcess('node', ['scripts/toxiproxy-controller.mjs', 'clear-latency'], { logFile: faultLog });
  } else {
    throw new Error(`Unsupported fault scenario: ${run.faultScenario}`);
  }
  evidence.clearedAt ??= new Date().toISOString();
  evidence.completed = true;
  writeJson(path.join(resultDirectory, 'fault-evidence.json'), evidence);
  return evidence;
}

async function drain(apiBase) {
  const deadline = Date.now() + drainSeconds * 1_000;
  let telemetry;
  do {
    telemetry = await fetchJson(`${apiBase}/admin/telemetry`);
    if (Number(telemetry.transfers_pending) === 0 && Number(telemetry.outbox_pending) === 0 && Number(telemetry.application_background_tasks) === 0) return telemetry;
    await wait(1_000);
  } while (Date.now() < deadline);
  return telemetry;
}

function appendRunIndex(record) {
  mkdirSync(resultsRoot, { recursive: true });
  appendFileSync(path.join(resultsRoot, 'run-index.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
}

async function runOne(run) {
  const resultDirectory = path.join(resultsRoot, run.runId);
  if (existsSync(resultDirectory) && readdirSync(resultDirectory).length > 0) {
    throw new Error(`Refusing to overwrite existing evidence in ${resultDirectory}. Use --resume to skip terminal runs or select a new RESULTS_ROOT.`);
  }
  mkdirSync(resultDirectory, { recursive: true });
  updateRunState(resultDirectory, 'STAGING');
  const apiBase = `http://127.0.0.1:${run.apiPort}`;
  const rate = pilotSpec ? run.offeredRate : Math.max(1, Math.round(sustainableRate * run.offeredLoadPercent / 100));
  let databaseRunId = null;
  let servicesStarted = false;
  const isolation = { snapshots: [] };
  const verifyIsolation = (phase) => {
    const { inspected, ...snapshot } = assertRunIsolation(command, composeProject, run);
    isolation.snapshots.push({ phase, ...snapshot });
    writeJson(path.join(resultDirectory, 'isolation.json'), isolation);
    return inspected;
  };

  try {
    process.env.EVENT_NAMESPACE = `${run.runId.toLowerCase()}-${Date.now()}`;
    // --execute already resets this dedicated project's trial data. Do it
    // before starting recovery workers, especially after a failed trial.
    const cleanStart = stopComposeProject({ command, project: composeProject, override: frozenCompose });
    writeJson(path.join(resultDirectory, 'clean-start.json'), cleanStart);
    servicesStarted = true;
    command('docker', compose('--profile', run.composeProfile, 'up', '-d', ...(frozenImages ? ['--no-build', '--pull', 'never'] : ['--build']), 'postgres', 'toxiproxy', 'toxiproxy-init'));
    command('docker', compose('wait', 'toxiproxy-init'));
    command('node', ['scripts/toxiproxy-controller.mjs', 'clear-latency']);
    command('docker', compose('run', ...(frozenImages ? [] : ['--build']), '--rm', '-T', '--no-deps', '-e', 'EXPERIMENT_RESET=confirmed', run.composeProfile, 'node', 'scripts/reset-experiment-database.mjs'));
    command('docker', compose('--profile', run.composeProfile, '--profile', 'observability', 'up', '-d', ...(frozenImages ? ['--no-build', '--pull', 'never'] : ['--build'])));
    await waitForGateway(run);
    const inspected = verifyIsolation('before-warmup');
    command('node', ['scripts/network-profile-controller.mjs', run.networkProfile, run.conditionId], {
      env: { COMPOSE_PROJECT_NAME: composeProject }
    });

    await fetchJson(`${apiBase}/admin/reset`, { method: 'POST', body: '{}' });
    await fetchJson('http://127.0.0.1:8090/reset', { method: 'POST', body: '{}' }, [204]);
    writeJson(path.join(resultDirectory, 'manifest.json'), manifestFor(run, rate));
    const activeProfiles = ['--profile', run.composeProfile, '--profile', 'observability'];
    writeFileSync(path.join(resultDirectory, 'resolved-compose.yaml'), command('docker', compose(...activeProfiles, 'config'), { capture: true }));
    writeJson(path.join(resultDirectory, 'resolved-compose.json'), JSON.parse(command('docker', compose(...activeProfiles, 'config', '--format', 'json'), { capture: true })));
    writeJson(path.join(resultDirectory, 'container-inspect.json'), inspected);

    updateRunState(resultDirectory, 'WARMUP');
    await runProcess('docker', k6Arguments(run, rate, warmupDuration, 'warmup'), {
      logFile: path.join(resultDirectory, 'warmup.log'), acceptExitCodes: [0, 99]
    });
    const warmupDrain = await drain(apiBase);
    if (Number(warmupDrain.transfers_pending) || Number(warmupDrain.application_background_tasks) || Number(warmupDrain.outbox_pending)) throw new Error('Warm-up did not drain; refusing to reset live workflows.');
    verifyIsolation('before-measurement');
    await fetchJson(`${apiBase}/admin/reset`, { method: 'POST', body: '{}' });
    await fetchJson('http://127.0.0.1:8090/reset', { method: 'POST', body: '{}' }, [204]);

    const registered = await fetchJson(`${apiBase}/admin/experiment-runs`, {
      method: 'POST',
      body: JSON.stringify({
        offeredLoad: rate,
        networkProfile: run.networkProfile,
        faultScenario: run.faultScenario,
        randomSeed: run.randomSeed,
        configuration: run,
        manifest: JSON.parse(readFileSync(path.join(resultDirectory, 'manifest.json'), 'utf8'))
      })
    }, [201]);
    databaseRunId = registered.experiment_run_id;
    writeJson(path.join(resultDirectory, 'registered-run.json'), registered);

    updateRunState(resultDirectory, 'STARTING_LOAD', { offeredRate: rate });
    const statsCollector = startStatsCollector(resultDirectory);
    let scheduledFault = { promise: Promise.resolve(), cancel() {} };
    try {
      const load = runProcess('docker', k6Arguments(run, rate, measurementDuration, 'measurement'), {
        logFile: path.join(resultDirectory, 'measurement.log'), acceptExitCodes: [0, 99]
      });
      load.catch(() => {});
      const measurementStartedAt = await waitForMeasurementClock(resultDirectory);
      updateRunState(resultDirectory, 'MEASUREMENT', { measurementStartedAt });
      scheduledFault = scheduleFault(run, resultDirectory, measurementStartedAt);
      const loadExit = await load;
      writeJson(path.join(resultDirectory, 'load-exit.json'), loadExit);
      await scheduledFault.promise;
    } catch (error) {
      scheduledFault.cancel();
      await scheduledFault.promise.catch(() => {});
      throw error;
    } finally {
      await statsCollector.stop();
    }

    updateRunState(resultDirectory, 'DRAINING');
    await drain(apiBase);
    updateRunState(resultDirectory, 'OBSERVATION_ENDED');
    verifyIsolation('after-observation');
    await captureRuntimeDiagnostics(apiBase, resultDirectory);
    await captureDatabaseDiagnostics(apiBase, resultDirectory);
    const providerAttempts = await fetchJson(`${apiBase}/admin/provider-attempts`);
    writeJson(path.join(resultDirectory, 'provider-attempt-timings.json'), { attempts: providerAttempts.attempts.map((a) => ({
      transferId: a.transfer_id, attemptNumber: a.attempt_number, providerProfile: a.provider_profile,
      startedAt: a.started_at, completedAt: a.completed_at, outcome: a.outcome, failureCode: a.failure_code
    })) });
    const invariants = await fetchJson(`${apiBase}/admin/invariants?experimentRunId=${encodeURIComponent(databaseRunId)}`);
    const telemetry = await fetchJson(`${apiBase}/admin/telemetry`);
    const traces = await fetchJson(`${apiBase}/admin/traces`);
    const callbacks = await fetchJson('http://127.0.0.1:8090/deliveries');
    const transfers = await fetchJson(`${apiBase}/admin/transfers`);
    writeJson(path.join(resultDirectory, 'transfers.json'), transfers);
    writeJson(path.join(resultDirectory, 'invariants.json'), invariants);
    writeJson(path.join(resultDirectory, 'telemetry.json'), telemetry);
    writeJson(path.join(resultDirectory, 'traces.json'), traces);
    writeJson(path.join(resultDirectory, 'callbacks.json'), callbacks);
    command('node', ['scripts/extract-client-evidence.mjs', resultDirectory]);
    command('node', ['scripts/derive-run-outcomes.mjs', resultDirectory]);
    captureCommandToFile('docker', compose('--profile', '*', 'logs', '--no-color'),
      path.join(resultDirectory, 'compose.log'), { env: { ...process.env, COMPOSE_PROFILES: '' } });

    updateRunState(resultDirectory, 'QUALIFYING');
    writeJson(path.join(resultDirectory, 'end-checksums.json'), {
      sourceSnapshotSha256: sourceSnapshotSha256(), matrixSha256: sha256(matrixPath),
      composeSha256: sha256('compose.yaml'), packageLockSha256: sha256('package-lock.json'),
      ...(frozenCompose ? { frozenComposeSha256: sha256(frozenCompose) } : {})
    });
    command('node', ['scripts/qualify-run.mjs', resultDirectory], { acceptFailure: true });
    const qualification = JSON.parse(readFileSync(path.join(resultDirectory, 'qualification.json'), 'utf8'));
    await fetchJson(`${apiBase}/admin/experiment-runs/${databaseRunId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: qualification.qualified ? 'QUALIFIED' : 'EXCLUDED',
        exclusionReason: qualification.qualified ? null : JSON.stringify(qualification.gates)
      })
    });
    updateRunState(resultDirectory, qualification.status);
    appendRunIndex({
      runId: run.runId,
      sequence: run.sequence,
      status: qualification.status,
      recordedAt: new Date().toISOString(),
      gates: qualification.gates
    });
    return qualification.qualified;
  } catch (error) {
    recordControllerFailure(resultDirectory, error, servicesStarted ? {
      composeLogs: () => captureCommandToFile('docker', compose('--profile', '*', 'logs', '--no-color'),
        path.join(resultDirectory, existsSync(path.join(resultDirectory, 'compose.log')) ? 'compose-failure.log' : 'compose.log'),
        { env: { ...process.env, COMPOSE_PROFILES: '' } }),
      containerState: () => writeFileSync(path.join(resultDirectory, 'container-state-at-failure.json'),
        command('docker', compose('ps', '-a', '--format', 'json'), { capture: true }), { flag: 'wx' })
    } : {});
    if (servicesStarted) await collectFailureDiagnostics(resultDirectory, {
      runtimeDiagnostics: () => captureRuntimeDiagnostics(apiBase, resultDirectory, true),
      databaseDiagnostics: () => captureDatabaseDiagnostics(apiBase, resultDirectory, true)
    });
    updateRunState(resultDirectory, 'FAILED', { message: error.message });
    appendRunIndex({ runId: run.runId, sequence: run.sequence, status: 'FAILED', recordedAt: new Date().toISOString(), error: error.message });
    if (databaseRunId) {
      await fetchJson(`${apiBase}/admin/experiment-runs/${databaseRunId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'FAILED', exclusionReason: error.message })
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (servicesStarted) {
      command('node', ['scripts/network-profile-controller.mjs', 'clear', run.conditionId], {
        env: { COMPOSE_PROJECT_NAME: composeProject },
        acceptFailure: true
      });
      command('node', ['scripts/toxiproxy-controller.mjs', 'clear-latency'], { acceptFailure: true });
      if (!keepServices) {
        try {
          writeJson(path.join(resultDirectory, 'cleanup.json'), stopComposeProject({ command, project: composeProject, override: frozenCompose }));
        } catch (error) {
          writeJson(path.join(resultDirectory, 'cleanup.json'), { passed: false, checkedAt: new Date().toISOString(), message: error.message });
          recordControllerFailure(resultDirectory, new Error(`Cleanup failed: ${error.message}`, { cause: error }));
          updateRunState(resultDirectory, 'FAILED', { message: `Cleanup failed: ${error.message}` });
          appendRunIndex({ runId: run.runId, sequence: run.sequence, status: 'FAILED', recordedAt: new Date().toISOString(), error: error.message });
          throw error; // Never start the next trial after an unverified teardown.
        }
      } else writeJson(path.join(resultDirectory, 'cleanup.json'), { passed: false, retainedForDebugging: true });
    }
  }
}

function terminalEvidenceExists(run) {
  const directory = path.join(resultsRoot, run.runId);
  return existsSync(path.join(directory, 'qualification.json')) && !existsSync(path.join(directory, 'controller-error.json'));
}

validateMatrix();
let selected = matrix.runs.filter(({ sequence }) => sequence >= fromSequence);
if (runIdArgument) selected = selected.filter(({ runId }) => runId === runIdArgument);
if (blockArgument) selected = selected.filter(({ block }) => block === blockArgument.toUpperCase());
if (resume) selected = selected.filter((run) => !terminalEvidenceExists(run));
if (limit > 0) selected = selected.slice(0, limit);
if (selected.length === 0) {
  process.stdout.write('No pending runs matched the selection.\n');
  process.exit(0);
}

if (!execute) {
  process.stdout.write(`${JSON.stringify({
    mode: 'dry-run',
    matrixPath,
    resultsRoot,
    resume,
    selectedRuns: selected.length,
    countsByBlock: Object.fromEntries(['LOAD', 'FAULT'].map((block) => [block, selected.filter((run) => run.block === block).length])),
    warmupDuration,
    measurementDuration,
    drainSeconds,
    faultAtSeconds,
    runs: selected
  }, null, 2)}\n`);
  process.exit(0);
}
if (!pilotSpec && !(sustainableRate > 0)) {
  throw new Error('SUSTAINABLE_RATE must be a positive pilot-estimated shared rate when --execute is used.');
}
if (selected.some(({ faultScenario }) => faultScenario !== 'none')
  && !(durationSeconds(measurementDuration) > faultAtSeconds + Math.max(adapterCrashSeconds, databaseFaultSeconds))) {
  throw new Error('MEASUREMENT_DURATION must extend beyond fault injection and fault clearance.');
}

mkdirSync(resultsRoot, { recursive: true });
const invocation = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  matrixPath: path.resolve(matrixPath),
  matrixSha256: sha256(matrixPath),
  sourceSnapshotSha256: sourceSnapshotSha256(),
  sustainableRate,
  selectedRunIds: selected.map(({ runId }) => runId),
  lifecycle: { warmupDuration, measurementDuration, drainSeconds, faultAtSeconds },
  composeProject
};
writeJson(path.join(resultsRoot, `controller-invocation-${Date.now()}.json`), invocation);

let qualified = 0;
for (const run of selected) {
  process.stdout.write(`Starting ${run.sequence}/${matrix.expectedRunCount} ${run.runId}.\n`);
  if (await runOne(run)) qualified += 1;
}
command('node', ['scripts/summarize-experiment.mjs', resultsRoot], { acceptFailure: true });
process.stdout.write(`Completed ${selected.length} runs; ${qualified} qualified.\n`);
process.exitCode = qualified === selected.length ? 0 : 2;
