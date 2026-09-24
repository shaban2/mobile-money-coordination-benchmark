# Pre-calibration verification — 20 September 2026

This is engineering verification, not capacity evidence or a calibration result.

- Final source fingerprint: `566eec698cb5d96eff09b8d0fb8bf2cd69dd3b9d9bac9a5da5ecc8765909189b`.
- `npm test`: 140 tests, 138 passed, zero failures, two PostgreSQL integration tests skipped without database environment variables.
- Both database integration tests were separately run against a disposable PostgreSQL 17 instance with I/O timing enabled: 2 passed. The diagnostic test observed a real `PgSleep` wait, WAL/checkpointer/I/O counters and the observer's read-only setting. Existing persistence tests verified durable transfers, ledger behavior, replay and restart recovery. The disposable container was stopped and auto-removed; no user database or persistent volume was deleted.
- Syntax checks passed for the modified runner, preparation/controller, resource collector and server entry point.

## Short end-to-end checks

`scripts/verify-calibration-instrumentation.mjs` used `config/engineering-calibration-smoke.json`, 10-second warm-up and 30-second measurement at 4 operations/s. Results are separately preserved in `results-engineering-calibration-v1`.

| Check | REST | Kafka |
|---|---:|---:|
| Qualification | QUALIFIED | QUALIFIED |
| Measured unique transfers | 91 | 91 |
| Correct completions | 91 | 91 |
| Failed / pending after drain | 0 / 0 | 0 / 0 |
| PostgreSQL diagnostic samples | 122 | 131 |
| Recording errors / overwritten / skipped / truncated | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Linux snapshots | 15 | 16 |
| Invalid Linux snapshots / unavailable files | 0 / 0 | 0 / 0 |
| Verified teardown | passed | passed |

These short checks verify wiring and exports, not full-duration reliability, causal explanations, observer overhead in an uninstrumented control, or sustainable capacity. A separate disposable PostgreSQL integration test briefly overlapped the REST engineering setup; these runs are explicitly excluded from calibration/confirmatory performance evidence.

After checks, the engineering Compose project had no remaining containers, no pilot/controller/collector was running, and the exact three approved the external stack instances were running and healthy. V4 and V5 still each had two records at `REVIEW`. Their protocol, frozen Compose override and source-archive hashes matched their original frozen checksums. No historical evidence was reclassified.

The new batch is governed by [CALIBRATION_V1.md](CALIBRATION_V1.md). Its freeze and actual launch state must be read from the fresh `results-calibration-v1` root, not inferred from this note.
