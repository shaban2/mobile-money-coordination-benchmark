import assert from 'node:assert/strict';
import test from 'node:test';
import { ProfileAAdapter } from '../src/adapters/profile-a-adapter.js';
import { ProfileBAdapter } from '../src/adapters/profile-b-adapter.js';

const transfer = {
  payerId: 'payer-1',
  payeeId: 'payee-1',
  amount: '2500',
  currency: 'UGX',
  idempotencyKey: 'idem-1',
  clientReference: 'ORDER-1'
};

test('Profile A maps the common contract to provider-specific fields and back', () => {
  const adapter = new ProfileAAdapter();
  assert.deepEqual(adapter.toProviderRequest(transfer), {
    sender: 'payer-1',
    recipient: 'payee-1',
    value: '2500',
    currency: 'UGX',
    requestKey: 'idem-1',
    clientReference: 'ORDER-1'
  });
  assert.deepEqual(adapter.fromProviderResponse({ providerTxnId: 'A-9', outcome: 'SUCCESS' }), {
    providerReference: 'A-9',
    status: 'COMPLETED',
    failureCode: null,
    failureMessage: null
  });
});

test('Profile B maps a different provider shape to the same common result', () => {
  const adapter = new ProfileBAdapter();
  assert.deepEqual(adapter.toProviderRequest(transfer), {
    debitParty: 'payer-1',
    creditParty: 'payee-1',
    amount: { value: '2500', currency: 'UGX' },
    requestKey: 'idem-1',
    transferReference: 'ORDER-1'
  });
  assert.equal(
    adapter.fromProviderResponse({ transferReference: 'B-9', status: 'COMPLETED' }).status,
    'COMPLETED'
  );
});
