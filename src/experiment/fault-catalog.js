// One place that says what each fault does to the system under test.
// `missingService` may be absent from container samples during the fault.
// `clientVisible` faults are expected to reject some client requests.
const appService = (run) => run?.composeProfile;
export const FAULTS = Object.freeze({
  'adapter-crash': { missingService: () => 'adapter-service', clientVisible: false },
  'database-delay': { missingService: () => null, clientVisible: false },
  'app-kill': { missingService: appService, clientVisible: true, disturbsDiagnostics: true },
  'postgres-restart': { missingService: () => 'postgres', clientVisible: true, disturbsDiagnostics: true },
  'database-partition': { missingService: () => null, clientVisible: true, disturbsDiagnostics: true },
  'broker-stop': { missingService: () => 'redpanda', clientVisible: false, kafkaOnly: true, disturbsDiagnostics: true }
});

export function faultFor(scenario) {
  if (scenario === 'none' || scenario == null) return null;
  const fault = FAULTS[scenario];
  if (!fault) throw new Error(`Unknown fault scenario: ${scenario}`);
  return fault;
}

export function optionalServicesFor(run) {
  const service = faultFor(run?.faultScenario)?.missingService(run);
  return service ? [service] : [];
}

export function assertFaultApplies(run) {
  if (faultFor(run.faultScenario)?.kafkaOnly && run.conditionId !== 'K-A') throw new Error(`${run.faultScenario} applies only to the Kafka condition.`);
}

// Client errors are acceptable only around a client-visible fault. Anything
// outside that span stays a failure, so a fault cannot hide an unrelated problem.
export function clientErrorSummary(attempts, fault, marginMs = 5000) {
  const failed = attempts.filter((a) => !(a.httpStatus >= 200 && a.httpStatus < 300));
  const start = Date.parse(fault?.injectedAt) - marginMs, end = Date.parse(fault?.clearedAt) + marginMs;
  const inside = failed.filter((a) => { const sent = Date.parse(a.sentAt); return sent >= start && sent <= end; });
  return { total: attempts.length, failed: failed.length, duringFault: inside.length, outsideFault: failed.length - inside.length };
}
