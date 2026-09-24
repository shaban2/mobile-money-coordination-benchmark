# V2 pre-traffic launch check — 20 September 2026

## Approved change and verification

The user approved temporary stop/restoration of the exact external companion container `external-container-d` and exploratory screening at 2 minutes of warm-up plus 4 minutes of measurement. Confirmation/fault trials retain 5 + 10 minutes. Both drain allowances, the six final 30-second stability windows, rates, repetitions, thresholds, and confirmatory matrix remain unchanged.

Phase-aware launch, evaluation and resume checks were implemented. The pre-freeze suite passed 100 tests with one optional PostgreSQL integration test skipped. The 96-run candidate matrix validated. Fresh inputs were frozen in `results-capacity-pilot-v2`.

## Live check and disposition

The controller started at `2026-09-20T09:19:09.036Z` and received a graceful pause request during preparation, before the first trial. It stopped the four approved containers, verified empty experiment cleanup, and restored all three the external stack services. Docker's events show that the external companion container stopped, exited successfully and was destroyed immediately. Its original listing showed no mounted volumes; its image remains available. The original instance and its writable layer cannot be restored with `docker start`.

Restoration failed for that exact companion ID, so the controller correctly ended at `REVIEW_REQUIRED`, not `PAUSED`. There are **zero trial batches and zero measurement records**. `pilot-state.json`, `pilot.log`, `launcher.log`, frozen inputs and the source archive retain the failure. The additive `DO_NOT_RESUME.json` prevents reuse of this root. It is not capacity evidence or a completed live pause/resume validation.

The current working source now rejects approved containers whose `HostConfig.AutoRemove` is true or unknown, before preparation writes a root and again before execution stops any service. Exact identity is rechecked. This guard was added after the failed freeze; it must not be represented as part of that archive.

After adding the guard, the full suite passed 106 tests with zero failures and one optional PostgreSQL integration test skipped. Guard tests reject auto-removing or unknown lifecycle settings and reused identities. This is automated engineering evidence, not successful live restoration of the removed companion.

## Remaining boundary

Identify and reconnect the companion through its original owning app/command, or obtain explicit direction for its external restoration. Do not invent a detached replacement for an unknown MCP connection, suppress the restoration failure, or start a replacement pilot while this remains unresolved. All three the external stack containers are running and healthy. The recurring monitor remains paused. A fresh root and new source/image freeze are required after resolution.

## Subsequent user direction

After this failed check, the user explicitly approved leaving the external companion container unavailable during the pilot, stating they are not using the external stack now. This resolves the external-service launch hold; it does not repair or erase the failed v2 check. The fresh attempt uses `results-capacity-pilot-v3` with unchanged approved timing rules. Only the three restorable the external stack services are stopped and restored by the controller. Reconnecting the external companion container is deferred to its owning app/user after the pilot. Neither retired root may be resumed.
