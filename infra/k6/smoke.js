import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';

export const options = { vus: 1, iterations: 4 };

export default function () {
  const index = __ITER;
  const payload = JSON.stringify({
    payerId: `payer-${index}`,
    payeeId: `payee-${index}`,
    amount: '1000',
    currency: 'UGX',
    clientReference: `K6-SMOKE-${index}`,
    providerProfile: index % 2 === 0 ? 'A' : 'B',
    ...(__ENV.CALLBACK_URL ? { callbackUrl: __ENV.CALLBACK_URL } : {})
  });
  const response = http.post(`${baseUrl}/v1/transfers`, payload, {
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `k6-smoke-${index}`
    }
  });
  check(response, {
    'create returns 200 or 202': (result) => [200, 202].includes(result.status),
    'create returns a transfer id': (result) => Boolean(result.json('transferId'))
  });
  const transferId = response.json('transferId');
  if (transferId) {
    sleep(0.05);
    const status = http.get(`${baseUrl}/v1/transfers/${transferId}`);
    check(status, { 'status retrieval succeeds': (result) => result.status === 200 });
  }
}
