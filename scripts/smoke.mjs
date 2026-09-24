import assert from 'node:assert/strict';
import { createSystem } from '../src/system.js';

const conditions = ['rest', 'kafka'];

for (const coordinationMode of conditions) {
  const clientMode = 'async';
  const system = createSystem({ coordinationMode, clientMode, providerDelayMs: 1 });
  const result = await system.application.submit({
    payerId: 'smoke-payer',
    payeeId: 'smoke-payee',
    amount: '100',
    currency: 'UGX',
    clientReference: `SMOKE-${coordinationMode}-${clientMode}`,
    providerProfile: coordinationMode === 'rest' ? 'A' : 'B'
  }, `smoke-${coordinationMode}-${clientMode}`);
  const terminal = await system.application.waitForTerminal(result.body.transferId);
  await system.application.drain();
  assert.equal(terminal.status, 'COMPLETED');
  assert.equal((await system.application.invariants()).passed, true);
  process.stdout.write(`${coordinationMode}-async: COMPLETED, callback delivered, and reconciled\n`);
}
