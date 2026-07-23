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

  // R-SH-F1.2 — shift-end handover generator (in-process; no public generate route).
  startShiftHandoverScheduler();

  // R-M1.1d — RFID reader-offline detection (heartbeat staleness → rfid_reader_offline signal).
  startRfidReaderOfflineSweep();

  // FS-1 (re-attempt) — reclaim crash-stranded `finalizing` rotation rows so a hard-crash mid-
  // finalize can never brick a clinic's one-in-flight rotation gate (time-bounded backstop for the
  // post-delete window + quiet-clinic case the lazy ingest reclaim cannot cover).
  startRfidFinalizingSweep();
}
