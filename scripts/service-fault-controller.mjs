// Injects the crash-style faults. Timing is the controller's observation: from
// the acknowledged kill or disable until the affected service reports ready.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const scenario = process.env.FAULT_SCENARIO;
const durationSeconds = Number(process.env.FAULT_SECONDS ?? 30);
const appService = process.env.APP_SERVICE;
const appHealthUrl = process.env.APP_HEALTH_URL;
const composeProject = process.env.COMPOSE_PROJECT_NAME;
const baseArguments = ['compose', ...(composeProject ? ['-p', composeProject] : [])];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(...args) {
  const result = spawnSync('docker', [...baseArguments, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status;
}
function mustDocker(...args) {
  if (docker(...args) !== 0) throw new Error(`docker ${args.join(' ')} failed.`);
}
function toxiproxy(action) {
  const result = spawnSync('node', ['scripts/toxiproxy-controller.mjs', action], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`toxiproxy ${action} failed.`);
}
async function httpReady(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}
async function until(ready, label) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await wait(200);
  }
  throw new Error(`${label} did not become ready after the fault.`);
}
const quietDocker = (...args) => spawnSync('docker', [...baseArguments, ...args], { stdio: 'ignore' }).status;

const plans = {
  'app-kill': { service: appService, inject: () => mustDocker('kill', '-s', 'SIGKILL', appService),
    clear: () => mustDocker('start', appService), ready: () => httpReady(appHealthUrl), definition: 'SIGKILL acknowledgement to application health readiness' },
  'postgres-restart': { service: 'postgres', inject: () => mustDocker('kill', '-s', 'SIGKILL', 'postgres'),
    clear: () => mustDocker('start', 'postgres'), ready: () => quietDocker('exec', '-T', 'postgres', 'pg_isready', '-U', 'experiment') === 0,
    definition: 'SIGKILL acknowledgement to pg_isready success after crash recovery' },
  'database-partition': { inject: () => toxiproxy('disable'), clear: () => toxiproxy('enable'), ready: () => true,
    definition: 'proxy disable acknowledgement to proxy enable acknowledgement' },
  'broker-stop': { service: 'redpanda', inject: () => mustDocker('kill', '-s', 'SIGKILL', 'redpanda'),
    clear: () => mustDocker('start', 'redpanda'), ready: () => quietDocker('exec', '-T', 'redpanda', 'rpk', 'cluster', 'health', '--exit-when-healthy') === 0,
    definition: 'SIGKILL acknowledgement to rpk cluster health success' }
};

const plan = plans[scenario];
if (!plan) throw new Error(`Unsupported service fault: ${scenario}`);
if (scenario === 'app-kill' && (!appService || !appHealthUrl)) throw new Error('APP_SERVICE and APP_HEALTH_URL are required.');
const timing = { injectedAt: null, clearedAt: null, timingDefinition: plan.definition, restartedByPolicyDuringFault: false };
const save = () => { if (process.env.FAULT_EVIDENCE_PATH) writeFileSync(process.env.FAULT_EVIDENCE_PATH, JSON.stringify(timing, null, 2)); };

plan.inject();
timing.injectedAt = new Date().toISOString();
save();
await wait(durationSeconds * 1_000);
// A restart policy must not silently shorten the outage, so the evidence says if one did.
if (plan.service) {
  const running = spawnSync('docker', [...baseArguments, 'ps', '--status', 'running', '--services'], { encoding: 'utf8' });
  timing.restartedByPolicyDuringFault = String(running.stdout ?? '').split('\n').includes(plan.service);
}
plan.clear();
await until(plan.ready, plan.service ?? 'proxy');
timing.clearedAt = new Date().toISOString();
save();
process.stdout.write(`${scenario} cleared after ${durationSeconds} s.\n`);
