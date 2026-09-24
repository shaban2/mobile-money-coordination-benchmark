import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { newPilotState } from '../src/experiment/pilot-session.js';

function temporaryRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'coordination-controller-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('unvalidated queue rule is blocked at prepare, background launch, direct controller and direct experiment entry points', (t) => {
  const parent = temporaryRoot(t), root = path.join(parent, 'pilot');
  mkdirSync(root);
  const protocol = JSON.parse(readFileSync('config/capacity-queue-pair-protocol.json', 'utf8'));
  writeFileSync(path.join(root, 'pilot-protocol.json'), JSON.stringify(protocol));
  writeFileSync(path.join(root, 'freeze.json'), '{}');
  writeFileSync(path.join(root, 'batch.json'), JSON.stringify({ capacityRule: { version: protocol.ruleVersion } }));
  const before = readdirSync(root).sort();
  for (const args of [
    ['scripts/prepare-capacity-pilot.mjs', path.join(parent, 'uncreated'), '--queue-pair'],
    ['scripts/launch-capacity-pilot.mjs', root],
    ['scripts/capacity-pilot.mjs', root, '--execute'],
    ['scripts/run-experiment.mjs', '--execute', '--pilot-spec', path.join(root, 'batch.json'), '--results', root]
  ]) {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /blocked: bounded-oscillation/);
    assert.deepEqual(readdirSync(root).sort(), before);
    assert.deepEqual(readdirSync(parent), ['pilot']);
  }
});

test('every execution entry point refuses a retired root before writing evidence or contacting Docker', (t) => {
  const root = temporaryRoot(t);
  writeFileSync(path.join(root, 'DO_NOT_RESUME.json'), '{}');
  const commands = [
    ['scripts/capacity-pilot.mjs', root, '--execute'],
    ['scripts/launch-capacity-pilot.mjs', root],
    ['scripts/launch-capacity-pilot.mjs', '--resume', root],
    ['scripts/pause-capacity-pilot.mjs', root],
    ['scripts/run-experiment.mjs', '--results', root, '--execute', '--resume']
  ];
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /paused\/retired/);
    assert.deepEqual(readdirSync(root), ['DO_NOT_RESUME.json']);
  }
});

function pausedState() {
  const state = newPilotState();
  const time = new Date(Date.now() - 1000).toISOString();
  Object.assign(state, { status: 'PAUSED', startedAt: time, sessionId: 'saved-session', cleanup: { passed: true }, restoreErrors: [] });
  state.timing.pausedSince = time;
  state.sessions.push({ sessionId: state.sessionId, startedAt: time, endedAt: time, status: 'PAUSED', runIds: [], activeMs: 0 });
  return state;
}

test('pause command writes an idempotent session-scoped request without changing state or signalling the controller', (t) => {
  const root = temporaryRoot(t), state = newPilotState();
  Object.assign(state, { status: 'RUNNING', pid: process.pid, sessionId: 'test-session' });
  state.timing.activeSince = new Date().toISOString();
  const original = JSON.stringify(state);
  writeFileSync(path.join(root, 'pilot-state.json'), original);
  writeFileSync(path.join(root, 'pilot.lock'), String(process.pid));
  const args = ['scripts/pause-capacity-pilot.mjs', root];
  let result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Pause requested/);
  const requestText = readFileSync(path.join(root, 'pause-request.json'), 'utf8'), request = JSON.parse(requestText);
  assert.equal(request.sessionId, state.sessionId); assert.equal(request.controllerPid, process.pid);
  assert.equal(request.mode, 'after-pair'); assert.ok(request.requestId);
  result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /already requested/);
  assert.equal(readFileSync(path.join(root, 'pause-request.json'), 'utf8'), requestText);
  assert.equal(readFileSync(path.join(root, 'pilot-state.json'), 'utf8'), original);
  assert.ok(!readdirSync(root).some((name) => name.endsWith('.tmp')));
  state.sessionId = 'new-session'; writeFileSync(path.join(root, 'pilot-state.json'), JSON.stringify(state));
  result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(root, 'pause-request.json'))).sessionId, 'new-session');
});

