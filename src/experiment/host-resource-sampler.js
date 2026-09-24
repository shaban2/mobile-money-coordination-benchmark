import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

// This is the controller's OS (macOS here), not the Docker VM. Container CPU is
// still recorded separately by docker stats. Neither measures disk wait latency.
export function createHostResourceSampler() {
  const counters = () => cpus().reduce((sum, cpu) => ({
    idle: sum.idle + cpu.times.idle,
    total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0)
  }), { idle: 0, total: 0 });
  let previous = counters(), previousAt = performance.now();
  return () => {
    const current = counters(), now = performance.now(), totalDelta = current.total - previous.total;
    const sample = { scope: 'controller-host-not-docker-vm', capturedAt: new Date().toISOString(),
      intervalMs: now - previousAt,
      cpuBusyFraction: totalDelta > 0 ? Math.max(0, Math.min(1, 1 - (current.idle - previous.idle) / totalDelta)) : null,
      loadAverage: loadavg(), freeMemoryBytes: freemem(), totalMemoryBytes: totalmem() };
    previous = current; previousAt = now;
    return sample;
  };
}
