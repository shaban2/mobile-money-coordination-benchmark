// Site bootstrap: start a new, fully guarded pilot chain on a machine other than the
// original capture host. The operator supplies the list of containers the controller
// may pause (possibly empty) and a written approval note; both are frozen with the
// root. Every other guard (competing-container abort, host identity, image pinning,
// source hash, isolation observer, two-run cap, cleanup and restore) is unchanged.
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import path from 'node:path';
import { IMPLEMENTATION_REBUILD_STAGES } from './queue-observation.js';

export function parseSiteBootstrapArgs(args) {
  const siteBootstrap = args.includes('--site-bootstrap');
  const allow = args.find(a => a.startsWith('--allow-pause='));
  const note = args.find(a => a.startsWith('--approval-note='));
  if (!siteBootstrap && (allow || note)) throw new Error('--allow-pause and --approval-note require --site-bootstrap.');
  const allowPause = allow ? allow.slice('--allow-pause='.length).split(',').map(s => s.trim()).filter(Boolean) : [];
  if (siteBootstrap && !note) throw new Error('--site-bootstrap requires --approval-note=<file> written by the operator.');
  return { siteBootstrap, allowPause, approvalNote: note ? note.slice('--approval-note='.length) : null };
}
export const isChainStart = protocol => Boolean(protocol?.exploratoryPair) && !protocol.exploratoryPair.predecessorRoot;
// A chain-start stage has no predecessor to review. It is allowed only under explicit
// site bootstrap and only as an implementation-rebuild stage, because nothing earlier
// pins its images or source identity.
export function assertChainStart(protocol, { siteBootstrap, rebuildStages = IMPLEMENTATION_REBUILD_STAGES } = {}) {
  if (!isChainStart(protocol)) return false;
  assert.ok(siteBootstrap, `Stage ${protocol.exploratoryPair.key} has no predecessor; it can only start a chain with --site-bootstrap.`);
  assert.ok(!protocol.exploratoryPair.predecessorProtocolId, 'A chain-start stage must not name a predecessor protocol.');
  assert.ok(rebuildStages.has(protocol.exploratoryPair.key), `Chain-start stage ${protocol.exploratoryPair.key} must be an implementation-rebuild stage.`);
  return true;
}
export function buildSiteApproval({ allowedPauseNames, noteText, notePath, host = hostname(), approvedAt = new Date().toISOString() }) {
  assert.ok(typeof noteText === 'string' && noteText.trim().length >= 20, 'The approval note must state who approved the run and what may be paused.');
  return { mode: 'SITE_BOOTSTRAP', allowedPauseNames: [...allowedPauseNames], host, approvedAt, noteFile: path.basename(notePath), note: noteText };
}
