import { INTERNAL_STATE } from '../domain/transfer.js';
export async function saveTransition(persistence, record, nextState, patch = {}, options = {}) {
  return persistence.transition(record, nextState, patch, options);
}
export async function failTransfer(persistence, record, error, options = {}) {
  if (!record || [INTERNAL_STATE.FULFILLED, INTERNAL_STATE.FAILED].includes(record.internalState)) return record;
  return persistence.fail(record, error, options);
}
export async function callProvider({ record, adapterBoundary, persistence,
  retryPolicy = { maxAttempts: 1, delayMs: 0 }, workflowTimeoutMs = 30_000 }) {
  const cached = await persistence.ensureProviderCommand(record);
  if (cached) return cached;
  const maxAttempts = Math.max(1, Number(retryPolicy.maxAttempts));
  const delayMs = Math.max(0, Number(retryPolicy.delayMs));
  const deadline = Date.parse(record.createdAt) + workflowTimeoutMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    let execution;
    let failure;
    // A network timeout cannot prove absence of a provider effect. Replay the
    // durable key to reconcile it; do not turn an uncertain effect into FAILED.
    try { execution = await adapterBoundary.execute(record); }
    catch (error) { failure = error; }
    if (execution) {
      await persistence.recordProviderAttempt({ transferId: record.transferId,
        providerProfile: record.providerProfile, requestPayload: execution.providerRequest,
        responsePayload: execution.providerResponse, outcome: execution.result.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        failureCode: execution.result.failureCode, startedAt, completedAt: new Date().toISOString()
      }, { result: execution.result });
      return execution.result;
    }
    const retryable = ['ADAPTER_UNAVAILABLE', 'ADAPTER_OUTCOME_UNKNOWN'].includes(failure.code);
    const exhausted = !retryable || attempt === maxAttempts || Date.now() + delayMs >= deadline;
    const uncertain = failure.code === 'ADAPTER_OUTCOME_UNKNOWN' || !failure.code;
    const result = { status: 'FAILED', failureCode: failure.code ?? 'ADAPTER_ERROR', failureMessage: failure.message };
    await persistence.recordProviderAttempt({ transferId: record.transferId, providerProfile: record.providerProfile,
      requestPayload: { requestKey: record.idempotencyKey }, responsePayload: null, outcome: 'FAILED',
      failureCode: result.failureCode, startedAt, completedAt: new Date().toISOString()
    }, { result: exhausted && !uncertain ? result : null });
    if (exhausted) {
      await persistence.recordDeadLetter(record.transferId, uncertain ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_RETRY_EXHAUSTED', failure, { attempts: attempt });
      if (uncertain) throw failure;
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
