import { initVapid, startPushCleanupScheduler } from "../lib/push.js";
import { startCleanupScheduler } from "../lib/cleanup-scheduler.js";
import {
  startScheduledNotificationProcessor,
  startSmartRoleNotificationScheduler,
} from "../lib/role-notification-scheduler.js";
import { startAccessDeniedMetricsWindowScheduler } from "../lib/access-denied.js";
import { startSystemWatchdog } from "../lib/system-watchdog.js";
import { startJobRuntime } from "../jobs/runtime.js";
import { startIntegrationWorker } from "../workers/integration.worker.js";
import { startTaskOwnershipBackfillWorker } from "../workers/taskOwnershipBackfill.worker.js";
import { startStaleTaskOwnershipSweepWorker } from "../workers/staleTaskOwnershipSweepWorker.js";
import { startIntegrationScheduleJobs } from "../integrations/jobs/integration-schedules.js";
import { startIntegrationRetentionCron } from "../integrations/jobs/integration-retention.js";
import { startShadowInventoryScheduler } from "../services/shadow-inventory.service.js";
import { startSystemHealthMonitor } from "../services/system-health-monitor.js";
import { startEventOutboxPublisher } from "../lib/event-publisher.js";
import { startOutboxJanitor } from "../lib/outbox-janitor.js";
import { startAlertReminderScheduler } from "../lib/alert-reminder.js";
import { scanUnresolvedEmergencyDispenses } from "../services/dispense.service.js";
import { startOutboxDlqScanner } from "../lib/outbox-dlq-scanner.js";
import { startCodeBlueReconciliationScanner } from "../lib/code-blue-reconciliation-scanner.js";
import { startEquipmentConditionStalenessWorker } from "../workers/equipmentConditionStalenessWorker.js";
import { startStagingExpiryWorker } from "../workers/stagingExpiryWorker.js";
import { startEquipmentWaitlistReservationWorker } from "../workers/equipment-waitlist-reservation.worker.js";
import { startStaleCheckoutSweepWorker } from "../workers/staleCheckoutSweepWorker.js";
import { startStaleReturnedSweepWorker } from "../workers/stale-returned-sweep.worker.js";
import { startSweepEscalationWorker } from "../workers/sweep-escalation.worker.js";
import { startAutopilotCoordinatorReassignWorker } from "../workers/autopilotCoordinatorReassignWorker.js";
import { startAutopilotRestockBurnWorker } from "../workers/autopilotRestockBurnWorker.js";
import { startAutopilotCrashCartDriftWorker } from "../workers/autopilotCrashCartDriftWorker.js";
import { startAutopilotHandoverDraftWorker } from "../workers/autopilotHandoverDraftWorker.js";
import { startShiftHandoverScheduler } from "../lib/shift-handover-scheduler.js";
import { startRfidReaderOfflineSweep } from "../lib/rfid/reader-offline-sweep.js";
import { startRfidFinalizingSweep } from "../lib/rfid/finalizing-sweep.js";

export async function startBackgroundSchedulers() {
  if (process.env.NODE_ENV === "test") {
    console.log("[test-mode] startBackgroundSchedulers: no-op");
    return;
  }
  await initVapid();
  startEventOutboxPublisher();
  startOutboxJanitor();
  startAlertReminderScheduler();
  startSystemHealthMonitor();
  startPushCleanupScheduler();
  startCleanupScheduler();
  startAccessDeniedMetricsWindowScheduler();
  startScheduledNotificationProcessor();
  startSmartRoleNotificationScheduler();
  startSystemWatchdog();
  await startJobRuntime();
  await startIntegrationWorker();
  await startTaskOwnershipBackfillWorker();
  await startStaleTaskOwnershipSweepWorker();
  startIntegrationScheduleJobs();
  startIntegrationRetentionCron();
  startShadowInventoryScheduler();

  // Scan for unresolved emergency dispenses every 10 minutes.
  // Emits escalating operational alerts at 30/60/120-minute thresholds.
  const EMERGENCY_DISPENSE_SCAN_INTERVAL_MS = 10 * 60 * 1000;
  setInterval(() => {
    scanUnresolvedEmergencyDispenses().catch((err) => {
      console.error("[emergency-dispense-scanner] scan failed:", err);
    });
  }, EMERGENCY_DISPENSE_SCAN_INTERVAL_MS);
  void scanUnresolvedEmergencyDispenses().catch(() => {});

  // Fix E (DLQ): proactive DLQ health scanner — alerts when dead_letter_count > 5.
  startOutboxDlqScanner();

  // Fix E (Code Blue): scanner for unreconciled sessions — alerts every 30 min per session.
  startCodeBlueReconciliationScanner();

  // Equipment Operational State V1/V2 workers
  startEquipmentConditionStalenessWorker();
  startStagingExpiryWorker();
  startEquipmentWaitlistReservationWorker();
  startStaleCheckoutSweepWorker();
  startStaleReturnedSweepWorker();
  startSweepEscalationWorker();

  // VetTrack 2.0, Task 1.1 §3 — Shift Autopilot `coordinator_reassign_off_roster`
  // scan (roster-drift detection; a different mechanism from the sweep-escalation
  // ladder above — see the worker file's header comment).
  startAutopilotCoordinatorReassignWorker();

  // VetTrack 2.0, Task 1.1 §4 — Shift Autopilot `restock_po_on_burn` scan
  // (reorder-point threshold detection; daily cadence — see the worker
  // file's header comment).
  startAutopilotRestockBurnWorker();

  // VetTrack 2.0, Task 1.1 §5 — Shift Autopilot `crash_cart_drift` scan
  // (missing-item + staleness detection over vt_crash_cart_checks /
  // vt_crash_cart_items; daily cadence, ahead of the restock scan's 07:00
  // slot — see the worker file's header comment). Read-only against
  // server/routes/crash-cart.ts; never touches Code Blue paths and never
  // pages/pushes/notifies anyone — it only stages a shadow approval-queue
  // proposal.
  startAutopilotCrashCartDriftWorker();

  // R-SH-F1.2 — shift-end handover generator (in-process; no public generate route).
  // FROZEN for VetTrack 2.0, Task 1.1 §2 — this registration and
  // shift-handover-scheduler.ts are untouched; see the worker below's
  // header doc for the parallel-run scope boundary.
  startShiftHandoverScheduler();

  // VetTrack 2.0, Task 1.1 §2 — Shift Autopilot `shift_handover_draft` scan
  // (shadow-mode staging only; R-SH-F1's auto-publish above is UNCHANGED and
  // runs in parallel for the same ended session — see the worker file's
  // header comment for the full scope boundary and the §0(c) follow-up).
  startAutopilotHandoverDraftWorker();

  // R-M1.1d — RFID reader-offline detection (heartbeat staleness → rfid_reader_offline signal).
  startRfidReaderOfflineSweep();

  // FS-1 (re-attempt) — reclaim crash-stranded `finalizing` rotation rows so a hard-crash mid-
  // finalize can never brick a clinic's one-in-flight rotation gate (time-bounded backstop for the
  // post-delete window + quiet-clinic case the lazy ingest reclaim cannot cover).
  startRfidFinalizingSweep();
}
