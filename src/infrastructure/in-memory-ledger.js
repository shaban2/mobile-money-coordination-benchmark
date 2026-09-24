import { DomainError } from '../domain/errors.js';

export class InMemoryLedger {
  constructor({ defaultPayerBalance = 100_000_000n } = {}) {
    this.defaultPayerBalance = BigInt(defaultPayerBalance);
    this.balances = new Map();
    this.openingBalances = new Map();
    this.entriesByTransfer = new Map();
  }

  seed(accountId, amount) {
    if (this.entriesByTransfer.size > 0) {
      throw new Error('Ledger balances cannot be seeded after transfers have been posted.');
    }
    const value = BigInt(amount);
    this.balances.set(String(accountId), value);
    this.openingBalances.set(String(accountId), value);
  }

  ensureAccount(accountId, openingBalance = 0n) {
    const key = String(accountId);
    if (!this.balances.has(key)) {
      const value = BigInt(openingBalance);
      this.balances.set(key, value);
      this.openingBalances.set(key, value);
    }
  }

  applyTransfer(transfer) {
    if (this.entriesByTransfer.has(transfer.transferId)) {
      return structuredClone(this.entriesByTransfer.get(transfer.transferId));
    }

    this.ensureAccount(transfer.payerId, this.defaultPayerBalance);
    this.ensureAccount(transfer.payeeId, 0n);
    const amount = BigInt(transfer.amount);
    const payerBefore = this.balances.get(transfer.payerId);
    const payeeBefore = this.balances.get(transfer.payeeId);
    if (payerBefore < amount) {
      throw new DomainError('INSUFFICIENT_FUNDS', 'The payer has insufficient synthetic funds.', 422);
    }

    this.balances.set(transfer.payerId, payerBefore - amount);
    this.balances.set(transfer.payeeId, payeeBefore + amount);
    const entry = {
      transferId: transfer.transferId,
      currency: transfer.currency,
      debit: { accountId: transfer.payerId, amount: transfer.amount },
      credit: { accountId: transfer.payeeId, amount: transfer.amount }
    };
    this.entriesByTransfer.set(transfer.transferId, entry);
    return structuredClone(entry);
  }

  balance(accountId) {
    return String(this.balances.get(String(accountId)) ?? 0n);
  }

  entries() {
    return [...this.entriesByTransfer.values()].map((entry) => structuredClone(entry));
  }

  checkConservation() {
    const opening = [...this.openingBalances.values()].reduce((sum, value) => sum + value, 0n);
    const current = [...this.balances.values()].reduce((sum, value) => sum + value, 0n);
    return { passed: opening === current, opening: String(opening), current: String(current) };
  }

  reset() {
    this.balances.clear();
    this.openingBalances.clear();
    this.entriesByTransfer.clear();
  }
}
