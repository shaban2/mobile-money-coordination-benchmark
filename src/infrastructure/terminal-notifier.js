// Completion signalling within the deliberately single-process deployment.
export class TerminalNotifier {
  constructor() { this.waiters = new Map(); }
  notify(record) {
    if (!record || record.publicStatus === 'PENDING') return;
    for (const resolve of this.waiters.get(record.transferId) ?? []) resolve(record);
    this.waiters.delete(record.transferId);
  }
  async wait(persistence, transferId, timeoutMs) {
    let finish;
    const promise = new Promise((resolve) => { finish = resolve; });
    const listeners = this.waiters.get(transferId) ?? new Set();
    listeners.add(finish);
    this.waiters.set(transferId, listeners);
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      const current = await persistence.get(transferId);
      if (current?.publicStatus !== 'PENDING') return current;
      // Expiry is an observation deadline, not proof a provider effect failed.
      return await promise ?? await persistence.get(transferId);
    } finally {
      clearTimeout(timer);
      listeners.delete(finish);
      if (!listeners.size) this.waiters.delete(transferId);
    }
  }
}
