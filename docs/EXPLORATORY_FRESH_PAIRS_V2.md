# Approved order-balanced fault pairs — 22 September 2026

The researcher approved two fresh fault pairs at a fixed **4 operations/second**, each seeded so that the **Kafka condition runs first**. They give each fault scenario one pair in each realized architecture order (the 21 September pairs all ran REST first). No capacity search, no-fault repetition, higher rate, or confirmatory launch is authorized. The six-run reporting set and the archived pairs are unchanged.

| Stage key | Evidence root | Fault | Seed | Realized order | Predecessor |
|---|---|---|---|---|---|
| `adapter-k4` | `results-exploratory-adapter-k4-v1` | Common adapter stopped for 30 s at measurement second 240 | `lubanga-exploratory-adapter-k4-v1` | K-A then R-A | `results-exploratory-database-r4-v1` |
| `database-k4` | `results-exploratory-database-k4-v1` | 100 ms downstream database-response delay for 60 s at second 240 | `lubanga-exploratory-database-k4-v5` | K-A then R-A | `results-exploratory-adapter-k4-v1` |

Both stages use 5 minutes warm-up and 10 minutes measurement, the same deterministic operation mix, the 50 ms outbox setting, four workers, the same resource limits and the same strict validity, correctness, callback, workload-delivery, ledger and diagnostic requirements as the 21 September fault pairs. Order is a pure function of the protocol seed (`src/experiment/pilot.js`); no order-forcing code exists. The `database-k4` seed suffix `v5` was chosen because `v1` realizes REST first. `test/exploratory-followup.test.js` pins the expected first condition for every stage.

## Implementation rebuild

`adapter-k4` is an **implementation-rebuild stage** (`IMPLEMENTATION_REBUILD_STAGES` in `src/experiment/queue-observation.js`), like `screening-r8` was on 21 September. The repository was renamed to `mobile-money-coordination-experiment` after the six-run set, which changed the package name in `package.json` and `package-lock.json`; the paper analysis and build scripts also changed. All of these are inside the source-hash scope, so the live source hash no longer equals `7995e552…`. A rebuild stage builds fresh application images, pins the infrastructure images from its predecessor's freeze, and records the new source hash. `database-k4` then pins to `adapter-k4`'s images and must share its source hash. The application-defining files (everything outside the experiment harness, scripts, tests and docs) differ from the reporting-set archive only in the package name; the paper analysis verifies this by comparing the frozen archives file by file.

## Commands, in order

After inspecting the completed predecessor and confirming Docker state, record the review, prepare, launch and monitor. Preparation freezes inputs but starts no traffic; launch starts the detached controller.

```sh
node scripts/review-exploratory-pair.mjs adapter-k4
node scripts/review-exploratory-pair.mjs adapter-k4 --record-review --note "Describe the actual predecessor review here."
node scripts/prepare-capacity-pilot.mjs results-exploratory-adapter-k4-v1 --exploratory=adapter-k4
node scripts/launch-capacity-pilot.mjs results-exploratory-adapter-k4-v1
node scripts/capacity-pilot.mjs results-exploratory-adapter-k4-v1
```

After the first pair has ended and been reviewed, repeat with stage `database-k4` and root `results-exploratory-database-k4-v1`. Do not run stages concurrently, and do not edit any hashed file (`src/`, `scripts/`, `config/*.json`, package files, compose, Dockerfiles) between recording the first review and the end of the second pair.

## Completion gate for each pair

`pilot-state.json` reads `EXPLORATORY_PAIR_COMPLETE_REVIEW_REQUIRED` with exactly two records, no current run, `cleanup.passed: true` and empty `restoreErrors`; there is no `pilot.lock`; the launcher process has exited; `docker ps` shows only the three restored the external stack containers; every line of `isolation-events.jsonl` has `foreign: false`; each run's `qualification.json` is `QUALIFIED` and `fault-evidence.json` is complete; and `pilot-batch-001.json` lists `K-A` first. A `REVIEW_REQUIRED`, `CENSORED` or invalid outcome is retained and routes to the researcher; the root is never reused.

## Preconditions

Only the exact three approved the external stack containers may be running; they are paused by ID and restored afterwards. The leftover `lubanga-mobile-money-coordination-experiment-postgres-1` container from the old folder name must be stopped and removed first (its volume is kept). At least 15 GiB free disk, unchanged Docker identity, mains power and an open lid are required. Total planned traffic is 60 minutes plus setup, drains, image build, export and cleanup; two hours per pair is a safety ceiling, not an estimate.

## Completion record

Both pairs completed on 22 September 2026 with status `EXPLORATORY_PAIR_COMPLETE_REVIEW_REQUIRED`, realized order K-A then R-A, all four runs `QUALIFIED` with 1,824 completions each, zero failed or pending transfers, complete fault evidence, cleanup passed, no restore errors, and every isolation event `foreign: false`. Review receipts are `.research/exploratory-reviews/adapter-k4.json` and `database-k4.json`. The paper analysis (`.research/exploratory-paper-v1/analysis.json`, revision 4) reports them beside the original pairs. No further stage is authorized by this document.
