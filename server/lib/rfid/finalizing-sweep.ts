/**
 * FS-1 (re-attempt) — scheduled backstop that reclaims crash-stranded `finalizing` rotation rows.
 *
 * See `reclaimStrandedFinalizingRotations` in ./provisioning for the full rationale. A hard process
 * kill between finalizeRotation's Phase-1 claim and its Phase-3 commit can strand a rotation at
 * `status='finalizing'`, permanently holding the per-clinic one-in-flight gate. The lazy ingest
 * reclaim only closes the pre-delete sub-window AND only under continued traffic; this fixed-cadence
 * sweep is the time-bounded backstop that releases a stranded gate regardless of blob state or
 * whether the affected clinic still produces ingest/ack traffic. Registered in
 * server/app/start-schedulers.ts.
 */
import { reclaimStrandedFinalizingRotations } from "./provisioning.js";

/** Fixed cadence: sweep once a minute (matches FINALIZING_STALE_MS granularity). */
const SWEEP_INTERVAL_MS = 60 * 1000;

let sweepStarted = false;

export function startRfidFinalizingSweep(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  void reclaimStrandedFinalizingRotations().catch((err) => {
    console.error("[rfid-finalizing-sweep] startup sweep failed:", err);
  });
  setInterval(() => {
    void reclaimStrandedFinalizingRotations().catch((err) => {
      console.error("[rfid-finalizing-sweep] sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);
}

export const __test = { SWEEP_INTERVAL_MS };
