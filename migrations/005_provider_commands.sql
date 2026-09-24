-- A committed intent precedes every external provider effect. Results are reusable
-- after a process restart; the provider must independently deduplicate the key.
CREATE TABLE IF NOT EXISTS provider_commands (
  transfer_id uuid PRIMARY KEY REFERENCES transfers(transfer_id),
  request_key text NOT NULL UNIQUE,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz
);
