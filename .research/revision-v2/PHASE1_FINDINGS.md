# Phase 1 findings: reanalysis of the v1 evidence

Source: `scripts/reanalyze-v1-evidence.mjs`, output in `reanalysis-v1.json`.
The script first reproduces published goodput, p95 and counts for all 10 runs. One run per cell, so nothing here has an uncertainty estimate. These are retrospective checks, and the new campaign replaces them as primary evidence.

## Completions during the fault
| Fault / pair | Arch. | Window count | Exact interval | Arrived in fault | Arrived in fault, done after |
|---|---|---|---|---|---|
| Adapter original | REST | 1 | 0 | 93 | 93 |
| Adapter original | Kafka | 1 | 0 | 93 | 93 |
| Adapter fresh | Kafka | 4 | 0 | 94 | 94 |
| Adapter fresh | REST | 2 | 4 | 92 | 88 |
| Database original | REST | 72 | 73 | 183 | 110 |
| Database original | Kafka | 15 | 17 | 183 | 167 |
| Database fresh | Kafka | 13 | 13 | 184 | 172 |
| Database fresh | REST | 73 | 73 | 184 | 111 |

The database result holds under exact counting. The 4 REST adapter completions land in the last 0.13 s of the interval, so the adapter was serving before health was observed.

## Recovery, in seconds after the fault cleared
| Fault / pair | Arch. | Fault-era transfers all finished | First normal full window ends | Three normal windows end |
|---|---|---|---|---|
| Adapter original | REST | 4.8 | 59.2 | 119.2 |
| Adapter original | Kafka | 6.2 | 59.2 | 119.2 |
| Adapter fresh | Kafka | 5.8 | 58.0 | 118.0 |
| Adapter fresh | REST | 4.6 | 59.0 | 119.0 |
| Database original | REST | 1.0 | 59.7 | 119.7 |
| Database original | Kafka | 2.2 | 59.7 | 119.7 |
| Database fresh | Kafka | 2.2 | 59.7 | 119.7 |
| Database fresh | REST | 1.0 | 59.7 | 119.7 |

The window columns are limited by the 30 s grid and cannot separate the designs. Rate, latency by completion and latency by arrival all land on the same window. The "all finished" column is the useful one, and it is a new measure defined after seeing the data.

Paper correction: "cleared the backlog at 6.07 transfers/s" is a 30 s window average. The backlog cleared in about 5 s.

## No-fault latency by hop (median ms, p95 in brackets)
| Hop | REST | Kafka |
|---|---|---|
| Received to validated | 5 (8) | 9 (27) |
| Validated to prepared | 2 (4) | 30 (53) |
| Prepared to provider done | 34 (39) | 79 (86) |
| Provider done to terminal | 5 (7) | 21 (26) |
| Terminal to commit confirmed | 1 (2) | 1 (2) |

Hop medians sum to 47 and 140 ms, close to the observed 50 and 141 ms. The three hops after validation add about 89 ms of the gap. Trace times have 1 ms resolution, and medians do not strictly add.

## Database delay: what the dispatcher did
| Pair | Arch. | Statements over 10 ms | Linked to a transfer | Outbox marks per s | Median mark (ms) |
|---|---|---|---|---|---|
| Original | REST | 4,001 | 2,317 | none | none |
| Original | Kafka | 4,443 | 2,120 | 6.35 | 102.7 |
| Fresh | Kafka | 4,112 | 1,847 | 5.85 | 103.1 |
| Fresh | REST | 4,007 | 2,317 | none | none |

- `db.pool_query.UPDATE` spans without a transfer are `markOutboxPublished`. The other pool-level UPDATEs run only on failure or at run end.
- Kafka issued 1.03-1.11 times REST's slow statements during the delay, not 1.7 times.
- Dispatch held near 6 events/s against estimated demand of about 15 events/s.
- This fits a serial-dispatcher limit but does not prove it. Queue depth was not sampled, and a stalled system also issues fewer statements, so the near-equal count is partly an effect of the stall. Block C tests this.

## Fixes carried into Phase 2
`src/experiment/outcomes.js:33` drops commit events marked `recovered`. They are written at `postgres-persistence.js:278`, so worker-kill runs could miscount transfers until this is handled.
