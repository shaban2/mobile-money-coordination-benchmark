import { createHash, randomUUID } from 'node:crypto';
import { DomainError } from './errors.js';

export const INTERNAL_STATE = Object.freeze({
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  PREPARED: 'PREPARED',
  FULFILLED: 'FULFILLED',
  FAILED: 'FAILED'
});

export const PUBLIC_STATUS = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  RECEIVED: new Set(['VALIDATED', 'FAILED']),
  VALIDATED: new Set(['PREPARED', 'FAILED']),
  PREPARED: new Set(['FULFILLED', 'FAILED']),
  FULFILLED: new Set(),
  FAILED: new Set()
});

export function validateTransferCommand(command) {
  const required = ['payerId', 'payeeId', 'amount', 'currency', 'clientReference', 'providerProfile'];
  const missing = required.filter((field) => command?.[field] === undefined || command[field] === '');
  if (missing.length > 0) {
    throw new DomainError('VALIDATION_ERROR', 'Required transfer fields are missing.', 400, { missing });
  }

  if (command.payerId === command.payeeId) {
    throw new DomainError('VALIDATION_ERROR', 'Payer and payee must be different.', 400);
  }

  if (!/^\d+$/.test(String(command.amount)) || BigInt(command.amount) <= 0n) {
    throw new DomainError('VALIDATION_ERROR', 'Amount must be a positive integer in minor currency units.', 400);
  }

  if (!/^[A-Z]{3}$/.test(command.currency)) {
    throw new DomainError('VALIDATION_ERROR', 'Currency must be a three-letter uppercase code.', 400);
  }

  if (!['A', 'B'].includes(command.providerProfile)) {
    throw new DomainError('VALIDATION_ERROR', 'providerProfile must be A or B.', 400);
  }

  return normalizeTransferCommand(command);
}

export function normalizeTransferCommand(command) {
  return {
    payerId: String(command.payerId),
    payeeId: String(command.payeeId),
    amount: String(command.amount),
    currency: String(command.currency).toUpperCase(),
    clientReference: String(command.clientReference),
    providerProfile: String(command.providerProfile).toUpperCase(),
    callbackUrl: command.callbackUrl ? String(command.callbackUrl) : null
  };
}

export function commandFingerprint(command) {
  const normalized = normalizeTransferCommand(command);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function createTransferRecord(command, idempotencyKey, now = new Date(), idFactory = randomUUID) {
  if (!idempotencyKey) {
    throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.', 400);
  }

  const normalized = validateTransferCommand(command);
  const timestamp = now.toISOString();
  return {
    transferId: idFactory(),
    traceId: randomUUID().replaceAll('-', ''),
    idempotencyKey: String(idempotencyKey),
    commandFingerprint: commandFingerprint(normalized),
    ...normalized,
    internalState: INTERNAL_STATE.RECEIVED,
    publicStatus: PUBLIC_STATUS.PENDING,
    providerReference: null,
    failureCode: null,
    failureMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    history: [{ state: INTERNAL_STATE.RECEIVED, at: timestamp }]
  };
}

export function transitionTransfer(record, nextState, patch = {}, now = new Date()) {
  if (!ALLOWED_TRANSITIONS[record.internalState]?.has(nextState)) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      `Cannot move transfer from ${record.internalState} to ${nextState}.`,
      409
    );
  }

  const timestamp = now.toISOString();
  const terminal = nextState === INTERNAL_STATE.FULFILLED || nextState === INTERNAL_STATE.FAILED;
  return {
    ...record,
    ...patch,
    internalState: nextState,
    publicStatus: nextState === INTERNAL_STATE.FULFILLED
      ? PUBLIC_STATUS.COMPLETED
      : nextState === INTERNAL_STATE.FAILED
        ? PUBLIC_STATUS.FAILED
        : PUBLIC_STATUS.PENDING,
    updatedAt: timestamp,
    completedAt: terminal ? timestamp : record.completedAt,
    history: [...record.history, { state: nextState, at: timestamp }]
  };
}

export function publicTransfer(record) {
  return {
    transferId: record.transferId,
    traceId: record.traceId,
    clientReference: record.clientReference,
    providerReference: record.providerReference,
    payerId: record.payerId,
    payeeId: record.payeeId,
    amount: record.amount,
    currency: record.currency,
    providerProfile: record.providerProfile,
    status: record.publicStatus,
    failure: record.failureCode
      ? { code: record.failureCode, message: record.failureMessage }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt
  };
}
