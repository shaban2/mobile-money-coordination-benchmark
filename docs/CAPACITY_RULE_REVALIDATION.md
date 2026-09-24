# Capacity rule revalidation — 21 September 2026

**Result: revalidation complete; live launch remains blocked.** The current formula is implemented correctly, but is not sufficient for automatic capacity boundaries. An offline screening-description candidate is available for review; it is not adopted or connected to the controller.

**Subsequent approval:** the researcher answered “yes lets proceed” to the narrower descriptive screening proposal. The identical pattern logic is now adopted as `queue-observation-v2` for exactly one two-run pair, subject to engineering verification. See [approved execution amendment](QUEUE_OBSERVATION_V2.md). The v1 growth-failure rule and automatic capacity search remain blocked. The report below records the earlier revalidation state and its unchanged findings.

## What was checked

The reproducible suite contains **2,400 synthetic queue traces**: constant queues, draining queues, sine/triangle/sawtooth/burst cycles, bounded seeded noise, accumulation with noise, slow/delayed accumulation and cleared bursts. It uses 8, 20, 60 and 120 thirty-second boundaries. No historical run was scored or used to choose thresholds.

An independent pairwise-covariance calculation checks the original whole-series and final-six slope signs, successive-minute flags and final decision. **All 2,400 matched.** This establishes implementation agreement, not a valid scientific inference.

Of **448 periodic traces containing at least two complete cycles**, v1 labels **37** `NOT_SUSTAINED_QUEUE_GROWTH`. For example, this ten-minute trace visibly returns to a low backlog twice:

`8,10,11,12,13,5,6,7,8,10,11,12,13,5,6,7,8,10,11,12`

The whole-run slope and final rising segment nevertheless trigger the v1 failure. Simply extending duration did not eliminate this phase sensitivity.

### Correction to the earlier interpretation

Knowing that a *synthetic generator* is bounded forever does not mean a classifier can infer that from a short rising segment. Two possible futures—one that recovers and one that keeps accumulating—can have identical observed prefixes. The suite explicitly verifies that indistinguishability. Therefore, the earlier bounded-fixture counts are **not estimates of real-world false-positive rates**, and growth observed during a bounded queue's rising arc is not a calculation error. The concern is using that observation as an automatic unsustainable-capacity boundary.

Likewise, a flat finite trace does not establish stability forever, and thirty-second boundary samples can miss within-window bursts.

## Proposed screening-only revision, not a new capacity pass/fail rule

The offline `queue-observation-v2-candidate` reports patterns without a `stable` flag or an automatic capacity boundary:

| Observation | Candidate output |
|---|---|
| Every sampled backlog is no larger than the previous one | `NO_INCREASE_AT_SAMPLED_BOUNDARIES` |
| Both minima and maxima rise across each of four equal consecutive blocks, with the final minimum above the first maximum | `CONSISTENT_BLOCK_GROWTH_OBSERVED` |
| Other traces containing both increases and decreases | `MIXED_RISES_AND_FALLS_REVIEW` |
| Remaining increasing/step-like patterns | `INCONCLUSIVE_GROWTH_PATTERN` |

Four blocks is an assistant-proposed descriptive construction, not a published standard or researcher-approved threshold. A four-minute screen gives one-minute blocks; ten minutes gives 2.5-minute blocks. No post-hoc phase/period search chooses the most favorable split.

The candidate reports **zero consistent-block-growth signals among those 448 multi-cycle fixtures**. This is a useful regression result, **not proof of a superior capacity classifier**: it has a narrower, descriptive target and intentionally refuses automatic boundary decisions.

Important retained tradeoffs:

- Of 2,016 bounded periodic traces, **99** short rising arcs still receive a growth signal; bounded seeded noise produces **1** such signal out of 128. They require review, not an automatic failure boundary.
- Of 96 slow/delayed accumulation cases, **21** receive a growth signal, **67** remain inconclusive, and **8** have no increase visible during the chosen horizon. Those eight are flat observed prefixes, not proof that the growing generator is stable.
- Of 128 accumulation-with-noise cases, **122** receive a growth signal and 6 require review.
- Correctness, timing completeness, callbacks, diagnostics and offered-load eligibility must remain separate strict gates. This offline pattern function does not replace any of them. Latency remains descriptive.

## Reproduction and current safety state

```sh
node scripts/revalidate-capacity-rule.mjs
node --test test/capacity-rule-revalidation.test.js
node --test test/*.test.js
```

The revalidation command outputs `REVALIDATED_LAUNCH_HOLD_REMAINS` and exits **2** deliberately; exit 1 would indicate a mathematical-reference mismatch. The saved [machine-readable report](../.research/capacity_rule_revalidation_2026-09-21.json) includes fixture/code SHA-256 hashes, every family tally and counterexamples. Re-running the command with unchanged files reproduces the report exactly.

No runtime evaluator, frozen protocol, launch permission, run duration, historical result or Docker service was changed by this revalidation. The original v1 launch hold remains in force for both v1 and the candidate. Database integration and Docker engineering checks are still pending; no live experiment was started.

Final automated check: **181 passed, 0 failed, 2 database-dependent tests skipped**. A second audit invocation reproduced the saved JSON exactly. All **92 original calibration files** still match the previously saved archive inventory hashes.

**Recommended next decision:** approve or reject using the candidate only to describe the already proposed first matched screening pair, stopping for human review. That would be a prospective interpretation amendment, not permission for adaptive capacity search. Before automatic higher-load search, separately agree a finite-horizon capacity policy, its treatment of ambiguous signals, a justified practical-growth tolerance (if any), confirmation requirements and a bounded follow-up budget. Do not invent a tolerance from existing calibration or keep extending runs until a desired answer appears. Three repeated finite runs may improve evidence but do not prove stability forever.

## Method context

Autocorrelation concerns dependence between time-ordered samples; adjacent windows are not automatically independent replicates. NIST recommends examining time-series structure when the randomness assumption fails. This supports retaining trajectories and avoiding unjustified independent-error inference; it does **not** validate the four-block proposal. [NIST autocorrelation](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35c.htm), [NIST assumptions example](https://www.itl.nist.gov/div898/handbook/eda/section4/eda4232.htm).

k6 explains that dropped arrival-rate iterations can reflect insufficient available VUs or degradation in the system under test. The existing policy of investigating such runs rather than automatically declaring architecture capacity remains unchanged. [Grafana k6 dropped iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/).
