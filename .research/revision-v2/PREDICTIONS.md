# Predictions, written before the revision campaign

Date: 2026-11-07, before the campaign freeze.

Disclosure: these are not blind. They were written after the Phase 1 reanalysis of the 16 archived runs and after a functional pilot (`results-revision-pilot-v1`, `-v2`, `-v3`). Pilot runs are single, use shorter timing, and are never reported as evidence.

## How this changed during the pilot
The plan expected a serial outbox dispatcher to explain Kafka's stall under database delay. The pilot's batched run argues against that: 15 completions in the delay, inside the archived serial range of 13-17, with outbox depth at most 6. The batched arm stays in as a planned test. A worker-count arm was added because of this result, and the ladder gained a 256 ops/s step because REST was not saturated at 128.

## Hypotheses
Working explanation for the stall: both designs are limited to about four concurrent units of work, each paying the added delay on every round trip. REST carries a few transfers to completion. Kafka processes stage events, so many transfers advance a little and few finish. Archived traces at fault end fit this (REST 106-107 not started and 4-5 part-way, Kafka 70-88 not started and 97-118 part-way).

1. No fault: Kafka's latency gap shrinks as the polling interval falls.
2. Database delay: polling interval does not materially change Kafka's in-fault completions.
3. Database delay: batched dispatch does not materially change Kafka's in-fault completions.
4. Database delay: eight workers raise in-fault completions in both designs, and Kafka still finishes fewer than REST.
5. At fault end, Kafka's unfinished transfers are spread across stages and REST's are mostly not started, in every run.
6. App kill: Kafka is unavailable for about 60 s longer than REST, from the consumer group rejoin that blocks startup.

## Changes from the approved plan
- Block C adds `C-WORKERS8-DATABASE-R4` (10 runs).
- Ladder adds 256 ops/s (up to 6 runs). Total becomes 181 runs.
- A step counts as saturated if over 1% of operations were dropped, not on any drop.
- Bulk evidence is gzipped after each run.
- App diagnostics are not preserved through an app kill. Results for those runs come from the database.
