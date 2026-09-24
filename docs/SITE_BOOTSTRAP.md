# Starting your own research chain on another machine (site bootstrap)

The pilot chain in this repository freezes source, protocol, images, host identity and the list of containers it may pause, and re-checks all of them before every run. The chain that produced the paper is bound to its capture host. To run the same kind of guarded pair on your own machine you start a **new chain** with `--site-bootstrap`. Nothing is weakened: the only differences are that the list of containers the controller may pause comes from you instead of a recorded approval, and that the first stage has no predecessor to review. Your host identity, images and source hash are frozen at preparation and enforced from then on.

## 1. Register a protocol

Copy the template and give the stage its own identity. Keep the timings if you want the paper's fault condition (5 min warm-up, 10 min measurement, adapter stopped for 30 s at second 240).

```sh
cp config/site-pair-protocol.example.json config/exploratory-site-adapter-protocol.json
```

Edit the copy: set `protocolId` (for example `site-adapter-r4-2026-10-01`) and, if you like, `randomSeed`. The seed decides which implementation runs first (see `src/experiment/pilot.js`). Then register the stage in three places, exactly as the paper's own stages are:

- `src/experiment/queue-observation.js`: import the file, add it to `approvedObservationProtocols` and `exploratoryProtocols`, and add its key to `IMPLEMENTATION_REBUILD_STAGES` (a chain start always rebuilds the application images).
- `src/experiment/provenance.js`: add `config/exploratory-site-adapter-protocol.json` to the explicit list in `sourceFiles()`.
- `test/exploratory-followup.test.js`: add the key and its realized first condition to the `expectedFirst` map. Find it with:

```sh
node --input-type=module -e "import {makePilotBatch,nextPilotStep} from './src/experiment/pilot.js'; import {exploratoryProtocol} from './src/experiment/queue-observation.js'; const p = exploratoryProtocol('site-adapter'); console.log(makePilotBatch(nextPilotStep([], p), p, 1).runs.map(r => r.conditionId).join(' then '));"
```

Run `npm test`; it must pass before anything is frozen.

## 2. Write the approval note

Create `site-approval.md` stating who approves the run, on which machine, which containers (if any) the controller may stop and restart, and that the run is a site chain start rather than part of the published evidence. The note is frozen with the root and hashed; changing it afterwards stops the pilot.

## 3. Prepare, launch, monitor

Stop every container you do not list. The controller refuses to prepare while any unlisted container is running, and it aborts a run if one starts mid-trial.

```sh
node scripts/prepare-capacity-pilot.mjs results-site-adapter-v1 --exploratory=site-adapter --site-bootstrap --allow-pause=<name,name> --approval-note=site-approval.md
node scripts/launch-capacity-pilot.mjs results-site-adapter-v1
node scripts/capacity-pilot.mjs results-site-adapter-v1
```

`--allow-pause=` may be empty. Listed containers are matched by name, checked to be restartable, stopped by ID before the first run and restarted afterwards. Preparation builds the application images, pins every image by ID, records your host identity in `freeze.json`, and archives the source tree. Launch starts a detached controller; the third command prints its state. A fault pair takes about 31 minutes of controller time. Completion is `pilot-state.json` status `EXPLORATORY_PAIR_COMPLETE_REVIEW_REQUIRED` with two `QUALIFIED` records, `cleanup.passed: true` and empty `restoreErrors`.

## 4. Continue the chain, if you want more stages

A second stage follows the same rules as the paper's: create another protocol whose `exploratoryPair.predecessorRoot` and `predecessorProtocolId` point at your first root and protocol, register it, record a review with `node scripts/review-exploratory-pair.mjs <key> --record-review --note "..."`, and prepare **without** `--site-bootstrap`. It will pin your first stage's images and require the same source hash.

## What this is not

Runs collected this way are your own evidence under your own identity. They are not part of the paper's reporting set, and `scripts/analyze-exploratory-paper.mjs` does not read them unless you add your roots to its selection lists.
