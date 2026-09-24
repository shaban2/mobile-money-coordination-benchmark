import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
export function sourceFiles() {
  const files = ['.dockerignore', '.env.example', 'compose.yaml', 'Dockerfile', 'Dockerfile.gateway', 'package.json', 'package-lock.json', 'config/queue-observation-pair-protocol.json',
    'config/exploratory-screening-r8-protocol.json', 'config/exploratory-adapter-r4-protocol.json', 'config/exploratory-database-r4-protocol.json',
    'config/exploratory-adapter-k4-protocol.json', 'config/exploratory-database-k4-protocol.json'];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    if (statSync(entry).isDirectory()) for (const child of readdirSync(entry).sort()) visit(path.join(entry, child));
    else files.push(entry);
  };
  for (const root of ['src', 'scripts', 'infra', 'migrations', 'contracts', 'config/conditions']) visit(root);
  return [...new Set(files)].sort();
}
export const fileHash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
export function sourceSnapshotSha256() {
  const hash = createHash('sha256');
  for (const file of sourceFiles()) {
    hash.update(path.relative(process.cwd(), file)); hash.update('\0');
    hash.update(readFileSync(file)); hash.update('\0');
  }
  return hash.digest('hex');
}
