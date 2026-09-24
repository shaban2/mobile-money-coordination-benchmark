import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransferRecord, transitionTransfer } from '../src/domain/transfer.js';

const command = {
  payerId: 'payer-1',
  payeeId: 'payee-1',
  amount: 500,
  currency: 'UGX',
  clientReference: 'ORDER-1',
  providerProfile: 'A'
};

test('a transfer starts pending and follows the allowed state sequence', () => {
  let record = createTransferRecord(command, 'idem-1');
  assert.equal(record.internalState, 'RECEIVED');
  record = transitionTransfer(record, 'VALIDATED');
  record = transitionTransfer(record, 'PREPARED');
  record = transitionTransfer(record, 'FULFILLED');
  assert.equal(record.publicStatus, 'COMPLETED');
  assert.deepEqual(record.history.map(({ state }) => state), [
    'RECEIVED',
    'VALIDATED',
    'PREPARED',
    'FULFILLED'
  ]);
});

test('a terminal transfer cannot be reversed', () => {
  let record = createTransferRecord(command, 'idem-2');
  record = transitionTransfer(record, 'FAILED');
  assert.throws(() => transitionTransfer(record, 'VALIDATED'), {
    code: 'INVALID_STATE_TRANSITION'
  });
});

test('P2P input rejects invalid amounts and identical parties', () => {
  assert.throws(() => createTransferRecord({ ...command, amount: 0 }, 'idem-3'), {
    code: 'VALIDATION_ERROR'
  });
  assert.throws(
    () => createTransferRecord({ ...command, payeeId: command.payerId }, 'idem-4'),
    { code: 'VALIDATION_ERROR' }
  );
});
