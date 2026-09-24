import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertPilotCanStart, newPilotState } from '../src/experiment/pilot-session.js';
import { isQueueCapacity, capacityRuleIdentity, assertCapacityRuleLaunchReady } from '../src/experiment/capacity-queue.js';
import { assertExploratoryRootReview } from '../src/experiment/exploratory-review.js';
const args = process.argv.slice(2), resume = args.includes('--resume');
const root = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? 'results-capacity-pilot-v3');
if (existsSync(path.join(root, 'DO_NOT_RESUME.json'))) throw new Error('This pilot evidence root is paused/retired; do not relaunch it.');
if (!existsSync(path.join(root, 'freeze.json'))) throw new Error('Prepare the immutable pilot inputs first.');
if (existsSync(path.join(root, 'pilot.lock'))) throw new Error('A pilot lock exists; do not launch a duplicate controller.');
const stateFile = path.join(root, 'pilot-state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : newPilotState();
assertPilotCanStart(state, { resume });
const protocolFile = path.join(root, 'pilot-protocol.json');
if (existsSync(protocolFile)) {
  const protocol = JSON.parse(readFileSync(protocolFile, 'utf8'));
  if (isQueueCapacity(protocol)) assertCapacityRuleLaunchReady(capacityRuleIdentity(protocol));
  assertExploratoryRootReview(root, protocol, JSON.parse(readFileSync(path.join(root, 'freeze.json'), 'utf8')));
}
const output = openSync(path.join(root, 'launcher.log'), 'a');
const child = spawn(process.execPath, ['scripts/capacity-pilot.mjs', root, '--execute', ...(resume ? ['--resume'] : [])], {
  cwd: process.cwd(), detached: true, stdio: ['ignore', output, output]
});
child.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.unref(); closeSync(output);
writeFileSync(path.join(root, 'launcher.json'), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), root, resume }, null, 2));
process.stdout.write(`Pilot controller started with PID ${child.pid}. Read ${path.join(root, 'pilot-state.json')} for progress.\n`);
