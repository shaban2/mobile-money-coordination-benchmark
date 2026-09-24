# Remaining experiment plan

Status: **proposed roadmap, not an execution authorization or frozen protocol**. Prepared 20 September 2026 from the researcher conversation and existing design brief. No new numerical capacity threshold is adopted here.

**21 September execution update:** the researcher approved implementing/verifying the drafted rule and then one 4/s screening pair, stopping for review. Implementation verification exposed bounded-oscillation misclassification; the rule is held before live collection. No adaptive search or fault trial is authorized. See [validation and launch hold](../docs/CAPACITY_QUEUE_V1_VERIFICATION.md).

**Revalidation update:** the researcher requested “revaliddate”. [The 2,400-trace revalidation](../docs/CAPACITY_RULE_REVALIDATION.md) confirms implementation correctness but does not clear automatic capacity decisions. A screening-description candidate remains unadopted; live runs are still blocked, and no previous evidence was rescored.

**Subsequent scope approval:** “yes lets proceed” adopts the descriptive interpretation for the already proposed first REST/Kafka screening pair only. [Execution amendment](../docs/QUEUE_OBSERVATION_V2.md): 4/s, 2m warm-up plus 4m measurement each, engineering verification first, then mandatory review after two. No numerical capacity boundary, higher rate, fault scenario or main-study launch is authorized by this amendment.

## Starting point

The four-run calibration is complete: two REST and two Kafka runs at 4 operations/second, without injected faults. Both handled that workload correctly; REST had lower completion latency. This is diagnostic evidence, not maximum capacity, fault-recovery evidence or a confirmatory architecture winner. Preserve both calibration evidence roots, the interrupted warm-up and all earlier pilot dispositions.

The agreed capacity definition remains: “the highest rate that processes transfers correctly without a persistently growing queue, with latency reported separately.”

**Order:** define and verify rules → find and confirm capacity → test faults → finalize repetitions and freeze → execute the main study. Review each stage before authorizing the next.

## 1. Define and verify the new capacity rule

**Work**

- Write a versioned amendment separating evidence validity, correctness, sustained-load handling and latency. Remove latency jitter from the *new* capacity decision, not from historical verdicts. Keep p95/p99 and variability in the report.
- Specify exactly what queue is measured, using all accepted unfinished transfers. Failed transfers must not make queue shrinkage look like success. Compare unique arrivals with correct completions; exclude status queries and replays from new-transfer counts.
- Agree the numerical growth tolerance, persistence duration, observation horizon and measurement uncertainty. Start discussion from the existing 30-second reporting windows and 10-minute full measurement; inspect the whole trajectory, not only the final queue or final few windows. A drained queue alone does not establish sustained handling during load.
- Define separate outcomes for correctly sustained load, unsustained load, invalid measurement and inconclusive evidence. Generator limitations, missing records or competing workloads must never become an architecture capacity boundary. Define a bounded follow-up policy for inconclusive results before execution.
- **Decision recorded 21 September:** retain the current 50 ms outbox polling interval for the next capacity pilot. A separate, fixed-budget sensitivity experiment remains optional and requires its own approval. Any sensitivity test must hold business guarantees and other settings constant, retain all outcomes and measure database/CPU cost as well as latency. It is not another confirmatory cell. If the implementation changes, verify it and freeze a fresh baseline before capacity search; do not pool revisions.
- Test the new rule against synthetic flat queues, bounded bursts that clear, persistent accumulation, temporary recovery followed by growth, failed transfers, missing timings and dropped load-generator iterations. Passing the current four runs is not the criterion for selecting a rule.
- Update configuration, evaluator, controller guards, tests and operational docs together. Preserve old freezes. Add equivalent checks for any continuation path used by the new revision.

**Exit gate:** researcher-approved written rule and decision table; regression and disposable-database checks pass; short wiring checks pass; source, images, resources, diagnostics and resource/run ceilings frozen for a separately named pilot. Exact queue thresholds remain **pending agreement**.

