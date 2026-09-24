# Confirmatory experiment runbook

This runbook describes the current 96-run confirmatory candidate, not the adaptive pilot (currently on hold). The final replication count and shared sustainable rate require pilot evidence and readiness review before protocol freeze and confirmatory execution. For pilot commands, variable run counts, timing, monitoring, and stop rules, use [CAPACITY_PILOT_EXECUTION.md](CAPACITY_PILOT_EXECUTION.md). No confirmatory execution is authorized merely by completing the pilot.

## 1. Freeze the environment

Record the following before the first run:

- host and Docker resource allocation;
- source folder and source snapshot;
- Docker, Compose, Node, npm, PostgreSQL, Redpanda, Toxiproxy, k6, Prometheus, and Grafana versions;
- retry, timeout, provider-delay, fault, and qualification settings;
- the pilot-estimated shared sustainable rate; and
- the final matrix and analysis plan.

Do not update code, images, resource limits, or settings during the final frozen confirmatory matrix. If a change is unavoidable, stop the experiment and begin a new clearly labelled evidence series. Do not run the generation/build/preflight workflow below against the active pilot workspace while its inputs are frozen.

## 2. Preflight checks

```bash
npm install
npm run matrix:generate
npm run matrix:validate
npm test
docker compose config --quiet
docker info
```

For the unchanged candidate, confirm that the matrix report says 96 runs, with 64 `LOAD` runs and 32 `FAULT` runs. Confirm that the only conditions are `R-A` and `K-A`. If the replication review requires a different count, first amend and verify the generator, validators, controller checks, tests, analysis, and these instructions, then freeze the revised matrix. The current implementation enforces 96; editing a document alone does not change execution.

## 3. Engineering checks

Run one short REST load cell and one short Kafka load cell into a separate results root. These checks confirm startup, callback delivery, durable completion, reconciliation, resource sampling, and cleanup. Do not combine these outputs with confirmatory evidence.

Use a dedicated Compose project. `--execute` stops that project's services and resets its experiment database before each trial; it must never target a project containing valuable non-experiment data. Provider effects remain in a persistent synthetic journal, with a fresh workload namespace per invocation. Failed-run logs and artifacts are preserved; never reuse an existing evidence directory to overwrite a failed attempt.

```bash
RESULTS_ROOT=results-engineering-rest \
SUSTAINABLE_RATE=4 \
WARMUP_DURATION=2s \
MEASUREMENT_DURATION=8s \
DRAIN_SECONDS=30 \
npm run experiment -- --execute --run-id LOAD-R-A-L50-Nstandard-Fnone-R06
```

Use the actual Kafka run ID returned by this command:

```bash
npm run experiment -- --block LOAD
```

Then run the selected `K-A` cell with the same engineering settings and a different results root.

## 4. Confirm the output gates

For each engineering run, inspect:

- `qualification.json`: evidence gates must pass; inspect status, performance, and safety separately;
- `invariants.json`: reconciliation must pass;
- `callbacks.json`: terminal results must be represented;
- `docker-stats.jsonl`: multiple time-stamped samples must exist;
- `clean-start.json` and `cleanup.json`: no project containers may remain after teardown (named volumes are preserved);
- `isolation.json`: only the selected architecture and its expected services may run before warm-up, before measurement, and after observation; the `architectureIsolated` qualification gate also checks measurement samples;
- `resolved-compose.json` and `resolved-compose.yaml`: active services must be present, not `services: {}`;
- `measurement-summary.json`: measured checks and request counts must exist;
- `manifest.json`: condition, rate, checksums, images, host, and lifecycle must be correct; and
- `controller-state.json`: the lifecycle must have a recorded terminal disposition. Fault-path checks too short to demonstrate recovery can correctly be `CENSORED`.

For fault-path engineering checks, also inspect `fault-evidence.json` and `fault.log`.

## 5. Start confirmatory execution

Proceed only after the confirmatory protocol and final run count are frozen. Set the shared sustainable rate from the pilot. The same rate is used to calculate absolute 25%, 50%, 75%, and 90% offered loads for both architectures. The example value `120` is not a capacity estimate.

```bash
SUSTAINABLE_RATE=120 npm run experiment -- --execute
```

The runner follows the seeded matrix order. Every run performs:

1. all-profile teardown, verification that no project containers remain, then condition-specific stack startup;
2. gateway and runtime-configuration checks;
3. standard network-profile application;
4. state reset;
5. five-minute warm-up;
6. warm-up drain, isolation recheck, second reset and measured-run registration;
7. ten-minute open-loop measurement;
8. the scheduled fault for fault cells;
9. whole-stack resource sampling during measurement;
10. drain and reconciliation;
11. artifact capture and qualification; and
12. fault clearing, network clearing, and verified all-profile stack shutdown. A teardown failure stops the controller rather than allowing the next trial. `KEEP_SERVICES=true` is only for debugging; the capacity pilot forces it off.

Runs are sequential. Allow 15 minutes of warm-up/measurement per run, up to 20 further minutes across the two drains, and additional setup/reset/cleanup time. The current 96-run candidate therefore needs 24 hours of warm-up/measurement, up to 32 more hours of drain, and overhead, excluding pilot time. A 15-minute monitoring check does not imply a completed run or trigger another one.

## 6. Resume safely

For a future v2 **capacity pilot**, use `npm run pilot:pause -- results-capacity-pilot-v2`, wait for `PAUSED`, and later use `npm run pilot:resume -- results-capacity-pilot-v2`. That feature finishes a matched pair, verifies cleanup/restoration, preserves consumed budgets and evidence, and rechecks frozen inputs before resuming. It does not shorten measurements, replay completed runs, or make an interrupted attempt resumable. See [the detailed pause instructions](CAPACITY_PILOT_EXECUTION.md#pause-and-continue-later-v2-only). The commands below concern the separate general experiment runner, not pilot checkpoints.

If execution stops between runs, resume with the same rate and settings:

```bash
SUSTAINABLE_RATE=120 npm run experiment -- --execute --resume
```

`--resume` skips directories containing `qualification.json` only when no `controller-error.json` exists. It does not overwrite a failed or interrupted directory. Preserve such a directory and decide on a replacement-run rule before collecting another attempt. A root containing `DO_NOT_RESUME.json` is blocked outright; the paused/retired first pilot batch must not be resumed. See [the isolation repair record](PILOT_ISOLATION_REPAIR.md).

For the unchanged 96-run candidate only, start from the fault block after confirming the first 64 runs:

```bash
SUSTAINABLE_RATE=120 npm run experiment -- --execute --from-sequence 65 --resume
```

## 7. Monitor progress

```bash
npm run experiment:summary
```

The command writes `results/experiment-summary.json` with qualified, excluded, failed, and incomplete counts. Keep `results/run-index.jsonl` as an append-only execution record.

## 8. Close the evidence set

After all runs in the final frozen matrix (96 only if the current candidate is retained):

1. reconcile the summary's terminal run records with every expected run ID in the final matrix and account separately for any authorized replacement attempts;
2. retain excluded runs and exclusion reasons;
3. retain censored non-recovery runs rather than deleting them;
4. make the entire results folder read-only or copy it to immutable storage;
5. calculate and record a checksum for the archived evidence; and
6. conduct analysis from the locked copy only with `npm run experiment:analyze -- <locked-results-directory>`.

Do not replace an inconvenient result, change a threshold after seeing outcomes, or combine pilot runs with confirmatory runs.
