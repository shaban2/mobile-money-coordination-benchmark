import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'results-capacity-pilot-v3');
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
if (existsSync(path.join(root, 'DO_NOT_RESUME.json'))) throw new Error('This evidence root is paused/retired; leave its original evidence unchanged.');
const state = read('pilot-state.json');
if (state.status === 'PAUSED') {
  process.stdout.write('Pilot is already PAUSED. No new request was written.\n');
  process.exit(0);
}
if (state.schemaVersion !== 2 || !['PREPARING', 'RUNNING', 'PAUSING'].includes(state.status) || !state.timing?.activeSince || !state.sessionId) {
  throw new Error('No active pausable session. Failed/interrupted/legacy pilots require review.');
}
const pid = Number(readFileSync(path.join(root, 'pilot.lock'), 'utf8').trim());
if (!Number.isSafeInteger(pid) || pid <= 0 || pid !== state.pid) throw new Error('Controller lock and session PID disagree; review required.');
process.kill(pid, 0); // Existence check only: graceful pause never sends a termination signal.
const prior = existsSync(path.join(root, 'pause-request.json')) ? read('pause-request.json') : null;
if (prior?.sessionId === state.sessionId && prior.controllerPid === pid && prior.mode === 'after-pair') {
  process.stdout.write('Pause is already requested. Wait for status PAUSED before sleeping or closing Docker.\n');
} else {
  const request = { requestId: randomUUID(), mode: 'after-pair', requestedAt: new Date().toISOString(), sessionId: state.sessionId, controllerPid: pid };
  const destination = path.join(root, 'pause-request.json'), temporary = `${destination}.${request.requestId}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, destination);
  process.stdout.write('Pause requested after the current complete REST–Kafka pair. Wait for status PAUSED before sleeping or closing Docker.\n');
}
