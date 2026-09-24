# V3 controller log-capture failure and V4 preparation

## Failure and evidence boundary — 20 September 2026

`results-capacity-pilot-v3` ended at `2026-09-20T09:33:42.557Z` (16:33 WIB) with `REVIEW_REQUIRED` during `PILOT-001-screening-R4-K-A-1`. The measured k6 process returned code 0, and the run reached `OBSERVATION_ENDED`; however, the controller saved no qualification or completed pilot record. Cleanup passed and the external stack restoration reported no errors. These partial artifacts are not accepted capacity evidence.

The saved controller stack reports `spawnSync docker ENOBUFS` while collecting all-profile Compose logs in the failure handler. The normal evidence path also collected these unbounded logs into Node's bounded capture buffer. Reproducing that pattern with 5 MiB of output produces `ENOBUFS`. The failure handler repeated the same capture before saving `controller-error.json`, masking the primary exception. The exact original exception was not persisted; the normal-path log capture is consistent with the last saved lifecycle/artifact sequence, but cannot be established from a missing error record alone.

Do not rerun, reclassify, regenerate outcomes for, or overwrite V3. Its source archive and original files remain unchanged. Its failed state is not a clean pause checkpoint. The repaired source also differs from its frozen source hash, so a fresh evidence root and image freeze are required.

## Repair

`src/experiment/controller-diagnostics.js` provides:

- `captureCommandToFile`: directs child stdout and stderr to an exclusively created file descriptor. Output volume is limited by available disk rather than an in-memory child-process buffer. A 120-second capture deadline bounds a stuck log command; incomplete output is retained and capture failure still fails the run. An existing evidence file is never truncated.
- `recordControllerFailure`: saves the original error before attempting diagnostics, records each diagnostic failure separately, continues to remaining collectors, and preserves the original error when later cleanup also fails.

`scripts/run-experiment.mjs` uses these helpers. Its normal log is `compose.log`; a subsequent failure-path capture uses `compose-failure.log` if the normal file already exists. A failed diagnostics command must not prevent saving the controller error or attempting the other collector. Qualification, thresholds, workload generation, rates, durations, and statistical rules are unchanged.

## Verification

- Eight regression tests cover 8 MiB combined stdout/stderr, nonzero exit, missing executable, timeout, no-overwrite protection, primary-error-first ordering, independent diagnostic failures, and secondary cleanup errors.
- The complete automated suite passed **114 tests**, with **one optional PostgreSQL integration test skipped**; no test database was used.
- The existing 96-run candidate matrix validated. A controller dry run selected the expected records without launching workloads.
- A disposable, network-isolated Docker log producer generated **8,388,608 bytes** across stdout/stderr. The repaired helper captured all bytes through `docker logs`, including both streams. Its exact container was removed successfully; no volumes or the external stack services were changed. See `results-engineering/controller-log-capture-2026-09-20/validation.json` and `docker.log`.

These are engineering checks, not new measured pilot runs or proof of sustainable capacity. The repaired full trial lifecycle still needs observation at the next approved launch. No failed V3 result is promoted to completed evidence.

## Next attempt

The user approved fixing the failure and preparing the next run. The target is `results-capacity-pilot-v4`, with the same approved pilot protocol: start at **4 operations/s**, use **2 minutes warm-up + 4 minutes measurement** for screening, retain **5 + 10 minutes** for confirmation and faults, and preserve both drain allowances and all stop rules.

Preparation builds and pins updated images and archives source/tests/docs; it does not launch measurement or stop the external stack. Always pass the explicit V4 root because script defaults still name V3. Read `freeze.json`, `archive-checksum.json`, and the read-only status command to verify preparation. Any later launch must use the new root and repoint monitoring explicitly; it must not resume V3 or silently start from an old monitoring job.

The Word guide's dated V3 checkpoint remains historical. This repair note and the fresh frozen inputs describe the later change; archived guides and source snapshots must not be rewritten to appear contemporaneous with it.
