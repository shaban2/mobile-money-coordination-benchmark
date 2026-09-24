# Targeted follow-up proposal

Status: **PROPOSED ONLY — no experiments launched, no protocol frozen, no additional run count approved.** The completed six-run evidence remains the exploratory reporting set. This proposal does not replace its rules or alter its results.

## First priority is execution-level repeatability

If further machine time is available, the smallest useful next *balanced-order batch* is two fresh matched pairs per existing condition: one REST→Kafka and one Kafka→REST. Randomize the order of those two blocks within each condition and balance their placement across sessions where feasible. That is **12 new runs**, intended to expose order sensitivity and obtain an initial execution-variation estimate, not to guarantee publication adequacy or precise confidence intervals.

| Condition retained exactly | Fresh pairs | New runs | Warm-up plus measurement traffic |
|---|---:|---:|---:|
| 8/s, no fault, 2m + 4m | 2 | 4 | 24 min |
| 4/s, 30 s adapter outage, 5m + 10m | 2 | 4 | 60 min |
| 4/s, 100 ms database-response delay for 60 s, 5m + 10m | 2 | 4 | 60 min |
| Total | 6 | 12 | 144 min |

Setup, drain, review and cleanup are additional. This is not an ETA. Run serially; pause only at a completed matched-pair boundary after cleanup, unless safety requires an immediate stop. A resumed session must recheck configuration, host isolation and source/image identities. Do not shorten or lengthen a condition silently.

Why two fresh pairs? It is the smallest batch that can include both realized orders in each condition. **It is not a statistically justified final sample size.** The existing REST-first pairs may be displayed beside fresh observations with explicit provenance, but they should not silently become a preregistered baseline or be used to conceal unbalanced order. Fresh results remain a separately labelled collection.

### Decisions required before collection

1. Confirm that the goal is better-supported exploratory reporting, not maximum-capacity estimation or a confirmatory superiority claim.
2. Agree a practical precision target and maximum machine-time budget. There is no defensible universal value inferred from the current one-pair dataset or from another paper's run count.
3. Prespecify the block schedule, matched workload seeds, session boundaries, duration, implementation identity, validity/correctness rules, and which comparisons will be reported.
4. Lock the descriptive run-level analysis and the decision rule for *any later* precision study before seeing the fresh results. Do not stop early when a preferred winner appears. This initial batch ends at its fixed budget regardless of direction; uncertainty may remain unresolved.
5. Treat invalid collection, valid poor performance, censoring and safety failures differently. Preserve all attempts and reasons. Any replacement policy must be specified in advance; never silently replace valid slow or failed runs.

The existing correctness gates, cohort definition, callback checks and recovery/clearance definition should remain identical for both architectures. Latency jitter does not become an overload gate. Do not alter the old protocols; create a new version with reviewed source/images and explicit execution authority.

## Second priority is a focused latency mechanism test

Only after assessing repeatability, consider a **Kafka-only dispatch-interval sensitivity study** at the same no-fault load. Candidate intervals are 10, 25 and the existing 50 ms; these are engineering settings to approve, not practical-effect thresholds or an assumed optimum. First expose and test the setting without changing the baseline default. Randomize setting order, hold durability and workload constant, and collect independent repetitions under a fixed budget.

Measure completion latency, CPU, outbox residence intervals and backlog. Preserve the original 50 ms observations as the original configuration. Include dispatches triggered directly by execution, not only timer ticks. If latency changes, report a configuration sensitivity within this implementation; do not conclude that all Kafka overhead is polling. Do not sum nested spans or per-component p95 values.

No setting change or sensitivity run is authorized by this document. The current study does not need this extra experiment if the paper keeps the mechanism explanation explicitly tentative.

## Third priority is workload sensitivity

The present 20% status-read stream always uses one fixture. A separate variant could read from a bounded, deterministic pool of previously created transfers, with the target-age distribution specified and logged. Plan how to share that pool across k6 virtual users before claiming a matched workload. Preserve the 80/20 mix, replay fraction and offered-rate semantics. Empty-pool behaviour and initial seeding must be defined, not allowed to drift by architecture.

This tests whether the fixed fixture matters; it does not make the workload production-representative. Empirical realism would require a lawful real workload source or a justified domain model. Do not combine new status-target behaviour and a changed outbox interval in the same unexplained revision.

## Work not needed for the current narrow claims

Do not automatically execute the old 96-run matrix or restart adaptive capacity search. A capacity paper requires a separately agreed sustained-queue-growth rule, an increasing-load search and fresh boundary confirmation. Faults at 90% of confirmed capacity require that capacity evidence first. Abrupt application or broker termination requires its own fault definition and correctness checks; the completed controlled adapter stop/start is not that experiment.

## Improving the paper without further traffic

Finish the full-text comparison for the closest transfer/Saga paper, choose a venue/track and apply its actual template, agree an artifact licence, and test the analysis on a separate machine. Publish only after the author approves the text and reviews metadata. These steps improve verifiability without relabelling the existing evidence or spending more experiment hours.

The emphasis on variability and precision follows [Kalibera and Jones](https://kar.kent.ac.uk/33611/); it does not imply their method validates a particular run count for this benchmark.
