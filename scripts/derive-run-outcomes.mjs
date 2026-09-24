import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveOutcomes } from '../src/experiment/outcomes.js';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/derive-run-outcomes.mjs <run-directory>');
const read = (name) => JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
const manifest = read('manifest.json');
const report = deriveOutcomes({ manifest, telemetry: read('telemetry.json'), traces: read('traces.json'),
  controller: read('controller-state.json'), invariants: read('invariants.json'), snapshot: read('transfers.json'),
  clock: read('measurement-clock.json'), fault: manifest.run.faultScenario === 'none' ? null : read('fault-evidence.json') });
writeFileSync(path.join(directory, 'run-outcomes.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ runId: report.runId, correctGoodput: report.correctGoodput, p95: report.durableCompletionMs.p95 })}\n`);
