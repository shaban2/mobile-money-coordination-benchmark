ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();

DROP INDEX IF EXISTS outbox_unpublished_idx;
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
  ON outbox_events (next_attempt_at, created_at) WHERE published_at IS NULL;
