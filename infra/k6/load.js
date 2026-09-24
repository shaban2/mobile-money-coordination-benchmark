import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Gauge } from 'k6/metrics';

const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
const offeredRate = Number(__ENV.OFFERED_RATE || 10);
const attempts = new Counter('client_attempts');
const measurementStart = new Gauge('measurement_started_at');
const seedOffset = [...(__ENV.RANDOM_SEED || 'pilot')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % 100;
const replaySlots = new Set([18, 37, 58, 77]);
const uniqueCreates = new Counter('workload_unique_creates');
const replayCreates = new Counter('workload_replay_creates');
const statusRetrievals = new Counter('workload_status_retrievals');
const providerARequests = new Counter('workload_provider_a_requests');
const providerBRequests = new Counter('workload_provider_b_requests');

export const options = {
  scenarios: {
    open_loop: {
      executor: 'constant-arrival-rate',
      rate: offeredRate,
      timeUnit: '1s',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 20),
      maxVUs: Number(__ENV.MAX_VUS || 200)
    }
  },
  thresholds: {
    checks: ['rate>=0.995']
  }
};

export function setup() {
  const response = http.post(`${baseUrl}/v1/transfers`, JSON.stringify({ payerId: 'status-fixture-payer', payeeId: 'status-fixture-payee',
    amount: '1', currency: 'UGX', clientReference: `fixture-${__ENV.RUN_ID}`, providerProfile: 'A' }), {
    headers: { 'content-type': 'application/json', 'idempotency-key': `fixture-${__ENV.RUN_ID}` }
  });
  if (response.status !== 202) throw new Error('Status fixture could not be created.');
  const transferId = response.json('transferId');
  return { transferId };
}

function recordAttempt(response, iteration, operation, sentAt, idempotencyKey = '') {
  let transferId = '';
  try { transferId = response.json('transferId') || ''; } catch {}
  attempts.add(1, { attemptId: `${__ENV.RUN_ID}:${iteration}`, operation, sentAt: String(sentAt),
    idempotencyKey, transferId, httpStatus: String(response.status) });
}

function createTransfer(iteration) {
  const cycleSlot = iteration % 100;
  const replay = replaySlots.has(cycleSlot);
  const sourceIteration = replay ? iteration - 1 : iteration;
  const creation = {
    key: `run-${__ENV.RUN_ID || 'pilot'}-iteration-${sourceIteration}`,
    payload: {
      payerId: `payer-${(sourceIteration + seedOffset) % 100}`,
      payeeId: `payee-${(sourceIteration + seedOffset) % 100}`,
      amount: String(100 + (sourceIteration % 900)),
      currency: 'UGX',
      clientReference: `RUN-${__ENV.RUN_ID || 'pilot'}-${sourceIteration}`,
      providerProfile: sourceIteration % 2 === 0 ? 'A' : 'B',
      ...(__ENV.CALLBACK_URL ? { callbackUrl: __ENV.CALLBACK_URL } : {})
    }
  };
  const sentAt = Date.now();
  const response = http.post(`${baseUrl}/v1/transfers`, JSON.stringify(creation.payload), {
    headers: { 'content-type': 'application/json', 'idempotency-key': creation.key },
    tags: { operation: replay ? 'transfer_replay' : 'transfer_create' }
  });
  if (![200, 202].includes(response.status)) {
    console.error(`transfer request failed: status=${response.status} body=${response.body}`);
  }
  check(response, { 'transfer request accepted': (result) => [200, 202].includes(result.status) });
  replay ? replayCreates.add(1) : uniqueCreates.add(1);
  creation.payload.providerProfile === 'A' ? providerARequests.add(1) : providerBRequests.add(1);
  recordAttempt(response, iteration, replay ? 'transfer_replay' : 'transfer_create', sentAt, creation.key);
}

export default function (data) {
  const iteration = exec.scenario.iterationInTest;
  if (iteration === 0) measurementStart.add(exec.scenario.startTime);
  if (iteration % 5 === 4) {
    statusRetrievals.add(1);
    const sentAt = Date.now();
    const response = http.get(`${baseUrl}/v1/transfers/${data.transferId}`, {
      tags: { operation: 'status_retrieval' }
    });
    check(response, { 'status retrieval succeeds': (result) => result.status === 200 });
    recordAttempt(response, iteration, 'status_retrieval', sentAt);
    return;
  }
  createTransfer(iteration);
}
