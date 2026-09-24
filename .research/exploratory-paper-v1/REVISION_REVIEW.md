# Revision and evidence review

Profile: computational systems benchmark; neutral technical review. Mode: authorized revision of a new copy. Stage: substantive revision and integration, not submission certification. Modules: computational evidence, display/notation/provenance, and round calibration from the paper-review skill; Word creation and render verification from the documents skill. The separately referenced academic-writing base module is unavailable, so no unsupported severity taxonomy or claim of completing that module is made.

Readiness: suitable for author/supervisor review as an exploratory results draft. Not yet a venue-validated or independently reproduced submission. The central inferential limit remains one execution per architecture per condition, compounded by REST-first order in every pair.

## Changes relative to the supplied pre-results draft

| Prior issue | Status in revised copy | Verified change |
|---|---|---|
| Planned capacity-relative grid and 96-run study described as the paper's method | Resolved for exploratory scope | Actual six-run table and unequal durations; old study identified as uncompleted, not erased |
| Future-tense results placeholders | Resolved | Four tables and four figures derived from archived evidence |
| Strong one-factor/equal-write-path interpretation | Resolved | Co-located direct workflow vs broker handlers and Kafka-specific inbox/outbox overhead disclosed |
| Real bilateral settlement/microservice deployment implication | Resolved | Single local ledger, synthetic provider and deployment boundaries stated and diagrammed |
| Completion confused with request transmission or early response | Resolved | API-ingress-to-observed-COMMIT-ack endpoint, observer-write limitation and cohort boundaries |
| Replay fraction and seed randomness ambiguous | Resolved | 76 new / 4 replay / 20 status operations per cycle; deterministic identities; one status fixture |
| Independent repetitions and uncertainty not established | Open scientific limitation | No pseudo-replicated confidence intervals; unapproved balanced-order follow-up proposal |
| Resource evidence missing | Resolved for recorded service set | Time-weighted sampled CPU and memory including broker, plus explicit exclusions and coverage |
| Latency mechanism uncertain | Partial | Existing diagnostic context reported; no causal decomposition or invented polling result |
| Recovery differences risk overinterpretation | Resolved in reporting | Definition retained; coarse window alignment prevents subsecond ranking or equality claim |
| Related-work novelty not demonstrated | Partial | Closest verified overlap added; no first-of-kind claim; Son et al. full methods remain unavailable |
| Public reproducibility / venue fit | Open delivery decisions | Local scripts and hashes provided; public archive, licence, chosen venue and independent reproduction not claimed |

The original Word file was preserved. The generated Markdown companion and Word draft use the same builder and analysis JSON. The eight-reference list is focused on the claims retained in the revised paper; unused references from the pre-results draft remain available in that unchanged original rather than appearing as unsupported citations in the new text.

## Evidence and display audit

- Reporting set: all six runs in the three final approved roots, all marked QUALIFIED. Selection is a post-data reporting decision and is disclosed as such.
- Source and image identities checked through the existing read-only pair inspection. Common archived source hash is recorded in the package README and JSON.
- All six outcomes recomputed exactly from original traces, transfer snapshots, clock, controller, invariants and fault evidence. The analysis checks complete file inventories before/after reading.
- 10,214 measured unique correct completions; zero measured failures, pending work or drain-only completions. Cohort counts remain distinct from client attempts and setup fixtures.
- Quantiles, units and table values originate in JSON. Fault figures retain null window p95 as absent, not zero. Backlog maxima are explicitly sampled. Recovery and clearance are not retroactively redefined.
- CPU/memory aggregation includes each manifest-listed service once and Redpanda only where applicable. The resource sum is not labelled total laptop consumption. Irregular timestamps are weighted; absent stopped-adapter treatment and excluded measurement edges are disclosed.
- Provider diagnostic means are instrumentation-window aggregates, not cohort-matched additive latency components. Detailed slow-span sampling is not used as if it were the full distribution.
- Unit checks cover memory units, irregular time weighting, excluded client/cleanup records and unplanned missing services. Existing bounded-scope controller tests are run without launching traffic.
- The final six-page Word copy passed the canonical render and visual inspection of every page. Narrow table headers were corrected and every final page was rechecked. `verification.json` stores the checked document hash so later manual edits are not mistaken for the checked version. Eighteen targeted tests passed, all six outcomes recomputed exactly, and all 256 files in the selected evidence roots were verified unchanged.

## Literature source coverage

Claims were checked against primary or author/institutional sources on 21 September 2026:

- GSMA P2P developer page: callback/polling contract context only.
- Kazanavičius and Mažeika publisher abstract/metadata, with previously inspected selected methods pages: communication technologies and distinct workload/deployment; no numerical cross-paper performance comparison.
- Son, Lee and Lee KCI-hosted author abstract/metadata: financial-transfer model and compared designs only. Full-text method/replication claims are intentionally absent.
- Kristianto and Zahra publisher PDF, especially methodology/design: both models use Kafka and vary service/user/instance counts; its own conclusion is limited to its setting.
- Hasselbring author manuscript: explicit benchmark workload/fairness/reproducibility context, not an adopted universal standard or acceptance rule.
- Kalibera and Jones institutional record and author abstract: uncertainty and repetition across sources of variation, not a magic minimum run count.
- Grafana k6 and Docker official documentation: tool semantics, not evidence of our measured results.

This is a targeted comparison, not a systematic review or a complete bibliography audit of the original 19 references. Link destinations are recorded in the manuscript references and existing literature matrix.

## Remaining decisions before submission

1. Author approval of the narrower research questions and exploratory interpretation. The latest approval authorized preparing this revision, not external submission.
2. Decide whether the observed evidence is suitable for the selected track as-is or approve separately planned repetitions. No amount of wording converts one pair into a precise execution-level effect estimate.
3. Obtain/inspect the closest unavailable full methods if the contribution comparison depends on them; avoid asserting an open novelty gap from an incomplete search.
4. Select venue/track and check page limit, template, required declarations, authorship/affiliation details and artifact policy. EDAS is a submission platform, not a publication standard.
5. Set a redistribution licence and public artifact location after reviewing operational metadata and permissions; arrange independent reproduction if claiming it.

No new experiments, publication, submission, container stop/start, automation update, source re-freeze, or capacity approval occurred during this revision.

## Revision 3 review (22 September 2026)

| Prior limitation | Status after revision 3 | Evidence |
|---|---|---|
| REST-first order in every pair | Mitigated for the no-fault condition only: two of three archived same-application 4/s pairs ran Kafka first with the same p95 difference | Table V; `archivedNoFaultRuns` |
| One execution per architecture for the no-fault condition | Six archived same-application executions per architecture now shown as supplementary observations (not a designed replication) | Table V |
| No 4/s no-fault reference for the fault runs | Archived 4/s pairs provide it, with the same p95 as the pre-fault baseline windows | Section V-E |
| Recovery scores uninformative (identical by construction) | Table III now reports in-fault completions, maximum latency and first-window baseline check; predefined scores retained in JSON and stated in the note | `faultInterval` |
| No mechanism for the database-delay difference | Additive statement counts reported (about 1.7x more statements in Kafka), phrased as consistent-with, not causal | `statements` |
| Four substantive references | Four added: Nadeem and Malik, Hegde et al., Aydın and Çebi, Richardson | References [9]–[12] |

Still open: the fault scenarios remain one pair each and REST-first; the 8/s screen is unrepeated; no visual render check of revision 3 was possible in the authoring session; venue, licence and public artifact decisions are unchanged.

## Revision 4 review (22 September 2026)

| Prior limitation | Status after revision 4 | Evidence |
|---|---|---|
| Fault scenarios single-pair and REST-first | Each fault scenario now has one REST-first and one Kafka-first pair | Table VI; `freshFaultRuns` |
| Database-delay in-fault difference unrepeated | Repeated in the Kafka-first pair with near-identical in-fault completions and peak backlog | Table VI |
| Rebuilt implementation identity for the fresh pairs | Disclosed; file-by-file comparison shows only the package name differs | `applicationFilesDiffering` |

Still open: two pairs per fault scenario are not a replication estimate; the 8/s screen is unrepeated; no visual render check; venue, licence and public artifact decisions unchanged.

## Revision 5 review (22 September 2026)

Editorial only: title chosen without over-claiming scope, user-view figure and mobile-money background added to the introduction, plain-language definitions for latency percentiles, goodput, backlog and core equivalents, provenance hash moved to Section VII, and repeated caveats trimmed. Numbers, tables and analysis are unchanged from revision 4. The docx render check remains structural (python-docx) because no Word renderer is available in the authoring session.

## Revision 6 review (22 September 2026)

Wording only; numbers, tables and analysis unchanged from revision 4. Run-count statements now distinguish the six-run reporting set from the sixteen runs reported in total.

## Revision 7 review (24 September 2026)

Title no longer says "exploratory"; the design is still named as exploratory in the body. Fig. 3 documents the method and the RQ mapping. Reference list verified against live sources: two author corrections ([10], [11]), two page additions ([5], [9]), one title correction ([16]), and four citing sentences narrowed ([1]/[15], [13], [14], [16]). Numbers, tables and analysis unchanged from revision 4.
