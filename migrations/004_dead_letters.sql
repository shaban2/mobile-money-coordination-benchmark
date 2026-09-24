CREATE TABLE IF NOT EXISTS dead_letter_events (
  dead_letter_id bigserial PRIMARY KEY,
  transfer_id uuid NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  category text NOT NULL,
  error_code text,
  error_message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS dead_letter_events_transfer_idx
  ON dead_letter_events(transfer_id, recorded_at);
