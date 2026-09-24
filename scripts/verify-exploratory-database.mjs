// Engineering check only. Readiness must use the same host TCP route as tests;
// pg_isready on the container's Unix socket can see its temporary init server.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { sourceSnapshotSha256 } from '../src/experiment/provenance.js';
const root = 'results-engineering-exploratory-followup-v1';
if (existsSync(root)) throw new Error('Preserve prior engineering evidence; no implicit retry/overwrite.');
mkdirSync(root);
const report = { schemaVersion: 1, engineeringOnly: true, sourceSha256: sourceSnapshotSha256(), startedAt: new Date().toISOString(), status: 'RUNNING', readinessAttempts: [] };
const save = () => writeFileSync(`${root}/verification.json`, `${JSON.stringify(report, null, 2)}\n`);
const command = (args, env = {}) => spawnSync(args[0], args.slice(1), { encoding: 'utf8', env: { ...process.env, ...env } });
const checked = (args, env) => { const r = command(args, env); if (r.status !== 0) throw new Error(r.stderr || r.stdout || r.error?.message); return r.stdout; };
const url = 'postgres://experiment:experiment@127.0.0.1:25433/experiment';
let id;
save();
try {
  id = checked(['docker', 'run', '-d', '--rm', '--name', 'lubanga-exploratory-dbcheck', '--label', 'lubanga.role=disposable-exploratory-verification',
    '--tmpfs', '/var/lib/postgresql/data', '-p', '127.0.0.1:25433:5432', '-e', 'POSTGRES_USER=experiment', '-e', 'POSTGRES_PASSWORD=experiment',
    '-e', 'POSTGRES_DB=experiment', 'postgres:17-alpine', 'postgres', '-c', 'track_io_timing=on', '-c', 'track_wal_io_timing=on']).trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Unexpected created database identity.');
  report.containerId = id; save();
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 1000, query_timeout: 1000 });
    client.on('error', () => {});
    try {
      await client.connect();
      await client.query('SELECT 1');
      ready = true; report.readinessAttempts.push({ at: new Date().toISOString(), ready: true });
    } catch (error) { report.readinessAttempts.push({ at: new Date().toISOString(), ready: false, error: error.message }); }
    finally { await client.end().catch(() => {}); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  save();
  if (!ready) throw new Error('PostgreSQL did not accept host TCP SQL queries.');
  writeFileSync(`${root}/database-before-tests.log`, checked(['docker', 'logs', id]));
  const tests = command([process.execPath, '--test', 'test/postgres.integration.test.js', 'test/database-diagnostics.integration.test.js'],
    { POSTGRES_TEST_URL: url, POSTGRES_DIAGNOSTIC_TEST_URL: url });
  writeFileSync(`${root}/database-tests.log`, `${tests.stdout ?? ''}${tests.stderr ?? ''}`);
  console.log(tests.stdout, tests.stderr);
  if (tests.status !== 0) throw new Error('Database tests failed; see retained logs.');
  report.status = 'PASSED';
} catch (error) { report.status = 'FAILED'; report.error = error.message; process.exitCode = 1; }
finally {
  if (id && /^[a-f0-9]{64}$/.test(id)) {
    const logs = command(['docker', 'logs', id]);
    writeFileSync(`${root}/database-final.log`, `${logs.stdout ?? ''}${logs.stderr ?? ''}`);
    const stopped = command(['docker', 'stop', id]);
    report.cleanup = { containerId: id, passed: stopped.status === 0, output: stopped.stdout, error: stopped.stderr };
    if (stopped.status !== 0) { report.status = 'CLEANUP_REVIEW_REQUIRED'; process.exitCode = 1; }
  }
  report.endedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report, null, 2));
}
