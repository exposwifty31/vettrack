import { text, timestamp, boolean, varchar, jsonb } from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, animals, owners, users } from "./core.js";

export const appointments = vtTable("vt_appointments", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  animalId: text("animal_id").references(() => animals.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => owners.id, { onDelete: "set null" }),
  vetId: text("vet_id").references(() => users.id, { onDelete: "restrict" }),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /**
   * Extended status values include 'approved' (vet gate for medication tasks).
   * Full machine: pending → approved → in_progress → completed | cancelled
   */
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  /** Links this task to the specific hospitalization episode it belongs to. */
  hospitalizationId: text("hospitalization_id"),
  /** Scheduling type/purpose (e.g. 'checkup', 'followup', 'medication', 'maintenance'). */
  appointmentType: varchar("appointment_type", { length: 40 }),
  /** Who created this appointment/task. */
  createdBy: text("created_by"),
  conflictOverride: boolean("conflict_override").notNull().default(false),
  overrideReason: text("override_reason"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  /**
   * Phase 3 PR 3.1: typed task-ownership FK. Foundation-only — no reads or
   * writes in this PR. The existing free-form `metadata.acknowledgedBy`
   * string remains the authoritative ownership marker until later PRs
   * migrate readers/writers. Nullable during the compat window.
   */
  acknowledgedUserId: text("acknowledged_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Phase 3 PR 3.1: timestamp ownership was acquired. Foundation-only — no reads or writes in this PR. */
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  priority: varchar("priority", { length: 20 }).notNull().default("normal"),
  taskType: varchar("task_type", { length: 20 }),
  /** Medication: inventory container for billing + stock deduction (see also metadata.containerId legacy). */
  containerId: text("container_id"),
  /** Medication: primary vt_items row for the cabinet line (Smart Cop / orphan checks). */
  inventoryItemId: text("inventory_item_id"),
  /** Automation: overdue escalation target — does not replace vet_id (technician ownership). */
  escalatedTo: text("escalated_to").references(() => users.id, { onDelete: "set null" }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  stuckNotifiedAt: timestamp("stuck_notified_at", { withTimezone: true }),
  overdueNotifiedAt: timestamp("overdue_notified_at", { withTimezone: true }),
  prestartReminderAt: timestamp("prestart_reminder_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  externalSyncedAt: timestamp("external_synced_at"),
});
