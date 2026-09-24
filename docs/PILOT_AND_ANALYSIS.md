# Pilot and analysis plan

Current execution amendment (21 September): the adaptive capacity/jitter plan below is historical/candidate, not the active launcher policy. Follow [the approved six-run exploratory sequence](EXPLORATORY_FOLLOWUP_V1.md). Automatic capacity boundaries remain blocked; the new fault observations use a fixed common 4 operations/s, not 90% of an unconfirmed capacity.

Status: pilot execution rules are locally frozen; the confirmatory design and analysis plan remain candidates awaiting pilot evidence, readiness review, and preregistration. No stable capacity, adequate sample size, or observed architecture advantage is asserted.

## Engineering gate

Run the unit suite and real PostgreSQL integration test. Execute short REST and Kafka load runs, then adapter-stop and database-delay runs in separate engineering evidence roots. Verify callback identity, commit timestamps, client-attempt accounting, resource coverage, and invariant reports. Include provider acceptance followed by response loss, event-handler rollback/redelivery, and REST restart from PREPARED. Preserve unsuccessful engineering attempts.

## Capacity pilot

Use one frozen host and the final four-worker configurations. The user-approved v2 split uses **two minutes of warm-up and four minutes of measurement for exploratory screening only**. Fresh boundary confirmations and fault checks retain five minutes of warm-up and ten minutes of measurement. Every run retains up to ten minutes of drain after each phase, plus setup/reset and cleanup overhead. Run one architecture at a time. Start at 4 operations/s and screen both architectures once per candidate, doubling a still-unbounded rate. Refine the last stable-to-unstable interval by integer bisection until its width is at most 10% of the stable rate. At a resolved boundary, require three fresh full-length confirmation runs per architecture in randomized paired order; screening runs do not count as confirmations. A failed confirmation tightens the boundary and resumes refinement under the same rule. Short screening can miss slow-developing instability; it is not a claim that six minutes is equivalent to the full observation horizon.

The frozen pilot stability rule requires valid instrumentation, no safety failures, at least 99.5% workload checks, no dropped iterations, no failed or pending transfers after drain, and terminal delivery coverage. For the final six complete 30-second measurement windows, the least-squares backlog slope must be nonpositive and every window's p95 must be at most 110% of their median p95. All three fresh confirmation runs must pass. Do not change this rule in response to outcomes; any methodological amendment requires explicit review and a separately labelled evidence series. The shared rate is the lower confirmed stable capacity. Round the four offered rates consistently, rejecting duplicate or nonpositive absolute rates.

After capacity confirmation, run three matched pairs for each full-duration fault at 90% of the shared rate: twelve fault runs if this phase completes. The total pilot count is adaptive, bounded by the 72-run/24-hour launch limits and other stop rules in [CAPACITY_PILOT_EXECUTION.md](CAPACITY_PILOT_EXECUTION.md). These are resource ceilings, not a required sample size. A 15-minute progress check is independent of the sequential run lifecycle and may observe a run still in progress.

## Replication and blocking

The 96-run candidate plan has eight execution blocks for LOAD and eight for FAULT. Each LOAD block contains both architectures at all four loads; each FAULT block contains both at both faults. Randomize inside each block and retain contiguous block IDs. Match architecture pairs by execution block, workload seed, load, and fault. LOAD/FAULT are study strata, not substitutes for execution-block IDs.

Eight repetitions remain a provisional budget. Use pilot run-level variability to simulate confidence-interval width and decision frequency at the prespecified 10%, 15%, and 20% effects. Publish the simulation assumptions and results. If eight are inadequate, amend and preregister the matrix before confirmation, rather than claiming the budget is automatically sufficient.

Pilot trials are additional and cannot substitute for confirmatory repetitions. With the same twelve cells and a common final replication count of `r`, the confirmatory total is `12 × r`; the current candidate uses `r = 8`. The current generator, validator, controller checks, and tests enforce that candidate. If the count changes, update and verify them together with the analysis and documentation before freezing a new confirmatory matrix; do not alter the active pilot source. At 96 runs, warm-up/measurement alone totals 24 hours, with up to 32 further hours across both drains and additional overhead, excluding the pilot.

## Analysis decisions to freeze

Use paired run-level contrasts within execution blocks. The reference analysis script reports bootstrap intervals for the difference relative to the REST mean and exact paired sign-randomization p-values. Resample complete architecture pairs, not requests. Use at least 10,000 bootstrap draws with a fixed analysis seed. This is the implemented primary analysis; a mixed-effects model is not currently implemented or claimed.

Define four multiplicity families before data collection: four goodput contrasts, four latency contrasts, two recovery contrasts, and two backlog-clearance contrasts. Apply Holm within each family. Report the family definition explicitly; this does not claim family-wise control across all four families jointly. With only eight pairs, exact randomization p-values are discrete; the pilot must account for that limitation.

For recovery and backlog clearance, compare restricted mean durations at a common administrative horizon no longer than the shortest valid observed horizon in that cell. Every censored run contributes time up to that horizon; do not discard non-recovery. Report event counts, horizons, and censoring beside the contrast. A cell with no measurable baseline is not an estimable recovery comparison.

A conditional leader requires no safety failure in that architecture/cell, an interval entirely beyond the practical-effect margin, and Holm-adjusted p <= 0.05. Practical similarity requires the whole interval to lie inside the symmetric margin. Otherwise report inconclusive. No latency contrast is estimable when a run has no correct completions; report that performance failure, do not silently drop its run-level p95. Report all run dispositions alongside estimates.

The thresholds remain 10% for goodput, 15% for latency, and 20% for recovery. As approved on 20 September 2026, backlog-clearance time is a descriptive secondary endpoint with no practical-winner threshold. Report its estimate, interval, and censoring without declaring a practical leader or similarity; a threshold is not a missing requirement for protocol freeze. Any future change to that role would require an explicit protocol amendment before confirmation.

## Before confirmation

Archive code and source hash, lock file, image digests, resolved Compose configuration and runtime limits, pilot evidence, capacity decision, final matrix, analysis plan, and preregistration identifier. This directory was supplied without Git metadata; source snapshots remain available, but a real revision identifier requires placing the project under version control. Do not invent one.

The paper should retain the pre-results stage until these gates and the measured study are complete. Related-work novelty still needs a source-by-source comparison; the implementation does not establish an open literature gap.
