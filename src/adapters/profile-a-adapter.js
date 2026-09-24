import { ProviderAdapter } from './provider-adapter.js';

const STATUS_MAP = Object.freeze({
  PROCESSING: 'PENDING',
  SUCCESS: 'COMPLETED',
  DECLINED: 'FAILED'
});

export class ProfileAAdapter extends ProviderAdapter {
  constructor() {
    super('A');
  }

  toProviderRequest(transfer) {
    return {
      sender: transfer.payerId,
      recipient: transfer.payeeId,
      value: transfer.amount,
      currency: transfer.currency,
      requestKey: transfer.idempotencyKey,
      clientReference: transfer.clientReference
    };
  }

  fromProviderResponse(response) {
    return {
      providerReference: response.providerTxnId,
      status: STATUS_MAP[response.outcome] ?? 'FAILED',
      failureCode: response.outcome === 'DECLINED' ? (response.errorCode ?? 'PROVIDER_DECLINED') : null,
      failureMessage: response.outcome === 'DECLINED' ? (response.message ?? 'Provider declined transfer.') : null
    };
  }
}
