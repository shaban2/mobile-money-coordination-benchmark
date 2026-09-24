# Capacity pilot execution and freeze boundary

**Current step:** V5 is stopped at `REVIEW`. Use [Diagnostic calibration V1](CALIBRATION_V1.md) for the approved fixed four-run diagnostic batch. The capacity-search rules below are historical V1–V5 rules, not a newly approved queue-growth criterion. Do not relaunch V5 or interpret calibration as a capacity estimate.

**Current preparation target: `results-capacity-pilot-v5`.** The user approved diagnostic instrumentation and proceeding to the next pilot. V4 remains in `REVIEW` with two qualified screening records (Kafka stable, REST unstable at 4 operations/s); its rules and evidence are unchanged. V1/V2 are retired and V3 is failed controller evidence. Do not resume these roots. See [V5 diagnostic definitions, limits and verification](PILOT_V5_DIAGNOSTICS.md). Only the three approved restorable the external stack instances may be stopped/restored by the pilot controller. The separately approved auto-removing external companion container has been stopped and must not be recreated. Preparation freezes inputs but does not start measurements; the saved state is authoritative for actual progress.

The user authorized the pilot and continued monitoring on 20 September 2026, keeping backlog clearance descriptive. They authorized temporarily stopping and restoring `external-container-a`, `external-container-b`, and `external-container-c`, and subsequently approved the external companion container `external-container-d` (exact container ID `redacted-container-id-d`). No other container may be stopped and no container, volume, or data may be removed outside the dedicated experiment lifecycle.

**Protocol authorization:** the first batch remains retired after the isolation defect; `results-capacity-pilot-v1/DO_NOT_RESUME.json` prevents its reuse for capacity/protocol decisions without modifying original evidence. The user approved pair-boundary pause/resume, then explicitly approved **2-minute warm-up and 4-minute measurement for exploratory screening only**, retaining 5 + 10 minutes for confirmation and faults. The current attempt leaves the removed external companion container unavailable by subsequent explicit approval. Prepare fresh source/image provenance and verify the live pause/restoration/resume lifecycle before sustained collection. This document records the approved configuration, not proof that a process is running; the current root's `pilot-state.json`, session history and launcher log are authoritative for execution progress. See [the repair record](PILOT_ISOLATION_REPAIR.md).

## Inputs to freeze before a new pilot

`config/pilot-protocol.json` is the machine-readable pilot rule. Preparation copies it into a dedicated evidence root, records its hash and the source hash, archives source/tests/docs, and pins every Compose service to an existing Docker image ID. The controller runs those images without rebuilding or pulling. The application has four workers, two CPUs, and 1 GiB; shared infrastructure and broker cost remain additional measured resources. A temporary `caffeinate` process inhibits idle sleep during the pilot without changing persistent power settings.

Screening uses two minutes of warm-up and four minutes of measurement. Boundary confirmation and fault runs retain five minutes of warm-up and ten minutes of measurement. Every run retains at most ten minutes of drain after each phase (two drains). `pilot-timing.js` selects timing by phase for the controller and checks the same values during evaluation and resume, including fault evidence. The candidate rate is an absolute operations/s value, never disguised as a percentage of an invented capacity. Pilot runs live in a separate schema and never count toward the current 96-run confirmatory candidate. Its final replication count remains subject to precision review and protocol freeze.

## Run counts and elapsed time

Only one run executes at a time; REST and Kafka must not run concurrently. The repaired runner verifies an empty project after all-profile teardown, checks the selected service inventory at lifecycle boundaries, and rejects unexpected/duplicate services in measurement samples. A screening run has 6 minutes of traffic; a full run has 15. Each can add up to 20 minutes across the two drains plus startup, resets, evidence capture and cleanup. A screening pair has 12 minutes of traffic plus up to 40 minutes of drains; a full pair has 30 plus up to 40, **plus overhead**. These are component budgets, not guaranteed wall-clock completion times.

The task's follow-up checks use a 15-minute interval. Monitoring is configured outside this repository; preparation does not change it. At launch, explicitly repoint/check it for V5. This monitoring cadence is independent of the controller: a check neither launches a trial nor changes its duration, and there is no fixed number of completed runs per check. A monitor must not restart a paused, failed, or review-required attempt.

The pilot has no fixed final run count:

