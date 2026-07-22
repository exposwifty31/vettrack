import type express from "express";

// --- Infrastructure ---
import userRoutes from "../routes/users.js";
import clinicJoinRoutes from "../routes/clinic-join.js";
import realtimeRoutes from "../routes/realtime.js";
import queueRoutes from "../routes/queue.js";
import metricsRoutes from "../routes/metrics.js";
import storageRoutes from "../routes/storage.js";
import uploadsRoutes from "../routes/uploads.js";
import pushRoutes from "../routes/push.js";
import supportRoutes from "../routes/support.js";
import auditLogsRoutes from "../routes/audit-logs.js";
import integrationsRoutes from "../routes/integrations.js";
import testRoutes from "../routes/test.js";
import healthRoutes from "../routes/health.js";

// --- Equipment core ---
import equipmentLocateRoutes from "../routes/equipment-locate.js";
import equipmentRoutes from "../routes/equipment.js";
import equipmentOperationalStateRoutes from "../routes/equipment-operational-state.js";
import operationalMetricsRoutes from "../routes/operational-metrics.js";
import roomsRoutes from "../routes/rooms.js";
import foldersRoutes from "../routes/folders.js";
import returnsRoutes from "../routes/returns.js";
import alertAcksRoutes from "../routes/alert-acks.js";
import activityRoutes from "../routes/activity.js";
import homeDashboardRoutes from "../routes/home-dashboard.js";
import { createDisplayRouter } from "../routes/display.js";
import platformCapabilitiesRoutes from "../routes/platform-capabilities.js";
import equipmentCopilotRoutes from "../routes/equipment-copilot.js";
import equipmentInferenceRoutes from "../routes/equipment-inference.js";
import equipmentDamageRoutes from "../routes/equipment-damage.js";
import dockingRoutes from "../routes/docking.js";

// --- Safety surfaces ---
import codeBlueRoutes from "../routes/code-blue.js";
import crashCartRoutes from "../routes/crash-cart.js";

// --- Admin config (always on) ---
import adminOutboxHealthRoutes from "../routes/admin-outbox-health.js";
import adminOutboxDlqRoutes from "../routes/admin-outbox-dlq.js";
import adminTaskOwnershipRoutes from "../routes/admin-task-ownership.js";
import adminRfidReadersRoutes from "../routes/admin-rfid-readers.js";
import adminRfidProvisioningRoutes from "../routes/admin-rfid-provisioning.js";
import adminEquipmentGovernanceRoutes from "../routes/admin-equipment-governance.js";
import adminWebhooksRoutes from "../routes/admin-webhooks.js";
import adminNotificationsRoutes from "../routes/admin-notifications.js";
import cursorBugFixerRoutes from "../routes/cursor-bug-fixer.js";
import stabilityRoutes from "../routes/stability.js";

// --- Platform (scheduling, inventory, clinical) ---
import analyticsRoutes from "../routes/analytics.js";
import shiftsRoutes from "../routes/shifts.js";
import shiftAdjustmentsRoutes from "../routes/shift-adjustments.js";
import appointmentsRoutes from "../routes/appointments.js";
import tasksRoutes from "../routes/tasks.js";
import containersRoutes from "../routes/containers.js";
import restockRoutes from "../routes/restock.js";
import inventoryItemsRoutes from "../routes/inventory-items.js";
import nudgesRoutes from "../routes/nudges.js";
import procurementRoutes from "../routes/procurement.js";
import clinicalCheckInRoutes from "../routes/clinical-check-in.js";
import dispenseRoutes from "../routes/dispense.js";
import shiftChatRoutes from "../routes/shift-chat.js";
import shiftHandoverRoutes from "../routes/shift-handover.js";
import whatsappRoutes from "../routes/whatsapp.js";

function registerInfrastructureRoutes(app: express.Express) {
  app.use("/api/users", userRoutes);
  // Bare /api mount: paths defined in-router (/auth/join-clinic + /admin/clinic-join-code*).
  app.use("/api", clinicJoinRoutes);
  app.use("/api/realtime", realtimeRoutes);
  app.use("/api/queue", queueRoutes);
  app.use("/api/metrics", metricsRoutes);
  app.use("/api/storage", storageRoutes);
  app.use("/api/uploads", uploadsRoutes);
  app.use("/api/push", pushRoutes);
  app.use("/api/support", supportRoutes);
  app.use("/api/audit-logs", auditLogsRoutes);
  app.use("/api/integrations", integrationsRoutes);
  app.use("/api/test", testRoutes);
  app.use("/api/health", healthRoutes);
  app.use("/api/health/ready", healthRoutes);
  app.use("/health", healthRoutes);
}

