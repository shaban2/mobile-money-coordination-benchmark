# Replicated campaign (207 runs)

This guide explains the replicated campaign: what was run, how, where each file is, and how to recompute every number. It is the second study in this repository. The first is the 16-run exploratory study in `.research/exploratory-paper-v1/`, which shaped this design and is not pooled with it.

## In one paragraph

REST orchestration and Kafka choreography were run behind the same transfer API, on one laptop, from one frozen source tree and one set of images. The main conditions were repeated as ten order-balanced REST/Kafka pairs. Smaller blocks tested Kafka's outbox settings, the number of workers, rising load and four crash faults. Every run was checked for ledger correctness. 207 runs were scheduled: 191 qualified, 6 were censored (valid, but a recovery criterion was not met), 9 were invalid, and 1 failed during setup and was rerun. No run had a failed transfer, a duplicate or a ledger violation.

## The design

Each run is one REST or one Kafka application under a constant arrival rate from k6. Of every 100 operations, 76 create a transfer, 20 read a status and 4 resend an earlier request. Faults start at measurement second 240.

| Block | Cell | What it tests | Rate (ops/s) | Runs |
|---|---|---|---|---|
| A | `A-NOFAULT-R8` | No fault | 8 | 10 pairs |
| A | `A-ADAPTER-R4` | Adapter outage, 30 s | 4 | 10 pairs |
| A | `A-DATABASE-R4` | Database delay, +100 ms per response for 60 s | 4 | 10 pairs |
| B | `B-POLL{5,10,25}-NOFAULT-R8` | Kafka outbox polling every 5, 10 or 25 ms (default 50) | 8 | 5 Kafka runs each |
| B | `B-POLL{5,10,25}-DATABASE-R4` | Same, under the database delay | 4 | 5 Kafka runs each |
| C | `C-BATCHED-NOFAULT-R8`, `C-BATCHED-DATABASE-R4` | Batched outbox dispatch (one UPDATE per batch) | 8, 4 | 5 Kafka runs each |
| C | `C-WORKERS8-DATABASE-R4` | Eight workers instead of four, under the database delay | 4 | 10 pairs |
| D | `D-LADDER-R{8,16,32,64,128,256}` | Load ladder | 8 to 256 | 3 series per design |
| E | `E-APPKILL-R4` | Application killed (SIGKILL) and restarted | 4 | 5 pairs |
| E | `E-PARTITION-R4` | Database disconnection: the app's database proxy disabled for 30 s | 4 | 5 pairs |
| E | `E-PGRESTART-R4` | PostgreSQL killed and restarted | 4 | 10 pairs |
| E | `E-BROKER-R4` | Redpanda killed and restarted (Kafka only) | 4 | 10 Kafka runs |

Run IDs follow `CAMP-<cell>-<R|K>-<repetition>`. In the code the database disconnection is the fault `database-partition`, the database restart is `postgres-restart`, and the broker kill is `broker-stop` (`src/experiment/fault-catalog.js`).

Timing: no-fault and ladder runs warm up for 2 min and measure for 4 min. Fault runs warm up for 5 min and measure for 10 min. Settings that change between cells are environment variables only (`OUTBOX_POLL_MS`, `OUTBOX_DISPATCH_MODE`, `WORKER_CONCURRENCY`), so every run uses the same images.

## Order, freeze and extension

- `scripts/campaign.mjs freeze <root>` builds the images and records the source, schedule and compose hashes in `<root>/freeze.json`, with a copy of the source in `source-snapshot.tar.gz`. `run` refuses to start a run if any hash changed or if other containers are running.
- The schedule (`campaign-schedule.json`) is generated from a seed by `buildCampaign` in `src/experiment/campaign.js`. Blocks are interleaved, and in each paired cell about half of the pairs run REST first.
- The main campaign (`results-revision-campaign-v2`, 181 runs) used five repetitions for the 8-worker cell, the database restart and the broker kill. Five pairs cannot reach p < 0.05 in an exact sign test, so these three cells were extended to ten in `results-revision-extension-v1` (25 runs) with the same source hash. That root also holds the rerun of the one setup failure (`CAMP-C-BATCHED-DATABASE-R4-K-03`). Every attempt is kept.
- Before the freeze, 13 short functional test runs checked the new faults and settings with shorter timing. They are not reported and are not part of the public evidence.
- Predictions for the polling, dispatch and worker tests were written before the campaign: `.research/revision-v2/PREDICTIONS.md`.

## Files in a run folder

The public export keeps the files the analysis reads, plus the run's disposition records and ledger checks. Large files are gzip-compressed.