- Each screening candidate schedules one matched pair: two sequential runs.
- Each boundary-confirmation batch schedules three fresh matched pairs: six sequential runs. Different architecture boundaries or a failed confirmation can require additional batches.
- After both boundaries are confirmed, the two fault scenarios each schedule three matched pairs: twelve fault runs in total if the pilot reaches and completes this phase.

Screening and confirmation counts depend on the observed boundaries and the unchanged decision rule below. The v2 controller stops for review instead of promising completion within 72 runs or 24 accumulated active-session hours. Active time includes session preparation, warm-up, measurement, drains, evidence capture, cleanup, and approved-service restoration. Only the gap between a verified `PAUSED` checkpoint and an explicit new session is excluded. Both consumed time and completed-run count survive resume; neither budget resets. The time ceiling is checked before starting another trial, not used to cut an ongoing measurement short; final cleanup can also extend past it. A safety ceiling can therefore stop a pair unfinished, requiring review rather than automatic resume. The confirmatory experiment has a separate, currently provisional budget.

The retired v1 protocol used a wall-clock ceiling. Its frozen files are unchanged; v2 active-session accounting must not be retroactively applied to that evidence.

## Search and confirmation

1. Start at 4 operations/s. Screen both architectures once in seeded randomized paired order, doubling a still-unbounded rate.
2. For each architecture, retain the lowest observed unstable rate as its upper bound and the highest stable rate below it as its lower bound. Refine by integer bisection until the width is at most 10% of the lower bound. The pair is run at every selected candidate; counterpart observations are retained, not dropped.
3. At a resolved boundary, require three **fresh** confirmation runs per architecture. Screening successes do not count toward confirmation. A failed confirmation moves the upper bound down and resumes refinement without changing the rule.
4. The shared rate is the lower confirmed capacity. Round 25%, 50%, 75%, and 90% consistently to nearest integer; reject duplicate or nonpositive rates.
5. At the shared 90% rate, run three matched pairs for each full-duration fault: adapter stop for 30 seconds and database downstream delay of 100 ms for 60 seconds, starting at measurement second 240.

Stability requires all recorded evidence and safety gates, at least 99.5% workload checks, complete terminal callbacks, no failed or pending transfers, no dropped iterations, nonpositive least-squares backlog slope over the final six complete 30-second windows, and every one of those windows' p95 at most 110% of their median. These criteria are not relaxed in response to observed results.

The pilot stops for invalid evidence, generator-limited delivery, safety failures, competing containers, changed frozen inputs/host settings, no stable initial rate, unresolved integer precision, a 256 operations/s search ceiling, a 15 GiB free-disk floor, or the 72-run/24-active-hour budget. These ceilings are resource protections, not capacity estimates. Unfinished/invalid attempts are retained and require review; the controller never overwrites them or automatically reruns until favorable.

## Commands

```bash
# Preparation only; refuses reuse if this root already exists:
npm run pilot:prepare -- results-capacity-pilot-v5
npm run pilot:status -- results-capacity-pilot-v5
# Later, explicit launch (not part of preparation):
npm run pilot:run -- results-capacity-pilot-v5 --execute
```

Always pass the explicit V5 root because script defaults still name V3. Preparation refuses an existing root; status is read-only. V1–V4 remain preserved and are not resumable. For background launch, use `npm run pilot:launch -- results-capacity-pilot-v5` instead of `pilot:run`; never invoke both. It records the controller PID and log. Monitoring must explicitly point to V5, never implicitly follow a new root.

`pilot-state.json` records progress, candidate boundaries, current run, session history, consumed active/paused time, final review reason, and restoration state. Atomic file replacement prevents a status reader from observing a partially written JSON checkpoint. Each completed run and its manifest carry a session ID; a matched pair must belong to one session. `pilot.log` and each run's controller/evidence files are retained. Do not launch a second controller while `pilot.lock` belongs to a live process. If the controller stops unexpectedly, inspect its process and artifacts before deciding whether its exact stale lock can be removed. Removing a stale lock alone does not make an interrupted session resumable.

## Pause and continue later (v2 only)

Request a graceful pause from another terminal:

```bash
npm run pilot:pause -- results-capacity-pilot-v5
npm run pilot:status -- results-capacity-pilot-v5
```