function registerEquipmentCoreRoutes(app: express.Express) {
  // Locate mounts before the main equipment router: /locate is a single path
  // segment and would otherwise match equipmentRoutes' generic GET /:id first.
  app.use("/api/equipment", equipmentLocateRoutes);
  // Main equipment router first; copilot nested routes (/:id/copilot/*) pass through when
  // unmatched. Copilot middleware is scoped to POST /:id/copilot/explain only.
  app.use("/api/equipment", equipmentRoutes);
  app.use("/api/equipment", equipmentCopilotRoutes);
  app.use("/api/equipment", equipmentInferenceRoutes);
  // Damage-report sub-resource (POST /:id/damage) — T-24b.
  app.use("/api/equipment", equipmentDamageRoutes);
  // Bare /api mounts: operational-state and operational-metrics attach to the shared
  // /api prefix. Keep them immediately after /api/equipment and before narrower paths.
  app.use("/api", equipmentOperationalStateRoutes);
  app.use("/api", operationalMetricsRoutes);
  app.use("/api/rooms", roomsRoutes);
  app.use("/api/folders", foldersRoutes);
  app.use("/api/returns", returnsRoutes);
  app.use("/api/alert-acks", alertAcksRoutes);
  app.use("/api/activity", activityRoutes);
  app.use("/api/home", homeDashboardRoutes);
  app.use("/api/display", createDisplayRouter());
  app.use("/api/equipment-board", createDisplayRouter());
  // Docking ownership (T1.4) — Home Room assignment + reconciliation reads.
  // Own /api/docking prefix: no path collision with /api/equipment/* above.
  app.use("/api/docking", dockingRoutes);
}

function registerSafetySurfaceRoutes(app: express.Express) {
  app.use("/api/code-blue", codeBlueRoutes);
  app.use("/api/crash-cart", crashCartRoutes);
}

function registerAdminConfigRoutes(app: express.Express) {
  app.use("/api/admin", adminOutboxHealthRoutes);
  app.use("/api/admin", adminOutboxDlqRoutes);
  app.use("/api/admin", adminTaskOwnershipRoutes);
  app.use("/api/admin", adminRfidReadersRoutes);
  app.use("/api/admin", adminRfidProvisioningRoutes);
  app.use("/api/admin", adminEquipmentGovernanceRoutes);
  app.use("/api/admin", adminWebhooksRoutes);
  app.use("/api/admin", adminNotificationsRoutes);
  app.use("/api/admin/cursor-bug-fixer", cursorBugFixerRoutes);
  app.use("/api/stability", stabilityRoutes);
}

function registerPlatformCapabilitiesRoutes(app: express.Express) {
  app.use("/api/platform", platformCapabilitiesRoutes);
}

function registerPlatformRoutes(app: express.Express) {
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/shifts", shiftsRoutes);
  app.use("/api/shift-adjustments", shiftAdjustmentsRoutes);
  app.use("/api/appointments", appointmentsRoutes);
  app.use("/api/tasks", tasksRoutes);
  app.use("/api/containers", containersRoutes);
  app.use("/api/restock", restockRoutes);
  app.use("/api/inventory-items", inventoryItemsRoutes);
  app.use("/api/nudges", nudgesRoutes);
  app.use("/api/procurement", procurementRoutes);
  app.use("/api/clinical", clinicalCheckInRoutes);
  app.use("/api/dispense", dispenseRoutes);
  app.use("/api/shift-chat", shiftChatRoutes);
  app.use("/api/shift-handover", shiftHandoverRoutes);
  app.use("/api/whatsapp", whatsappRoutes);
}

/**
 * Registers all API route modules on the Express app.
 * Mount order is significant (Express matches in registration order).
 */
export function registerApiRoutes(app: express.Express) {
  registerInfrastructureRoutes(app);
  registerEquipmentCoreRoutes(app);
  registerSafetySurfaceRoutes(app);
  registerAdminConfigRoutes(app);
  registerPlatformCapabilitiesRoutes(app);
  registerPlatformRoutes(app);
}
