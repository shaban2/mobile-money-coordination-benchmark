import { spawn } from 'node:child_process';

export function foreignContainerStart(event, project) {
  if (event.Type !== 'container' || event.Action !== 'start') throw new Error('Unexpected isolation event.');
  return event.Actor?.Attributes?.['com.docker.compose.project'] !== project;
}

// Observe host contention without ever stopping a foreign container. The caller
// aborts only its own trial and retains the contaminated/unfinished evidence.
export function observePilotIsolation({ project, record, abort }) {
  const since = new Date().toISOString();
  const child = spawn('docker', ['events', '--since', since, '--filter', 'type=container', '--filter', 'event=start', '--format', '{{json .}}'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let stopping = false, buffer = '';
  const done = new Promise(resolve => child.once('close', (code, signal) => {
    if (!stopping) abort(`Docker isolation observer exited: ${code ?? signal}`);
    resolve();
  }));
  child.on('error', error => abort(`Docker isolation observer failed: ${error.message}`));
  child.stderr.on('data', () => {});
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 1024 * 1024) { buffer = ''; abort('Docker isolation event buffer overflow.'); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line), foreign = foreignContainerStart(event, project);
        record({ capturedAt: new Date().toISOString(), event, foreign });
        if (foreign) abort(`Unapproved container started: ${event.Actor?.Attributes?.name ?? event.Actor?.ID}; container left untouched.`);
      } catch (error) { abort(`Unreadable isolation evidence: ${error.message}`); }
    }
  });
  return { since, async stop() { stopping = true; if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await done; } };
}
