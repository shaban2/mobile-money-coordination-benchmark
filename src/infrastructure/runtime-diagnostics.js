import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';

// Diagnostic spans are NOT scientific endpoints. Keep them off the database and
// stdout hot paths, bound memory, and disclose every overwritten detail record.
class Ring {
  constructor(limit) { this.limit = limit; this.items = []; this.total = 0; }
  push(value) { this.items[this.total++ % this.limit] = value; }
  snapshot() {
    const offset = this.total > this.limit ? this.total % this.limit : 0;
    return [...this.items.slice(offset), ...this.items.slice(0, offset)];
  }
  get overwritten() { return Math.max(0, this.total - this.limit); }
}

const histogramUpperMs = [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 5000, null];
const rounded = (n) => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;

export class RuntimeDiagnostics {
  constructor({ enabled = false, slowMs = 10, maxSpans = 20000, maxSamples = 4096,
    intervalMs = 1000, clock = () => performance.now(), wallClock = () => Date.now() } = {}) {
    if (!(slowMs >= 0) || !Number.isInteger(maxSpans) || maxSpans < 1
      || !Number.isInteger(maxSamples) || maxSamples < 1 || !(intervalMs >= 100)) throw new Error('Invalid diagnostic limits.');
    Object.assign(this, { enabled, slowMs, maxSpans, maxSamples, intervalMs, clock, wallClock });
    this.context = new AsyncLocalStorage();
    this.reset();
  }

  reset() {
    this.generation = (this.generation ?? 0) + 1;
    this.startedAt = new Date(this.wallClock()).toISOString();
    this.startedMonotonic = this.clock();
    this.sequence = 0; this.aggregates = new Map(); this.recordingErrors = 0;
    this.spans = new Ring(this.maxSpans); this.samples = new Ring(this.maxSamples);
    this.eventLoop?.reset();
    this.previousCpu = process.cpuUsage(); this.previousUsage = process.resourceUsage();
    this.previousElu = performance.eventLoopUtilization(); this.previousSample = this.clock();
  }

  begin(label, attributes = {}) {
    if (!this.enabled) return null;
    const parent = this.context.getStore();
    return { generation: this.generation, spanId: ++this.sequence,
      parentSpanId: parent?.generation === this.generation ? parent.spanId : null,
      transferId: attributes.transferId ?? parent?.transferId ?? null,
      label, started: this.clock(), startedAt: new Date(this.wallClock()).toISOString(),
      // Only caller-selected identifiers/counters belong here; never SQL values,
      // account IDs, request bodies, credentials, or error messages.
      attributes };
  }

  finish(span, error = null, ended = this.clock(), endedAt = this.wallClock()) {
    if (!span || span.generation !== this.generation) return;
    try {
      const durationMs = Math.max(0, ended - span.started);
      const key = this.aggregates.has(span.label) || this.aggregates.size < 256 ? span.label : 'other';
      const stats = this.aggregates.get(key) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0,
        histogram: histogramUpperMs.map(() => 0) };
      stats.count++; stats.errors += error ? 1 : 0; stats.totalMs += durationMs;
      stats.maxMs = Math.max(stats.maxMs, durationMs);
      stats.histogram[histogramUpperMs.findIndex((bound) => bound === null || durationMs <= bound)]++;
      this.aggregates.set(key, stats);
      if (error || durationMs >= this.slowMs) this.spans.push({
        spanId: span.spanId, parentSpanId: span.parentSpanId, transferId: span.transferId,
        label: span.label, startedAt: span.startedAt, endedAt: new Date(endedAt).toISOString(),
        durationMs: rounded(durationMs), failed: Boolean(error), ...span.attributes
      });
    } catch { this.recordingErrors++; } // Instrumentation must not mask an application error.
  }

  async measure(label, attributes, work) {
    if (!this.enabled) return work();
    const span = this.begin(label, attributes);
    return this.context.run(span, async () => {
      try { const result = await work(); this.finish(span); return result; }
      catch (error) { this.finish(span, error); throw error; }
    });
  }

  start(poolSnapshot = () => null) {
    if (!this.enabled || this.timer) return;
    this.poolSnapshot = poolSnapshot;
    this.eventLoop = monitorEventLoopDelay({ resolution: 10 }); this.eventLoop.enable();
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime < this.startedMonotonic) continue;
        const span = this.begin('runtime.gc', { gcKind: entry.detail?.kind ?? null });
        span.started = entry.startTime;
        span.startedAt = new Date(performance.timeOrigin + entry.startTime).toISOString();
        // GC duration is the observed GC event, not delivery delay of this observer.
        this.finish(span, null, entry.startTime + entry.duration, performance.timeOrigin + entry.startTime + entry.duration);
      }
    });
    this.observer.observe({ entryTypes: ['gc'] });
    this.reset();
    this.timer = setInterval(() => this.sample(), this.intervalMs); this.timer.unref();
  }

  sample() {
    if (!this.enabled) return;
    try {
      const now = this.clock(), cpu = process.cpuUsage(), usage = process.resourceUsage();
      const elu = performance.eventLoopUtilization(), memory = process.memoryUsage();
      this.samples.push({ capturedAt: new Date(this.wallClock()).toISOString(), intervalMs: rounded(now - this.previousSample),
        cpuUserMs: (cpu.user - this.previousCpu.user) / 1000,
        cpuSystemMs: (cpu.system - this.previousCpu.system) / 1000,
        eventLoopUtilization: performance.eventLoopUtilization(elu, this.previousElu).utilization,
        eventLoopDelayMs: { p95: rounded(this.eventLoop?.percentile(95) / 1e6), max: rounded(this.eventLoop?.max / 1e6) },
        rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
        involuntaryContextSwitches: usage.involuntaryContextSwitches - this.previousUsage.involuntaryContextSwitches,
        voluntaryContextSwitches: usage.voluntaryContextSwitches - this.previousUsage.voluntaryContextSwitches,
        majorPageFaults: usage.majorPageFault - this.previousUsage.majorPageFault,
        pool: this.poolSnapshot?.() ?? null });
      this.previousCpu = cpu; this.previousUsage = usage; this.previousElu = elu; this.previousSample = now;
      this.eventLoop?.reset();
    } catch { this.recordingErrors++; }
  }

  stop() {
    clearInterval(this.timer); this.timer = null; this.eventLoop?.disable(); this.observer?.disconnect();
  }

  snapshot() {
    return { schemaVersion: 1, enabled: this.enabled, startedAt: this.startedAt,
      capturedAt: new Date(this.wallClock()).toISOString(), durationClock: 'monotonic performance.now',
      slowMs: this.slowMs, intervalMs: this.intervalMs, eventLoopResolutionMs: 10,
      limits: { maxSpans: this.maxSpans, maxSamples: this.maxSamples },
      overwrittenSpans: this.spans.overwritten, overwrittenSamples: this.samples.overwritten,
      recordingErrors: this.recordingErrors, histogramUpperMs,
      aggregates: Object.fromEntries([...this.aggregates].map(([key, s]) => [key,
        { ...s, totalMs: rounded(s.totalMs), maxMs: rounded(s.maxMs), meanMs: rounded(s.totalMs / s.count) }])),
      spans: this.spans.snapshot(), runtimeSamples: this.samples.snapshot() };
  }
}

export function instrumentMethods(target, diagnostics, methods, prefix, attributes = () => ({})) {
  if (!diagnostics?.enabled) return;
  for (const name of methods) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function (...args) {
      return diagnostics.measure(`${prefix}.${name}`, attributes(name, args), () => original.apply(this, args));
    };
  }
}