## 2. Find capacity, then confirm it

**Proposed execution design**

- Start a fresh no-fault REST/Kafka pair at 4 operations/second under the new rule. Calibration does not replace this pair.
- Use paired, sequential screening, provisionally retaining **2 minutes warm-up + 4 minutes measurement**. Increase candidate rates, for example 4 → 8 → 16 → 32, only while supported by the rule and within an approved ceiling. Track separate architecture boundaries; do not keep increasing an already-unsustained architecture without the predefined refinement rule.
- Refine each sustained/unsustained bracket. The existing 10% bracket-width target is a proposal to review, not precision demonstrated by the present calibration. Handle integer-rate limits explicitly.
- At the candidate boundaries, provisionally require **three fresh full-length runs per architecture**, each **5 minutes warm-up + 10 minutes measurement**. Match seeds and balance/randomize architecture order. If rates differ by architecture, these boundary trials are not a same-load architecture comparison.
- A failed confirmation is retained and triggers the predefined refinement/review policy. Never add attempts until three favorable outcomes appear. Screening observations do not count as confirmation runs.
- Report the highest confirmed tested rate and its adjacent failing rate, observation horizon and environment. If the ceiling is reached without failure, report a tested lower bound, not a discovered maximum.
- Define the shared rate as the lower confirmed rate. Derive common 25%, 50%, 75% and 90% absolute operation rates, with a documented rounding rule; reject duplicate/nonpositive grid values.

**Exit gate:** reviewed capacity evidence for both implementations, usable common load grid, no outstanding correctness/measurement issue, and a frozen configuration for fault pilots. Latency remains a separate outcome.

## 3. Pilot the faults and close crash-readiness gaps

**Work**

- Use the same absolute **90% shared rate** for REST and Kafka. Retain **5-minute warm-up + 10-minute measurement** for fault pilots.
- Adapter unavailability: at measurement second **240**, stop the shared adapter service, wait **30 seconds**, restart and verify health. Record actual stop acknowledgement and health-ready timestamps; the observed outage can exceed the requested wait.
- Database delay: at measurement second **240**, add **100 ms downstream latency for 60 seconds** through the existing proxy, then remove it and record actual boundaries.
- k6 continues generating traffic; the experiment controller injects/removes the fault. Derive recovery and backlog from durable records, using actual clearance time rather than the planned time.
- Provisionally retain **three matched pairs per fault**: 12 full runs total. Pair workload seeds and order blocks. Validate the required pre-fault baseline and at least three complete post-clearance 30-second windows.
- Review the recovery definition before launch: the old rule includes latency returning within 110% of baseline. Decide prospectively how to distinguish restored load handling from lingering latency variation. Do not silently change the recovery endpoint because the capacity definition changed.
- Check failed/pending transfers, retries, callbacks, duplicate provider/ledger effects, conservation and drain completions. Keep valid non-recovery as censored and retain performance/safety failures; these are not automatically invalid instrumentation. Backlog clearance remains descriptive, with no winner threshold.
- Separately complete engineering tests of abrupt application termination near provider acceptance and database commit, and real HTTP response loss after acceptance. The current adapter stop/start test is not proof of abrupt-crash safety. Use disposable experiment data and agreed fault boundaries; verify restart, idempotency and ledger invariants. Never fabricate missing original commit timestamps after recovery.

**Exit gate:** both full fault scenarios yield trustworthy evidence (including failures/censoring), observation horizons are suitable, and crash/response-loss correctness checks pass. Any correctness failure requires investigation and a new verified revision before confirmation, not deletion of the failure.

## 4. Finalize repetitions, freeze, then run the main study

**Work before freeze**

