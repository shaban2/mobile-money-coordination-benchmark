import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { cpus, hostname, totalmem } from 'node:os';
import path from 'node:path';
import { fileHash, sourceSnapshotSha256 } from '../src/experiment/provenance.js';
import { pilotTimingForPhase } from '../src/experiment/pilot-timing.js';
import { assertRestorablePilotContainer } from '../src/experiment/pilot-containers.js';
import { validateCalibrationProtocol } from '../src/experiment/calibration.js';
import { validateQueueCapacityProtocol, capacityRuleIdentity, assertCapacityRuleLaunchReady } from '../src/experiment/capacity-queue.js';
import { exploratoryProtocol, rebuildsImplementation } from '../src/experiment/queue-observation.js';
import { assertPredecessorReview, predecessorReviewPath } from '../src/experiment/exploratory-review.js';

const args = process.argv.slice(2), calibration = args.includes('--calibration');
const exploratoryKey = args.find(a => a.startsWith('--exploratory='))?.split('=')[1];
const exploratory = exploratoryKey ? exploratoryProtocol(exploratoryKey) : null;
const observationPair = args.includes('--observation-pair') || Boolean(exploratory);
const queuePair = args.includes('--queue-pair') || observationPair;
if (calibration && queuePair) throw new Error('Choose calibration or queue pair, not both.');
const root = path.resolve(args.find(a => !a.startsWith('--')) ?? (calibration ? 'results-calibration-v1' : 'results-capacity-pilot-v3'));
const protocolFile = exploratory ? `config/exploratory-${exploratoryKey}-protocol.json`
  : calibration ? 'config/calibration-protocol.json' : observationPair ? 'config/queue-observation-pair-protocol.json'
  : queuePair ? 'config/capacity-queue-pair-protocol.json' : 'config/pilot-protocol.json';
