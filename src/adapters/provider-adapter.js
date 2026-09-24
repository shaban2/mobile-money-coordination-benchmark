export class ProviderAdapter {
  constructor(profile) {
    this.profile = profile;
  }

  toProviderRequest() {
    throw new Error('toProviderRequest must be implemented');
  }

  fromProviderResponse() {
    throw new Error('fromProviderResponse must be implemented');
  }
}

export class ProviderAdapterRouter {
  constructor(adapters) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.profile, adapter]));
  }

  forProfile(profile) {
    const adapter = this.adapters.get(profile);
    if (!adapter) {
      throw new Error(`No adapter registered for provider profile ${profile}`);
    }
    return adapter;
  }
}
