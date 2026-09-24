import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ProviderSimulator {
  constructor({ delayMs = 0, idFactory = randomUUID, journalPath = null } = {}) {
    this.delayMs = delayMs;
    this.idFactory = idFactory;
    this.available = true;
    this.calls = [];
    this.journalPath = journalPath;
    this.results = new Map();
    if (journalPath) {
      mkdirSync(path.dirname(journalPath), { recursive: true });
      if (existsSync(journalPath)) for (const line of readFileSync(journalPath, 'utf8').split('\n').filter(Boolean)) {
        const record = JSON.parse(line);
        this.results.set(record.key, record);
      }
    }
  }

  setAvailable(available) {
    this.available = available;
  }

  async submit(profile, request) {
    if (!this.available) {
      const error = new Error('Adapter/provider boundary is unavailable.');
      error.code = 'ADAPTER_UNAVAILABLE';
      throw error;
    }

    if (this.delayMs > 0) {
      await wait(this.delayMs);
    }

    const shouldDecline = String(request.clientReference ?? request.transferReference)
      .toUpperCase()
      .includes('DECLINE');
    const requestKey = String(request.requestKey ?? request.clientReference ?? request.transferReference);
    const key = `${profile}:${requestKey}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const existing = this.results.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Object.assign(new Error('Provider key reused with a different payload.'), { code: 'PROVIDER_IDEMPOTENCY_CONFLICT' });
      return structuredClone(existing.response);
    }
    const stableReference = createHash('sha256').update(`${profile}:${requestKey}`).digest('hex').slice(0, 24);

    let response;
    if (profile === 'A') {
      response = shouldDecline
        ? {
            providerTxnId: `A-${stableReference}`,
            outcome: 'DECLINED',
            errorCode: 'LIMIT_EXCEEDED',
            message: 'Synthetic provider decline.'
          }
        : { providerTxnId: `A-${stableReference}`, outcome: 'SUCCESS' };
    } else response = shouldDecline
      ? {
          transferReference: `B-${stableReference}`,
          status: 'REJECTED',
          reason: { code: 'LIMIT_EXCEEDED', message: 'Synthetic provider decline.' }
        }
      : { transferReference: `B-${stableReference}`, status: 'COMPLETED' };
    const record = { key, fingerprint, response };
    if (this.journalPath) {
      const fd = openSync(this.journalPath, 'a');
      try { writeSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd); }
      finally { closeSync(fd); }
    }
    this.results.set(key, record);
    this.calls.push({ profile, request: structuredClone(request) });
    return structuredClone(response);
  }
}
