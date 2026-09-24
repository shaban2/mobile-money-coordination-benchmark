import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { DatabaseDiagnostics, databaseDiagnosticQuery } from '../src/infrastructure/postgres/database-diagnostics.js';
import { linuxDiagnosticFiles, parseLinuxDiagnostics } from '../src/experiment/linux-resource-sampler.js';
import { assertDeepDiagnosticEvidence } from '../src/experiment/deep-diagnostic-evidence.js';
const settings = { version: '170000', track_io_timing: 'on', track_wal_io_timing: 'on', track_activities: 'on' };
const row = { database_time: '2026-09-20T00:00:00Z', observed_backends: 1, activity: [{ pid: 42, wait_event: 'WalSync' }], counters: { wal: {}, checkpointer: {}, io: [] } };
function mockPool() {
  const pool = new EventEmitter(); pool.calls = [];
  pool.query = async (...args) => { pool.calls.push(args); return { rows: [args[0] === databaseDiagnosticQuery ? structuredClone(row) : structuredClone(settings)] }; };
  pool.end = async () => { pool.ended = true; }; return pool;
}
test('database diagnostics are opt-in, bounded, resettable, stop cleanly, and do not export SQL', async () => {
  const off = new DatabaseDiagnostics(); await off.start(); await off.stop(); assert.equal(off.snapshot().enabled, false);
  const pool = mockPool(), d = new DatabaseDiagnostics({ enabled: true, pool, maxSamples: 2 });
  await d.start(); await d.sample(); await d.sample();
  assert.equal(d.snapshot().samples.length, 2); assert.equal(d.snapshot().overwrittenSamples, 1);
  assert.equal(pool.calls[1][1][0], true); assert.equal(pool.calls[2][1][0], false);
  assert.ok(!JSON.stringify(d.snapshot()).includes('SELECT'));
  d.reset(); assert.equal(d.snapshot().samples.length, 0); assert.equal(d.snapshot().overwrittenSamples, 0);
  await d.sample(); assert.equal(pool.calls.at(-1)[1][0], true);
  await d.stop(); assert.equal(pool.ended, true);
});
test('database query overlap is skipped and pre-reset completions are discarded', async () => {
  const pool = mockPool(), d = new DatabaseDiagnostics({ enabled: true, pool }); let resolve;
  pool.query = () => new Promise(r => { resolve = r; });
  const running = d.sample(); await d.sample(); assert.equal(d.snapshot().skippedTicks, 1);
  d.reset(); resolve({ rows: [row] }); await running; assert.equal(d.snapshot().samples.length, 0);
  pool.query = async () => { throw new Error('secret SQL text'); }; await d.sample();
  assert.equal(d.snapshot().recordingErrors, 1); assert.ok(!JSON.stringify(d.snapshot()).includes('secret'));
  await d.stop();
});
test('database settings fail closed if I/O timing is unavailable', async () => {
  const pool = mockPool(); pool.query = async () => ({ rows: [{ ...settings, track_io_timing: 'off' }] });
  const d = new DatabaseDiagnostics({ enabled: true, pool }); await assert.rejects(d.start(), /timing enabled/);
  assert.equal(pool.ended, true);
});
test('Linux snapshots disclose unavailable files and evidence gates reject missing data', () => {
  const output = linuxDiagnosticFiles.map(f => `\n@@${f}\n${f.includes('pressure') ? 'UNAVAILABLE' : 'cpu 1 2 3'}\n`).join('');
  const linux = parseLinuxDiagnostics(output); assert.equal(linux.valid, true); assert.equal(linux.unavailable.length, 6);
  assert.equal(parseLinuxDiagnostics('').valid, false);
  const s = { schemaVersion: 1, enabled: true, recordingErrors: 0, overwrittenSamples: 0, truncatedActivitySamples: 0, settings, samples: [row, row] };
  const lines = [1, 2].map(() => JSON.stringify({ linuxDiagnostics: linux })).join('\n');
  assert.equal(assertDeepDiagnosticEvidence(s, lines), true);
  for (const change of [{ samples: [] }, { recordingErrors: 1 }, { overwrittenSamples: 1 }, { settings: {} }]) assert.throws(() => assertDeepDiagnosticEvidence({ ...s, ...change }, lines));
  assert.throws(() => assertDeepDiagnosticEvidence(s, '{}\n{}'));
});
