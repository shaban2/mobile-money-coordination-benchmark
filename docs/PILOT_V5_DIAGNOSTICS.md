# V5 diagnostic instrumentation

The user approved improving diagnostic logging and proceeding to a fresh pilot on 20 September 2026. V4 remains preserved in `REVIEW`: two qualified screening observations at 4 operations/s, Kafka stable and REST unstable under the frozen relative-p95 rule. V4 does not establish either capacity boundary. V1–V4 must not be resumed, overwritten, selectively discarded, or combined with V5 as interchangeable replications.

V5 is a new instrumented implementation revision, not a repair of the observed V4 result. The existing protocol is unchanged: 4 operations/s initially, 2m/4m screening, 5m/10m confirmation and faults, the same stability criterion, repetitions, drains, fault parameters and stopping rules. It can stop for review again. Do not rerun until a favorable result appears. Instrumentation itself has overhead; equal instrumentation in both architectures does not prove zero overhead or justify pooling old and new timings.

## What to inspect after a run

| File | What it explains |
| --- | --- |
| `run-outcomes.json` and `traces.json` | The unchanged scientific endpoints and per-transfer event evidence. Start here to locate a slow transfer and time window. |
| `diagnostics.json` | Supplemental database acquisition/query/commit, persistence operation and provider-boundary durations; slow spans have transfer IDs and parent span IDs. Runtime samples contain event-loop delay/utilization, process CPU/memory/context switches/page faults, and pool occupancy. |
| `provider-attempt-timings.json` | Each durable provider attempt's start/end timestamps, attempt number, profile and outcome, without copying its account/payload fields. |
| `docker-stats.jsonl` | Existing container resource samples plus controller-host CPU/load/memory observations and collector duration. Host samples describe macOS here, not the Docker VM. |
| `diagnostics-at-failure.json` | Best-effort snapshot if the controller fails while the application remains reachable. Unavailable collection is recorded under `controller-error.json.diagnosticErrors`; the primary error remains primary. |

`db.acquire` includes waiting for or establishing a checked-out connection. `db.query.*` measures checked-out-client query round trips (including `BEGIN`, `COMMIT`, and `ROLLBACK`). `db.pool_query.*` includes the native pool's internal acquisition as well as its query; it is not pure database execution time. `persistence.transition`/`fulfill` encompass the corresponding method, including nested connection/query work. **Do not sum nested spans as independent delays.** `provider.execute` measures the complete adapter-boundary call, not just the provider's configured delay.

SQL durations are measured in the application with a monotonic clock; they include driver/network/scheduling delays. They do not isolate PostgreSQL lock waits, disk/fsync latency or query execution on the database server. Node event-loop delay is a process-level scheduling observation, not proof of a particular CPU/GC/host cause. Cross-source wall-clock alignment is approximate; scientific latency still uses the original API-ingress and post-COMMIT application timestamps.

## Bounded collection and privacy

Both Compose application profiles explicitly enable the same instrumentation. `createSystem()` defaults to disabled outside that environment; `DIAGNOSTICS_ENABLED=true` enables it through `server.js`. No new packages are required.

- The application aggregates all observed promise-API spans in memory. Detailed spans are retained for durations of at least 10 ms or errors, keeping the most recent 20,000. Aggregate labels are bounded. This is threshold-selected detail, not a representative latency sample.
- Runtime sampling is once per second with a 10 ms event-loop histogram resolution, retaining the most recent 4,096 samples. GC aggregates use observer-reported durations; slow GC records use their actual start/end time.
- `overwrittenSpans`, `overwrittenSamples`, and `recordingErrors` explicitly disclose missing detail. Full-run aggregate counts survive ring overwrites. Parent spans may be absent because of thresholds/overwrites.
- No new diagnostic writes occur in PostgreSQL and no per-query diagnostic messages go to stdout. Export occurs after observation/drain. Diagnostics are reset after warm-up with application reset; stale in-flight spans from the previous reset are ignored.
- SQL text, query parameters, payment/account payloads, credentials and exception messages are not copied into these new spans. Existing scientific trace/export behavior is unchanged.
- The `pg` promise API used by this repository is timed. Callback and custom query-object APIs delegate unchanged without timing. The facade does not change pool size, retry policy, transaction boundaries or release behavior.

The controller checks diagnostic enablement at readiness and requires a healthy normal-end snapshot. Failure stops for review; it never upgrades an unstable scientific result or alters qualification/stability thresholds.

Implementation: `src/infrastructure/runtime-diagnostics.js`, `src/infrastructure/postgres/diagnostic-pool.js`, `src/system.js`, and the capture steps in `scripts/run-experiment.mjs`. Host sampling is added to the existing collector through `src/experiment/host-resource-sampler.js`.

The timing APIs follow [Node.js performance hooks](https://nodejs.org/download/release/v24.14.0/docs/api/perf_hooks.html); pooling semantics follow [node-postgres Pool](https://node-postgres.com/apis/pool).

## Verification and launch boundary

Automated regression tests cover bounded rings, reset isolation, concurrent transfer context, error identity, disabled behavior, callback passthrough, pool/client receiver and release behavior, runtime sampling, and equivalent REST/Kafka outcomes. The full suite passed 127 tests with the optional PostgreSQL test skipped; that test subsequently passed against an isolated real PostgreSQL container, including a deliberately slow query and an intentionally terminated connection. The first disposable-container attempt reported a connection termination during startup; the readiness probe was changed from the Unix socket to TCP and the repeat passed. Both disposable containers were removed. These are engineering checks, not measured pilot replications.

`results-engineering-diagnostics-v5` is reserved for exactly two short real-Docker wiring checks, Kafka then REST at 4 operations/s, with 10s warm-up and 30s measurement. Their explicit `engineering` phase is not a permitted pilot phase, they are outside the pilot state, and they must never be counted as capacity or fault evidence. Their only purpose is verifying artifact capture, application correctness, and lifecycle cleanup.

The user separately approved stopping exact external companion container `infallible_ardinghelli` (`d4f7134248915e24929eea8949d84e178d01982921f39a9760ee63a608c40e3c`). Docker automatically removed it on stop because AutoRemove was true; it had no mounted volumes. Do not recreate it. This does not authorize stopping a future replacement. Only the existing approved the external stack Redis/MySQL/Meilisearch instances may be stopped/restored by the pilot controller.

Prepare `results-capacity-pilot-v5` only after verification; preparation freezes the current source/images and copies the unchanged protocol. Start the new root once, and point monitoring explicitly at V5. The root's `pilot-state.json`, not this document, is authoritative for whether it has started or finished. Engineering success and `PREPARED` do not imply capacity readiness or protocol completion.
