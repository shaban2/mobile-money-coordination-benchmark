import assert from 'node:assert/strict';
import test from 'node:test';
import { foreignContainerStart } from '../src/experiment/pilot-isolation-guard.js';
test('isolation guard distinguishes exact project from foreign and missing labels', () => {
  const event = { Type: 'container', Action: 'start', Actor: { Attributes: { 'com.docker.compose.project': 'pilot' } } };
  assert.equal(foreignContainerStart(event, 'pilot'), false);
  assert.equal(foreignContainerStart(event, 'other'), true);
  delete event.Actor.Attributes['com.docker.compose.project']; assert.equal(foreignContainerStart(event, 'pilot'), true);
  assert.throws(() => foreignContainerStart({}, 'pilot'));
});
