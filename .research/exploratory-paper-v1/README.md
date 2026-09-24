# Exploratory paper results package

Prepared 21 September 2026. This package reports existing observations. It launches no experiments, changes no Docker services, and does not freeze a new collection protocol.

Start with `../../docs/REST_Kafka_Exploratory_Findings_Draft.docx`. The original Downloads Word document is unchanged. `manuscript.md` is a searchable generated companion; edit the build script to regenerate it and the Word copy together.

## What is included

- `analysis.json`: per-run outcomes, distributions, 30-second trajectories, service resource summaries, diagnostic aggregates and run identities. No population-level confidence intervals or superiority tests.
- `evidence-inventory.json`: SHA-256 inventory of every file in the three selected evidence roots. No raw evidence is modified or copied over another run.
- `figures/`: four figures in editable SVG and high-resolution PNG form. The SVG source is generated from actual results, not an illustrative reconstruction.
- `document-build.json`: hashes of the unchanged input manuscript, generated Word document and analysis input.
- `verification.json`: checked document hash, six-page visual review, exact recomputation and evidence-preservation checks, and 18 passing targeted tests.
- `REVISION_REVIEW.md`: changes, evidence checks, source coverage and remaining readiness limits.
- `FOLLOWUP_PROPOSAL.md`: a separate, unapproved proposal for additional observations. It is not an executable pilot specification.

## Reporting set and sample size

| Evidence root | Condition | Warm-up / measurement per run | Executions |
|---|---|---|---|
| `results-queue-screening-r8-v2` | No fault, 8 operations/s | 2m / 4m | REST once, Kafka once |
| `results-exploratory-adapter-r4-v1` | Adapter outage, 4 operations/s | 5m / 10m | REST once, Kafka once |
| `results-exploratory-database-r4-v1` | Database-response delay, 4 operations/s | 5m / 10m | REST once, Kafka once |

The three roots are relative to the repository. Pair order was REST then Kafka in every case. Their common archived source identity is:

`7995e55285b54ac33365084157467ded4bf816377074c648a762ed76e58f0d77`

There are six executions and 10,214 unique measured completions, **not 10,214 independent experimental repetitions**. Earlier evidence is retained but not pooled into this reporting set. No capacity has been established. The decision to report the narrower exploratory paper and to produce these displays was made after observing data.

### Attempt counts are not completion counts

| Condition | Recorded operations | New-create attempts | Replays | Status reads | Measured unique completions |
|---|---:|---:|---:|---:|---:|
| No fault REST | 1,921 | 1,460 | 77 | 384 | 1,459 |
| No fault Kafka | 1,921 | 1,460 | 77 | 384 | 1,459 |
| Adapter REST | 2,401 | 1,825 | 96 | 480 | 1,824 |
| Adapter Kafka | 2,400 | 1,824 | 96 | 480 | 1,824 |
| Database REST | 2,401 | 1,825 | 96 | 480 | 1,824 |
| Database Kafka | 2,401 | 1,825 | 96 | 480 | 1,824 |

A final scheduled operation can occur at the ending boundary. The transfer cohort uses server ingress in `[measurementStart, measurementEnd)`, so an outside-boundary creation is not a measured arrival. The setup fixture is separate from this attempt stream and from the measured cohort. Replay and status operations do not create additional unique transfers. Exact counts are also generated in `analysis.json`.

## Reproduce the analysis without running traffic

Run these from the repository root, in order:

```sh
node --test test/exploratory-paper.test.js test/outcomes.test.js test/exploratory-followup.test.js
node scripts/analyze-exploratory-paper.mjs
node scripts/render-exploratory-figures.mjs
python3 scripts/build-exploratory-paper.py /path/to/IEEE_Conference_Paper_REST_vs_Kafka_PreResults_Draft.docx
```

Requirements: Node.js 24 or later, existing repository dependencies, `sharp` 0.35.4 for figures, and Python with `python-docx` 1.2.0 for Word. The figure renderer resolves `sharp` through Node's module search path (`NODE_PATH` is supported); it is not added to the experiment application's dependency lock. This generation used the bundled workspace Python/Node runtimes and their installed libraries. No extra package was installed. On another machine, install these authoring dependencies in a separate tools environment so the frozen application dependency lock stays unchanged.

The same commands, with the authoring dependencies on the path:

```sh
node scripts/analyze-exploratory-paper.mjs
NODE_PATH=<directory containing sharp> node scripts/render-exploratory-figures.mjs
python3 scripts/build-exploratory-paper.py <path to the original pre-results draft .docx>
```

The first analysis command reads the existing roots, validates their qualification/provenance, recomputes all six `run-outcomes.json` reports exactly, and checks the evidence inventory again after reading. It writes only this derived package. Do **not** use `scripts/derive-run-outcomes.mjs` on the frozen roots for this purpose: that older command writes back into the run directory.

Regeneration replaces the derived JSON, figures, Markdown and revised Word copy, not the original manuscript or the raw evidence. Save any manual edits to the generated copy under a different name first. DOCX ZIP metadata can change between builds; numerical results and the analysis JSON should be deterministic for unchanged inputs.

