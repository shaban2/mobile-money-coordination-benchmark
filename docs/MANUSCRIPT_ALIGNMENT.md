# Manuscript alignment notes

Source: `IEEE_Conference_Paper_REST_vs_Kafka_PreResults_Draft.docx`. The original Word file is unchanged. These notes identify the wording and methods that must align with this implementation before submission.

## Exploratory results amendment on 21 September 2026

The current revised copy is `REST_Kafka_Exploratory_Findings_Draft.docx`. It reports the six completed runs in `results-queue-screening-r8-v2`, `results-exploratory-adapter-r4-v1`, and `results-exploratory-database-r4-v1`, with one REST–Kafka pair per condition. They share the same archived implementation. This supersedes the instruction below to keep the manuscript pre-results **for this new exploratory copy only**. It does not rewrite the historical candidate confirmatory protocol or relabel earlier evidence.

The revised paper uses observed completion/goodput, descriptive fault recovery, ledger checks and sampled service resources. It explicitly reports the post-data scope decision, 2m/4m no-fault screen versus 5m/10m fault runs, REST-first realized order in all pairs, no established capacity, and no run-level effect inference from one pair. The original mixed-effects/96-run/capacity-relative plan is not presented as completed work. Backlog clearance remains descriptive without a winner threshold.

Reproducible analysis, figures, checks, review notes and an **unapproved** follow-up proposal are in `../.research/exploratory-paper-v1/`. No new runs are launched by creating the paper. The added authoring scripts change the live source inventory; any later experiment needs a reviewed new freeze, while the historical source archives remain intact.

**Revision 3, 22 September 2026.** The draft now also reports the three archived same-application 4 operations/s no-fault pairs as supplementary observations (Table V), replaces the uninformative clearance/recovery columns with an in-fault trajectory description (Table III), and adds additive database statement counts as context for the database-delay result. See `../.research/exploratory-paper-v1/README.md`, revision 3 section.

## Historical pre-results alignment below

The following notes describe the earlier, broader study plan and are retained as history. Requirements about capacity, provisional replication, confirmatory analysis and registration apply only if that broader plan is revived; they are not claims about the completed exploratory dataset.

## Scope and contribution

Describe a controlled comparison of two **single-process synthetic transfer-coordination implementations** sharing an asynchronous client contract. REST uses direct workflow calls; Kafka uses co-located handlers and an external broker. Each transfer selects one provider mapping and updates a common PostgreSQL ledger. This is not a production mobile-money switch, two independently settled telecom ledgers, or a test of separately deployed domain microservices.

The defensible contribution is the reproducible comparison, explicit failure semantics, and auditable measurement contract. Novelty relative to prior work still needs a verified literature comparison; implementation alone does not establish a research gap.

## Methods to replace or clarify

| Draft topic | Implementation-aligned description |
|---|---|
| Equal write paths | Same business contract, durability requirements, retry burst, application CPU/memory limits and worker limit. Kafka-specific inbox/outbox writes and broker resources remain measured overhead. |
| Completion latency | API ingress to application-observed terminal COMMIT acknowledgement, using one application clock. Excludes client-network transit. Post-commit observation is not the database's exact commit time. |
| Correct goodput | Reconciled unique successes admitted and confirmed inside measurement. Report drain completions, failures and pending work separately. |
| Retries and restart | Durable provider intent/result; idempotent synthetic provider journal; restart recovery of pending work; unknown network outcomes remain pending for reconciliation. No claim of atomic commitment across a real provider and local ledger. |
| Workload | Open-loop operations: 80% creation, 20% retrieval of a fixed setup transfer; 5% of creation attempts are deterministic idempotent replays. Seeds rotate synthetic wallets. |
| Replication | Candidate 96-run matrix, with eight explicit contiguous randomized execution blocks per study stratum. Eight repetitions are provisional until pilot precision/power work. |
| Pilot count and timing | Separate adaptive pilot, not part of the confirmatory count. Sequential runs use 5-minute warm-up, 10-minute measurement, up to 10-minute drain, plus overhead. The 15-minute follow-up cadence is monitoring only. Pilot ceilings of 72 runs/24 hours are resource safeguards, not target replication or promised completion time. |
| Protocol status | Pilot rules/source/images locally frozen; confirmatory protocol and final run count await evidence and review. No external preregistration is claimed. If 96 confirmatory runs are retained, warm-up/measurement alone needs 24 hours, excluding pilot, drain, and overhead. |
| Qualification | Instrument validity is separate from safety/performance outcomes. Retain valid failures and censored runs; preserve invalid/controller-failed runs for audit. |
| Recovery | Three complete 30-second post-clearance windows under continued offered load, compared with three complete pre-fault windows. No usable baseline means non-estimable, not zero recovery time. |
| Backlog clearance | Descriptive secondary endpoint, as approved on 20 September 2026. Report estimates, intervals, and censoring without a practical-winner threshold or leader/similarity declaration. |
| Statistical model | Implemented paired run-level bootstrap and exact paired sign-randomization analysis; not an implemented mixed-effects model. Holm families and practical margins are specified in `PILOT_AND_ANALYSIS.md`. |

## Results and limitations

Keep the manuscript explicitly pre-results. The short runs under `results-engineering-*` test machinery, not capacity or architecture superiority. Do not populate confirmatory result tables with them. The manuscript still needs pilot capacity selection, justified replication, frozen analysis/censoring rules, a registered protocol, the complete measured dataset, and outcome-linked discussion.

State these limitations: co-located application handlers, one host and shared clock, synthetic providers without economic wallet ledgers, single-broker replication factor one, fixed retrieval target, instrumentation overhead, possible post-commit observation loss, and conditional inference about these configurations rather than universal REST/Kafka superiority.

Authoritative repo references: `ARCHITECTURE.md`, `MEASUREMENT.md`, `PILOT_AND_ANALYSIS.md`, and `VERIFICATION.md`.
