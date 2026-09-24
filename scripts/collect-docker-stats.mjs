import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHostResourceSampler } from '../src/experiment/host-resource-sampler.js';
import { linuxDiagnosticCommand, parseLinuxDiagnostics } from '../src/experiment/linux-resource-sampler.js';

const outputPath = process.argv[2];
const intervalMs = Number(process.env.STATS_INTERVAL_MS ?? 1_000);
const composeProject = process.env.COMPOSE_PROJECT_NAME;
if (!outputPath) throw new Error('Usage: node scripts/collect-docker-stats.mjs <output.jsonl>');
if (!(intervalMs >= 250)) throw new Error('STATS_INTERVAL_MS must be at least 250.');
mkdirSync(path.dirname(outputPath), { recursive: true });

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sampleHost = createHostResourceSampler();

while (!stopping) {
  const startedAt = Date.now();
  const containerQuery = spawnSync('docker', [
    'ps',
    ...(composeProject ? ['--filter', `label=com.docker.compose.project=${composeProject}`] : []),
    '--format', '{{.ID}}\t{{.Label "com.docker.compose.service"}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.oneoff"}}'
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const inventory = new Map(String(containerQuery.stdout ?? '').split('\n').filter(Boolean).map((line) => {
    const [id, Service, ComposeProject, oneOff] = line.split('\t');
    return [id, { Service, ComposeProject, OneOff: oneOff?.toLowerCase() === 'true' }];
  }));
  const containerIds = [...inventory.keys()];
  const result = containerIds.length === 0 ? {
    status: containerQuery.status,
    stdout: '',
    stderr: containerQuery.stderr
  } : spawnSync('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...containerIds], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const record = {
    capturedAt: new Date().toISOString(),
    composeProject: composeProject ?? null,
    host: sampleHost(),
    collectionElapsedMs: Date.now() - startedAt,
    commandStatus: result.status,
    containers: String(result.stdout ?? '').split('\n').filter(Boolean).map((line) => {
      try {
        const container = JSON.parse(line);
        return { ...container, ...inventory.get(container.ID) };
      } catch { return { parseError: true, raw: line }; }
    }),
    stderr: String(result.stderr ?? '').trim() || null
  };
  if (process.env.DEEP_DIAGNOSTICS === 'true') {
    const selected = [...inventory].filter(([, c]) => ['rest-async', 'kafka-async'].includes(c.Service) && !c.OneOff);
    const begin = Date.now();
    const collected = selected.length === 1 ? spawnSync('docker', ['exec', selected[0][0], 'sh', '-c', linuxDiagnosticCommand],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }) : { status: -1 };
    record.linuxDiagnostics = { ...parseLinuxDiagnostics(collected.stdout),
      service: selected[0]?.[1].Service ?? null, capturedAt: new Date().toISOString(),
      collectionMs: Date.now() - begin, commandStatus: collected.status,
      valid: collected.status === 0 && parseLinuxDiagnostics(collected.stdout).valid };
  }
  record.totalCollectionElapsedMs = Date.now() - startedAt;
  appendFileSync(outputPath, `${JSON.stringify(record)}\n`, 'utf8');
  await wait(Math.max(0, intervalMs - (Date.now() - startedAt)));
}
