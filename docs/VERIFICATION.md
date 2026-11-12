# Engineering verification record

## Current check (12 November 2026)

- `npm test`: **289 tests, 287 passed, zero failed, 2 skipped**. The two skipped tests need a live PostgreSQL (`POSTGRES_TEST_URL`). There are 33 test files and 126 JavaScript files in `src/`, `scripts/` and `test/`.
- New suites since September cover the campaign schedule and order balance (`campaign.test.js`), the fault catalog, its qualification rules and recovered confirmations (`fault-catalog.test.js`), serial and batched outbox dispatch (`outbox-dispatch-modes.test.js`), and the Swagger page (`api-docs.test.js`).
- The replicated campaign itself is the large-scale check: 207 runs, no failed transfers, no duplicates and no ledger violations. See [REPLICATED_CAMPAIGN.md](REPLICATED_CAMPAIGN.md).
- The public release build recomputes both studies' analyses from the redacted public export and requires an exact match with the private analysis.

The rest of this page is the September record, kept as written.

## September record

Verification date: 20 September 2026. These are engineering checks, not research results.

## Completed checks

- Full suite with `POSTGRES_TEST_URL=postgresql://experiment:experiment@127.0.0.1:25432/experiment npm test`: **49 passed, zero failed, zero skipped**. Without the database environment variable, 48 pass and the PostgreSQL integration test is skipped.
- Real PostgreSQL checks include checked-out connection termination, transactional rollback, atomic inbox/state/outbox handling, corrupted-posting detection, persisted terminal state, idempotency, and REST restart from PREPARED with a saved provider result.
- In-memory tests compare a fixed request corpus across architectures, including both provider mappings, declines, replay, callbacks, state histories, ledger postings and balances. Lost-response-after-acceptance simulations produce one provider effect in both architectures. A journal restart test preserves the provider response and rejects changed payloads.
- Measurement regressions cover commit acknowledgement rather than pre-commit timestamps, unfinished backlog, drain completions, absent ingress evidence, negative intervals, boundary arrivals, callback identities, missing resource samples, dropped arrivals, failure classification, source-hash changes, and recovery without a usable baseline.
- Analysis tests cover paired run-level effects, exact sign-randomization probabilities, censoring horizons, Holm adjustment, missing endpoints and safety gates. The analysis CLI emits all 12 planned contrasts as inconclusive when supplied insufficient engineering runs.
- Syntax checks passed for all 62 JavaScript files in `src/`, `scripts/`, and `test/`.
- `npm run matrix:validate`, controller dry-run selection, `npm run smoke`, `npm run verify:invariants`, and `docker compose config --quiet` passed. The invariant script reconciles 20 synthetic transfers per architecture.

## Container-level evidence

Docker Desktop was started with permission. Validation used the dedicated Compose project `lubanga-coordination-validation`, PostgreSQL host port 25432, and the final four-worker application configuration. The application CPU/memory settings were verified in container inspection data: 2 CPUs and 1 GiB. Broker and shared infrastructure are additional measured resources, not included in that application limit.

| Check | Evidence directory | Recorded status |
|---|---|---|
| REST load, final regression | `results-engineering-v2-rest-final/LOAD-R-A-L50-Nstandard-Fnone-R06/` | QUALIFIED |
| Kafka load, corrected clock | `results-engineering-v2-kafka-clockfix/LOAD-K-A-L50-Nstandard-Fnone-R06/` | QUALIFIED |
| REST adapter stop/restart | `results-engineering-v2-adapter-fault/FAULT-R-A-L90-Nstandard-Fadapter-crash-R01/` | CENSORED |
| Kafka database latency, corrected proxy | `results-engineering-v2-database-fault-final/FAULT-K-A-L90-Nstandard-Fdatabase-delay-R01/` | CENSORED |

Every listed run passed its recorded evidence gates and safety checks, matched terminal callbacks, and had zero pending transfers after drain. The final latency-only run's application logs contain no PostgreSQL connection errors. Resolved configuration, image IDs, runtime limits, and start/end source hashes are included in the final controller's schema-4 evidence.

Load checks used two seconds of warm-up and ten seconds of measurement at two operations/s. Fault checks used two seconds of warm-up and sixteen seconds of measurement at four operations/s, with injection at three seconds and a five-second fault. The input `SUSTAINABLE_RATE=4` was an engineering setting, **not** an estimated sustainable capacity.

The fault checks are deliberately too short to provide three complete pre-fault and post-fault 30-second windows. Their recovery endpoints are non-estimable/censored, not successful recovery-time estimates. A valid evidence flag is not proof of an architecture advantage. No timing comparison between these short runs is a research conclusion.

## Failures retained and fixes verified

- `results-engineering-v2-kafka/`: the first Kafka load run failed client-attempt accounting at the measurement boundary. The marker now uses k6's actual scenario start, and accepted transfers outside the measured cohort remain accounted for. The corrected run is preserved separately.
- `results-engineering-v2-database-fault/` and `results-engineering-v2-database-fault-diagnostics/`: database-fault runs exposed an unhandled checked-out PostgreSQL client error. The latter retains container diagnostics. Client error handling and real connection-termination regression coverage were added.
- `results-engineering-v2-database-fault-clientfix/`: the application survived, but logs exposed an unintended proxy reconfiguration at fault boundaries. Automated evidence gates passed, yet the fault was not latency-only. Its `ENGINEERING_NOTE.md` explicitly excludes it from research comparisons.
- `results-engineering-v2-database-fault-clean-proxy/`: staging caught a proxy-initialization race. The controller now waits for the initialization container before clearing a fault or resetting the trial database. The final rerun passed.

Failed runs were not overwritten or reclassified after fixes. Earlier successful engineering attempts also remain on disk. The final controller captures logs before teardown on failure and resets trial data before application recovery starts. Validation containers were removed after testing; named volumes and evidence files were retained.

## Remaining research-readiness work

1. Pilot stable capacity and freeze a common absolute load grid.
2. Run the full-duration faults and a broader abrupt-crash/HTTP-response-loss campaign. (Since done in part: the campaign ran full-duration faults, an application kill and a database restart. A real HTTP response-loss injection was not added.)
3. Assess run-level precision and justify or revise eight repetitions.
4. Freeze the statistical plan, censoring rules, exclusions, images and source snapshot; register the protocol.
5. Execute and analyze the complete measured study before reporting an architecture advantage.

See `PILOT_AND_ANALYSIS.md` for the proposed design, `MEASUREMENT.md` for metric definitions, and `MANUSCRIPT_ALIGNMENT.md` for paper changes. The original Word manuscript is unchanged. The supplied directory has no Git metadata, so manifests retain source hashes rather than an invented commit identifier.
