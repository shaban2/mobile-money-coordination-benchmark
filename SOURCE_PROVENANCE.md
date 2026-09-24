# Source provenance

This repository was created on 20 September 2026 as a separate coordination-only version of the author's local, unpublished predecessor project `lubanga-mobile-money-architecture-experiment`.

The source project remains unchanged and retains the complete 2 x 2 comparison of coordination architecture and client-result delivery.

This version intentionally narrows the confirmatory experiment to REST orchestration versus Kafka choreography. It fixes client-result delivery as asynchronous and removes synchronous Compose profiles, synchronous condition files, variable client-network cells, and the 288-run matrix from the executable study plan.

The shared domain model, adapters, PostgreSQL persistence, ledger, retry logic, REST coordinator, Kafka choreography, Redpanda event transport, callback path, and provider simulator were carried forward so the new version remains technically comparable to the original implementation.
