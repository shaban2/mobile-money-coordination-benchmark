export function sameProxyConfiguration(current, { listen, upstream }) {
  const normalizeListen = (value) => String(value).replace(/^(0\.0\.0\.0|\[::\]):/, '*:');
  return current?.enabled === true && current.upstream === upstream
    && normalizeListen(current.listen) === normalizeListen(listen);
}