const project = 'lubanga-coordination-pilot';
if (existsSync(root)) throw new Error(`Refusing to overwrite pilot preparation: ${root}`);
const json = (name, value) => writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
function command(program, args, capture = false) {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, POSTGRES_PORT: '25432', APP_CPUS: '2', APP_MEMORY: '1g' } });
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed: ${result.stderr ?? result.error ?? result.status}`);
  return result.stdout;
}
const compose = (...args) => ['compose', '-p', project, ...args];
const protocol = JSON.parse(readFileSync(protocolFile, 'utf8'));
if (calibration) validateCalibrationProtocol(protocol);
if (queuePair) { validateQueueCapacityProtocol(protocol); assertCapacityRuleLaunchReady(capacityRuleIdentity(protocol)); }
let prerequisiteReview;
let predecessorFreeze;
if (exploratory) {
  if (root !== path.resolve(exploratory.exploratoryPair.root)) throw new Error('Use the exact approved exploratory evidence root.');
  prerequisiteReview = JSON.parse(readFileSync(predecessorReviewPath(protocol), 'utf8'));
  assertPredecessorReview(protocol, prerequisiteReview);
  predecessorFreeze = JSON.parse(readFileSync(path.join(protocol.exploratoryPair.predecessorRoot, 'freeze.json'), 'utf8'));
}
const deep = calibration || protocol.deepDiagnostics === true;
for (const phase of calibration ? ['calibration'] : ['screening', 'confirmation', 'fault']) pilotTimingForPhase(protocol, phase);
const running = command('docker', ['ps', '--no-trunc', '--format', '{{json .}}'], true).trim().split('\n').filter(Boolean).map(JSON.parse);
// The user approved leaving the removed external companion container unavailable during
// this pilot. Do not recreate it or stop a newly appearing companion instance.
const approvedNames = ['external-container-a', 'external-container-b', 'external-container-c'];
const isApproved = (c) => approvedNames.includes(c.Names);
const pauseContainers = running.filter(isApproved).map((c) => ({ id: c.ID, name: c.Names }));
// Calibration inherits authorization for exact instances, not names alone.
const approvalSource = calibration || queuePair ? 'results-capacity-pilot-v5/freeze.json' : null;
if (approvalSource) {
  const approved = JSON.parse(readFileSync(approvalSource, 'utf8')).pauseContainers;
  for (const c of pauseContainers) if (!approved.some(a => a.id === c.id && a.name === c.name)) {
    throw new Error(`Container ${c.name} is a different instance; new approval is required.`);
  }
}
const unexpected = running.filter((c) => !isApproved(c));
if (unexpected.length) throw new Error(`Unapproved competing containers are running: ${unexpected.map((c) => c.Names).join(', ')}`);
// Validate every approved instance before building, freezing, or stopping any.
for (const container of pauseContainers) {
  assertRestorablePilotContainer(JSON.parse(command('docker', ['inspect', container.id], true))[0], container);
}
mkdirSync(root, { recursive: true });
if (prerequisiteReview) json('prerequisite-review.json', prerequisiteReview);
const config = JSON.parse(command('docker', compose('--profile', '*', 'config', '--format', 'json'), true));
const buildServices = Object.entries(config.services).filter(([, s]) => s.build).map(([name]) => name);
const reuseAllImages = exploratory && !rebuildsImplementation(protocol);
if (!reuseAllImages) command('docker', compose('--profile', '*', 'build', ...buildServices));
const images = {}, overrides = { services: {} };
for (const [service, definition] of Object.entries(config.services)) {
  const pinned = predecessorFreeze && (reuseAllImages || !definition.build) ? predecessorFreeze.images[service] : null;
  const reference = pinned?.reference ?? definition.image ?? `${project}-${service}:latest`;
  const inspected = JSON.parse(command('docker', ['image', 'inspect', pinned?.id ?? reference], true))[0];
  if (pinned && inspected.Id !== pinned.id) throw new Error('Predecessor image identity changed.');
  images[service] = { reference, id: inspected.Id, repoDigests: inspected.RepoDigests ?? [], platform: `${inspected.Os}/${inspected.Architecture}` };
  overrides.services[service] = { image: inspected.Id, pull_policy: 'never' };
  if (deep && ['rest-async', 'kafka-async'].includes(service)) overrides.services[service].environment = { DATABASE_DIAGNOSTICS_ENABLED: 'true' };
  if (deep && service === 'postgres') overrides.services[service].command = ['postgres', '-c', 'track_io_timing=on', '-c', 'track_wal_io_timing=on'];
}
json('frozen-compose.json', overrides);
if (reuseAllImages && fileHash(path.join(root, 'frozen-compose.json')) !== predecessorFreeze.frozenComposeSha256) {
  throw new Error('Follow-up must retain the exact preceding frozen images and Compose override.');
}
copyFileSync(protocolFile, path.join(root, 'pilot-protocol.json'));
const info = JSON.parse(command('docker', ['info', '--format', '{{json .}}'], true));
if (predecessorFreeze && (hostname() !== predecessorFreeze.host.hostname || totalmem() !== predecessorFreeze.host.totalMemoryBytes
  || info.ID !== predecessorFreeze.host.dockerId || info.NCPU !== predecessorFreeze.host.dockerCPUs
  || info.MemTotal !== predecessorFreeze.host.dockerMemoryBytes || info.ServerVersion !== predecessorFreeze.host.dockerVersion)) {
  throw new Error('Host/Docker configuration differs from the reviewed predecessor.');
}
json('freeze.json', { schemaVersion: 1, stage: exploratory ? 'DESCRIPTIVE_EXPLORATORY_FROZEN_NOT_CAPACITY_EVIDENCE' : observationPair ? 'DESCRIPTIVE_SCREENING_FROZEN_NOT_CAPACITY_EVIDENCE'
  : calibration ? 'DIAGNOSTIC_CALIBRATION_FROZEN_NOT_CAPACITY_EVIDENCE' : 'PILOT_RULES_AND_EXECUTION_FROZEN_NOT_CONFIRMATORY', frozenAt: new Date().toISOString(),
  project, postgresPort: 25432, sourceSha256: sourceSnapshotSha256(), protocolSha256: fileHash(path.join(root, 'pilot-protocol.json')),
  frozenComposeSha256: fileHash(path.join(root, 'frozen-compose.json')), images, pauseContainers,
  ...(prerequisiteReview ? { prerequisiteReviewSha256: fileHash(path.join(root, 'prerequisite-review.json')) } : {}),
  ...(approvalSource ? { approvalSource, approvalSourceSha256: fileHash(approvalSource) } : {}),
  host: { hostname: hostname(), cpuModel: cpus()[0]?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem(),
    dockerId: info.ID, dockerVersion: info.ServerVersion, dockerCPUs: info.NCPU, dockerMemoryBytes: info.MemTotal, dockerArchitecture: info.Architecture },
  approvals: { fullPilotAndMonitoring: !queuePair, pauseAndRestoreNamedExternalContainers: true,
    companionContainerUnavailableDuringPilot: true, restoreCompanionByController: false,
    ...(calibration ? { fourRunsFourOperationsPerSecondFiveMinuteWarmupTenMinuteMeasurement: true, noFaultsOrCapacitySearch: true }
      : { shortScreeningTwoMinuteWarmupFourMinuteMeasurement: true }),
    ...(queuePair ? { firstPairOnly: true, noHigherRatesOrFaults: !exploratory, maximumRuns: 2, capacityRule: capacityRuleIdentity(protocol) } : {}),
    ...(exploratory ? { exactExploratoryPair: protocol.exploratoryPair, noAdaptiveSearchOrConfirmatoryStudy: true } : {}),
    ...(observationPair ? { descriptiveOnly: true, noCapacityDecision: true } : {}), backlogClearanceDescriptive: true },
  confirmatoryFreeze: false });
command('tar', ['-czf', path.join(root, 'source-snapshot.tar.gz'), 'src', 'scripts', 'infra', 'migrations', 'contracts', 'config', 'docs', 'test', 'README.md', 'SOURCE_PROVENANCE.md', 'package.json', 'package-lock.json', 'compose.yaml', 'Dockerfile', 'Dockerfile.gateway', '.dockerignore', '.env.example']);
json('archive-checksum.json', { sha256: fileHash(path.join(root, 'source-snapshot.tar.gz')) });
process.stdout.write(`Prepared immutable pilot inputs in ${root}. No measurement has started.\n`);
