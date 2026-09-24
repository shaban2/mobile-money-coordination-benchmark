import { ProviderAdapter } from './provider-adapter.js';

const STATUS_MAP = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'FAILED'
});

export class ProfileBAdapter extends ProviderAdapter {
  constructor() {
    super('B');
  }

  toProviderRequest(transfer) {
    return {
      debitParty: transfer.payerId,
      creditParty: transfer.payeeId,
      amount: {
        value: transfer.amount,
        currency: transfer.currency
      },
      requestKey: transfer.idempotencyKey,
      transferReference: transfer.clientReference
    };
  }

  fromProviderResponse(response) {
    return {
      providerReference: response.transferReference,
      status: STATUS_MAP[response.status] ?? 'FAILED',
      failureCode: response.status === 'REJECTED' ? (response.reason?.code ?? 'PROVIDER_REJECTED') : null,
      failureMessage: response.status === 'REJECTED' ? (response.reason?.message ?? 'Provider rejected transfer.') : null
    };
  }
}
