import { isCalibration, validateCalibrationProtocol } from './calibration.js';
// Keep phase selection shared by launch, evaluation, and resume verification.
// A short screen locates candidates; it must never masquerade as confirmation.
export function pilotTimingForPhase(protocol, phase) {
  if (isCalibration(protocol)) {
    validateCalibrationProtocol(protocol);
    if (phase !== 'calibration') throw new Error('Only calibration runs are permitted in this protocol.');
    return { warmupDuration: protocol.warmupDuration, measurementDuration: protocol.measurementDuration, drainSeconds: protocol.drainSeconds };
  }
  if (!['screening', 'confirmation', 'fault'].includes(phase)) throw new Error(`Unknown pilot phase: ${phase}`);
  const selected = phase === 'screening' && protocol.screening ? protocol.screening : protocol;
  const seconds = (value) => {
    const match = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(value ?? '');
    return match ? Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]] : NaN;
  };
  const warmup = seconds(selected.warmupDuration), measurement = seconds(selected.measurementDuration);
  const requiredWindowSeconds = protocol.stability.lastCompleteWindows * protocol.stability.windowSeconds;
  if (!(warmup > 0) || !(measurement >= requiredWindowSeconds) || !(requiredWindowSeconds > 0)
    || !Number.isFinite(protocol.drainSeconds) || protocol.drainSeconds < 0) {
    throw new Error(`Invalid pilot timing or insufficient stability windows for ${phase}.`);
  }
  if (phase === 'fault' && !(measurement > protocol.faults.atSeconds
    + Math.max(protocol.faults.adapterCrashSeconds, protocol.faults.databaseDelaySeconds))) {
    throw new Error('Fault measurement must extend beyond injection and clearance.');
  }
  return { warmupDuration: selected.warmupDuration, measurementDuration: selected.measurementDuration,
    drainSeconds: protocol.drainSeconds };
}

export function pilotLifecycleMatches(manifest, protocol, phase) {
  const timing = pilotTimingForPhase(protocol, phase);
  return manifest?.run?.phase === phase
    && Object.entries(timing).every(([key, value]) => manifest?.lifecycle?.[key] === value);
}

export function pilotTimingEnvironment(protocol, phase) {
  const timing = pilotTimingForPhase(protocol, phase);
  return { WARMUP_DURATION: timing.warmupDuration, MEASUREMENT_DURATION: timing.measurementDuration,
    DRAIN_SECONDS: String(timing.drainSeconds) };
}
