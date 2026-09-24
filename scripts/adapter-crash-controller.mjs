import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const durationSeconds = Number(process.env.ADAPTER_CRASH_SECONDS ?? 30);
const composeProject = process.env.COMPOSE_PROJECT_NAME;
const baseArguments = ['compose'];
if (composeProject) baseArguments.push('-p', composeProject);

function docker(...arguments_) {
  const result = spawnSync('docker', [...baseArguments, ...arguments_], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`docker ${arguments_.join(' ')} failed.`);
}

docker('stop', 'adapter-service');
const timing = { injectedAt: new Date().toISOString(), clearedAt: null,
  timingDefinition: 'controller observation of container-stop acknowledgement to adapter health readiness' };
const save = () => { if (process.env.FAULT_EVIDENCE_PATH) writeFileSync(process.env.FAULT_EVIDENCE_PATH, JSON.stringify(timing, null, 2)); };
save();
process.stdout.write(`Common adapter service stopped for ${durationSeconds} seconds.\n`);
await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1_000));
docker('start', 'adapter-service');
const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try { ready = (await fetch(process.env.ADAPTER_HEALTH_URL ?? 'http://127.0.0.1:8095/health', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!ready) throw new Error('Adapter did not become healthy after restart.');
timing.clearedAt = new Date().toISOString();
save();
process.stdout.write('Common adapter service restarted.\n');
