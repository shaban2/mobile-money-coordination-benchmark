import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, hostname, platform, release, totalmem } from 'node:os';

function command(program, args) {
  try {
    return execFileSync(program, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function sha256(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

const manifest = {
  createdAt: new Date().toISOString(),
  sourceRevision: command('git', ['rev-parse', 'HEAD']),
  dirtyFiles: command('git', ['status', '--short'])?.split('\n').filter(Boolean) ?? [],
  node: process.version,
  npm: command('npm', ['--version']),
  docker: command('docker', ['--version']),
  packageLockSha256: sha256('package-lock.json'),
  host: {
    hostname: hostname(),
    platform: platform(),
    release: release(),
    cpuModel: cpus()[0]?.model,
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtCapture: freemem()
  },
  condition: {
    coordinationMode: process.env.COORDINATION_MODE ?? null,
    clientMode: process.env.CLIENT_MODE ?? null,
    eventBusType: process.env.EVENT_BUS_TYPE ?? null,
    providerDelayMs: process.env.PROVIDER_DELAY_MS ?? null
  },
  randomSeed: process.env.RANDOM_SEED ?? null,
  imageIdentifiers: process.env.IMAGE_IDENTIFIERS?.split(',') ?? []
};

const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv[2]) writeFileSync(process.argv[2], output, 'utf8');
process.stdout.write(output);
