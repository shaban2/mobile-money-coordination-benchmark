import { createSystem } from '../src/system.js';

const report = [];
for (const coordinationMode of ['rest', 'kafka']) {
  for (const clientMode of ['async']) {
    const system = createSystem({ coordinationMode, clientMode });
    for (let index = 0; index < 20; index += 1) {
      const profile = index % 2 === 0 ? 'A' : 'B';
      const result = await system.application.submit({
        payerId: `payer-${index % 4}`,
        payeeId: `payee-${index % 5}`,
        amount: String(100 + index),
        currency: 'UGX',
        clientReference: index % 10 === 9 ? `DECLINE-${index}` : `ORDER-${index}`,
        providerProfile: profile
      }, `${coordinationMode}-${clientMode}-${index}`);
      await system.application.waitForTerminal(result.body.transferId);
    }
    await system.application.drain();
    const invariants = await system.application.invariants();
    report.push({ condition: `${coordinationMode}-${clientMode}`, ...invariants });
    if (!invariants.passed) process.exitCode = 1;
  }
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
