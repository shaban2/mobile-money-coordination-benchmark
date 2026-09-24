export class HttpAdapterBoundary {
  constructor({ baseUrl, timeoutMs = 5_000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.kind = 'http-service';
  }

  async execute(record) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}/v1/provider-transfers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (cause) {
      const error = new Error('The common adapter service is unavailable.', { cause });
      error.code = 'ADAPTER_OUTCOME_UNKNOWN';
      throw error;
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message ?? 'The common adapter service failed.');
      error.code = body.error?.code ?? 'ADAPTER_ERROR';
      throw error;
    }
    return body;
  }

  setAvailable() {
    const error = new Error('Availability is controlled by stopping or starting the adapter-service container.');
    error.code = 'EXTERNAL_ADAPTER_CONTROL';
    error.httpStatus = 409;
    throw error;
  }

  get available() {
    return null;
  }
}
