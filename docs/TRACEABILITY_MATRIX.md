# Paper-to-project traceability

| Paper element | Project implementation | Verification |
|---|---|---|
| Fixed bilateral P2P contract | `contracts/openapi.yaml`, `src/domain/transfer.js` | Contract and domain tests |
| Fixed asynchronous acknowledgement | `src/application/payment-application.js`, R-A and K-A Compose profiles | Coordination-condition tests and runtime preflight |
| Callback and status retrieval | callback sink, callback receiver, gateway, transfer GET route | Callback evidence and trace-completeness gate |
| Two telecom-provider mappings | Profile A and Profile B adapters | Adapter tests and fixed 50:50 workload sequence |
| REST orchestration | `src/coordination/rest-orchestrator.js` | R-A tests and Docker profile |
| Kafka choreography | `src/coordination/kafka-choreography.js`, Kafka event bus | K-A tests and Redpanda profile |
| Same durable state and ledger | PostgreSQL persistence and migrations | Reconciliation and safety gates |
| Shared provider retry burst and deadline | shared workflow steps; unknown effects remain pending for reconciliation | Recovery and response-loss tests |
| Open-loop offered load | `infra/k6/load.js` | k6 summary and metric stream |
| Shared load grid | `config/run-matrix.json` | `npm run matrix:validate` |
| Adapter crash | separate adapter container and timed controller | `fault-evidence.json` and fault log |
| Database delay | PostgreSQL through Toxiproxy | `fault-evidence.json` and Toxiproxy log |
| Whole-system resources | time-series Compose-project Docker sampler | `docker-stats.jsonl` gate |
| Timing completeness | API ingress and COMMIT acknowledgement observations | 99.5% timing gate; a confirmation recovered after a crash counts only as a latency upper bound |
| Correct goodput inputs | measured arrival cohort, commit confirmations, ledger reconciliation | drain separation and unfinished-backlog tests |
| Statistical contrasts | `scripts/analyze-experiment.mjs` | paired bootstrap, sign-randomization, Holm and censoring tests |
| Candidate confirmatory replication | Current matrix: 64 load runs and 32 fault runs, eight per cell; final count pending precision review | matrix validator and controller sequence; no claim of sample-size adequacy or preregistration |
| Separate adaptive capacity pilot | `config/pilot-protocol.json`, `scripts/capacity-pilot.mjs` | paired screening, fresh confirmations, full-fault checks, preserved evidence, 72-run/24-hour ceilings; excluded from confirmatory counts |
| Evidence preservation | run manifest, state history, index, no-overwrite rule | per-run result directory |
| Replicated campaign schedule | `src/experiment/campaign.js`, `scripts/campaign.mjs` | `campaign.test.js` (order balance, cells, ladder rules); freeze and host checks before every run |
| Crash faults (application kill, database disconnection, database restart, broker kill) | `src/experiment/fault-catalog.js`, `scripts/service-fault-controller.mjs` | `fault-catalog.test.js`; `fault-evidence.json` per run |
| Outbox polling, dispatch mode and worker count | `OUTBOX_POLL_MS`, `OUTBOX_DISPATCH_MODE`, `WORKER_CONCURRENCY` in `src/system.js`, `src/infrastructure/outbox-dispatcher.js` | `outbox-dispatch-modes.test.js` |
| Campaign analysis | `scripts/analyze-campaign.mjs` | `.research/revision-v2/campaign-analysis.json`; recomputed exactly from the public export |
| Interactive API documentation | `src/http/api-docs.js`, `contracts/openapi.yaml` | `api-docs.test.js` |

## Standards boundary

- GSMA informs selected public fields, identifiers, status retrieval, callback, and message concepts. Formal GSMA conformance is not claimed.
- Mojaloop informs selected preparation, fulfilment, provider-boundary, accounting, history, and reconciliation ideas. Mojaloop is not deployed.
- The provider profiles and simplified state names are experimental artifacts.
- The research contribution is evidence about internal coordination architecture, not a new payment standard.
