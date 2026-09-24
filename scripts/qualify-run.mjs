import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { qualifyRun } from '../src/experiment/qualification.js';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/qualify-run.mjs <run-directory>');
const read = (name) => { const file = path.join(directory, name); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; };
const resourceFile = path.join(directory, 'docker-stats.jsonl');
const resources = existsSync(resourceFile) ? readFileSync(resourceFile, 'utf8').split('\n').filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return {}; }
}) : [];
const report = qualifyRun({ manifest: read('manifest.json'), invariants: read('invariants.json'), telemetry: read('telemetry.json'),
  summary: read('measurement-summary.json'), callbacks: read('callbacks.json'), outcomes: read('run-outcomes.json'), traces: read('traces.json'),
  attempts: read('client-attempts.json'), resources, fault: read('fault-evidence.json'), exitCode: read('load-exit.json')?.code ?? -1,
  endChecksums: read('end-checksums.json'),
  isolation: read('isolation.json'), cleanStart: read('clean-start.json'), resolvedCompose: read('resolved-compose.json'),
  composeHash: createHash('sha256').update(readFileSync('compose.yaml')).digest('hex') });
writeFileSync(path.join(directory, 'qualification.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.valid ? 0 : 2;