| File | Contents |
|---|---|
| `manifest.json` | Run settings: design, cell, rate, fault, variant, timing, seed |
| `run-outcomes.json.gz` | Per-transfer latency, per-second windows, completions, backlog and recovery, recomputed from traces |
| `qualification.json` | Pass or fail for every validity gate, and the final status |
| `fault-evidence.json` | When the fault was injected and cleared, as observed |
| `traces.json.gz` | Timestamped workflow steps for every transfer |
| `client-attempts.json.gz` | Every client request and its HTTP status (fault runs) |
| `docker-stats.jsonl.gz` | CPU and memory samples per container |
| `invariants.json.gz` | Ledger checks: final states never reverse, one balanced entry per completed transfer, money conserved, unique idempotency keys |
| `measurement-summary.json` | k6 summary, including dropped iterations |

A run that failed during setup has only its failure record (`controller-error.json`) and controller state.

## Recompute the numbers

```sh
npm ci
node scripts/analyze-campaign.mjs public-evidence/results-revision-campaign-v2 public-evidence/results-revision-extension-v1
```

In the private archive, run it without arguments. The script writes `.research/revision-v2/campaign-analysis.json` and `campaign-runs.csv`. It pairs REST and Kafka runs by repetition and reports, for ten-pair cells, the relative effect with a 95% paired bootstrap interval and an exact sign test with Holm adjustment over five contrasts (`src/experiment/analysis.js`). Smaller cells are reported as ranges. Resource use excludes the monitoring stack, the test tools and the shared adapter. The battery check reads `.research/revision-v2/power-log.txt`, a list of AC and battery switches from the host's power log.

Figures: `scripts/figures/campaign-results.py` and `scripts/figures/fault-timelines.py` (Python with matplotlib) read `campaign-analysis.json` and the run folders.

## Run the campaign on your own machine

You can run the same 181-run schedule on your own hardware. Your absolute numbers will differ from ours. The useful comparison is whether the same patterns appear.

**Before you start**

- macOS. The runner keeps the machine awake with `caffeinate` and records thermal state with `pmset`, so it does not start on Linux as written.
- Docker Desktop. Ours had 8 CPUs and about 7.7 GiB of memory, and each application container is limited to 2 CPUs and 1 GiB.
- Node.js 24 or newer, and `npm ci` run once.
- At least 8 GiB of free disk. The runner checks this before every run. Our two roots took about 1.5 GB.
- No other containers running. The runner refuses to start a run while any are up, and it never stops them for you.
- A machine you can leave alone. Our 181 runs took about 36 hours of machine time: about 15 minutes per fault run and 6 minutes per other run.

**Steps**

```sh
node scripts/campaign.mjs freeze results-my-campaign
node scripts/campaign.mjs run results-my-campaign
```

- `freeze` builds the images, writes the same seeded schedule we used, and records your machine's identity, the image IDs and the source hash in `freeze.json`. The folder must not exist yet. Nothing is measured.
- `run` works through the schedule. Before each run it checks that the source, schedule, images and machine still match the freeze. If you edit any source file, it stops, because the results would mix versions.
- If the runner stops or the machine restarts, run the same `run` command again. Finished runs are kept and skipped. It also stops after three controller failures in a row, so you can look before continuing.
- It is finished when `campaign-log.jsonl` ends with a `COMPLETE` event.

**Analyze your runs**

```sh
cp .research/revision-v2/campaign-analysis.json campaign-analysis.published.json
node scripts/analyze-campaign.mjs results-my-campaign
```

The script writes to `.research/revision-v2/`, so keep a copy of the published file first. Without a power log for your machine, the battery fields stay empty.

**The extension.** Our `results-revision-extension-v1` schedule was written separately, after the main campaign. Its `campaign-schedule.json` records what it extends and why. No command regenerates it. `freeze` only writes the full campaign schedule, so extending your own campaign the same way needs a hand-written schedule in a new root.

## Two findings about configuration

- **Broker kill:** in 5 of 10 runs one transfer stayed in RECEIVED. Redpanda ran in development container mode, which does not wait for writes to reach the disk, so the kill lost records it had already confirmed while the consumer group's committed offsets survived. A new event then reused a lost offset that the group had already passed. Disk synchronization or replication prevents this. Scripts: `.research/revision-v2/root-causes/`.
- **Database restart:** in 7 of 20 runs requests waited up to about 36 s instead of failing fast. One connection attempt hung inside Toxiproxy, and the application's pg pool (`src/infrastructure/postgres/postgres-persistence.js`) has no connection or query timeout, so requests queued behind it. Correctness held in every run.

## Limits

One laptop, both designs in one process sharing one database, a synthetic provider with a fixed 25 ms delay, one broker without replication in development mode, and short runs. The load ladder shares the host with k6, so its limits belong to this host.
