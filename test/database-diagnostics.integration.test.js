import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { DatabaseDiagnostics } from '../src/infrastructure/postgres/database-diagnostics.js';
const url = process.env.POSTGRES_DIAGNOSTIC_TEST_URL;
test('real PostgreSQL exposes waits, WAL/checkpoint/IO counters and a read-only observer', { skip: !url }, async () => {
  const observer = new DatabaseDiagnostics({ enabled: true, connectionString: url });
  const pool = new pg.Pool({ connectionString: url });
  try {
    await observer.start();
    const readOnly = await observer.pool.query('SHOW default_transaction_read_only');
    assert.equal(readOnly.rows[0].default_transaction_read_only, 'on');
    const client = await pool.connect();
    try {
      const sleeping = client.query('SELECT pg_sleep(1.2)');
      await new Promise(r => setTimeout(r, 400)); await observer.sample(); await sleeping;
    } finally { client.release(); }
    await observer.sample();
    const s = observer.snapshot(); assert.equal(s.recordingErrors, 0);
    assert.ok(s.samples.some(x => x.activity.some(a => a.wait_event === 'PgSleep')));
    assert.ok(s.samples.some(x => x.counters?.wal && x.counters.checkpointer && x.counters.io.length));
    assert.ok(s.samples.every(x => x.activity.every(a => !('query' in a))));
  } finally { await observer.stop(); await pool.end(); }
});
