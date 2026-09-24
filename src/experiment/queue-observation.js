import protocol from '../../config/queue-observation-pair-protocol.json' with { type: 'json' };
import screening from '../../config/exploratory-screening-r8-protocol.json' with { type: 'json' };
import adapter from '../../config/exploratory-adapter-r4-protocol.json' with { type: 'json' };
import database from '../../config/exploratory-database-r4-protocol.json' with { type: 'json' };
import adapterK4 from '../../config/exploratory-adapter-k4-protocol.json' with { type: 'json' };
import databaseK4 from '../../config/exploratory-database-k4-protocol.json' with { type: 'json' };

export const OBSERVATION_RULE_VERSION = 'queue-observation-v2';
export const approvedObservationProtocol = protocol;
export const approvedObservationProtocols = [protocol, screening, adapter, database, adapterK4, databaseK4];
export const exploratoryProtocols = [screening, adapter, database, adapterK4, databaseK4];
// An implementation-rebuild stage builds fresh application images and may carry a source hash
// different from its predecessor's freeze. Every later stage must pin to the rebuild stage's
// images and share its source hash. screening-r8 began the 21 September sequence; adapter-k4
// begins the 22 September order-balanced fault sequence after the repository rename.
export const IMPLEMENTATION_REBUILD_STAGES = new Set(['screening-r8', 'adapter-k4']);
export const rebuildsImplementation = p => IMPLEMENTATION_REBUILD_STAGES.has(p?.exploratoryPair?.key);
export const observationPairScope = p => p.exploratoryPair ?? { phase: 'screening', rate: 4, faultScenario: 'none' };
export function exploratoryProtocol(key) {
  const result = exploratoryProtocols.find(p => p.exploratoryPair.key === key);
  if (!result) throw new Error(`Unknown exploratory stage: ${key}`);
  return result;
}
export const isQueueObservation = p => p?.ruleVersion === OBSERVATION_RULE_VERSION;

// Prospectively approved descriptive interpretation. The validation-only
// candidate is retained separately so all 2,400 cases can test exact parity.
export function describeQueueObservation(boundaries) {
  if (!Array.isArray(boundaries) || boundaries.length < 8 || boundaries.length % 4 !== 0
    || Array.from(boundaries).some(v => !Number.isSafeInteger(v) || v < 0)) {
    throw new Error('Expected a complete nonnegative integer series divisible into four equal blocks.');
  }
  const size = boundaries.length / 4;
  const blocks = Array.from({ length: 4 }, (_, i) => {
    const values = boundaries.slice(i * size, (i + 1) * size);
    return { firstBoundary: i * size + 1, lastBoundary: (i + 1) * size, min: Math.min(...values), max: Math.max(...values) };
  });
  const risesThroughout = blocks.slice(1).every((block, i) => block.min > blocks[i].min && block.max > blocks[i].max)
    && blocks.at(-1).min > blocks[0].max;
  const fallsOrFlatThroughout = boundaries.every((value, i) => i === 0 || value <= boundaries[i - 1]);
  const anyRise = boundaries.some((value, i) => i > 0 && value > boundaries[i - 1]);
  const anyFall = boundaries.some((value, i) => i > 0 && value < boundaries[i - 1]);
  const status = fallsOrFlatThroughout ? 'NO_INCREASE_AT_SAMPLED_BOUNDARIES'
    : risesThroughout ? 'CONSISTENT_BLOCK_GROWTH_OBSERVED'
    : anyRise && anyFall ? 'MIXED_RISES_AND_FALLS_REVIEW' : 'INCONCLUSIVE_GROWTH_PATTERN';
  return { version: OBSERVATION_RULE_VERSION, status, blocks,
    role: 'DESCRIPTIVE_SCREENING_NOT_CAPACITY_DECISION',
    capacityEstablished: false, automaticBoundaryDecision: null };
}
