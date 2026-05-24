import { sql } from "drizzle-orm";
import {
  text, timestamp, boolean, varchar, integer, date,
  index, uniqueIndex, pgEnum, bigint, jsonb,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users, animals, hospitalizations } from "./core.js";
import { billingItems, usageSessionStatusEnum } from "./billing.js";
import { appointments } from "./tasks.js";

export const occupancySourceEnum = pgEnum("vt_occupancy_source", ["manual"]);

export const folders = vtTable("vt_folders", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("manual"),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
});

export const rooms = vtTable(
  "vt_rooms",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    floor: text("floor"),
    masterNfcTagId: text("master_nfc_tag_id").unique(),
    syncStatus: varchar("sync_status", { length: 20 }).notNull().default("stale"),
    lastAuditAt: timestamp("last_audit_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicNameUnique: uniqueIndex("vt_rooms_clinic_name_unique").on(table.clinicId, table.name),
  }),
);

export const docks = vtTable(
  "vt_docks",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicNameUnique: uniqueIndex("vt_docks_clinic_name_unique").on(t.clinicId, t.name),
  }),
);
export type Dock = typeof docks.$inferSelect;
export type NewDock = typeof docks.$inferInsert;

export const assetTypes = vtTable(
  "vt_asset_types",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicNameUnique: uniqueIndex("vt_asset_types_clinic_name_unique").on(t.clinicId, t.name),
  }),
);
export type AssetType = typeof assetTypes.$inferSelect;
export type NewAssetType = typeof assetTypes.$inferInsert;

export const assetTypeConditions = vtTable(
  "vt_asset_type_conditions",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    assetTypeId: text("asset_type_id").notNull().references(() => assetTypes.id, { onDelete: "cascade" }),
    conditionName: text("condition_name").notNull(),
    verificationMethod: text("verification_method").notNull(),
    staleAfterMinutes: integer("stale_after_minutes").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    assetTypeConditionUnique: uniqueIndex("vt_asset_type_conditions_unique").on(
      t.assetTypeId,
      t.conditionName,
    ),
  }),
);
export type AssetTypeCondition = typeof assetTypeConditions.$inferSelect;
export type NewAssetTypeCondition = typeof assetTypeConditions.$inferInsert;

export const equipment = vtTable("vt_equipment", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  serialNumber: text("serial_number"),
  model: text("model"),
  manufacturer: text("manufacturer"),
  purchaseDate: text("purchase_date"),
  expiryDate: date("expiry_date", { mode: "string" }),
  expiryNotifiedAt: timestamp("expiry_notified_at"),
  location: text("location"),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("ok"),
  lastSeen: timestamp("last_seen"),
  lastStatus: varchar("last_status", { length: 20 }),
  lastMaintenanceDate: timestamp("last_maintenance_date"),
  lastSterilizationDate: timestamp("last_sterilization_date"),
  maintenanceIntervalDays: integer("maintenance_interval_days"),
  imageUrl: text("image_url"),
  nfcTagId: text("nfc_tag_id").unique(),
  billingItemId: text("billing_item_id").references(() => billingItems.id, { onDelete: "set null" }),
  lastVerifiedAt: timestamp("last_verified_at"),
  lastVerifiedById: text("last_verified_by_id"),
  // Checkout / ownership
  checkedOutById: text("checked_out_by_id"),
  checkedOutByEmail: text("checked_out_by_email"),
  checkedOutAt: timestamp("checked_out_at"),
  checkedOutLocation: text("checked_out_location"),
  expectedReturnMinutes: integer("expected_return_minutes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  version: integer("version").notNull().default(1),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  usuallyFoundHere: text("usually_found_here"),
  searchAlias: text("search_alias"),
  staffNote: text("staff_note"),
  // Operational state — V1
  assetTypeId: text("asset_type_id").references(() => assetTypes.id, { onDelete: "set null" }),
  dockId: text("dock_id").references(() => docks.id, { onDelete: "set null" }),
  dockConfirmedReadyAt: timestamp("dock_confirmed_ready_at"),
  dockConfirmedById: text("dock_confirmed_by_id").references(() => users.id, { onDelete: "set null" }),
  custodyState: text("custody_state").notNull().default("untracked"),
  custodyStateSince: timestamp("custody_state_since"),
  untrackedDepartureAt: timestamp("untracked_departure_at"),
  emergencyOverrideAt: timestamp("emergency_override_at"),
  emergencyOverrideById: text("emergency_override_by_id").references(() => users.id, { onDelete: "set null" }),
  readinessState: text("readiness_state").notNull().default("unknown"),
  readinessStateSince: timestamp("readiness_state_since"),
  usageState: text("usage_state").notNull().default("available"),
  usageStateSince: timestamp("usage_state_since"),
  procedureBoundHospitalizationId: text("procedure_bound_hospitalization_id").references(
    () => hospitalizations.id,
    { onDelete: "set null" },
  ),
});

