export class WorkLimiter {
  constructor(limit = 4) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Worker concurrency must be a positive integer.');
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }
  async run(work) {
    if (this.active >= this.limit) await new Promise((resolve) => this.queue.push(resolve));
    else this.active += 1;
    try { return await work(); }
    finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
