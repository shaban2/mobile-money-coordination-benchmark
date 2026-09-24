import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRestorablePilotContainer } from '../src/experiment/pilot-containers.js';
const approved = { id: 'exact-container-id', name: 'approved-service' };
const inspected = () => ({ Id: approved.id, Name: `/${approved.name}`, HostConfig: { AutoRemove: false } });
test('only an exact non-auto-removing instance is safe for pilot stop/start', () => {
  assert.doesNotThrow(() => assertRestorablePilotContainer(inspected(), approved));
});
for (const autoRemove of [true, undefined, null, 'false']) {
  test(`auto-removal setting ${String(autoRemove)} is rejected before stopping services`, () => {
    const container = inspected(); container.HostConfig.AutoRemove = autoRemove;
    assert.throws(() => assertRestorablePilotContainer(container, approved), /Cannot safely stop\/restore/);
  });
}
test('a reused name or changed name cannot inherit the original approval', () => {
  const container = inspected(); container.Id = 'different-instance';
  assert.throws(() => assertRestorablePilotContainer(container, approved), /identity changed/);
  container.Id = approved.id; container.Name = '/different-name';
  assert.throws(() => assertRestorablePilotContainer(container, approved), /identity changed/);
});
