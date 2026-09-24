// Engineering only: short traffic checks never become calibration records.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assertRestorablePilotContainer } from '../src/experiment/pilot-containers.js';
const approved = JSON.parse(readFileSync('results-capacity-pilot-v5/freeze.json', 'utf8')).pauseContainers;
const run = (program, args, env = {}) => {
  const r = spawnSync(program, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.error || r.status !== 0) throw new Error(`${program} failed (${r.status}): ${r.error?.message ?? ''}`);
};
const inspect = id => {
  const r = spawnSync('docker', ['inspect', id], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Cannot inspect approved container');
  return JSON.parse(r.stdout)[0];
};
const paused = [];
try {
  for (const c of approved) assertRestorablePilotContainer(inspect(c.id), c);
  for (const c of approved) if (inspect(c.id).State.Running) { paused.push(c); run('docker', ['stop', c.id]); }
  run(process.execPath, ['scripts/run-experiment.mjs', '--execute', '--pilot-spec', 'config/engineering-calibration-smoke.json', '--results', 'results-engineering-calibration-v1'], {
    COMPOSE_PROJECT_NAME: 'lubanga-coordination-calibration-check', POSTGRES_PORT: '25432',
    APP_CPUS: '2', APP_MEMORY: '1g', WARMUP_DURATION: '10s', MEASUREMENT_DURATION: '30s', DRAIN_SECONDS: '60', DEEP_DIAGNOSTICS: 'true', KEEP_SERVICES: 'false'
  });
} finally {
  const errors = [];
  for (const c of paused) try {
    assertRestorablePilotContainer(inspect(c.id), c);
    if (!inspect(c.id).State.Running) run('docker', ['start', c.id]);
    if (!inspect(c.id).State.Running) throw new Error('Container did not remain running');
  } catch (e) { errors.push(`${c.name}: ${e.message}`); }
  if (errors.length) throw new Error(`the external stack restoration needs attention: ${errors.join('; ')}`);
}
