# Mobile-money coordination benchmark

A controlled synthetic benchmark comparing **REST orchestration** with **Kafka choreography** behind one asynchronous person-to-person (P2P) mobile-money transfer API. Both implementations expose the same API, use the same PostgreSQL ledger, the same provider adapters and the same k6 workload; only the internal coordination changes. Every transfer is timed from the moment the API receives it to the moment the database confirms its final commit, and only transfers that completed, were not duplicated and left the ledger balanced are counted.

This is the **public derivative** of a private research archive. It contains the complete source code, the paper draft, the generated figures, and a redacted, analysis-sufficient export of the run evidence. See "What was redacted" below.

- Paper draft: `docs/REST_Kafka_Exploratory_Findings_Draft.docx` (Markdown companion in `.research/exploratory-paper-v1/manuscript.md`)
- Analysis package: `.research/exploratory-paper-v1/` (`analysis.json`, figures, revision notes)
- Evidence: `public-evidence/` (sixteen qualified runs across eight evidence roots, plus `EXPORT-MANIFEST.json`)
- Technical guide: `docs/TECHNICAL_GUIDE.md`

## Reproduce the paper's numbers

Requirements: Node.js 24 or newer, npm. Python 3 with `python-docx` is needed only to rebuild the Word draft; `sharp` is needed only to re-render figures.

```sh
npm ci
npm test
PUBLIC_EVIDENCE=public-evidence node scripts/analyze-exploratory-paper.mjs
```

The analysis recomputes every run's outcomes from its traces, transfer snapshots and invariants, requires exact agreement with the archived `run-outcomes.json`, verifies every exported file against `EXPORT-MANIFEST.json`, and writes `.research/exploratory-paper-v1/analysis.json`. The tables and figures in the paper are generated from that file:

```sh
NODE_PATH=<directory containing sharp> node scripts/render-exploratory-figures.mjs
cp docs/REST_Kafka_Exploratory_Findings_Draft.docx /tmp/template.docx
python3 scripts/build-exploratory-paper.py /tmp/template.docx
```

## Run the system yourself

The quick start (`npm run start:rest`, `npm run start:kafka`) runs one implementation with in-memory persistence. The full Docker stack (PostgreSQL through Toxiproxy, Redpanda, adapter service, callback receiver, k6, Prometheus, Grafana) is exercised by the engineering smoke pair, which builds the images, runs a short REST run and a short Kafka run at 4 operations per second, and qualifies both:

```sh
COMPOSE_PROJECT_NAME=mm-smoke POSTGRES_PORT=25432 APP_CPUS=2 APP_MEMORY=1g \
WARMUP_DURATION=10s MEASUREMENT_DURATION=30s DRAIN_SECONDS=60 DEEP_DIAGNOSTICS=true KEEP_SERVICES=false \
node scripts/run-experiment.mjs --execute --pilot-spec config/engineering-calibration-smoke.json --results results-engineering-smoke
```

The research pilot chain that produced the paper is bound to its capture host: it checks frozen host and container identities and refuses to continue elsewhere. To run the same guarded pair on your own machine, start your own chain with `--site-bootstrap`; `docs/SITE_BOOTSTRAP.md` gives the steps (register a protocol from `config/site-pair-protocol.example.json`, write an approval note, prepare, launch). Your host identity, images and source hash are then frozen and enforced exactly as they were for the paper's runs.

## What was redacted, and how to verify the export

The private archive hashes every evidence file, so it cannot be edited in place. This public copy was produced by two scripts kept in the private archive (`scripts/export-public-evidence.mjs` and `scripts/build-public-release.mjs`; they are not included here because their redaction table lists the identifiers themselves). They:

- copy only the files the analysis reads (raw k6 metric streams, database diagnostics, container inspections, resolved compose files and logs are left out);
- replace the capture host's name, home-directory paths, Docker daemon identity, and the names and identities of unrelated containers that ran on the capture host with neutral tokens such as `capture-host`, `<repo>` and `external-container-a`;
- replace each `source-snapshot.tar.gz` with `source-snapshot-application.tar.gz`, containing only the application-defining files the analysis compares;
- record, for every exported file, its SHA-256 in the private archive and its SHA-256 here, in `public-evidence/EXPORT-MANIFEST.json`, together with the private commit it was exported from.

No experiment number depends on a redacted field: the recomputation reads run and lifecycle settings, never host metadata. Anyone given access to the private archive can confirm the export by hashing the original files. The source identities quoted in the paper (`7995e552…` for the reporting set, `713bbfc6…` for the Kafka-first pairs) are the hashes recorded in each root's `freeze.json` at collection time.

## Scope

Synthetic benchmark only. All accounts, amounts and provider responses are synthetic; the two provider interfaces are simulated; there is no real money, no customer data, and no connection to a live mobile-money provider. The prototype routes each transfer to one synthetic provider interface and records it in one local ledger; it does not model settlement between two independently operated ledgers.

## Licence and citation

Code: Apache-2.0 (`LICENSE`). Evidence, figures and paper: CC BY 4.0 (`LICENSE-DATA.md`). Cite using `CITATION.cff`.