export const unitConditionStates = vtTable(
  "vt_unit_condition_states",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    conditionId: text("condition_id").notNull().references(() => assetTypeConditions.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at"),
    verifiedById: text("verified_by_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    equipmentConditionUnique: uniqueIndex("vt_unit_condition_states_unique").on(
      t.equipmentId,
      t.conditionId,
    ),
    clinicEquipmentIdx: index("vt_unit_condition_states_clinic_equipment").on(
      t.clinicId,
      t.equipmentId,
    ),
  }),
);
export type UnitConditionState = typeof unitConditionStates.$inferSelect;
export type NewUnitConditionState = typeof unitConditionStates.$inferInsert;

export const equipmentReturns = vtTable("vt_equipment_returns", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
  returnedById: text("returned_by_id").notNull(),
  returnedByEmail: text("returned_by_email").notNull(),
  returnedAt: timestamp("returned_at").defaultNow().notNull(),
  isPluggedIn: boolean("is_plugged_in").notNull().default(false),
  plugInDeadlineMinutes: integer("plug_in_deadline_minutes").notNull().default(30),
  plugInAlertSentAt: timestamp("plug_in_alert_sent_at"),
  chargeAlertJobId: text("charge_alert_job_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const usageSessions = vtTable("vt_usage_sessions", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  animalId: text("animal_id")
    .notNull()
    .references(() => animals.id, { onDelete: "cascade" }),
  equipmentId: text("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
  billingItemId: text("billing_item_id")
    .notNull()
    .references(() => billingItems.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  lastBilledThrough: timestamp("last_billed_through", { withTimezone: true }),
  status: usageSessionStatusEnum("status").notNull().default("open"),
});

export const patientRoomAssignments = vtTable("vt_patient_room_assignments", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  animalId: text("animal_id")
    .notNull()
    .references(() => animals.id, { onDelete: "cascade" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  source: occupancySourceEnum("source").notNull(),
});

export const stagingQueue = vtTable(
  "vt_staging_queue",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").notNull().references(() => equipment.id, { onDelete: "cascade" }),
    requestedById: text("requested_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => appointments.id, { onDelete: "set null" }),
    clinicalPriority: text("clinical_priority").notNull().default("routine"),
    stagedAt: timestamp("staged_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clinicEquipmentIdx: index("vt_staging_queue_clinic_equipment").on(
      t.clinicId,
      t.equipmentId,
      t.status,
    ),
    expiryIdx: index("vt_staging_queue_expiry")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active' AND ${t.expiresAt} IS NOT NULL`),
  }),
);
export type StagingQueueRow = typeof stagingQueue.$inferSelect;
export type NewStagingQueueRow = typeof stagingQueue.$inferInsert;

export const operationalMetrics = vtTable(
  "vt_operational_metrics",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    equipmentId: text("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    eventIdx: index("vt_operational_metrics_event_idx").on(t.clinicId, t.eventType, t.createdAt),
    equipmentIdx: index("vt_operational_metrics_equipment_idx").on(t.equipmentId, t.createdAt),
    roomIdx: index("vt_operational_metrics_room_idx").on(t.roomId, t.createdAt),
  }),
);
export type OperationalMetric = typeof operationalMetrics.$inferSelect;
export type NewOperationalMetric = typeof operationalMetrics.$inferInsert;

export const scanLogs = vtTable("vt_scan_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id"),
  userId: text("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  note: text("note"),
  photoUrl: text("photo_url"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const transferLogs = vtTable("vt_transfer_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id"),
  fromFolderId: text("from_folder_id"),
  fromFolderName: text("from_folder_name"),
  toFolderId: text("to_folder_id"),
  toFolderName: text("to_folder_name"),
  userId: text("user_id").notNull(),
  note: text("note"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const whatsappAlerts = vtTable("vt_whatsapp_alerts", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  note: text("note"),
  phoneNumber: text("phone_number"),
  message: text("message").notNull(),
  waUrl: text("wa_url").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export const alertAcks = vtTable("vt_alert_acks", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  alertType: varchar("alert_type", { length: 30 }).notNull(),
  acknowledgedById: text("acknowledged_by_id").notNull(),
  acknowledgedByEmail: text("acknowledged_by_email").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),
  remindAt: timestamp("remind_at"),
  remindedAt: timestamp("reminded_at"),
  /** Two-level status: SEEN = awareness (alerts continue); RESOLVED = handled (alerts stop). */
  ackStatus: varchar("ack_status", { length: 10 }).notNull().default("SEEN"),
  /** Set when user marks as RESOLVED. Persisted — row is never deleted. */
  resolvedAt: timestamp("resolved_at"),
  resolvedById: text("resolved_by_id"),
  resolutionNote: text("resolution_note"),
});

export const undoTokens = vtTable("vt_undo_tokens", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  equipmentId: text("equipment_id").notNull(),
  actorId: text("actor_id").notNull(),
  scanLogId: text("scan_log_id").notNull(),
  previousState: text("previous_state").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumed: boolean("consumed").notNull().default(false),
});
