// Observe the promise API used by this repo without changing pg's pooling,
// transaction, release, or error semantics. Callback/query-object APIs delegate
// unchanged and are deliberately not timed by this facade.
// Named by what the statement does, so background polling can be separated from
// transfer work. Order matters: telemetry reads mention many tables.
export function statementCategory(query) {
  const sql = String(typeof query === 'string' ? query : query?.text ?? '').trim();
  const verb = sql.match(/^\w+/)?.[0]?.toUpperCase() ?? 'UNKNOWN';
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(verb)) return 'transaction';
  if (/pg_stat_database|xact_commit|outbox_pending|transfers_pending|complete_traces|COUNT\(\*\)/i.test(sql)) return 'telemetry';
  if (/public_status = 'PENDING'\s+OR NOT EXISTS/i.test(sql)) return 'recovery_scan';
  if (/\boutbox_events\b/i.test(sql)) return verb === 'SELECT' ? 'outbox_poll' : verb === 'UPDATE' ? 'outbox_mark' : 'outbox_write';
  if (/\binbox_events\b/i.test(sql)) return 'inbox';
  if (/\btrace_events\b/i.test(sql)) return 'trace';
  if (/\bcallback_deliveries\b/i.test(sql)) return 'callback';
  if (/\b(ledger_transactions|ledger_postings|accounts)\b/i.test(sql)) return 'ledger';
  if (/\bprovider_(attempts|commands)\b/i.test(sql)) return 'provider';
  if (/\btransfers\b/i.test(sql)) return 'transfer_state';
  return 'other';
}

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
    query: (...args) => {
      if (!isPromiseQuery(args)) return client.query(...args);
      diagnostics.countStatement(statementCategory(args[0]));
      return diagnostics.measure(`db.query.${verb(args[0])}`, { backendPid: client.processID }, () => client.query(...args));
    }
  });
  return proxy(pool, {
    connect: (...args) => args.length ? pool.connect(...args)
      : diagnostics.measure('db.acquire', { poolAtStart: snapshot() }, () => pool.connect()).then(clientProxy),
    query: (...args) => {
      if (!isPromiseQuery(args)) return pool.query(...args);
      diagnostics.countStatement(statementCategory(args[0]));
      return diagnostics.measure(`db.pool_query.${verb(args[0])}`, { poolAtStart: snapshot() }, () => pool.query(...args));
    }
  });
}
