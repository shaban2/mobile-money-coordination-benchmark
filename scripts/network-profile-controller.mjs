import { spawnSync } from 'node:child_process';

const profileName = process.argv[2] ?? 'standard';
const condition = process.argv[3] ?? process.env.EXPERIMENT_CONDITION ?? 'R-A';
const composeProject = process.env.COMPOSE_PROJECT_NAME ?? 'lubanga-coordination';

const gateways = Object.freeze({
  'R-A': 'gateway-rest-async',
  'K-A': 'gateway-kafka-async'
});

// Values are applied on each gateway egress. Each round trip crosses that egress
// twice, so delay/jitter are one half and loss is the per-leg equivalent.
const profiles = Object.freeze({
  standard: { delay: '10ms', jitter: '2.5ms', loss: '0.0500%' }
});

const gateway = gateways[condition];
if (!gateway) throw new Error(`Unknown condition ${condition}. Use R-A or K-A.`);
if (profileName !== 'clear' && !profiles[profileName]) {
  throw new Error(`Unknown network profile ${profileName}.`);
}

const command = profileName === 'clear'
  ? ['compose', '-p', composeProject, 'exec', '-T', gateway, 'sh', '/app/infra/netem/clear.sh']
  : [
      'compose', '-p', composeProject, 'exec', '-T',
      '-e', `NETEM_DELAY=${profiles[profileName].delay}`,
      '-e', `NETEM_JITTER=${profiles[profileName].jitter}`,
      '-e', `NETEM_LOSS=${profiles[profileName].loss}`,
      gateway, 'sh', '/app/infra/netem/apply.sh'
    ];

const result = spawnSync('docker', command, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
