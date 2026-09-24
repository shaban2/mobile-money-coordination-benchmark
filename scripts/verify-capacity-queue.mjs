// Disposable engineering verification, not a capacity observation or repetition.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assertRestorablePilotContainer } from '../src/experiment/pilot-containers.js';
import { assertDeepDiagnosticEvidence } from '../src/experiment/deep-diagnostic-evidence.js';
const root = 'results-engineering-queue-observation-v2';
if (existsSync(root)) throw new Error('Preserve previous engineering attempts; choose a new reviewed root.');
const approved = JSON.parse(readFileSync('results-capacity-pilot-v5/freeze.json', 'utf8')).pauseContainers;
const run = (program, args, { capture = false, env = {} } = {}) => {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...env } });
  if (result.error || result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout;
};
const inspect = id => JSON.parse(run('docker', ['inspect', id], { capture: true }))[0];
const running = JSON.parse(`[${run('docker', ['ps', '--no-trunc', '--format', '{{json .}}'], { capture: true }).trim().split('\n').filter(Boolean).join(',')}]`);
if (running.some(c => !approved.some(a => a.id === c.ID && a.name === c.Names))) throw new Error('Unapproved competing container; do not stop it.');
for (const c of approved) assertRestorablePilotContainer(inspect(c.id), c);
mkdirSync(root);
const verification = { startedAt: new Date().toISOString(), status: 'RUNNING', engineeringOnly: true };
const save = () => writeFileSync(`${root}/verification.json`, JSON.stringify(verification, null, 2));
save();
const paused = [];
let disposableDatabase;
try {
  for (const c of approved) if (inspect(c.id).State.Running) { paused.push(c); run('docker', ['stop', c.id]); }
  disposableDatabase = run('docker', ['run', '-d', '--rm', '--name', 'lubanga-capacity-queue-dbcheck',
    '--label', 'lubanga.role=disposable-capacity-verification', '--tmpfs', '/var/lib/postgresql/data',
    '-p', '127.0.0.1:25433:5432', '-e', 'POSTGRES_USER=experiment', '-e', 'POSTGRES_PASSWORD=experiment',
    '-e', 'POSTGRES_DB=experiment', 'postgres:17-alpine', 'postgres', '-c', 'track_io_timing=on', '-c', 'track_wal_io_timing=on'], { capture: true }).trim();
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (spawnSync('docker', ['exec', disposableDatabase, 'pg_isready', '-U', 'experiment'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.');
  const databaseTestOutput = run(process.execPath, ['--test', 'test/postgres.integration.test.js', 'test/database-diagnostics.integration.test.js'], {
    capture: true,
    env: { POSTGRES_TEST_URL: 'postgres://experiment:experiment@127.0.0.1:25433/experiment',
      POSTGRES_DIAGNOSTIC_TEST_URL: 'postgres://experiment:experiment@127.0.0.1:25433/experiment' }
  });
  writeFileSync(`${root}/database-tests.log`, databaseTestOutput);
  console.log(databaseTestOutput);
  verification.databaseTestsPassed = true; save();
  run('docker', ['stop', disposableDatabase]); disposableDatabase = null;
  run(process.execPath, ['scripts/run-experiment.mjs', '--execute', '--pilot-spec', 'config/engineering-calibration-smoke.json', '--results', root], {
    env: { COMPOSE_PROJECT_NAME: 'lubanga-capacity-queue-check', POSTGRES_PORT: '25432', APP_CPUS: '2', APP_MEMORY: '1g',
      WARMUP_DURATION: '10s', MEASUREMENT_DURATION: '30s', DRAIN_SECONDS: '60', DEEP_DIAGNOSTICS: 'true', KEEP_SERVICES: 'false' }
  });
  for (const id of ['ENGINEERING-DEEP-R-A', 'ENGINEERING-DEEP-K-A']) {
    const read = name => JSON.parse(readFileSync(`${root}/${id}/${name}`, 'utf8'));
    if (read('qualification.json').status !== 'QUALIFIED' || read('cleanup.json').passed !== true) throw new Error(`Engineering check failed: ${id}`);
    assertDeepDiagnosticEvidence(read('database-diagnostics.json'), readFileSync(`${root}/${id}/docker-stats.jsonl`, 'utf8'));
  }
  console.log('Disposable database and both short engineering checks passed; these are not pilot records.');
  verification.status = 'PASSED';
} catch (error) {
  verification.status = 'FAILED'; verification.error = error.message; throw error;
} finally {
  const errors = [];
  if (disposableDatabase) try { run('docker', ['stop', disposableDatabase]); } catch (error) { errors.push(error.message); }
  for (const c of paused) try {
    assertRestorablePilotContainer(inspect(c.id), c);
    if (!inspect(c.id).State.Running) run('docker', ['start', c.id]);
    if (!inspect(c.id).State.Running) throw new Error('Container did not remain running.');
  } catch (error) { errors.push(`${c.name}: ${error.message}`); }
  verification.restoreErrors = errors; verification.endedAt = new Date().toISOString();
  if (errors.length) verification.status = 'RESTORATION_REVIEW_REQUIRED';
  save();
  if (errors.length) throw new Error(`Verification cleanup/restoration needs attention: ${errors.join('; ')}`);
}
