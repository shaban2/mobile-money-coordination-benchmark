import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRunIsolation, checkContainerSet, composeArguments, resourceServicesFor, stopComposeProject } from '../src/experiment/compose-lifecycle.js';

const project = 'isolation-test';
const rest = { conditionId: 'R-A', composeProfile: 'rest-async' };
const kafka = { conditionId: 'K-A', composeProfile: 'kafka-async' };
const running = (service) => ({ Name: `/${project}-${service}-1`, State: { Running: true }, Config: { Labels: {
  'com.docker.compose.service': service, 'com.docker.compose.project': project, 'com.docker.compose.oneoff': 'False'
} } });

test('teardown activates every profile, preserves volumes, and checks the exact project label', () => {
  const calls = [];
  const command = (program, args) => { calls.push([program, args]); return ''; };
  assert.equal(stopComposeProject({ command, project, override: 'frozen.json' }).passed, true);
  assert.deepEqual(calls[0], ['docker', ['compose', '-f', 'compose.yaml', '-f', 'frozen.json', '-p', project, '--profile', '*', 'down', '--remove-orphans']]);
  assert.deepEqual(calls[1], ['docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}']]);
  assert.ok(!calls.flat(2).includes('--volumes'));
});
test('successful down with a remaining stopped container is still a fatal cleanup failure', () => {
  const command = (_program, args) => args[0] === 'compose' ? '' : args[0] === 'ps' ? 'leftover' : JSON.stringify([{ Name: '/leftover', State: { Running: false } }]);
  assert.throws(() => stopComposeProject({ command, project }), /left containers behind/);
});
test('teardown and inventory failures cannot be silently accepted', () => {
  for (const failingCommand of ['compose', 'ps']) {
    const command = (_program, args) => { if (args[0] === failingCommand) throw new Error('docker failed'); return ''; };
    assert.throws(() => stopComposeProject({ command, project }), /docker failed/);
  }
});
test('condition/profile mismatches and an implicit project are rejected', () => {
  assert.throws(() => resourceServicesFor({ ...rest, composeProfile: 'kafka-async' }), /do not match/);
  assert.throws(() => composeArguments('', null, 'down'), /explicit Compose project/);
});
test('startup permits exactly the selected stack and ignores completed init containers', () => {
  const inspected = [...resourceServicesFor(rest).map(running), { ...running('toxiproxy-init'), State: { Running: false } }];
  const command = (_program, args) => args[0] === 'ps' ? 'ids' : JSON.stringify(inspected);
  assert.equal(assertRunIsolation(command, project, rest).passed, true);
  inspected.push(running('kafka-async'));
  assert.throws(() => assertRunIsolation(command, project, rest), /Run isolation failed/);
});
test('both architecture orders reject the previous architecture, and REST rejects a leftover broker', () => {
  for (const [run, extra] of [[rest, 'kafka-async'], [kafka, 'rest-async'], [rest, 'redpanda']]) {
    const expected = resourceServicesFor(run);
    const containers = [...expected, extra].map((Service) => ({ Service, ComposeProject: project }));
    assert.equal(checkContainerSet(containers, expected, { project }).passed, false);
  }
});
test('duplicate replicas, foreign projects, and reset one-offs fail isolation', () => {
  for (const extra of [{ Service: 'rest-async' }, { Service: 'rest-async', ComposeProject: 'foreign' }, { Service: 'rest-async', OneOff: true }]) {
    assert.equal(checkContainerSet([{ Service: 'rest-async' }, extra], ['rest-async'], { project }).passed, false);
  }
});
test('only one k6 one-off is permitted during measurement, never at startup', () => {
  const containers = [{ Service: 'rest-async' }, { Service: 'k6', OneOff: true }];
  assert.equal(checkContainerSet(containers, ['rest-async'], { project, allowK6: true }).passed, true);
  assert.equal(checkContainerSet(containers, ['rest-async'], { project }).passed, false);
  containers.push({ Service: 'k6', OneOff: true });
  assert.equal(checkContainerSet(containers, ['rest-async'], { project, allowK6: true }).passed, false);
});
test('legacy names must match the exact project and numeric service replica', () => {
  for (const name of [`${project}-rest-async-1`, `${project}-not-rest-async-1`, 'foreign-rest-async-1', `${project}-rest-async-run-123`]) {
    assert.equal(checkContainerSet([{ Name: name }], ['rest-async'], { project }).passed, name === `${project}-rest-async-1`);
  }
});
