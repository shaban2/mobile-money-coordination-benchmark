// Completeness checks for diagnostic evidence, never a performance threshold.
export function assertDeepDiagnosticEvidence(snapshot, linuxJsonl) {
  if (snapshot?.schemaVersion !== 1 || snapshot.enabled !== true || snapshot.recordingErrors !== 0
    || snapshot.overwrittenSamples !== 0 || snapshot.truncatedActivitySamples !== 0
    || snapshot.samples?.length < 2 || !Array.isArray(snapshot.samples)
    || Number(snapshot.settings?.version) < 170000
    || ['track_io_timing', 'track_wal_io_timing', 'track_activities'].some(k => snapshot.settings?.[k] !== 'on')
    || snapshot.samples.filter(s => s.counters?.wal && s.counters?.checkpointer && Array.isArray(s.counters?.io)).length < 2) {
    throw new Error('Database diagnostic evidence missing, truncated or unhealthy; review required.');
  }
  const rows = linuxJsonl.trim().split('\n').filter(Boolean).map(JSON.parse);
  if (rows.length < 2 || rows.some(r => r.linuxDiagnostics?.valid !== true)) {
    throw new Error('Linux diagnostic evidence missing or unhealthy; review required.');
  }
  return true;
}
