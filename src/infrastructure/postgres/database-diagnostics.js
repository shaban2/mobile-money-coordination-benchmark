import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);

export const databaseDiagnosticQuery = `
WITH observed AS MATERIALIZED (
 SELECT pid, backend_type, state, wait_event_type, wait_event
 FROM pg_stat_activity WHERE pid <> pg_backend_pid()
 AND (datname = current_database() OR backend_type IN ('checkpointer', 'background writer', 'walwriter'))
 AND (state = 'active' OR wait_event_type IN ('Lock', 'LWLock', 'IO', 'IPC'))
)
SELECT clock_timestamp() AS database_time,
 (SELECT count(*)::int FROM observed) AS observed_backends,
 COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT * FROM observed ORDER BY pid LIMIT 32) a), '[]'::jsonb) AS activity,
 CASE WHEN $1::boolean THEN jsonb_build_object(
   'wal', (SELECT to_jsonb(w) FROM pg_stat_wal w),
   'checkpointer', (SELECT to_jsonb(c) FROM pg_stat_checkpointer c),
   'io', (SELECT jsonb_agg(to_jsonb(i)) FROM (
     SELECT backend_type, sum(reads) AS reads, sum(read_time) AS read_time_ms,
       sum(writes) AS writes, sum(write_time) AS write_time_ms,
       sum(fsyncs) AS fsyncs, sum(fsync_time) AS fsync_time_ms,
       min(stats_reset) AS oldest_stats_reset, max(stats_reset) AS newest_stats_reset
     FROM pg_stat_io GROUP BY backend_type ORDER BY backend_type
   ) i)
 ) ELSE NULL END AS counters`;

// One separate read-only connection; never changes the application's pool.
// No SQL text, payloads, usernames, credentials or exception messages exported.
export class DatabaseDiagnostics {
  constructor({ enabled = false, connectionString, intervalMs = 250, counterIntervalMs = 1000,
    maxSamples = 8192, pool = null } = {}) {
    if (!(intervalMs >= 100) || !(counterIntervalMs >= intervalMs) || !Number.isInteger(maxSamples) || maxSamples < 1) throw new Error('Invalid database diagnostic limits.');
    Object.assign(this, { enabled, intervalMs, counterIntervalMs, maxSamples });
    if (enabled) {
      const { Pool } = require('pg');
      this.pool = pool ?? new Pool({ connectionString, max: 1, application_name: 'coordination-diagnostics',
        connectionTimeoutMillis: 2000, query_timeout: 2000, statement_timeout: 1000,
        options: '-c default_transaction_read_only=on -c stats_fetch_consistency=none' });
      this.pool.on('error', () => { this.errors++; });
    }
    this.reset();
  }
  reset() {
    this.generation = (this.generation ?? 0) + 1; this.startedAt = new Date().toISOString();
    this.samples = []; this.total = 0; this.errors = 0; this.skippedTicks = 0; this.truncatedActivitySamples = 0;
    this.lastCounters = -Infinity;
  }
  async start() {
    if (!this.enabled || this.timer) return;
    const { rows } = await this.pool.query(`SELECT current_setting('server_version_num') AS version,
      current_setting('track_io_timing') AS track_io_timing,
      current_setting('track_wal_io_timing') AS track_wal_io_timing,
      current_setting('track_activities') AS track_activities,
      current_setting('checkpoint_timeout') AS checkpoint_timeout,
      current_setting('checkpoint_completion_target') AS checkpoint_completion_target`);
    this.settings = rows[0];
    if (Number(this.settings.version) < 170000 || ['track_io_timing', 'track_wal_io_timing', 'track_activities'].some(k => this.settings[k] !== 'on')) {
      await this.pool.end(); throw new Error('Database diagnostics require PostgreSQL 17+ with activity and I/O timing enabled.');
    }
    await this.sample();
    this.timer = setInterval(() => { this.sample(); }, this.intervalMs); this.timer.unref();
  }
  async sample() {
    if (!this.enabled) return;
    if (this.pending) { this.skippedTicks++; return; }
    const generation = this.generation, started = performance.now(), startedAt = new Date().toISOString();
    const counters = started - this.lastCounters >= this.counterIntervalMs;
    this.pending = (async () => {
      try {
        const { rows } = await this.pool.query(databaseDiagnosticQuery, [counters]);
        if (generation !== this.generation) return;
        if (counters) this.lastCounters = started;
        const row = rows[0];
        if (row.observed_backends > 32) this.truncatedActivitySamples++;
        this.samples[this.total++ % this.maxSamples] = { startedAt, capturedAt: new Date().toISOString(),
          collectionMs: performance.now() - started, ...row };
      } catch { if (generation === this.generation) this.errors++; }
    })();
    try { await this.pending; } finally { this.pending = null; }
  }
  async stop() { clearInterval(this.timer); this.timer = null; await this.pending; if (this.enabled) await this.pool.end(); }
  snapshot() {
    const offset = this.total > this.maxSamples ? this.total % this.maxSamples : 0;
    return { schemaVersion: 1, enabled: this.enabled, startedAt: this.startedAt, capturedAt: new Date().toISOString(),
      scope: 'PostgreSQL instance; cumulative counters include pre-measurement work, use deltas',
      intervalMs: this.intervalMs, counterIntervalMs: this.counterIntervalMs, maxSamples: this.maxSamples,
      overwrittenSamples: Math.max(0, this.total - this.maxSamples), recordingErrors: this.errors,
      skippedTicks: this.skippedTicks, truncatedActivitySamples: this.truncatedActivitySamples,
      settings: this.settings ?? null, samples: [...this.samples.slice(offset), ...this.samples.slice(0, offset)] };
  }
}
