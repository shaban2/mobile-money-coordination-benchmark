# Measurement and evidence contract

This contract replaces the draft's request-transmission-to-durable-completion wording. Results use outcome schema 2. Older evidence cannot be silently upgraded.

## Time boundaries

The API captures `receivedAt` when Node accepts the HTTP request, before reading its body or acquiring a database connection. It persists that timestamp in `API_RECEIVED.details`. After the terminal database transaction returns from `COMMIT`, the application captures `confirmedAt` and persists `COMMIT_CONFIRMED` in a separate write. Their difference is API-ingress-to-commit-acknowledgement latency on one application wall clock. It includes database acknowledgement delay but excludes client-to-API transit. `TERMINAL_STATE` is an internal transactional event and is never used as a commit timestamp.

The observer write adds overhead to both conditions. A crash after commit but before observer persistence leaves missing timing evidence. A terminal state remains valid business evidence, but no original latency is reconstructed. Wall-clock adjustments must be prevented during experiments; negative intervals are invalid observations. Client send and response timestamps are retained separately in the k6 attempt stream.

k6 emits `execution.scenario.startTime` on its first measured iteration. Measurement lasts the configured duration from that timestamp. The controller schedules faults against this marker rather than container launch. All containers share the host clock. The observation end is explicitly recorded after drain. Accepted attempts whose API ingress falls just outside the window remain in client/server accounting but outside the measured cohort.

## Outcomes

- Correct goodput: reconciled, unique successful transfers accepted during measurement and confirmed before measurement end, divided by measurement seconds.
- Eventual correct completion rate: the same arrival cohort, allowing confirmations during drain, divided by measurement seconds. Report it alongside `completedDuringDrain`; do not call it measurement throughput.
- Primary p95: ingress-to-commit-acknowledgement intervals for correct measurement-window completions. Report eventual-cohort p95, failure counts, and pending counts alongside it to reveal selection effects.
- Backlog: measured arrivals minus observed commit confirmations at each window boundary. Never-terminal transfers remain in the count. Missing commit observations cannot be treated as a measured completion.
- Recovery: the end of the third consecutive complete 30-second window under continued load meeting 90% of baseline goodput and 110% of baseline p95. Baseline uses the last three complete pre-fault windows consistently. No recovery can be established from partial windows or drain after traffic stops.
- Backlog clearance: first complete post-fault window reaching the pre-fault maximum backlog. It may occur during drain and is reported separately from recovery under continued load.
- Censoring: store the observed horizon and a separate event indicator. A missing recovery time is not zero.

The status-retrieval workload uses a fixed setup transfer so every virtual user can perform the same deterministic 80/20 operation mix. This transfer is outside the measured arrival cohort. It represents retrieval of an existing transfer, not a distribution of polling ages. Seeds rotate synthetic wallet identities; the operation schedule is deterministic. Replay is 5% of creation attempts, not 5% of all operations.

## Run validity and outcomes

`qualification.valid` assesses instrument completeness, actual workload delivery, configuration, resources, and fault evidence. `qualified` is retained as an alias for evidence validity. Consumers must use `status` and `eligibleToLead` rather than assuming valid means successful.

| Status | Meaning | Retain for analysis |
|---|---|---|
| QUALIFIED | Valid evidence, no observed safety or delivery failure, no censoring | Yes |
| PERFORMANCE_FAILURE | Valid evidence with failed workload checks, failed transfers, or incomplete terminal delivery | Yes |
| SAFETY_FAILURE | Valid evidence with violated ledger invariants | Yes; architecture cannot lead |
| CENSORED | Valid evidence with unfinished work or no observed recovery/clearance | Yes, with observation horizon |
| INVALID | Instrumentation, workload delivery, or configuration requirements not met | Preserve with reasons; outside primary contrasts |
| FAILED / INCOMPLETE | Controller failure or unfinished collection | Preserve for audit |

Callback coverage is by transfer identifier and matching final status; duplicate callbacks do not substitute for another transfer. Resource coverage requires multiple samples spanning the window, bounded gaps, and every expected service (with an allowance for the scheduled adapter stop). A dropped k6 iteration invalidates the claimed common offered load. A failed HTTP check alone is a performance observation.

Manifest schema 4 archives resolved Compose configuration and container inspection data, and checks source, matrix, Compose, and dependency-lock hashes again at run end. A fresh workload namespace prevents the persistent provider journal from reusing an earlier invocation's effects. Fault timestamps are observed controller boundaries: stop acknowledgement to adapter health readiness, or toxic-add to toxic-remove acknowledgement. They are not claimed to be exact first-packet failure times.

Safety checks inspect actual debit and credit postings, matching transaction amounts, account balances reconstructed from postings, conservation per currency, unique idempotency keys, and terminal histories. Provider economic balances are outside the simulation boundary.