The first command writes a request for the current controller/session; it does not kill or suspend any process. Wait until the reported status is **`PAUSED`**, not merely “Pause requested,” before allowing sleep or closing Docker. The controller finishes both members of the current REST–Kafka matched pair, including normal drains and evidence capture, then verifies experiment cleanup and restores only the approved the external stack containers that this session found running. The external companion container stays unavailable by user approval. It does not proceed to the next pair. A request before the first trial can pause with zero runs. An invalid run, safety failure, time/run ceiling, or cleanup/restoration error takes priority and produces a review/interrupted state, not a clean pause.

The wait depends on how much of the pair remains. Screening pairs have 12 minutes of warm-up/measurement; full confirmation/fault pairs have 30. Either can add up to 40 further minutes of drains, plus overhead. Pause is not an immediate emergency stop. `Ctrl+C`, `SIGTERM`, forced sleep, or quitting Docker mid-run is not the graceful-pause mechanism and can leave an interrupted, non-resumable attempt.

When ready, wake the Mac, start Docker, keep the host otherwise idle, preserve the frozen images/files, and explicitly resume:

```bash
npm run pilot:resume -- results-capacity-pilot-v5
# Foreground alternative (choose one, not both):
npm run pilot:run -- results-capacity-pilot-v5 --execute --resume
```

Resume checks the clean pair checkpoint and saved evidence, unchanged source/protocol/image override, host/Docker settings, empty experiment project, competing containers, remaining budget, and free disk. It then starts the next uncompleted pair with normal setup/reset/warm-up. Completed runs are not replayed, old pause requests are ignored by the new session, and boundaries/randomized order are retained. Changed inputs, an unfinished session, or a review state block automatic resume. Never edit a frozen protocol or clear evidence to bypass these checks. No background monitor is allowed to restart a `PAUSED` pilot automatically.

Implementation: `scripts/pause-capacity-pilot.mjs` writes the request; `src/experiment/pilot-session.js` owns pairing, checkpoint, and clock transitions; `scripts/capacity-pilot.mjs` supplies Docker, evidence, and process handling; `scripts/launch-capacity-pilot.mjs` provides explicit background launch/resume. Automated tests exercise pair pausing, overnight resume, stale requests, budget preservation, and failure paths without actual timed trials. V3 recorded two successful live pre-traffic pause/resume checks with zero measured runs; this did not validate a measured mid-pair pause. Observe the repaired end-to-end lifecycle at the next authorized launch.

## What is not yet frozen

The retired v1 pilot has an archived freeze. The approved v2 pause policy and 2 + 4 minute screening split form a new protocol revision requiring fresh preparation. **The confirmatory protocol is not frozen.** The controller deliberately ends at `PILOT_COMPLETE_REVIEW_REQUIRED`. Review capacity and full-fault evidence, run-level variability and replication adequacy, censoring horizons, and the remaining abrupt-crash/real-HTTP-response-loss readiness checks before freezing the confirmatory plan. Capacity screening may proceed as exploratory work while these broader readiness checks remain outstanding; no confirmatory run is authorized by this controller.

Backlog clearance remains descriptive with no practical-winner threshold, as approved by the user. An external preregistration identifier must come from an actual registration; a local hash is not preregistration. Do not infer an architecture advantage from pilot screening or claim eight repetitions adequate without supporting analysis and explicit assumptions.

## Documentation clarification — 20 September 2026

After pilot launch, the working README and related method/runbook documents were clarified to distinguish monitoring cadence, sequential trial duration, adaptive pilot counts, and provisional confirmatory replication. They also record the approved descriptive role of backlog clearance and distinguish exploratory pilot work from outstanding confirmatory-readiness gates. These are documentation clarifications, not amendments to the frozen pilot algorithm, settings, thresholds, or stop rules. The archived pre-launch documentation, source snapshot, protocol copy, manifests, and run evidence remain unchanged; current working documentation must not be represented as the exact archived version.

The initial v2 pause/resume implementation added matched-pair checkpoints and active-session accounting without changing timings. The subsequently approved short-screening amendment changes only screening warm-up/measurement to 2 + 4 minutes and adds phase-aware lifecycle verification. Full-duration confirmation/fault timing, rates, stability thresholds, repetitions, drains, fault settings, and the confirmatory matrix remain unchanged. Neither revision upgrades or resumes the retired v1 evidence. The earlier Word guide predates this timing amendment; this runbook and the new frozen JSON take precedence for execution settings.
