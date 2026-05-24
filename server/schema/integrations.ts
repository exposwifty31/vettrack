import { sql } from "drizzle-orm";
import {
  text, timestamp, boolean, varchar, jsonb, integer, doublePrecision,
} from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics } from "./core.js";

export const integrationConfigs = vtTable("vt_integration_configs", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  syncPatients: boolean("sync_patients").notNull().default(false),
  syncInventory: boolean("sync_inventory").notNull().default(false),
  syncAppointments: boolean("sync_appointments").notNull().default(false),
  exportBilling: boolean("export_billing").notNull().default(false),
  lastPatientSyncAt: timestamp("last_patient_sync_at"),
  lastInventorySyncAt: timestamp("last_inventory_sync_at"),
  lastAppointmentSyncAt: timestamp("last_appointment_sync_at"),
  lastBillingExportAt: timestamp("last_billing_export_at"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const integrationSyncConflicts = vtTable("vt_integration_sync_conflicts", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  entityType: text("entity_type").notNull(),
  localId: text("local_id").notNull(),
  externalId: text("external_id").notNull(),
  status: text("status").notNull().default("open"),
  policyUsed: text("policy_used").notNull(),
  payloadSnapshot: jsonb("payload_snapshot"),
  severity: varchar("severity", { length: 10 }).notNull().default("HIGH"),
  resolution: varchar("resolution", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const integrationSyncLog = vtTable("vt_integration_sync_log", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull(),
  adapterId: text("adapter_id").notNull(),
  syncType: text("sync_type").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  recordsAttempted: integer("records_attempted").notNull().default(0),
  recordsSucceeded: integer("records_succeeded").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  error: text("error"),
  jobId: text("job_id"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata"),
});

export const integrationMappingReviews = vtTable("vt_integration_mapping_reviews", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  entityType: text("entity_type").notNull(),
  externalId: text("external_id").notNull(),
  localId: text("local_id"),
  confidence: doublePrecision("confidence"),
  snapshot: jsonb("snapshot"),
  reviewStatus: text("review_status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const integrationWebhookEvents = vtTable("vt_integration_webhook_events", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
  adapterId: text("adapter_id").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("received"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

export const integrationWebhookEventsArchive = vtTable("vt_integration_webhook_events_archive", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull(),
  adapterId: text("adapter_id").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").notNull(),
  processedAt: timestamp("processed_at"),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
});

export const integrationSyncLogArchive = vtTable("vt_integration_sync_log_archive", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull(),
  adapterId: text("adapter_id").notNull(),
  syncType: text("sync_type").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  recordsAttempted: integer("records_attempted").notNull().default(0),
  recordsSucceeded: integer("records_succeeded").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  error: text("error"),
  jobId: text("job_id"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata"),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
});
