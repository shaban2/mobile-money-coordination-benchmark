// /proc describes the Linux kernel serving the containers (Docker VM on macOS).
// Cgroup files below describe only the selected application container.
export const linuxDiagnosticFiles = [
  '/proc/stat', '/proc/meminfo', '/proc/vmstat',
  '/proc/pressure/cpu', '/proc/pressure/io', '/proc/pressure/memory',
  '/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpu.max',
  '/sys/fs/cgroup/memory.events', '/sys/fs/cgroup/memory.current',
  '/sys/fs/cgroup/cpu.pressure', '/sys/fs/cgroup/io.pressure', '/sys/fs/cgroup/memory.pressure'
];
export const linuxDiagnosticCommand = linuxDiagnosticFiles.map(f =>
  `printf '\\n@@${f}\\n'; if test -r '${f}'; then cat '${f}'; else printf 'UNAVAILABLE\\n'; fi`).join('; ');
export function parseLinuxDiagnostics(output) {
  const files = Object.fromEntries(String(output).split('\n@@').slice(1).map(chunk => {
    const index = chunk.indexOf('\n'); return [chunk.slice(0, index), chunk.slice(index + 1).trim()];
  }));
  const unavailable = linuxDiagnosticFiles.filter(f => !files[f] || files[f] === 'UNAVAILABLE');
  return { schemaVersion: 1, scope: 'Linux kernel /proc plus application-container cgroup; not macOS host',
    units: 'Raw kernel counters; cumulative values need deltas, PSI totals are microseconds',
    files, unavailable, valid: ['/proc/stat', '/proc/meminfo', '/proc/vmstat', '/sys/fs/cgroup/cpu.stat'].every(f => !unavailable.includes(f)) };
}