## Measurement and display definitions

Latency is application API ingress to application-observed terminal COMMIT acknowledgement. It is not HTTP acknowledgement time, callback delay, client-network latency or the database's exact internal commit instant. Goodput counts reconciled unique arrivals confirmed before measurement ends. All six selected runs have no failures, pending transfers or drain-only completions; those quantities remain explicit rather than silently excluded.

Quantiles use linear interpolation at `(n - 1) × p`. Numeric display rounds away sub-nanosecond binary interpolation noise before rounding to one decimal place. CDFs contain measured completions only. Recovery remains the pre-existing three-consecutive-30-second-window rule; no retrospective winner margin is added. Figures show completion-window latency, not latency grouped by arrival window. A window with no completion has no p95 segment, not zero latency. Backlog lines connect sampled points for readability and do not claim the true instantaneous maximum.

### Resource analysis

CPU core equivalents are `sum(CPUPerc) / 100`. Memory is the sum of reported Docker CLI memory usage normalized to MiB. For each run, sum the frozen manifest's expected services: application, gateway, PostgreSQL, Toxiproxy, adapter, callback receiver, Prometheus, Grafana, and Redpanda in Kafka runs. The k6 client, one-off setup jobs, controller and host/VM overhead are excluded. This is a service-set footprint, not a whole-machine footprint or cloud bill.

Use only samples whose capture timestamp is inside measurement. Compute trapezoidal time-weighted means between the first and last samples, with no edge extrapolation. Fail on unknown memory units, invalid CPU fields, duplicate services, unplanned missing services or sample gaps over five seconds. A deliberately stopped adapter is assigned zero during its absence, allowing five seconds around the observed outage boundaries because inventory and stats collection take about two seconds. This is an approximation at restart boundaries, not a claim of instantaneous sampling. `analysis.json` retains absence timestamps, coverage, gaps, and points so this choice is auditable.

