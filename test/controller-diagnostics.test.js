import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureCommandToFile, recordControllerFailure, collectFailureDiagnostics } from '../src/experiment/controller-diagnostics.js';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'coordination-diagnostics-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('async diagnostic failure is secondary and later collectors still run', async (t) => {
  const root = fixture(t);
  recordControllerFailure(root, new Error('original failure'));
  let collected = false;
  await collectFailureDiagnostics(root, {
    unavailable: async () => { throw new Error('HTTP capture timed out'); },
    other: async () => { collected = true; }
  });
  const saved = JSON.parse(readFileSync(path.join(root, 'controller-error.json')));
  assert.equal(saved.message, 'original failure');
  assert.equal(saved.diagnosticErrors[0].name, 'unavailable'); assert.equal(collected, true);
});

test('large stdout and stderr reach disk intact without the spawnSync capture buffer', (t) => {
  const file = path.join(fixture(t), 'compose.log');
  const result = captureCommandToFile(process.execPath, ['--input-type=module', '-e', `
    import { writeSync } from 'node:fs';
    writeSync(1, 'A'.repeat(5 * 1024 * 1024));
    writeSync(2, 'B'.repeat(3 * 1024 * 1024));
    writeSync(1, 'END\\n');
  `], file);
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(readFileSync(file, 'utf8'), 'A'.repeat(5 * 1024 * 1024) + 'B'.repeat(3 * 1024 * 1024) + 'END\n');
});

test('failed captures retain all output and expose the nonzero exit', (t) => {
  const file = path.join(fixture(t), 'compose.log');
  assert.throws(() => captureCommandToFile(process.execPath, ['-e', "require('node:fs').writeSync(2, 'docker failed'); process.exit(7)"], file),
    (error) => error.exitCode === 7 && /exit 7/.test(error.message));
  assert.equal(readFileSync(file, 'utf8'), 'docker failed');
});

test('spawn failures expose the original OS error and do not hide partial evidence', (t) => {
  const root = fixture(t), file = path.join(root, 'compose.log');
  assert.throws(() => captureCommandToFile(path.join(root, 'missing-program'), [], file),
    (error) => error.code === 'ENOENT' && error.cause.code === 'ENOENT');
  assert.equal(readFileSync(file, 'utf8'), '');
});

test('hung diagnostic commands have a deadline and preserve partial output', (t) => {
  const file = path.join(fixture(t), 'compose.log');
  assert.throws(() => captureCommandToFile(process.execPath, ['-e', "require('node:fs').writeSync(1, 'started'); setInterval(() => {}, 1000)"], file, { timeoutMs: 1000 }),
    (error) => error.code === 'ETIMEDOUT' && error.signal === 'SIGKILL');
  assert.equal(readFileSync(file, 'utf8'), 'started');
});

test('capture refuses to overwrite previous evidence', (t) => {
  const file = path.join(fixture(t), 'compose.log');
  writeFileSync(file, 'preserved');
  assert.throws(() => captureCommandToFile(process.execPath, ['-e', "process.stdout.write('replacement')"], file), { code: 'EEXIST' });
  assert.equal(readFileSync(file, 'utf8'), 'preserved');
});

test('primary failure is saved before diagnostics and every failed collector is recorded', (t) => {
  const root = fixture(t), file = path.join(root, 'controller-error.json');
  const original = new Error('original trial failure');
  original.code = 'ORIGINAL';
  const attempted = [];
  const saved = recordControllerFailure(root, original, {
    composeLogs() {
      assert.equal(JSON.parse(readFileSync(file)).message, original.message);
      attempted.push('composeLogs');
      throw Object.assign(new Error('logs unavailable'), { code: 'ENOBUFS' });
    },
    containerState() { attempted.push('containerState'); throw new Error('Docker offline'); },
    otherEvidence() { attempted.push('otherEvidence'); writeFileSync(path.join(root, 'other.json'), '{}'); }
  });
  assert.deepEqual(attempted, ['composeLogs', 'containerState', 'otherEvidence']);
  assert.equal(saved.message, original.message);
  assert.equal(saved.code, 'ORIGINAL');
  assert.deepEqual(saved.diagnosticErrors.map((e) => e.name), ['composeLogs', 'containerState']);
  assert.equal(saved.diagnosticErrors[0].code, 'ENOBUFS');
  assert.deepEqual(JSON.parse(readFileSync(file)), saved);
});

test('a subsequent cleanup failure is appended without overwriting the primary error', (t) => {
  const root = fixture(t);
  const original = recordControllerFailure(root, new Error('trial failed'));
  const saved = recordControllerFailure(root, new Error('Cleanup failed: Docker offline'));
  assert.equal(saved.message, original.message);
  assert.equal(saved.failedAt, original.failedAt);
  assert.equal(saved.stack, original.stack);
  assert.deepEqual(saved.secondaryErrors.map((e) => e.message), ['Cleanup failed: Docker offline']);
});

test('large failure diagnostics do not hide the primary failure', (t) => {
  const root = fixture(t);
  const saved = recordControllerFailure(root, new Error('trial failed'), {
    composeLogs: () => captureCommandToFile(process.execPath, ['-e', "require('node:fs').writeSync(1, 'x'.repeat(2 * 1024 * 1024))"], path.join(root, 'compose.log'))
  });
  assert.equal(saved.message, 'trial failed');
  assert.equal(saved.diagnosticErrors, undefined);
  assert.equal(readFileSync(path.join(root, 'compose.log')).length, 2 * 1024 * 1024);
});
