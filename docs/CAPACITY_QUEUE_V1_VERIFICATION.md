# Queue capacity rule v1 — implementation and launch hold

21 September 2026. **BLOCKED_RULE_VALIDATION. No live queue-pilot run has started.**

Follow-up: [expanded revalidation](CAPACITY_RULE_REVALIDATION.md) independently confirms the formula on 2,400 traces and distinguishes finite observed growth from claims about long-run capacity. It also records an unadopted screening-description candidate. The hold below remains active.

Later approval authorizes only the separate [v2 descriptive screening pair](QUEUE_OBSERVATION_V2.md), after engineering verification. This does not remove the v1 hold or authorize automatic capacity boundaries.

The researcher approved implementing and verifying the proposed queue rule, followed by exactly one fresh no-fault REST/Kafka screening pair at 4 operations/second, with 2-minute warm-up and 4-minute measurement per run, then review. This does not authorize higher rates, confirmation, faults or the main study.

## Implementation

- `src/experiment/capacity-queue.js` implements the approved whole-window and last-six-window slope signs plus three successive one-minute increases. Exact integer arithmetic determines slope signs. It checks all expected windows against transfer-level arrivals/terminal confirmations using the same half-open boundaries as the existing outcomes module.
- Eligibility, correctness, queue classification and descriptive latency are separate. Incomplete timestamps, diagnostics, offered-load delivery or rule identity cannot establish an overload boundary. Failed transfers cannot make a shrinking queue pass.
- A canonical protocol hash and rule version travel through batch, manifest and assessment. Live and checkpoint evaluation use the same function. The older latency-jitter evaluator and its protocol remain unchanged for historical evidence.
- `config/capacity-queue-pair-protocol.json` limits this stage to two runs at 4/s. Its two-hour cumulative ceiling is a safety bound, not a finish-time estimate. There is no adaptive escalation or automatic retry. The controller stops at `SCREENING_PAIR_COMPLETE_REVIEW_REQUIRED` after the pair; invalid evidence or safety failure stops sooner.
- Both conditions retain the 50 ms outbox configuration and calibration-level deep diagnostics. The host-side Docker start-event observer stops only the experiment if a foreign container starts; it never stops a newly discovered foreign service. Exact previously approved the external stack container identities are checked before any pause and restored afterward.
- k6 now uses inclusive `checks >= 0.995`, matching qualification. This changes the new source revision, not previous archived runs.

## Scientific validation blocker

Unit tests show that the implementation follows the proposed formula. They do **not** show that the formula is a suitable capacity definition.

Read-only adversarial check:

```sh
node scripts/check-capacity-rule-synthetic.mjs
```

It intentionally exits **2** with `BLOCKED_RULE_VALIDATION`.

The synthetic queues are `round(10 + 5*sin(2*pi*(i+shift)/period))`, with periods 2, 4, 8, 16 and 32 thirty-second windows, and all integer phase shifts. Each is bounded between 5 and 15 transfers indefinitely. There are 62 period/phase combinations at each horizon. The artificial suite tests sensitivity; these counts are **not real-world false-positive estimates**.

| Windows / duration | SUSTAINED | INCONCLUSIVE | Labelled queue-growth failure despite bounded generating process |
|---|---:|---:|---:|
| 8 / 4 minutes | 28 | 22 | 12 |
| 20 / 10 minutes | 11 | 45 | 6 |
| 60 / 30 minutes | 6 | 51 | 5 |
| 120 / 60 minutes | 6 | 49 | 7 |

A ten-minute counterexample (period 32, shift 15) is:

`11,10,9,8,7,6,6,5,5,5,5,5,6,6,7,8,9,10,11,12`

Whole slope: +0.0022305764 transfers/second. Final-six-boundary slope: +0.0333333333 transfers/second. Three successive minute increases occur at the final boundary. The current formula therefore returns `NOT_SUSTAINED_QUEUE_GROWTH`, although its generating process is bounded. Longer windows alone do not remove phase sensitivity; a 30-minute counterexample covers several complete cycles and still fails.

This is not a regression in REST/Kafka or a measured capacity finding. It is a problem in the proposed inference rule, found **before live collection**. Flat and monotone-growth controls behave as specified. No threshold was tuned to historical outcomes, no historical run was rescored, and the calibration evidence remains intact.

## Launch hold and remaining verification

Preparation, detached launch, direct pilot execution and direct experiment execution carrying this rule identity all fail closed before writes or Docker actions. Do not remove the hold merely to make tests pass.

The new evaluator, legacy evaluator, boundary checks, matched-pair stop/cleanup, checkpoint provenance and launch holds are covered by automated tests. Ordinary test runs skip the two tests requiring PostgreSQL URLs. The disposable PostgreSQL and REST/Kafka engineering checks in `scripts/verify-capacity-queue.mjs` have been implemented but **not run**, because the scientific rule failed validation first. No the external stack service was stopped for this attempt.

Final check: `node --test test/*.test.js` reported **176 passed, 0 failed, 2 skipped**. All changed controller/verification scripts passed syntax checks. The separate scientific validation command returned exit code 2 as intended. All **92** files in the original calibration archive still match the continuation plan's saved hashes; no queue-pilot or engineering evidence root was created.

Next: agree a revised finite-horizon decision policy that handles bounded oscillations and inconclusive evidence explicitly, validate it on these same retained cases plus accumulating queues, then complete database/wiring verification and freeze a new rule revision before the approved pair. Increasing the duration alone is not a demonstrated fix. No finite observation proves unbounded long-run growth or stability.
