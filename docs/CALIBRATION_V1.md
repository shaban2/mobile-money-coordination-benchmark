# Diagnostic calibration V1

This batch investigates the low-load timing variation seen in V4/V5. It does **not** establish capacity, change their historical verdicts, or start the 96-run confirmatory matrix.

## What will run

Four sequential runs: two REST and two Kafka, all at **4 operations/second**, with no injected fault. Each gets **5 minutes warm-up → drain → reset → 10 minutes measurement → drain → export/check → cleanup**. The first matched pair's architecture order is seeded; the second pair reverses it. Each pair uses the same workload seed across architectures. Two repetitions provide initial diagnostics, not a claim of adequate statistical precision.

Traffic alone takes 60 minutes. Setup and cleanup add time; each run retains two **up-to-600-second** drains, which end earlier when work is cleared. The three-active-hour ceiling is an execution safety budget checked before starting another run, not an overload threshold, guaranteed deadline, or minimum sample size. Paused time is excluded. A started trial has the existing 45-minute controller deadline.

4 operations/s means 240 scheduled operations/minute, not 240 new transfers. The fixed workload includes status reads and idempotent replays. Goodput counts correctly completed unique transfers during measurement from durable records, not all k6 operations or HTTP acceptance responses.

## Commands, in order

Run from the repository root, after approval and engineering verification. Never prepare over an existing root or run two controllers.

```sh
npm run calibration:prepare -- results-calibration-v1
npm run pilot:launch -- results-calibration-v1
npm run pilot:status -- results-calibration-v1
```

The first command builds/freezes images and archives source; it does not start traffic. The launcher starts the detached controller. Existing `pilot:*` names are reused for lifecycle safety; the frozen protocol's `kind` selects **diagnostic calibration**, not adaptive capacity search. `pilot-protocol.json` and `pilot-state.json` retain their existing filenames for compatibility.

```sh
npm run pilot:pause -- results-calibration-v1
# Wait for PAUSED, cleanup.passed=true, no restoration errors, ended session.
# Only then may the computer sleep.
npm run pilot:resume -- results-calibration-v1
```

A pause completes the current matched pair; it is not immediate. Resume is explicit and requires unchanged frozen source/images/host configuration. `REVIEW_REQUIRED`, `INTERRUPTED` and completed batches are not resumable checkpoints. Do not edit frozen source, restart Docker, force sleep, or run competing tests while collecting evidence. The controller inhibits idle sleep on macOS, not every possible shutdown/sleep action.

Only the exact three the external stack instances approved in the V5 freeze may be paused. The controller restores only those it found running and stopped in this session, on completion, safe pause, or handled failure. Volumes remain preserved. The removed external companion container is not recreated; a different competing container needs separate approval.

## What counts as done

Read `results-calibration-v1/pilot-state.json`. Successful collection needs **all** of:

- `status: CALIBRATION_COMPLETE_REVIEW_REQUIRED` and exactly four records.
- The last session has `endedAt`, no current run, `cleanup.passed: true` and `restoreErrors: []`.
- Every recorded run has passed correctness/validity checks and complete diagnostic exports.

This means **ready for review**, not “capacity found.” `RUNNING` means collection continues; per-run `QUALIFIED` is evidence validation, not capacity confirmation. `REVIEW_REQUIRED` means stop and investigate. Process exit alone is not proof of successful collection.

## Evidence to inspect

Each run directory contains:

| File | Meaning |
|---|---|
| `calibration-assessment.json` | Separate strict checks, descriptive queue/goodput history, and descriptive latency; no capacity threshold. |
| `qualification.json`, `invariants.json`, `telemetry.json` | Validity, financial correctness, workload checks, callbacks, and unfinished/failed transfers. |
| `run-outcomes.json`, `traces.json`, `transfers.json` | Durable ingress/completion times, unique transfers, every complete 30-second under-load window and exact per-transfer outstanding-work history. |
| `diagnostics.json` | Existing application/SQL spans, event-loop delay, GC, process CPU and application pool observations. Nested spans are not additive. |
| `database-diagnostics.json` | PostgreSQL wait samples, WAL/checkpointer/I/O counters, settings, sample errors, skips, truncation and collection duration. |
| `docker-stats.jsonl` | Container resources, macOS host samples, raw Linux kernel/pressure and application-cgroup snapshots with separate timestamps/cost. |
| `provider-attempt-timings.json`, `compose.log` | Provider attempts and service/checkpoint logs for time alignment. |
| `manifest.json`, `end-checksums.json`, `cleanup.json` | Treatment/provenance, unchanged source and verified teardown. |

On failure also inspect `controller-error.json`, its secondary/diagnostic errors, and any `*-at-failure.json`. Preserve failed evidence; do not retry until favorable.

## How the added diagnostics work

`src/infrastructure/postgres/database-diagnostics.js` uses one **separate read-only connection**, up to four samples/second; cumulative WAL/checkpointer/I/O counters are requested at most once/second. The app's processing pool and queries are unchanged. The bounded 8,192-sample ring is reset after warm-up; query overlap is skipped and counted. It exports backend IDs, wait types and counters, not SQL text or transfer payloads. PostgreSQL I/O timing is enabled in both frozen conditions, and can add overhead. Counters are instance-wide and include earlier work: compare deltas, not raw totals. Cumulative statistics can lag; a sample is not a full execution trace. [PostgreSQL statistics](https://www.postgresql.org/docs/17/monitoring-stats.html), [timing overhead](https://www.postgresql.org/docs/17/runtime-config-statistics.html).

`scripts/collect-docker-stats.mjs` reads Linux `/proc` and cgroup counters through the selected application container once per actual Docker-stats cycle (often slower than the nominal one-second interval). `/proc` refers to the Docker Linux VM kernel, **not macOS**; cgroup files refer to the selected app container, not every service. Unsupported pressure files are explicitly listed as unavailable. PSI measures time stalled on resource pressure; cgroup CPU throttling is not evidence of thermal throttling. [Linux PSI](https://docs.kernel.org/accounting/psi.html).

Sampling and I/O timing add overhead; both architectures receive the same instrumentation. Collection duration and skipped ticks must be reviewed. The database observer also runs in the application process, so event-loop stalls can delay sampling. Absence of a sampled wait does not prove no wait occurred. Neither shared spikes nor checkpoint alignment establishes causation. No instrumentation-off ablation is included, and V4/V5 cannot be pooled with this revision as interchangeable replications.

## Review before another pilot

Keep correctness and measurement-validity gates strict: valid provenance/load generation, safety invariants, workload check rate ≥99.5%, complete terminal callbacks and transfer timing, no failed/pending transfers after drain, healthy diagnostics and verified cleanup. A latency-only change does not fail capacity because **this batch makes no capacity decision at all**.

Compare arrivals, correct completions, outstanding work and drain completions through the whole measurement, alongside latency windows and diagnostic timestamps. Distinguish bounded transient queues from sustained accumulation. Review sample coverage/gaps and observer cost before interpreting correlations. Then agree and freeze a prospective numerical sustained-load rule, time horizon and replication plan for a new capacity search. The conceptual definition is “highest correctly sustained rate without a persistently growing queue, latency reported separately”; no numerical queue-growth allowance or completion-time deadline has yet been chosen.

## Engineering checks are separate

`npm test` exercises the bounded scheduler, correctness failures, pause/resume, diagnostic rings and existing behavior. PostgreSQL integration tests additionally need disposable `POSTGRES_TEST_URL` and `POSTGRES_DIAGNOSTIC_TEST_URL` databases; never point them at real data. `scripts/verify-calibration-instrumentation.mjs` runs **10s warm-up + 30s measurement** for each architecture in `results-engineering-calibration-v1`, temporarily stopping/restoring the exact approved the external stack instances. These are wiring checks, not extra calibration runs, and do not test a capacity threshold.
