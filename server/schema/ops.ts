import { sql } from "drizzle-orm";
import {
  text, timestamp, integer, boolean, varchar, jsonb,
  date, time, uuid, index, uniqueIndex, primaryKey, bigserial, pgEnum,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics, users, animals, hospitalizations } from "./core.js";
import { appointments } from "./tasks.js";

export const shiftRole = pgEnum("vt_shift_role", ["technician", "senior_technician", "admin"]);

export const shiftSessions = vtTable("vt_shift_sessions", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  startedByUserId: text("started_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  note: text("note"),
});

export const shifts = vtTable("vt_shifts", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  date: date("date", { mode: "string" }).notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  employeeName: text("employee_name").notNull(),
  role: shiftRole("role").notNull(),
});

export const shiftImports = vtTable("vt_shift_imports", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  importedBy: text("imported_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
});

export const doctorShifts = vtTable(
  "vt_doctor_shifts",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    shiftName: text("shift_name").notNull(),
    operationalRole: varchar("operational_role", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    clinicDateRoleIdx: index("idx_doctor_shifts_clinic_date_role").on(
      table.clinicId,
      table.date,
      table.operationalRole,
    ),
  }),
);

export type DoctorShift = typeof doctorShifts.$inferSelect;
export type NewDoctorShift = typeof doctorShifts.$inferInsert;

export const serverConfig = vtTable("vt_server_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const pushSubscriptions = vtTable("vt_push_subscriptions", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  technicianReturnRemindersEnabled: boolean("technician_return_reminders_enabled").notNull().default(true),
  seniorOwnReturnRemindersEnabled: boolean("senior_own_return_reminders_enabled").notNull().default(true),
  seniorTeamOverdueAlertsEnabled: boolean("senior_team_overdue_alerts_enabled").notNull().default(true),
  adminHourlySummaryEnabled: boolean("admin_hourly_summary_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scheduledNotifications = vtTable("vt_scheduled_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  userId: text("user_id").notNull(),
  equipmentId: text("equipment_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  payload: jsonb("payload"),
});

export const supportTickets = vtTable("vt_support_tickets", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: varchar("severity", { length: 10 }).notNull().default("medium"),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  userId: text("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  pageUrl: text("page_url"),
  deviceInfo: text("device_info"),
  appVersion: text("app_version"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const bulkAuditLog = vtTable("vt_bulk_audit_log", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  eventType: varchar("event_type", { length: 30 }).notNull(),
  equipmentId: text("equipment_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  equipmentStatus: varchar("equipment_status", { length: 20 }),
  actorId: text("actor_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  note: text("note"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const auditLogs = vtTable("vt_audit_logs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  performedBy: text("performed_by").notNull(),
  performedByEmail: text("performed_by_email").notNull(),
  targetId: text("target_id"),
  targetType: varchar("target_type", { length: 50 }),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const eventOutbox = vtTable(
  "vt_event_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    eventVersion: integer("event_version").notNull().default(1),
    errorType: varchar("error_type", { length: 20 }),
    level: varchar("level", { length: 10 }).notNull().default("INFO"),
    category: varchar("category", { length: 20 }).notNull().default("SYSTEM"),
  },
  (table) => ({
    unpublishedIdx: index("idx_vt_event_outbox_unpublished").on(table.id).where(sql`${table.publishedAt} IS NULL`),
  }),
);

export const shiftMessages = vtTable(
  "vt_shift_messages",
  {
    id: text("id").primaryKey(),
    shiftSessionId: text("shift_session_id")
      .notNull()
      .references(() => shiftSessions.id, { onDelete: "cascade" }),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    senderId: text("sender_id").references(() => users.id, { onDelete: "set null" }),
    senderName: text("sender_name"),
    senderRole: text("sender_role"),
    body: text("body").notNull().default(""),
    type: text("type").notNull().default("regular"),
    broadcastKey: text("broadcast_key"),
    systemEventType: text("system_event_type"),
    systemEventPayload: jsonb("system_event_payload"),
    roomTag: text("room_tag"),
    isUrgent: boolean("is_urgent").notNull().default(false),
    mentionedUserIds: jsonb("mentioned_user_ids").notNull().default(sql`'[]'::jsonb`),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    pinnedByUserId: text("pinned_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shiftIdx: index("vt_shift_messages_shift_idx").on(table.shiftSessionId),
    clinicIdx: index("vt_shift_messages_clinic_idx").on(table.clinicId),
    createdIdx: index("vt_shift_messages_created_idx").on(table.createdAt),
  }),
);

export const shiftMessageAcks = vtTable(
  "vt_shift_message_acks",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => shiftMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId] }),
  }),
);

export const shiftMessageReactions = vtTable(
  "vt_shift_message_reactions",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => shiftMessages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
  }),
);

