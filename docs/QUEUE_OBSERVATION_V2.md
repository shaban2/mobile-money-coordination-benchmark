# Approved descriptive screening pair — 21 September 2026

The researcher approved the narrower interpretation with “yes lets proceed”: one new no-fault REST/Kafka pair at **4 operations/second**, each **2 minutes warm-up + 4 minutes measurement**, then mandatory human review. This is descriptive screening, not maximum-capacity evidence. Earlier pilots, calibration and the failed v1 validation are unchanged.

The four-block pattern logic is unchanged from the tested candidate. The executable version is `queue-observation-v2`, with one exact approved policy hash. The old `queue-growth-v1` and unapproved candidate identity remain blocked. The v1 source used by the previous revalidation report is retained in `.research/validation-archive/capacity-queue-v1.js`.

## Rules and stop conditions

- Both architectures share the same rate, paired seed, operation mix, lifecycle, correctness/eligibility gates and deep diagnostics. The outbox interval stays 50 ms.
- Complete timestamps, correct cohort accounting, contiguous thirty-second windows, diagnostics and source/image/protocol identity are required. Zero dropped k6 iterations and at least 99.5% offered-load delivery remain eligibility requirements.
- Safety invariants, at least 99.5% HTTP checks, matching terminal callbacks and zero failed or pending transfers after drain remain required. Failure is preserved and stops this descriptive sequence for review.
- Valid, correct runs receive `OBSERVATION_RECORDED`. Queue output is one of `NO_INCREASE_AT_SAMPLED_BOUNDARIES`, `CONSISTENT_BLOCK_GROWTH_OBSERVED`, `MIXED_RISES_AND_FALLS_REVIEW` or `INCONCLUSIVE_GROWTH_PATTERN`. None is a capacity pass/fail verdict; no `stable` flag is emitted. Latency is reported separately.
- After two runs, the session stops at `SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED`, even if both look good. There is no automatic rate increase, confirmation, fault trial or retry. The two-hour cumulative ceiling is a safety bound, not a predicted finish time.
- Previously approved exact the external stack instances may be paused and restored. New foreign containers are not stopped. A host-side Docker start-event observer aborts the experiment if competing work appears.
- Pause requests finish the matched pair. Since this authorization contains only one pair, its completion ends at review rather than enabling further resumed work.

## Execution and evidence

Database and short wiring verification, saved separately from screening evidence:

```sh
node scripts/verify-capacity-queue.mjs
```

This uses a disposable PostgreSQL instance and a REST/Kafka engineering pair with 10-second warm-up/30-second measurement. Those checks are not study repetitions. Their root is `results-engineering-queue-observation-v2` and failed attempts are not overwritten.

After verification, prepare and launch the approved pair:

```sh
node scripts/prepare-capacity-pilot.mjs results-queue-screening-v2 --observation-pair
node scripts/launch-capacity-pilot.mjs results-queue-screening-v2
node scripts/capacity-pilot.mjs results-queue-screening-v2
```

Optional graceful pause:

```sh
node scripts/pause-capacity-pilot.mjs results-queue-screening-v2
```

Do not edit source, policy or images during the frozen pair. Check `pilot-state.json` for session status, ended timestamp, verified cleanup and empty restoration errors. Each run retains its manifest, qualification, outcomes, traces, diagnostics, resource samples and assessment in `pilot-stability.json` (the historical filename now contains a descriptive assessment, not a stability verdict). `pilot.log` and the per-run controller logs record progress. `freeze.json`, the source archive and rule hashes define the exact revision used.

Total traffic time is **12 minutes for the pair**, plus setup, drains, exports and cleanup. Inspect actual start/clock markers before estimating a finish time. The Mac must stay awake and mostly idle while traffic is running.

## Pre-launch verification completed

21 September: **188 automated tests passed**; the two database-dependent tests then both passed against the disposable PostgreSQL instance. The approved descriptive implementation exactly matched all **2,400** candidate status/block outputs while retaining no capacity verdict. Scope, original-rule hold, correctness-stop, pair-limit and checkpoint-tampering regressions passed.

Both engineering runs in `results-engineering-queue-observation-v2` qualified with all validity and safety gates true, 100% workload checks, complete callbacks and verified cleanup. Required PostgreSQL/Linux diagnostics passed inspection. `verification.json` records `PASSED` and no restoration errors. The three exact approved the external stack instances were restarted. Disposable database contents were temporary and removed; retained engineering volumes and exported artifacts were not deleted. These are wiring checks, not screening or confirmatory repetitions.
