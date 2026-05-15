import { initVapid, startPushCleanupScheduler } from "../lib/push.js";
import { startCleanupScheduler } from "../lib/cleanup-scheduler.js";
import {
  startScheduledNotificationProcessor,
  startSmartRoleNotificationScheduler,
} from "../lib/role-notification-scheduler.js";
import { startAccessDeniedMetricsWindowScheduler } from "../lib/access-denied.js";
import { startSystemWatchdog } from "../lib/system-watchdog.js";
import { startExpiryCheckWorker } from "../workers/expiryCheckWorker.js";
import { startStaleCheckInSweepWorker } from "../workers/staleCheckInSweepWorker.js";
import { startChargeAlertWorker } from "../workers/chargeAlertWorker.js";
import { startInventoryDeductionWorker } from "../workers/inventory-deduction.worker.js";
import { startAdmissionFanoutWorker } from "../workers/admission-fanout.worker.js";
import { startIntegrationWorker } from "../workers/integration.worker.js";
import { startTaskOwnershipBackfillWorker } from "../workers/taskOwnershipBackfill.worker.js";
import { startStaleTaskOwnershipSweepWorker } from "../workers/staleTaskOwnershipSweepWorker.js";
import { startIntegrationScheduleJobs } from "../integrations/jobs/integration-schedules.js";
import { startIntegrationRetentionCron } from "../integrations/jobs/integration-retention.js";
import { startErHandoffSlaScheduler } from "../services/er-handoff-sla.service.js";
import { startErIntakeEscalationScheduler } from "../services/er-intake-escalation.service.js";
import { startErKpiDailyRollupScheduler } from "../services/er-kpi-rollup.service.js";
import { startShadowInventoryScheduler } from "../services/shadow-inventory.service.js";
import { startSystemHealthMonitor } from "../services/system-health-monitor.js";
import { startEventOutboxPublisher } from "../lib/event-publisher.js";
import { startOutboxJanitor } from "../lib/outbox-janitor.js";
import { startAlertReminderScheduler } from "../lib/alert-reminder.js";
import { scanUnresolvedEmergencyDispenses } from "../services/dispense.service.js";
import { startOutboxDlqScanner } from "../lib/outbox-dlq-scanner.js";
import { startCodeBlueReconciliationScanner } from "../lib/code-blue-reconciliation-scanner.js";
import { recoverPendingInventoryJobs } from "../lib/inventory-job-recovery.js";

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
  await startExpiryCheckWorker();
  await startStaleCheckInSweepWorker();
  await startChargeAlertWorker();
  await startInventoryDeductionWorker();
  await startAdmissionFanoutWorker();
  await startIntegrationWorker();
  await startTaskOwnershipBackfillWorker();
  await startStaleTaskOwnershipSweepWorker();
  startIntegrationScheduleJobs();
  startIntegrationRetentionCron();
  startErKpiDailyRollupScheduler();
  startErHandoffSlaScheduler();
  startErIntakeEscalationScheduler();
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

  // Re-enqueue stale/failed inventory deduction jobs every 10 minutes.
  try {
    const INVENTORY_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
    recoverPendingInventoryJobs()
      .then(({ enqueued, skipped }) => {
        console.log("[inventory-job-recovery] startup recovery complete", { enqueued, skipped });
      })
      .catch((err) => {
        console.error("[inventory-job-recovery] startup recovery failed", err);
      });
    setInterval(() => {
      recoverPendingInventoryJobs().catch((err) => {
        console.error("[inventory-job-recovery] interval recovery failed", err);
      });
    }, INVENTORY_RECOVERY_INTERVAL_MS);
    console.log("[inventory-job-recovery] scheduler registered (interval=10m)");
  } catch (err) {
    console.error("[inventory-job-recovery] scheduler registration failed — recovery will not run", err);
  }
}
