import { commandFingerprint, createTransferRecord, validateTransferCommand } from '../domain/transfer.js';
import { DomainError } from '../domain/errors.js';

export class InMemoryTransferRepository {
  constructor() {
    this.byId = new Map();
    this.idByIdempotencyKey = new Map();
  }

  createOrGet(command, idempotencyKey) {
    if (!idempotencyKey) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.', 400);
    }

    const normalized = validateTransferCommand(command);
    const existingId = this.idByIdempotencyKey.get(String(idempotencyKey));
    if (existingId) {
      const existing = this.byId.get(existingId);
      if (existing.commandFingerprint !== commandFingerprint(normalized)) {
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was already used for a different transfer.',
          409
        );
      }
      return { record: structuredClone(existing), created: false };
    }

    const record = createTransferRecord(normalized, idempotencyKey);
    this.save(record);
    this.idByIdempotencyKey.set(record.idempotencyKey, record.transferId);
    return { record: structuredClone(record), created: true };
  }

  save(record) {
    this.byId.set(record.transferId, structuredClone(record));
    return structuredClone(record);
  }

  get(transferId) {
    const record = this.byId.get(transferId);
    return record ? structuredClone(record) : null;
  }

  list() {
    return [...this.byId.values()].map((record) => structuredClone(record));
  }

  reset() {
    this.byId.clear();
    this.idByIdempotencyKey.clear();
  }
}
