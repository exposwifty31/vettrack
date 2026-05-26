import { api } from "./api";

let circuitOpenReportedForWindow = false;
let reportedCircuitOpenUntilMs = 0;

export function reportSyncPermanentFailure(): void {
  void api.realtime.telemetry({ syncPermanentFailure: true }).catch(() => {});
}

/**
 * Event-driven circuit-open signal (one POST per open window).
 * Pass `circuitOpenUntilMs` from sync-engine after `circuitOpenUntil` is set.
 */
export function reportSyncCircuitOpen(circuitOpenUntilMs: number): void {
  const now = Date.now();
  if (now >= reportedCircuitOpenUntilMs) {
    circuitOpenReportedForWindow = false;
  }
  if (circuitOpenReportedForWindow && reportedCircuitOpenUntilMs === circuitOpenUntilMs) {
    return;
  }
  circuitOpenReportedForWindow = true;
  reportedCircuitOpenUntilMs = circuitOpenUntilMs;
  void api.realtime.telemetry({ syncCircuitOpen: true }).catch(() => {});
}

/** Clears dedupe when the circuit cooldown elapses (sync-engine timer). */
export function resetSyncCircuitOpenTelemetryIfExpired(nowMs = Date.now()): void {
  if (nowMs >= reportedCircuitOpenUntilMs) {
    circuitOpenReportedForWindow = false;
    reportedCircuitOpenUntilMs = 0;
  }
}

/** Test-only reset of dedupe state. */
export function _resetSyncEngineTelemetryForTests(): void {
  circuitOpenReportedForWindow = false;
  reportedCircuitOpenUntilMs = 0;
}