The reported memory peak, available in JSON, is the highest *sampled aggregate*, not the sum of per-service maxima. Docker CLI Linux memory discounts cache. CPU samples are estimates over the Docker collection interval; they are not exact integrated CPU counters. Different collection windows and background services remain limitations. See [Docker's definition](https://docs.docker.com/reference/cli/docker/container/stats/).

### Diagnostic evidence

The no-fault provider-execution means are from complete diagnostic aggregates, not the threshold-selected detailed span sample. Their instrumentation interval includes some setup/boundary work. They are supplemental evidence, not precisely cohort-matched latency components. Nested database/provider spans and their percentiles must not be added to infer a causal latency decomposition. The 50 ms outbox interval is a configuration fact, not a measured 50 ms delay per transfer.

## Preservation and publication limits

The original paper, experiment code, application dependency lock, frozen source archives, protocols and run evidence are unchanged by this revision. New analysis/build scripts do change the live repository's overall source inventory; a future experiment must use a newly reviewed freeze, not pretend that its live source hash still matches the archived runs. The frozen code remains available inside each evidence root.

This is a local authoring package, not yet a public artifact release. It does not establish a redistribution licence, public archive DOI, target venue, or independent reproduction. Do not publish raw manifests without reviewing local hostnames, paths and other operational metadata. The targeted literature comparison is documented in `../literature_matrix.md`; the manuscript cites only claims supported by the inspected sources and explicitly limits the abstract-only Son et al. comparison.

## Revision 3 (22 September 2026): supplementary archived pairs and fault trajectories

`analysis.json` is now `exploratory-paper-v3`. Three additions, all derived from evidence that already existed in the repository; no new research runs were launched:

- `archivedNoFaultRuns`: the four archived 4 operations/s no-fault pairs (`results-calibration-v1`, `results-calibration-v1-continuation-1`, `results-queue-screening-v2`, `results-capacity-pilot-v5`). For each, the analysis verifies qualification, invariant checks and the p95 recomputation, and compares every application-defining file in the frozen source archive against the reporting-set archive (`applicationFilesDiffering`). The paper tabulates the three pairs whose application files are identical (the calibration k6 script differs only in a `>` versus `>=` check-threshold comparison) and mentions the pilot v5 pair, which ran under an earlier application revision, in one sentence. These are supplementary observations with their own source identities and realized order. They are not pooled and no interval is derived from them.
- `statements` per reporting-set run: additive database statement counts (transaction and pool-level) and garbage-collection cycles from the diagnostic aggregates. Counts are additive; nested span durations remain non-additive and are still not summed.
- `faultInterval` per fault run: windows whose boundary fell inside the observed fault interval, completions in those windows, the catch-up window, and whether the first complete window entirely after clearance already met the predefined baseline criteria. The predefined clearance and recovery scores are retained unchanged in `fault`.

The Word draft (`docs/REST_Kafka_Exploratory_Findings_Draft.docx`) adds Table V (archived pairs), replaces Table III's clearance/recovery columns with the trajectory description, adds a statement-count paragraph, four references, and revised abstract, discussion and conclusion text. The `verification.json` document hash predates this revision; a fresh page-by-page render check has not been repeated for revision 3 because no Word renderer was available in the authoring session. Structural checks (paragraph, table, column-width and image counts) were run with python-docx.

An engineering wiring check of the current branch (`results-engineering-branch-verification-v1`, 10 s warm-up + 30 s measurement per architecture, deep diagnostics on) completed on 22 September 2026 with both runs `QUALIFIED`, 91 completions each, zero failures and verified cleanup. It is not a study repetition.

## Revision 4 (22 September 2026): fresh Kafka-first fault pairs

Two new research pairs were collected on 22 September 2026 under the approved sequence in `../../docs/EXPLORATORY_FRESH_PAIRS_V2.md`:

| Evidence root | Stage | Fault | Realized order | Executions |
|---|---|---|---|---|
| `results-exploratory-adapter-k4-v1` | `adapter-k4` | 30 s adapter outage, 4 ops/s, 5m/10m | Kafka then REST | 2, both QUALIFIED |
| `results-exploratory-database-k4-v1` | `database-k4` | 100 ms database delay for 60 s, 4 ops/s, 5m/10m | Kafka then REST | 2, both QUALIFIED |

Both roots share source identity `713bbfc648f17748ee41371e73ead83efb43dfab5eac8b1301505b5731c2dcb7` (an implementation-rebuild freeze after the repository rename; application files differ from the reporting-set archive only in the package name, which the analysis verifies file by file). `analysis.json` is now `exploratory-paper-v4`: the per-run extraction is shared by `analyzeObservationRun`, the reporting set is unchanged, and `freshFaultRuns` carries the four new runs with the same fields plus `sequence`, `firstInPair`, `sourceSha256` and the application-file comparison. `evidence-inventory.json` tags entries by collection. The paper adds Table VI and a "Fresh Kafka-first fault pairs" subsection and revises the abstract, dataset, order, discussion and conclusion text from the data. The `verification.json` document hash predates revisions 3 and 4; no Word renderer was available for a page-by-page check, so structural checks were run with python-docx instead.

## Revision 5 (22 September 2026): title, introduction and readability

No analysis change. The builder and figure renderer changed:

- Title is now "REST Orchestration or Kafka Choreography Behind a Unified Telecom Mobile-Money P2P Transfer API: An Exploratory Synthetic Benchmark". "Bilateral", "cross-provider" and "off-us" were deliberately not used because each measured transfer is routed to one of two synthetic provider interfaces and settled in one local ledger.
- New Fig. 1 (`figures/user-view.*`, generated by the renderer) shows a P2P transfer as the user sees it, adapted from Figure 1.1 of the thesis proposal; the proposal PNG was not embedded because its wording says "bilateral". Earlier figures are renumbered 2 to 5.
- The introduction now explains mobile money, interoperability, the user flow, the platform's hidden duties, the fixed public contract and the one design choice varied, with references [13] to [15] taken from the proposal's reference list.
- A "Reading the measures" paragraph opens Section V; table headers name units and plain meanings (completed transfers, correct goodput in transfers/s, p95 latency in ms, completed during fault, longest transfer, core equivalents, median instead of p50).
- The source hash left Section IV (only the date and "one frozen identity" remain) and both short hash prefixes now sit in Section VII beside the results-package pointer.
- Repeated caveat sentences in Sections II to VI were merged or removed so the added material fits in roughly the previous length.

## Revision 6 (22 September 2026): wording

Editorial only. Fig. 1 label moved below the measured step; a plain one-sentence explanation of a P2P transfer and the GSMA/Mojaloop framing sentence (new reference [16]) added to the introduction; the "rather than the broader confirmatory study" clause removed from the contribution paragraph; RQ2 and RQ3 reworded in plain language; the abstract, Section VII and the conclusion now count all sixteen reported runs (10,214 reporting-set plus 7,296 fresh completions in the abstract).

## Revision 7 (24 September 2026): title, method figure, citation verification

- Title is now "REST Orchestration or Kafka Choreography Behind a Unified Telecom Mobile-Money P2P Transfer API: A Controlled Synthetic Benchmark". "Exploratory" remains in the abstract, contribution paragraph, Table I title and conclusion, where it names the design.
- New Fig. 3 (`figures/method.*`, generated) shows the three conditions, the six-step frozen pipeline every run follows, and which tables and figures answer each research question. Later figures are renumbered 4 to 6.
- All sixteen references were checked against their live sources on 24 September 2026. Every reference exists and resolves. Corrections: page numbers added to [5] and [9]; first author of [10] corrected to P. Hegde N; author initials of [11] corrected to S. Aydın and C. B. Çebi; [16] retitled to the page's real title "Mojaloop Hub". Four citing sentences were narrowed to what the source states: [13] (economic and policy, not technical), [14] (fragmentation raises time, cost and error risk), [1]/[15] (the specification, not the P2P overview page, defines fields and callback/polling flows), and [16] (provider boundaries and lookup, quote, transfer workflow only). IEEE Xplore, the ACM Digital Library and the BIS PDF blocked direct fetches, so [5], [6], [9], [10], [11] were verified through Crossref, OpenAlex and open author copies, and [14] through its landing page.
