# Pilot isolation repair — 20 September 2026

## Disposition

The user requested a pause and repair. The full capacity pilot and its monitor remain paused; no confirmatory protocol is frozen. The first batch in `results-capacity-pilot-v1` is retained as diagnostic evidence. Its original files, source archive, frozen protocol, hashes, and qualification decisions are not rewritten. The additive `DO_NOT_RESUME.json` notice prevents the controllers from treating that root as resumable.

## Observed defect

All Compose services have profiles. The old runner invoked `down` without enabling those profiles, and Docker returned success without removing the services. The first Kafka stack remained running throughout the REST measurement: Kafka application, Kafka gateway, and Redpanda appear in all 293 successful REST resource samples. Both applications used the shared experiment database and had recovery workers. The existing qualification checked that expected services were present but did not reject extras. Both saved resolved configurations contained `services: {}`, and the profile-less log capture was empty.

The traffic phases and recorded reconciliation passed, but this is not an isolated REST capacity observation. The precise contribution of the leftover stack to the final latency spike has not been established. It must not be used to infer REST capacity or an architecture advantage.

## Repair

- `src/experiment/compose-lifecycle.js` centralizes explicit project/profile arguments, all-profile teardown, label-scoped inventory, and service-set checks. Teardown preserves named volumes and fails unless every container in that project is gone, including stopped containers.
- `scripts/run-experiment.mjs` verifies clean start and architecture isolation before warm-up, before measurement/reset, and after observation. Manifest v5 records the Compose project. Active-profile configuration is saved as JSON and YAML; logs include all project profiles. Cleanup failure is fatal, saved in controller evidence, and blocks the next run.
- Resource samples carry exact Compose service/project labels and one-off identity. Qualification rejects extra architectures, unexpected brokers/services, duplicate replicas, foreign-project identities, and non-k6 one-offs. One k6 generator is allowed during measurement; an injected adapter outage may explain only the missing adapter within its documented interval.
- Manifest v5 qualification requires the clean-start record, all three lifecycle snapshots, the canonical service set, and a nonempty resolved configuration. Old measurements can be reviewed in memory with the stronger gate without overwriting original decisions.
- The pilot controller rejects leftover project containers between trials and surfaces cleanup failures. The summary prioritizes controller failures over provisional qualification; resume does not skip a run with a controller error.
- The launcher, pilot controller, and experiment runner refuse execution in an evidence root containing `DO_NOT_RESUME.json`.

## Verification and restart boundary

Regression tests cover cleanup no-ops/failures, both architecture orders, extra brokers, duplicate/foreign workers, exact legacy names, k6 exceptions, missing lifecycle evidence, empty resolved configuration, and adapter-fault exceptions. In-memory review of the first batch accepts the Kafka isolation samples and rejects REST as `INVALID`; original reports remain untouched.

Final `npm test`: 70 passed, zero failed, one optional PostgreSQL integration test skipped. CLI regression tests also confirm that all three execution entry points refuse a retired root before side effects, and cleanup/controller failures override earlier qualification in summaries. The live checks below exercise PostgreSQL through the full Docker stack separately from that optional test.

Short Docker engineering checks use the separate `coordination-isolation-check` project and `results-engineering-isolation-v1`, 4 operations/s, a 5-second warm-up, and 30-second measurement. These test the harness only, with the external stack left running. They are not sustainable-capacity measurements, replacements for the full pilot, or confirmatory observations.

Both checks completed with `QUALIFIED` evidence and `architectureIsolated: true`: Kafka `LOAD-K-A-L50-Nstandard-Fnone-R06` followed by REST `LOAD-R-A-L50-Nstandard-Fnone-R06`. Kafka recorded 15 successful resource samples; REST recorded 16. Every REST sample excluded Kafka, its gateway, and Redpanda. Both `cleanup.json` files report an empty project. Active resolved configuration and Compose logs are populated. Each manifest's source hash matches its end-of-run hash.

The same cleanup helper removed the original stopped pilot containers and network at `2026-09-20T07:55:36.012Z`, verified no containers remained, and retained `lubanga-coordination-pilot_postgres_data` and `lubanga-coordination-pilot_provider_data`. Containers/network can be recreated; no named data volumes or original evidence files were removed. All three the external stack containers remained running and healthy. The monitor was paused using the app's automation control, following OpenAI Docs guidance.

Before any full restart: finish verification, obtain explicit approval to resume, prepare a fresh evidence root with new source/image hashes, and retain the old batch and this exclusion rationale. Do not change the pilot's stability threshold, rates, stopping rule, fault durations, or descriptive-only backlog endpoint based on the first batch. The two-drain timing clarification in the working docs describes existing behavior, not a protocol change.