- Use variation between independent runs and matched pairs, including load/fault pilot outcomes, to assess precision. Thousands of transfers in one run are not thousands of independent replications. Two low-load repetitions per architecture cannot justify all study cells.
- Evaluate candidate repetition counts using paired simulations/interval-width analysis, plausible variability ranges and censoring. Check the discreteness of exact paired tests and the planned multiple-comparison correction. Pilot estimates may be uncertain; do not treat one variance estimate as exact.
- Eight repetitions per cell remains provisional. With the existing design there are **12 cells**: 8 load cells (2 architectures × 4 loads) and 4 fault cells (2 architectures × 2 faults). A common repetition count `r` means **12 × r runs**; `r = 8` would mean 96. If precision is infeasible, revise scope or claims before freeze rather than promising a winner.
- Freeze endpoints, practical-effect margins, pairing, randomization, exclusions, failure/censoring treatment, administrative horizons and analysis. Preserve descriptive backlog clearance. Validate the analysis with known synthetic cases and all planned dispositions.
- Update and verify the matrix generator, validators, controller checks, tests and docs if the repetition count changes. Archive hashes, dependencies, image IDs, host resources, retry/timeouts, fault settings, measurement rules and matrix. Register the protocol before confirmatory collection; do not claim preregistration without an actual registration record.

**Exit gate:** researcher-approved protocol, justified repetition budget, verified matrix/analysis and immutable experiment snapshot. Obtain explicit launch approval for the main study.

**Main study:** run one condition at a time in predefined blocks; preserve failed/interrupted attempts; review any deviation under the frozen rules. Do not tune code, thresholds, stopping criteria or sample count after seeing confirmatory results. Analyze at run/pair level, report uncertainty and all dispositions, and limit conclusions to the tested implementation/environment.

## Time and operating rules

| Component | Proposed count | Warm-up + measurement only |
|---|---:|---:|
| Screening | Adaptive | 6 minutes/run; 12 minutes per two-architecture pair |
| Boundary confirmation | 3/architecture at final candidates | 90 minutes for six runs |
| Fault pilots | 3 pairs × 2 faults | 180 minutes for twelve runs |
| Main study | 12 × r | 3 × r hours; 24 hours if r = 8 |

These are traffic-time calculations, not finish-time estimates or sufficient sample-size claims. Failed boundary confirmation can add prespecified refinement work. Each run can also have **two up-to-10-minute drains**, plus setup, reset, exports and cleanup. No sensitivity/crash-readiness time is included. Agree ceilings and check actual pilot timings before scheduling.

Keep the Mac awake and isolated while running. Before launch, inspect exact competing containers; do not infer permission to stop new replacements. Pause only at a supported complete-pair/block checkpoint after verifying ended processes, cleanup and restoration. Preserve active-time budgets across pauses. Monitor meaningful progress/completion/failure only if execution is authorized; keep the current monitor paused meanwhile.

## Decisions to settle next

1. Expected mechanism and alternatives: outstanding researcher answer; association does not establish that polling or host scheduling caused the full gap.
2. Resolved 21 September: keep the 50 ms dispatch configuration. Any sensitivity check is separate and not yet authorized.
3. Numerical queue-growth/persistence rule, inconclusive-result policy and run/time ceilings.
4. Recovery endpoint definition and observation horizon; final replication count follows pilot precision review.

The full five-segment research discussion remains tracked in [design_brief.md](design_brief.md). This assistant-proposed roadmap does not fill unanswered sections as researcher-approved answers.

A concrete [capacity-rule proposal and consistency check](capacity_rule_draft.md) was drafted on 21 September. Its numerical conditions still need approval and implementation verification before a new pilot can be frozen or launched.

## Method references

Matching and randomizing execution blocks helps account for nuisance variation: [NIST randomized block designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm). Precision depends on independent replication and the sampling design: [NIST choosing a sampling scheme](https://itl.nist.gov/div898/handbook/ppc/section3/ppc332.htm). These principles do not supply our numerical capacity threshold or justify eight runs automatically.
