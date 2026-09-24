# Approved higher-load and fixed-load fault follow-up

21 September 2026. The researcher approved the recommended fixed **4 operations/second** exploratory fault tests, after review of the higher-load pair. This authorizes six new runs in three separately reviewed pairs, not adaptive capacity search or the confirmatory study. Earlier results, source archives and policies remain unchanged.

| Stage key | Evidence root | Load | Fault | Runs | Warm-up / measurement |
|---|---|---:|---|---:|---|
| `screening-r8` | `results-queue-screening-r8-v2` | 8 operations/s | None | REST + Kafka | 2m / 4m each |
| `adapter-r4` | `results-exploratory-adapter-r4-v1` | 4 operations/s | Common adapter stopped for 30 seconds | REST + Kafka | 5m / 10m each |
| `database-r4` | `results-exploratory-database-r4-v1` | 4 operations/s | 100 ms added downstream database-response delay for 60 seconds | REST + Kafka | 5m / 10m each |

The rate is constant within each run, including during a fault. `4/s` means four workload operations per second, not an increase every four seconds. Operations include new-transfer attempts, replays and status retrievals. The same deterministic operation mix and matched seed are used for both architectures within each pair. Architecture order is deterministically randomized from each pair's seed.

Faults are scheduled at measurement second 240 using the actual k6 clock marker. The 5-minute warm-up is separate. Each fault measurement retains pre-fault baseline and continued traffic after restoration. The existing recovery definition (three consecutive complete 30-second windows meeting the baseline goodput/latency criteria) and separate backlog-clearance definition are unchanged; both are descriptive, with censoring retained. Latency consistency is **not** restored as a capacity gate.

## Evidence and stop rules

- Identical strict correctness, callback, timing, workload-delivery, ledger and diagnostic requirements apply to both architectures. The 50 ms outbox setting, four workers, resources and shared host are unchanged. New controller/protocol source is archived; these are separately labelled observations, not silently pooled confirmations.
- The 8/s stage builds and pins the new controller revision while retaining predecessor infrastructure image IDs. Both later fault stages reuse those exact pinned images and the same source hash; they do not rebuild or pull newer tags between stages.
- The descriptive `queue-observation-v2` pattern calculation is unchanged. Three new exact policy hashes authorize only the table above. The old capacity-growth rule remains blocked; the old 4/s pair still cannot escalate or resume.
- Each controller stops after exactly two runs: `SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED` for 8/s, or `EXPLORATORY_PAIR_COMPLETE_REVIEW_REQUIRED` for a fault pair. Source/image/host changes, invalid evidence, correctness/safety failure, cleanup failure or competing containers stop collection earlier, with evidence retained. No retries, extra rates or extra repetitions are authorized.
- A valid fault run can be `CENSORED` if recovery/clearance was not observed. That is not itself a ledger/correctness failure and does not turn into zero seconds. Both members may finish if strict correctness and validity remain satisfied. Censoring blocks the next stage pending a new user decision; it is not deleted or silently repeated.
- Review the completed pair's raw outcomes, trajectories, timing, callbacks, diagnostics and identities; verify no live controller or lock and actual restoration of the exact the external stack instances. Record an explicit review only after inspection. A receipt binds every predecessor file and the current source hash. Preparing, launching and direct experiment execution all check it.
- The existing monitoring task may continue to the next already-approved stage only after this review, if there was no user pause, invalid/correctness/safety issue, censored recovery, or unresolved queue pattern. A non-flat/rising description routes to the researcher, not to an automatic overload boundary. Even a flat finite screen does not establish capacity.
- the external stack pause/restoration is limited to the exact previously approved Redis, MySQL and Meilisearch instances. Their volumes remain. A new foreign container is never stopped automatically. The external companion container is not recreated.

## Commands, in order

After inspecting the completed predecessor and checking Docker/process state, record your review. The note must explain the actual reviewed evidence; it is not a substitute for inspection:

```sh
node scripts/review-exploratory-pair.mjs screening-r8
node scripts/review-exploratory-pair.mjs screening-r8 --record-review --note "Describe the actual predecessor review here."
node scripts/prepare-capacity-pilot.mjs results-queue-screening-r8-v2 --exploratory=screening-r8
node scripts/launch-capacity-pilot.mjs results-queue-screening-r8-v2
node scripts/capacity-pilot.mjs results-queue-screening-r8-v2
```

The first and last commands inspect only; preparation freezes inputs but starts no traffic; launch starts the detached controller. Review receipts live in `.research/exploratory-reviews/` and are copied into the new root as `prerequisite-review.json`. They cannot be overwritten. All source edits and automated tests must finish before recording the review and freeze.

After the 8/s pair has ended and been reviewed, repeat those commands with stage `adapter-r4` and root `results-exploratory-adapter-r4-v1`. After reviewing that pair, use `database-r4` and `results-exploratory-database-r4-v1`. Do not skip the prerequisite review or run stages concurrently.

For a graceful stop:

```sh
node scripts/pause-capacity-pilot.mjs ACTIVE_EVIDENCE_ROOT
```

This finishes the current matched pair and prevents monitored progression to the next stage. Wait for an ended session, empty `currentRun`, no lock/live controller, successful cleanup and the external stack restoration before sleeping. A pause in the final member is still detected from the session-specific request file even if completion wins the status race. Restarting beyond a user pause needs explicit direction; there is no automatic resume into another pair.

Completion evidence is `pilot-state.json`, `pilot.log`, each run's `qualification.json`, `pilot-stability.json` (historical filename, descriptive content), `run-outcomes.json`, `fault-evidence.json` for fault runs, diagnostics, traces and `cleanup.json`. No background work continues once the final pair ends and the monitor is paused.

Total planned traffic is **72 minutes**: 12 for screening and 60 for four fault runs. Setup, up-to-ten-minute drains after each phase, export, cleanup and review time are additional. Two hours per pair is a safety ceiling, not an ETA. Keep the Mac awake and mostly idle during active traffic.

These fixed-load faults do **not** replace later faults at 90% of the lower confirmed capacity. No capacity has yet been established, and no winner claim or final protocol freeze follows automatically.

## Pre-launch verification

The controller suite passed 202 tests with no failures; its two real-database tests were skipped there and then both passed against a disposable PostgreSQL instance using actual host-TCP readiness. The initial readiness attempt failed before testing traffic; its limitation and disposal are retained in `.research/exploratory-database-precheck-attempt-1.md`. The successful follow-up logs and cleanup report are in `results-engineering-exploratory-followup-v1`. This is engineering evidence, not a study repetition. Only those disposable temporary databases were removed; their tmpfs data is not recoverable or needed as study evidence.

All 52 compared application, infrastructure, migration, contract, dependency and fault-injection files match the previous 4/s source archive. Changes concern bounded protocol selection, assessment/review, controller safeguards and documentation. The original 4/s assessment recomputes identically, including both 729-transfer cohorts and original rule hash. The new unit checks cover all three exact scopes, fault timestamps/settings, retained censoring, immediate correctness stops, pair-limit/pause behaviour, checkpoint re-evaluation and direct-controller scope bypass attempts.
