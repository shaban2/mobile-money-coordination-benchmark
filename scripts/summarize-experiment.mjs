import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const resultsRoot = path.resolve(process.argv[2] ?? 'results');
const outputPath = path.join(resultsRoot, 'experiment-summary.json');
const rows = existsSync(resultsRoot)
  ? readdirSync(resultsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(resultsRoot, entry.name);
        const read = (name) => {
          const file = path.join(directory, name);
          return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
        };
        const qualification = read('qualification.json');
        const controllerError = read('controller-error.json');
        const manifest = read('manifest.json');
        const outcomes = read('run-outcomes.json');
        return {
          runId: entry.name,
          sequence: manifest?.run?.sequence ?? null,
          block: manifest?.run?.block ?? null,
          conditionId: manifest?.run?.conditionId ?? null,
          faultScenario: manifest?.run?.faultScenario ?? null,
          offeredLoadPercent: manifest?.run?.offeredLoadPercent ?? null,
          offeredRate: manifest?.run?.offeredRate ?? null,
          status: controllerError ? 'FAILED' : qualification ? (qualification.status ?? (qualification.qualified ? 'QUALIFIED' : 'EXCLUDED')) : 'INCOMPLETE',
          correctGoodput: outcomes?.correctGoodput ?? null,
          p95DurableCompletionMs: outcomes?.durableCompletionMs?.p95 ?? null,
          recoveryTimeSeconds: outcomes?.faultAnalysis?.recoveryTimeSeconds ?? null,
          recoveryCensored: outcomes?.faultAnalysis?.recoveryCensored ?? null,
          backlogClearanceSeconds: outcomes?.faultAnalysis?.backlogClearanceSeconds ?? null,
          gates: qualification?.gates ?? null,
          error: controllerError?.message ?? null
        };
      })
      .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER))
  : [];

mkdirSync(resultsRoot, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  resultsRoot,
  observedRuns: rows.length,
  counts: Object.fromEntries(['QUALIFIED', 'CENSORED', 'PERFORMANCE_FAILURE', 'SAFETY_FAILURE', 'INVALID', 'EXCLUDED', 'FAILED', 'INCOMPLETE'].map((status) => [
    status,
    rows.filter((row) => row.status === status).length
  ])),
  runs: rows
};
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(summary.counts)}\nWrote ${outputPath}.\n`);
