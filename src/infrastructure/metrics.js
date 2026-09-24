export class Metrics {
  constructor() {
    this.counters = new Map();
    this.observations = new Map();
  }

  increment(name, amount = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  observe(name, milliseconds) {
    const values = this.observations.get(name) ?? [];
    values.push(Number(milliseconds));
    this.observations.set(name, values);
  }

  snapshot() {
    return {
      counters: Object.fromEntries(this.counters),
      observations: Object.fromEntries(
        [...this.observations].map(([name, values]) => [name, [...values]])
      )
    };
  }

  toPrometheus(gauges = {}) {
    const lines = [];
    for (const [name, value] of this.counters) {
      lines.push(`# TYPE ${name} counter`, `${name} ${value}`);
    }
    for (const [name, values] of this.observations) {
      const sum = values.reduce((total, value) => total + value, 0);
      lines.push(
        `# TYPE ${name}_milliseconds summary`,
        `${name}_milliseconds_count ${values.length}`,
        `${name}_milliseconds_sum ${sum}`
      );
    }
    for (const [rawName, rawValue] of Object.entries(gauges)) {
      const name = String(rawName).replace(/[^a-zA-Z0-9_:]/g, '_');
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
      lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }

  reset() {
    this.counters.clear();
    this.observations.clear();
  }
}
