import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exploratoryProtocol } from '../src/experiment/queue-observation.js';
import { inspectCompletedObservationPair, assertPredecessorReview, predecessorReviewPath } from '../src/experiment/exploratory-review.js';
import { sourceSnapshotSha256 } from '../src/experiment/provenance.js';

const [stage, ...args] = process.argv.slice(2), protocol = exploratoryProtocol(stage);
const predecessor = inspectCompletedObservationPair(protocol.exploratoryPair.predecessorRoot);
console.log(JSON.stringify({ ...predecessor, files: { count: Object.keys(predecessor.files).length } }, null, 2));
if (args.includes('--record-review')) {
  const noteIndex = args.indexOf('--note'), note = noteIndex >= 0 ? args[noteIndex + 1] : null;
  const receipt = { schemaVersion: 1, reviewedAt: new Date().toISOString(), decision: 'APPROVED_NEXT_EXPLORATORY_PAIR',
    nextProtocolId: protocol.protocolId, currentSourceSha256: sourceSnapshotSha256(), note, predecessor };
  assertPredecessorReview(protocol, receipt);
  const file = predecessorReviewPath(protocol);
  if (existsSync(file)) throw new Error('Review already exists; do not overwrite it.');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(`Recorded explicit prerequisite review: ${file}. No experiment was launched.`);
}
