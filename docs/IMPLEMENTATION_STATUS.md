# Implementation status and research-readiness gates

## Implemented

- Fixed asynchronous bilateral P2P API and status resource.
- REST orchestration and Kafka choreography as the only confirmatory conditions.
- Two synthetic telecom-provider adapters with normalized outcomes.
- PostgreSQL transfer state, experiment records, callbacks, traces, dead letters, and atomic double-entry ledger.
- Redpanda-backed Kafka transport with transactional outbox publication and inbox deduplication.
- Common adapter-service container for the specified stop-and-restart fault.
- PostgreSQL through Toxiproxy for the specified database-delay fault.
- Fixed standard client-network gateway for request, status, and callback traffic.
- Open-loop k6 workload with 80% creation, 20% retrieval, and 5% idempotent replay.
- Seeded candidate 96-run confirmatory matrix with eight independent runs per cell, pending replication-precision review and freeze.
- Separate adaptive capacity-pilot controller with frozen source/images/rules, sequential paired trials, fresh boundary confirmations, full-fault checks, evidence preservation, and 72-run/24-hour resource ceilings.
- No-overwrite, resumable run controller with per-run lifecycle state.
- Source, configuration, host, image, tool, rate, seed, and timing manifests.
- Whole-Compose-project resource sampling with a one-second target interval and checked actual gaps.
- Time-stamped fault evidence and logs.
- Run-level correct goodput, durable-completion latency, 30-second recovery windows, backlog, and censoring fields derived from durable traces.
- Evidence validity gates separate from performance failures, safety failures, and censored recovery.
- Post-commit observations, measured-cohort goodput, explicit drain completions, and backlog retaining unfinished transfers.
- Atomic state/outbox/inbox updates, durable provider intent/result, REST restart recovery, and persistent simulator idempotency.
- Actual ledger-posting and per-currency account reconciliation.
- Four-worker application limits and Kafka partition concurrency; notification-based completion.
- Paired run-level analysis, exact sign-randomization tests, Holm endpoint families, and administrative-horizon recovery estimates.
- Checked-out PostgreSQL connection-error handling; latency fault control without live proxy reconfiguration.
- Pre-start trial database reset, source/configuration hash comparison, resolved Compose and runtime-limit evidence, and failed-run diagnostics.
- Experiment summary and append-only run index.

## Exploratory pilot status and outstanding readiness checks

The user authorized the exploratory capacity pilot on 20 September 2026. Its execution rules are frozen, not the confirmatory protocol. Broader crash/response-loss checks below remain outstanding confirmatory-readiness requirements; launching the pilot does not mark them passed or waive them. See [CAPACITY_PILOT_EXECUTION.md](CAPACITY_PILOT_EXECUTION.md).

- Review the engineering evidence and retained failures in `VERIFICATION.md`.
- Extend the passing in-memory fixed-corpus comparison to a durable, multi-process crash-boundary campaign, including abrupt application termination around provider acceptance and database commit.
- Extend the passing simulated lost-response and provider-journal restart tests to a real HTTP response-loss injection after acceptance.
- Confirm stability of the standard client-network profile and resource coverage at pilot-scale load; short-run checks do not establish this.

## Must pass before confirmatory measurement

- Estimate each architecture's stable capacity under one documented pilot rule and freeze the lower value as the shared sustainable rate.
- Freeze the four resulting absolute offered rates.
- Pilot the 30-second adapter crash and 60-second database delay at the 90% rate.
- Confirm that the ten-minute measurement window provides three usable 30-second post-fault recovery windows.
- Freeze retry, timeout, fault, callback, qualification, censoring, and practical-effect rules.
- Justify the final replication count using run-level precision and feasible machine time; eight runs per cell (96 total) are provisional. If revised, update and verify the generator, validators, controller checks, tests, analysis, and documentation before freeze.
- Pilot and preregister the proposed paired analysis, endpoint families, censoring horizons, exclusions, and decision rules in `PILOT_AND_ANALYSIS.md`.
- Lock the code, matrix, images, host resources, and dependency versions before run 1.

Anything produced before these gates pass is pilot or engineering evidence, not a confirmatory result.
