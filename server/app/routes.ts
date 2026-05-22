import type express from "express";
import equipmentRoutes from "../routes/equipment.js";
import analyticsRoutes from "../routes/analytics.js";
import activityRoutes from "../routes/activity.js";
import userRoutes from "../routes/users.js";
import stabilityRoutes from "../routes/stability.js";
import metricsRoutes from "../routes/metrics.js";
import foldersRoutes from "../routes/folders.js";
import alertAcksRoutes from "../routes/alert-acks.js";
import roomsRoutes from "../routes/rooms.js";
import supportRoutes from "../routes/support.js";
import pushRoutes from "../routes/push.js";
import whatsappRoutes from "../routes/whatsapp.js";
import auditLogsRoutes from "../routes/audit-logs.js";
import storageRoutes from "../routes/storage.js";
import shiftsRoutes from "../routes/shifts.js";
import appointmentsRoutes from "../routes/appointments.js";
import tasksRoutes from "../routes/tasks.js";
import testRoutes from "../routes/test.js";
import healthRoutes from "../routes/health.js";
import queueRoutes from "../routes/queue.js";
import realtimeRoutes from "../routes/realtime.js";
import returnsRoutes from "../routes/returns.js";
import shiftHandoverRoutes from "../routes/shift-handover.js";
import containersRoutes from "../routes/containers.js";
import formularyRoutes from "../routes/formulary.js";
import restockRoutes from "../routes/restock.js";
import medicationTasksRoutes from "../routes/medication-tasks.js";
import billingRoutes from "../routes/billing.js";
import inventoryItemsRoutes from "../routes/inventory-items.js";
import procurementRoutes from "../routes/procurement.js";
import forecastRoutes from "../routes/forecast.js";
import animalsRoutes from "../routes/animals.js";
import patientsRoutes from "../routes/patients.js";
import uploadsRoutes from "../routes/uploads.js";
import clinicalCheckInRoutes from "../routes/clinical-check-in.js";
import codeBlueRoutes from "../routes/code-blue.js";
import crashCartRoutes from "../routes/crash-cart.js";
import integrationsRoutes from "../routes/integrations.js";
import shiftChatRoutes from "../routes/shift-chat.js";
import displayRoutes from "../routes/display.js";
import erRoutes from "../routes/er.js";
import adminOutboxHealthRoutes from "../routes/admin-outbox-health.js";
import adminOutboxDlqRoutes from "../routes/admin-outbox-dlq.js";
import adminMedicationIntegrityRoutes from "../routes/admin-medication-integrity.js";
import adminTaskOwnershipRoutes from "../routes/admin-task-ownership.js";
import dispenseRoutes from "../routes/dispense.js";
import patientHandoffsRoutes from "../routes/patient-handoffs.js";
import homeDashboardRoutes from "../routes/home-dashboard.js";

const isPilotMode = process.env.PILOT_MODE === "true";

export function registerApiRoutes(app: express.Express) {
  // --- Infrastructure (always registered) ---
  app.use("/api/users", userRoutes);
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

  // --- Equipment core (always registered) ---
  app.use("/api/equipment", equipmentRoutes);
  app.use("/api/rooms", roomsRoutes);
  app.use("/api/folders", foldersRoutes);
  app.use("/api/returns", returnsRoutes);
  app.use("/api/alert-acks", alertAcksRoutes);
  app.use("/api/activity", activityRoutes);
  app.use("/api/home", homeDashboardRoutes);
  app.use("/api/display", displayRoutes);

  // --- Safety surfaces (always registered) ---
  app.use("/api/code-blue", codeBlueRoutes);
  app.use("/api/crash-cart", crashCartRoutes);
  app.use("/api/er", erRoutes);

  // --- Admin (always registered — data management during pilot) ---
  app.use("/api/admin", adminOutboxHealthRoutes);
  app.use("/api/admin", adminOutboxDlqRoutes);
  app.use("/api/admin", adminMedicationIntegrityRoutes);
  app.use("/api/admin", adminTaskOwnershipRoutes);
  app.use("/api/stability", stabilityRoutes);

  // --- Full-platform routes (disabled in pilot mode) ---
  if (!isPilotMode) {
    app.use("/api/analytics", analyticsRoutes);
    app.use("/api/shifts", shiftsRoutes);
    app.use("/api/appointments", appointmentsRoutes);
    app.use("/api/tasks", tasksRoutes);
    app.use("/api/shift-handover", shiftHandoverRoutes);
    app.use("/api/shift-handover/patient-handoffs", patientHandoffsRoutes);
    app.use("/api/containers", containersRoutes);
    app.use("/api/restock", restockRoutes);
    app.use("/api/formulary", formularyRoutes);
    app.use("/api/medication-tasks", medicationTasksRoutes);
    app.use("/api/billing", billingRoutes);
    app.use("/api/inventory-items", inventoryItemsRoutes);
    app.use("/api/procurement", procurementRoutes);
    app.use("/api/forecast", forecastRoutes);
    app.use("/api/animals", animalsRoutes);
    app.use("/api/patients", patientsRoutes);
    app.use("/api/clinical", clinicalCheckInRoutes);
    app.use("/api/dispense", dispenseRoutes);
    app.use("/api/shift-chat", shiftChatRoutes);
    app.use("/api/whatsapp", whatsappRoutes);
  }
}
