export class InProcessAdapterBoundary {
  constructor({ adapterRouter, provider }) {
    this.adapterRouter = adapterRouter;
    this.provider = provider;
    this.kind = 'in-process';
  }

  async execute(record) {
    const adapter = this.adapterRouter.forProfile(record.providerProfile);
    const providerRequest = adapter.toProviderRequest(record);
    const providerResponse = await this.provider.submit(record.providerProfile, providerRequest);
    return {
      providerRequest,
      providerResponse,
      result: adapter.fromProviderResponse(providerResponse)
    };
  }

  setAvailable(available) {
    this.provider.setAvailable(available);
  }

  get available() {
    return this.provider.available;
  }
}
