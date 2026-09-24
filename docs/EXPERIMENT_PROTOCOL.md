# Coordination-only experimental protocol

This protocol implements the international conference paper's single design choice. The only manipulated factor is internal coordination architecture.

Status: candidate confirmatory protocol, not yet frozen or externally preregistered. The separately frozen adaptive pilot is described in [CAPACITY_PILOT_EXECUTION.md](CAPACITY_PILOT_EXECUTION.md). Its runs are additional to the provisional confirmatory budget below.

## Research questions

1. Under common offered loads, how do REST orchestration and Kafka choreography compare in correct goodput and p95 durable-completion time?
2. Following an adapter-service crash or database delay, how do the two architectures compare in recovery time and backlog-clearance time?
3. What whole-system resource costs and ledger-correctness outcomes accompany those performance and recovery results?

## Experimental factor

| Condition | Workflow-control ownership | Internal transport |
|---|---|---|
| R-A | One REST orchestrator chooses each next step | Direct REST calls plus durable command intent |
| K-A | Services make local next-step decisions from events | Redpanda-backed Kafka events plus outbox and inbox records |

Client-result delivery is fixed. Both conditions return an asynchronous acknowledgement and later deliver the terminal result through callback and status retrieval.

## Held-constant elements

- One registered-wallet, off-us bilateral P2P transfer contract.
- One public request and status model.
- Two synthetic telecom-provider profiles in the same prespecified sequence.
- One transfer-state model and one double-entry ledger model.
- The same PostgreSQL schema, business durability requirements, idempotency, provider retry burst and deadline, provider delay, callback policy, and reconciliation checks. Kafka-specific inbox and outbox writes remain measured implementation overhead.
- The same standard client-network profile.
- The same host, Docker resource allocation, software versions, run duration, workload seeds, and offered rate within each matched cell.

## Workload

- Open-loop k6 traffic.
- 80% transfer creation and 20% retrieval of a fixed setup transfer outside the measured cohort.
- Within creation attempts, 95% unique idempotency keys and 5% prespecified replays.
- A deterministic 50:50 provider-profile sequence.
- Four shared offered loads: 25%, 50%, 75%, and 90% of the pilot-estimated shared sustainable rate.

The shared sustainable rate is the lower stable capacity of the two implementations under the same pilot rule. The resulting absolute offered rate at each percentage is identical for R-A and K-A.

## Faults

Fault runs use the 90% shared offered load.

| Fault | Injection | Duration | Evidence |
|---|---|---:|---|
| Common adapter-service crash | Docker Compose stops the shared adapter container at measurement minute four, then starts it | 30 seconds | Fault timestamps, controller log, retry evidence, recovery and reconciliation |
| Database delay | Toxiproxy adds 100 ms downstream latency to the PostgreSQL path at measurement minute four | 60 seconds | Fault timestamps, Toxiproxy log, latency, recovery and reconciliation |

Kafka-broker failure, weak client networks, internal network partitions, and regional failures are outside this paper.

## Run lifecycle

1. Start one condition and verify that runtime configuration matches its matrix cell.
2. Apply the fixed standard client-network profile.
3. Reset state and callback evidence.
4. Warm up for five minutes.
5. Reset again so warm-up transfers cannot enter measured evidence.
6. Register the measured run and start the resource sampler.
7. Measure for ten minutes with open-loop traffic.
8. Inject the specified fault where applicable while traffic continues.
9. Allow up to ten minutes for drain and reconciliation.
10. Capture traces, callbacks, telemetry, logs, resources, and invariants.
11. Apply the qualification gates and retain any exclusion reason.
12. Clear faults and network shaping, then stop the stack.

Runs are sequential, one architecture at a time. Warm-up and measurement take 15 minutes per run; drain may add up to 10 minutes, with startup, resets, artifact capture, and cleanup additional. The active pilot's 15-minute monitoring cadence is not a trial duration or a batching rule.

## Candidate confirmatory run budget

