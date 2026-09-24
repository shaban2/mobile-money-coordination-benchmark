ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS trace_id text DEFAULT encode(gen_random_bytes(16), 'hex');

UPDATE transfers
   SET trace_id = encode(gen_random_bytes(16), 'hex')
 WHERE trace_id IS NULL;

ALTER TABLE transfers ALTER COLUMN trace_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transfers_trace_id_idx ON transfers(trace_id);

CREATE TABLE IF NOT EXISTS trace_events (
  trace_event_id bigserial PRIMARY KEY,
  trace_id text NOT NULL,
  transfer_id uuid NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  boundary text NOT NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS trace_events_transfer_idx
  ON trace_events(transfer_id, occurred_at, trace_event_id);
CREATE INDEX IF NOT EXISTS trace_events_trace_idx
  ON trace_events(trace_id, occurred_at, trace_event_id);
