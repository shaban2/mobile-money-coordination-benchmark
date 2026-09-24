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
| Timing completeness | API ingress and COMMIT acknowledgement observations | 99.5% timing gate; no reconstruction after crash |
| Correct goodput inputs | measured arrival cohort, commit confirmations, ledger reconciliation | drain separation and unfinished-backlog tests |
| Statistical contrasts | `scripts/analyze-experiment.mjs` | paired bootstrap, sign-randomization, Holm and censoring tests |
| Candidate confirmatory replication | Current matrix: 64 load runs and 32 fault runs, eight per cell; final count pending precision review | matrix validator and controller sequence; no claim of sample-size adequacy or preregistration |
| Separate adaptive capacity pilot | `config/pilot-protocol.json`, `scripts/capacity-pilot.mjs` | paired screening, fresh confirmations, full-fault checks, preserved evidence, 72-run/24-hour ceilings; excluded from confirmatory counts |
| Evidence preservation | run manifest, state history, index, no-overwrite rule | per-run result directory |

## Standards boundary

- GSMA informs selected public fields, identifiers, status retrieval, callback, and message concepts. Formal GSMA conformance is not claimed.
- Mojaloop informs selected preparation, fulfilment, provider-boundary, accounting, history, and reconciliation ideas. Mojaloop is not deployed.
- The provider profiles and simplified state names are experimental artifacts.
- The research contribution is evidence about internal coordination architecture, not a new payment standard.