| Block | Cells | Runs per cell | Total |
|---|---:|---:|---:|
| Load: 2 architectures x 4 loads | 8 | 8 | 64 |
| Fault: 2 architectures x 2 faults | 4 | 8 | 32 |
| Confirmatory total | 12 | 8 | 96 |

The independent replication is the run, not an individual request or transfer. Eight repetitions per cell and the 96-run total are provisional until pilot-based precision review. Any change must be justified and reflected in the matrix generator, validators, controller checks, tests, analysis, and docs before confirmatory freeze. The adaptive pilot has a separate variable count and 72-run/24-hour resource ceilings; it does not fill cells in this table.

If 96 runs are retained, the warm-up/measurement minimum is 24 hours, with up to 16 additional hours of drain plus other overhead. This excludes pilot and engineering time and is not a completion-time guarantee.

## Primary outcomes

- Correct goodput: reconciled, unique transfers from the measured arrival cohort with commit acknowledgement during measurement, divided by measurement duration. Report eventual-cohort completion rate separately.
- p95 commit-acknowledgement time: API ingress until the application receives the terminal database COMMIT acknowledgement, on the same application clock. Client-network transit is excluded. See `MEASUREMENT.md` for the exact observation and missing-data rules.
- Recovery time: time after fault removal until goodput and p95 remain within the specified recovery bounds for three consecutive windows.

Descriptive secondary endpoint: backlog-clearance time, measured from fault removal until queued or pending work is no greater than the maximum observed across the final three complete 30-second pre-fault windows. Report its estimate, uncertainty, and censoring, with no practical-winner threshold or leader/similarity declaration, as approved on 20 September 2026.

The recovery bounds are at least 90% of baseline correct goodput and no more than 110% of baseline p95 durable-completion time for three consecutive complete 30-second windows. A run that does not satisfy the rule during observation is retained as censored.

Whole-system CPU, memory, storage input/output, and network traffic are supporting outcomes. The initial `202` acknowledgement is descriptive and is not used to declare a winner.

## Safety gates

1. One durable transfer per idempotency key.
2. No terminal-state reversal.
3. No creation or loss of value across the controlled accounts.
4. Agreement between transfer records and ledger effects.
5. No duplicate provider or ledger effect from replay and retry.

A confirmed safety violation prevents the affected architecture from leading in that condition.

## Run qualification

A run has valid experimental evidence only when:

- all required artifacts are present;
- measured workload composition is within the specified tolerances for status retrieval, replay, and provider balance when at least 100 operations are observed;
- timing evidence for the measured cohort is at least 99.5% complete;
- client-attempt records reconcile with accepted transfers;
- achieved workload matches the offered rate without dropped iterations;
- whole-stack resource samples span the window without excessive gaps;
- fault evidence is complete for a fault run;
- the runtime condition uses the fixed asynchronous client mode; and
- the Compose configuration hash has not changed.

HTTP check failures, undelivered callbacks, failed transfers, safety violations, and pending work are outcomes, not automatic instrumentation exclusions. The statuses QUALIFIED, PERFORMANCE_FAILURE, SAFETY_FAILURE, CENSORED, and INVALID distinguish them. All remain in the evidence record. See `MEASUREMENT.md`.

## Planned analysis

The implemented reference analysis uses paired run-level contrasts within explicit execution blocks, paired bootstrap confidence intervals, and exact sign-randomization p-values. Restricted mean durations retain censored recovery and backlog-clearance observations at a common administrative horizon. This replaces the unimplemented mixed-effects plan and must be frozen before confirmation; see `PILOT_AND_ANALYSIS.md`.

Report effect estimates with 95% confidence intervals. Apply Holm separately within the four endpoint families defined in `PILOT_AND_ANALYSIS.md`. Practical thresholds are 10% for correct goodput, 15% for p95 latency, and 20% for recovery time. The whole confidence interval must exceed the margin and adjusted p must be <= 0.05 for a leader; the whole interval must lie inside the margin for practical similarity. Otherwise report inconclusive. Backlog clearance remains descriptive regardless of its reported statistical contrast; no practical margin is required or claimed for it.
