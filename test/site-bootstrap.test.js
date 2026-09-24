import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSiteBootstrapArgs, assertChainStart, isChainStart, buildSiteApproval } from '../src/experiment/site-bootstrap.js';
import { pilotTimingForPhase } from '../src/experiment/pilot-timing.js';
import { exploratoryProtocols } from '../src/experiment/queue-observation.js';

const template = JSON.parse(readFileSync('config/site-pair-protocol.example.json', 'utf8'));

test('site bootstrap arguments: pause list may be empty, the approval note is mandatory, flags need the mode', () => {
  assert.deepEqual(parseSiteBootstrapArgs(['results-x', '--site-bootstrap', '--approval-note=note.md']), { siteBootstrap: true, allowPause: [], approvalNote: 'note.md' });
  assert.deepEqual(parseSiteBootstrapArgs(['--site-bootstrap', '--allow-pause=a, b,,c', '--approval-note=n']).allowPause, ['a', 'b', 'c']);
  assert.throws(() => parseSiteBootstrapArgs(['--site-bootstrap']), /approval-note/);
  assert.throws(() => parseSiteBootstrapArgs(['--allow-pause=a']), /require --site-bootstrap/);
  assert.deepEqual(parseSiteBootstrapArgs(['results-x', '--exploratory=adapter-k4']), { siteBootstrap: false, allowPause: [], approvalNote: null });
});
test('a chain start is only accepted under site bootstrap and only as a rebuild stage', () => {
  assert.equal(isChainStart(template), true);
  for (const p of exploratoryProtocols) assert.equal(isChainStart(p), false, p.exploratoryPair.key);
  assert.throws(() => assertChainStart(template, { siteBootstrap: false }), /--site-bootstrap/);
  assert.throws(() => assertChainStart(template, { siteBootstrap: true, rebuildStages: new Set() }), /rebuild/);
  assert.equal(assertChainStart(template, { siteBootstrap: true, rebuildStages: new Set(['site-adapter']) }), true);
  assert.equal(assertChainStart(exploratoryProtocols[0], { siteBootstrap: true }), false);
  const bad = { ...template, exploratoryPair: { ...template.exploratoryPair, predecessorProtocolId: 'x' } };
  assert.throws(() => assertChainStart(bad, { siteBootstrap: true, rebuildStages: new Set(['site-adapter']) }), /predecessor protocol/);
});
test('the site template keeps the paper fault timing and validates before registration', () => {
  const timing = pilotTimingForPhase(template, 'fault');
  assert.equal(timing.warmupDuration, '5m'); assert.equal(timing.measurementDuration, '10m');
  assert.equal(template.faults.atSeconds, 240); assert.equal(template.exploratoryPair.faultScenario, 'adapter-crash');
  assert.ok(!('predecessorRoot' in template.exploratoryPair) && !('predecessorProtocolId' in template.exploratoryPair));
});
test('the frozen site approval records the operator list, host, note and time', () => {
  const approval = buildSiteApproval({ allowedPauseNames: ['x'], noteText: 'Approved by the operator; container x may be paused during the pair.', notePath: '/tmp/site-approval.md', host: 'h', approvedAt: 't' });
  assert.deepEqual(approval, { mode: 'SITE_BOOTSTRAP', allowedPauseNames: ['x'], host: 'h', approvedAt: 't', noteFile: 'site-approval.md', note: 'Approved by the operator; container x may be paused during the pair.' });
  assert.throws(() => buildSiteApproval({ allowedPauseNames: [], noteText: 'ok', notePath: 'n' }), /approval note/);
});
