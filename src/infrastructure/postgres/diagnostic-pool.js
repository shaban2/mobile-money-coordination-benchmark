// Observe the promise API used by this repo without changing pg's pooling,
// transaction, release, or error semantics. Callback/query-object APIs delegate
// unchanged and are deliberately not timed by this facade.
export function instrumentPool(pool, diagnostics) {
  if (!diagnostics?.enabled) return pool;
  const snapshot = () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });
  const isPromiseQuery = (args) => !args.some((a) => typeof a === 'function')
    && !args[0]?.callback && !args[0]?.submit;
  const verb = (query) => String(typeof query === 'string' ? query : query?.text ?? '').trim().match(/^\w+/)?.[0]?.toUpperCase() ?? 'UNKNOWN';
  const proxy = (target, overrides) => new Proxy(target, {
    get(object, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(object, key, object);
      return typeof value === 'function' ? value.bind(object) : value;
    }
  });
  const clientProxy = (client) => proxy(client, {
    query: (...args) => isPromiseQuery(args)
      ? diagnostics.measure(`db.query.${verb(args[0])}`, { backendPid: client.processID }, () => client.query(...args))
      : client.query(...args)
  });
  return proxy(pool, {
    connect: (...args) => args.length ? pool.connect(...args)
      : diagnostics.measure('db.acquire', { poolAtStart: snapshot() }, () => pool.connect()).then(clientProxy),
    query: (...args) => isPromiseQuery(args)
      ? diagnostics.measure(`db.pool_query.${verb(args[0])}`, { poolAtStart: snapshot() }, () => pool.query(...args))
      : pool.query(...args)
  });
}