test('pause command refuses mismatched locks, legacy state and failed sessions without writes', (t) => {
  const root = temporaryRoot(t), state = newPilotState();
  Object.assign(state, { status: 'RUNNING', pid: process.pid, sessionId: 'test-session' });
  state.timing.activeSince = new Date().toISOString();
  writeFileSync(path.join(root, 'pilot.lock'), String(process.pid + 1));
  for (const patch of [{}, { schemaVersion: 1 }, { status: 'REVIEW_REQUIRED' }, { status: 'INTERRUPTED' }]) {
    writeFileSync(path.join(root, 'pilot-state.json'), JSON.stringify({ ...state, ...patch }));
    const result = spawnSync(process.execPath, ['scripts/pause-capacity-pilot.mjs', root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /disagree|No active pausable session/);
    assert.deepEqual(readdirSync(root).sort(), ['pilot-state.json', 'pilot.lock']);
  }
});

test('pause of an already-paused pilot needs no controller and changes nothing', (t) => {
  const root = temporaryRoot(t), original = JSON.stringify(pausedState());
  writeFileSync(path.join(root, 'pilot-state.json'), original);
  const result = spawnSync(process.execPath, ['scripts/pause-capacity-pilot.mjs', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /already PAUSED/);
  assert.deepEqual(readdirSync(root), ['pilot-state.json']);
  assert.equal(readFileSync(path.join(root, 'pilot-state.json'), 'utf8'), original);
});

test('background launch requires explicit resume of a clean paused checkpoint before spawning or writing logs', (t) => {
  const root = temporaryRoot(t);
  writeFileSync(path.join(root, 'freeze.json'), '{}');
  for (const [state, flags] of [[pausedState(), []], [{ ...pausedState(), status: 'REVIEW_REQUIRED' }, ['--resume']], [newPilotState(), ['--resume']]]) {
    const original = JSON.stringify(state);
    writeFileSync(path.join(root, 'pilot-state.json'), original);
    const result = spawnSync(process.execPath, ['scripts/launch-capacity-pilot.mjs', ...flags, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Use --resume|clean PAUSED/);
    assert.deepEqual(readdirSync(root).sort(), ['freeze.json', 'pilot-state.json']);
    assert.equal(readFileSync(path.join(root, 'pilot-state.json'), 'utf8'), original);
  }
});

test('changed frozen source prevents resume without changing a clean checkpoint or contacting Docker', (t) => {
  const root = temporaryRoot(t), original = JSON.stringify(pausedState());
  writeFileSync(path.join(root, 'freeze.json'), JSON.stringify({ sourceSha256: 'not-the-current-source' }));
  writeFileSync(path.join(root, 'pilot-protocol.json'), readFileSync('config/pilot-protocol.json'));
  writeFileSync(path.join(root, 'pilot-state.json'), original);
  const result = spawnSync(process.execPath, ['scripts/capacity-pilot.mjs', root, '--execute', '--resume'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Frozen source, protocol, or images override changed/);
  assert.deepEqual(readdirSync(root).sort(), ['freeze.json', 'pilot-protocol.json', 'pilot-state.json']);
  assert.equal(readFileSync(path.join(root, 'pilot-state.json'), 'utf8'), original);
});

test('status remains read-only and identifies the paused timing basis and explicit resume requirement', (t) => {
  const root = temporaryRoot(t), original = JSON.stringify(pausedState());
  writeFileSync(path.join(root, 'freeze.json'), '{}');
  writeFileSync(path.join(root, 'pilot-protocol.json'), readFileSync('config/pilot-protocol.json'));
  writeFileSync(path.join(root, 'pilot-state.json'), original);
  const result = spawnSync(process.execPath, ['scripts/capacity-pilot.mjs', root], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.next, { action: 'PAUSED', resumeRequired: true });
  assert.equal(report.timing.basis, 'active-sessions'); assert.ok(report.timing.pausedMs >= 1000);
  assert.equal(readFileSync(path.join(root, 'pilot-state.json'), 'utf8'), original);
});

test('a cleanup/controller failure takes precedence over a previously saved qualification in the summary', (t) => {
  const root = temporaryRoot(t), run = path.join(root, 'run');
  mkdirSync(run);
  writeFileSync(path.join(run, 'qualification.json'), JSON.stringify({ qualified: true, status: 'QUALIFIED' }));
  writeFileSync(path.join(run, 'controller-error.json'), JSON.stringify({ message: 'Cleanup failed: leftover worker' }));
  const result = spawnSync(process.execPath, ['scripts/summarize-experiment.mjs', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(path.join(root, 'experiment-summary.json')));
  assert.equal(report.counts.QUALIFIED, 0);
  assert.equal(report.counts.FAILED, 1);
  assert.equal(report.runs[0].error, 'Cleanup failed: leftover worker');
});