export type ShiftMessage = typeof shiftMessages.$inferSelect;
export type ShiftMessageAck = typeof shiftMessageAcks.$inferSelect;
export type ShiftMessageReaction = typeof shiftMessageReactions.$inferSelect;

export const shiftHandoffs = vtTable(
  "vt_shift_handoffs",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    hospitalizationId: text("hospitalization_id")
      .references(() => hospitalizations.id, { onDelete: "set null" }),
    outgoingUserId: text("outgoing_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clinicStatusIdx: index("idx_shift_handoffs_clinic_status").on(
      table.clinicId,
      table.status
    ),
    clinicCreatedIdx: index("idx_shift_handoffs_clinic_created").on(
      table.clinicId,
      table.createdAt
    ),
  }),
);

export const shiftHandoffItems = vtTable(
  "vt_shift_handoff_items",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    handoffId: text("handoff_id")
      .notNull()
      .references(() => shiftHandoffs.id, { onDelete: "cascade" }),
    activeIssue: text("active_issue").notNull(),
    nextAction: text("next_action").notNull(),
    currentStability: text("current_stability").notNull().default(""),
    pendingTasks: text("pending_tasks").notNull().default(""),
    criticalWarnings: text("critical_warnings").notNull().default(""),
    etaMinutes: integer("eta_minutes").notNull(),
    ownerUserId: text("owner_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    riskFlags: jsonb("risk_flags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    pendingMedicationTaskId: text("pending_medication_task_id"),
    note: text("note"),
    ackBy: text("ack_by")
      .references(() => users.id, { onDelete: "set null" }),
    ackAt: timestamp("ack_at"),
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),
    overriddenBy: text("overridden_by")
      .references(() => users.id, { onDelete: "set null" }),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    handoffIdx: index("idx_shift_handoff_items_handoff").on(table.handoffId),
    clinicOwnerIdx: index("idx_shift_handoff_items_clinic_owner").on(
      table.clinicId,
      table.ownerUserId
    ),
  }),
);

export const shiftHandoverSnapshots = vtTable(
  "vt_shift_handover_snapshots",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    shiftSessionId: text("shift_session_id")
      .notNull()
      .references(() => shiftSessions.id, { onDelete: "restrict" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    patientsPayload: jsonb("patients_payload").notNull(),
    summaryCounts: jsonb("summary_counts").notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => ({
    clinicShiftIdx: index("idx_vt_shift_handover_snapshots_clinic_shift").on(table.clinicId, table.shiftSessionId),
    clinicGeneratedIdx: index("idx_vt_shift_handover_snapshots_clinic_generated").on(table.clinicId, table.generatedAt),
  }),
);

export type ShiftHandoverSnapshot = typeof shiftHandoverSnapshots.$inferSelect;

export const operationalTasks = vtTable(
  "vt_tasks",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: text("patient_id").references(() => animals.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    tag: text("tag").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clinicCreatedIdx: index("idx_vt_tasks_clinic_created").on(table.clinicId, table.createdAt),
  }),
);

export const idempotencyKeys = vtTable(
  "vt_idempotency_keys",
  {
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clinicId, table.key] }),
    clinicCreatedIdx: index("idx_vt_idempotency_keys_clinic_created").on(table.clinicId, table.createdAt),
  }),
);

