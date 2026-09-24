import assert from 'node:assert/strict';
import test from 'node:test';
import { sameProxyConfiguration } from '../src/experiment/proxy-config.js';
test('canonical wildcard listeners do not trigger a live proxy reconfiguration', () => {
  const expected = { listen: '0.0.0.0:15432', upstream: 'postgres:5432' };
  const actual = { listen: '[::]:15432', upstream: 'postgres:5432', enabled: true };
  assert.equal(sameProxyConfiguration(actual, expected), true);
  for (const patch of [{ listen: '[::]:15433' }, { upstream: 'other:5432' }, { enabled: false }]) {
    assert.equal(sameProxyConfiguration({ ...actual, ...patch }, expected), false);
  }
});
