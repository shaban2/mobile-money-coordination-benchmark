import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Logs grow with run duration. Send both streams directly to a file descriptor
// instead of retaining them in spawnSync's bounded stdout/stderr buffers.
export function captureCommandToFile(program, args, file, { env = process.env, timeoutMs = 120_000 } = {}) {
  const output = openSync(file, 'wx'); // Never truncate evidence from an earlier attempt.
  try {
    const result = spawnSync(program, args, {
      env, stdio: ['ignore', output, output], timeout: timeoutMs, killSignal: 'SIGKILL'
    });
    if (result.error || result.status !== 0) {
      const error = new Error(`${program} output capture failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}. See ${file}.`, { cause: result.error });
      error.code = result.error?.code ?? null;
      error.exitCode = result.status;
      error.signal = result.signal;
      throw error;
    }
    return { code: result.status, signal: result.signal };
  } finally {
    closeSync(output);
  }
}

function errorRecord(error) {
  return {
    failedAt: new Date().toISOString(), message: error.message, stack: error.stack,
    code: error.code ?? null, exitCode: error.exitCode ?? null, signal: error.signal ?? null,
    cause: error.cause ? { message: error.cause.message, code: error.cause.code ?? null } : null
  };
}

// Save the primary error BEFORE best-effort diagnostics. A log command failure
// (or later teardown failure) must not replace the reason the run first failed.
export function recordControllerFailure(directory, error, diagnostics = {}) {
  const file = path.join(directory, 'controller-error.json');
  const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : errorRecord(error);
  if (existsSync(file)) (record.secondaryErrors ??= []).push(errorRecord(error));
  const save = () => writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  save();
  for (const [name, collect] of Object.entries(diagnostics)) {
    try {
      collect();
    } catch (diagnosticError) {
      (record.diagnosticErrors ??= []).push({ name, ...errorRecord(diagnosticError) });
      save();
    }
  }
  return record;
}

// The primary error must already be on disk; HTTP diagnostics are best effort.
export async function collectFailureDiagnostics(directory, collectors) {
  const file = path.join(directory, 'controller-error.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, collect] of Object.entries(collectors)) {
    try { await collect(); }
    catch (error) {
      (record.diagnosticErrors ??= []).push({ name, ...errorRecord(error) });
      writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    }
  }
}