export const shiftPatientHandoffs = vtTable(
  "vt_shift_patient_handoffs",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    outgoingUserId: text("outgoing_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    receivingUserId: text("receiving_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clinicStatusIdx: index("idx_vt_sph_clinic_status").on(t.clinicId, t.status),
    receivingIdx: index("idx_vt_sph_receiving").on(t.receivingUserId, t.status),
    outgoingIdx: index("idx_vt_sph_outgoing").on(t.outgoingUserId, t.status),
  }),
);
export type ShiftPatientHandoff = typeof shiftPatientHandoffs.$inferSelect;

export const shiftPatientHandoffItems = vtTable(
  "vt_shift_patient_handoff_items",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    handoffId: text("handoff_id")
      .notNull()
      .references(() => shiftPatientHandoffs.id, { onDelete: "cascade" }),
    hospitalizationId: text("hospitalization_id")
      .notNull()
      .references(() => hospitalizations.id, { onDelete: "restrict" }),
    animalId: text("animal_id")
      .notNull()
      .references(() => animals.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    skipReason: text("skip_reason"),
    currentStability: text("current_stability").notNull().default(""),
    pendingTasksNote: text("pending_tasks_note").notNull().default(""),
    criticalWarnings: text("critical_warnings").notNull().default(""),
    clinicalNote: text("clinical_note").notNull().default(""),
    patientSnapshot: jsonb("patient_snapshot").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    handoffIdx: index("idx_vt_sphi_handoff").on(t.handoffId),
    handoffHospUq: uniqueIndex("uq_vt_sphi_handoff_hosp").on(t.handoffId, t.hospitalizationId),
  }),
);
export type ShiftPatientHandoffItem = typeof shiftPatientHandoffItems.$inferSelect;

export const clinicalCheckIns = vtTable(
  "vt_clinical_check_ins",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    operationalRole: varchar("operational_role", { length: 40 }),
    clinicalRoleAtCheckIn: varchar("clinical_role_at_check_in", { length: 20 }).notNull(),
    activeShiftId: text("active_shift_id"),
    shiftSessionId: text("shift_session_id"),
    checkOutReason: varchar("check_out_reason", { length: 40 }),
    clientId: varchar("client_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    openPerUserUq: uniqueIndex("ux_vt_clinical_check_ins_open_per_user")
      .on(t.clinicId, t.userId)
      .where(sql`${t.checkedOutAt} IS NULL`),
    clinicOpenIdx: index("idx_vt_clinical_check_ins_clinic_open")
      .on(t.clinicId)
      .where(sql`${t.checkedOutAt} IS NULL`),
    userRecentIdx: index("idx_vt_clinical_check_ins_user_recent").on(t.userId, t.checkedInAt.desc()),
  }),
);
export type ClinicalCheckIn = typeof clinicalCheckIns.$inferSelect;

export const taskOwnershipConfirmQueue = vtTable(
  "vt_task_ownership_confirm_queue",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
    appointmentId: text("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
    rawAcknowledgedBy: text("raw_acknowledged_by").notNull(),
    candidateUserIds: jsonb("candidate_user_ids").notNull().default(sql`'[]'::jsonb`),
    resolutionReason: varchar("resolution_reason", { length: 40 }).notNull(),
    matcherVersion: varchar("matcher_version", { length: 20 }).notNull(),
    resolvedSource: varchar("resolved_source", { length: 30 }).notNull().default("pending"),
    confirmedUserId: text("confirmed_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdByJobId: text("created_by_job_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tripleUq: uniqueIndex("ux_vt_task_ownership_confirm_queue_triple")
      .on(t.clinicId, t.appointmentId, t.rawAcknowledgedBy),
    clinicPendingIdx: index("idx_vt_task_ownership_confirm_queue_clinic_pending")
      .on(t.clinicId, t.createdAt)
      .where(sql`${t.resolvedSource} = 'pending'`),
    appointmentIdx: index("idx_vt_task_ownership_confirm_queue_appointment").on(t.appointmentId),
  }),
);
export type TaskOwnershipConfirmQueueRow = typeof taskOwnershipConfirmQueue.$inferSelect;
