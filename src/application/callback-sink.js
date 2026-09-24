import { publicTransfer } from '../domain/transfer.js';

export class CallbackSink {
  constructor({
    sendHttp = false,
    persistence = null,
    maxAttempts = 1,
    retryDelayMs = 0
  } = {}) {
    this.sendHttp = sendHttp;
    this.persistence = persistence;
    this.maxAttempts = Math.max(1, Number(maxAttempts));
    this.retryDelayMs = Math.max(0, Number(retryDelayMs));
    this.deliveries = [];
  }

  async deliver(record) {
    let finalDelivery;
    for (let attemptNumber = 1; attemptNumber <= this.maxAttempts; attemptNumber += 1) {
      const delivery = {
        transferId: record.transferId,
        callbackUrl: record.callbackUrl,
        payload: publicTransfer(record),
        attemptNumber,
        deliveredAt: new Date().toISOString(),
        httpStatus: null,
        delivered: !record.callbackUrl,
        error: null
      };

      if (this.sendHttp && record.callbackUrl) {
        try {
          const response = await fetch(record.callbackUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(delivery.payload),
            signal: AbortSignal.timeout(5_000)
          });
          delivery.httpStatus = response.status;
          delivery.delivered = response.ok;
        } catch (error) {
          delivery.error = error.message;
        }
      }

      this.deliveries.push(delivery);
      await this.persistence?.recordCallbackDelivery(delivery);
      finalDelivery = delivery;
      if (delivery.delivered || !record.callbackUrl) break;
      if (attemptNumber < this.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
    return structuredClone(finalDelivery);
  }

  list() {
    return structuredClone(this.deliveries);
  }

  reset() {
    this.deliveries.length = 0;
  }
}
