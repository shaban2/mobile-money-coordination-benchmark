CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS transfers (
  transfer_id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  command_fingerprint text NOT NULL,
  payer_id text NOT NULL,
  payee_id text NOT NULL,
  amount numeric(20, 0) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  client_reference text NOT NULL,
  provider_profile char(1) NOT NULL CHECK (provider_profile IN ('A', 'B')),
  callback_url text,
  provider_reference text,
  internal_state text NOT NULL CHECK (
    internal_state IN ('RECEIVED', 'VALIDATED', 'PREPARED', 'FULFILLED', 'FAILED')
  ),
  public_status text NOT NULL CHECK (public_status IN ('PENDING', 'COMPLETED', 'FAILED')),
  failure_code text,
  failure_message text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (payer_id <> payee_id),
  CHECK (
    (internal_state = 'FULFILLED' AND public_status = 'COMPLETED' AND completed_at IS NOT NULL)
    OR (internal_state = 'FAILED' AND public_status = 'FAILED' AND completed_at IS NOT NULL)
    OR (internal_state IN ('RECEIVED', 'VALIDATED', 'PREPARED') AND public_status = 'PENDING')
  )
);

CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers (public_status, updated_at);
CREATE INDEX IF NOT EXISTS transfers_client_reference_idx ON transfers (client_reference);

CREATE TABLE IF NOT EXISTS accounts (
  account_id text NOT NULL,
  currency char(3) NOT NULL,
  opening_balance numeric(20, 0) NOT NULL CHECK (opening_balance >= 0),
  balance numeric(20, 0) NOT NULL CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, currency)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  ledger_transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL UNIQUE REFERENCES transfers(transfer_id),
  amount numeric(20, 0) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS ledger_postings (
  posting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(ledger_transaction_id),
  transfer_id uuid NOT NULL REFERENCES transfers(transfer_id),
  account_id text NOT NULL,
  currency char(3) NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  amount numeric(20, 0) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (transfer_id, entry_type),
  FOREIGN KEY (account_id, currency) REFERENCES accounts(account_id, currency)
);

CREATE INDEX IF NOT EXISTS ledger_postings_account_idx
  ON ledger_postings (account_id, currency, created_at);

CREATE TABLE IF NOT EXISTS provider_attempts (
  provider_attempt_id bigserial PRIMARY KEY,
  transfer_id uuid NOT NULL REFERENCES transfers(transfer_id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider_profile char(1) NOT NULL CHECK (provider_profile IN ('A', 'B')),
  request_payload jsonb NOT NULL,
  response_payload jsonb,
  outcome text NOT NULL CHECK (outcome IN ('STARTED', 'COMPLETED', 'FAILED')),
  failure_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (transfer_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  event_id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES transfers(transfer_id),
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
  ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS inbox_events (
  event_id uuid PRIMARY KEY,
  topic text NOT NULL,
  payload_hash text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS callback_deliveries (
  callback_delivery_id bigserial PRIMARY KEY,
  transfer_id uuid NOT NULL REFERENCES transfers(transfer_id),
  callback_url text,
  payload jsonb NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  delivered boolean NOT NULL,
  http_status integer,
  error_message text,
  attempted_at timestamptz NOT NULL,
  UNIQUE (transfer_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  experiment_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id text NOT NULL CHECK (condition_id IN ('R-A', 'K-A')),
  coordination_mode text NOT NULL CHECK (coordination_mode IN ('rest', 'kafka')),
  client_mode text NOT NULL CHECK (client_mode = 'async'),
  offered_load numeric,
  network_profile text,
  fault_scenario text,
  random_seed text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  qualification_status text NOT NULL DEFAULT 'RUNNING' CHECK (
    qualification_status IN ('RUNNING', 'QUALIFIED', 'EXCLUDED', 'FAILED')
  ),
  exclusion_reason text
);

CREATE TABLE IF NOT EXISTS reconciliation_results (
  reconciliation_result_id bigserial PRIMARY KEY,
  experiment_run_id uuid REFERENCES experiment_runs(experiment_run_id),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  passed boolean NOT NULL,
  transfer_count bigint NOT NULL,
  ledger_transaction_count bigint NOT NULL,
  checks jsonb NOT NULL,
  conservation jsonb NOT NULL
);
