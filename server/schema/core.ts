import { sql } from "drizzle-orm";
import { text, timestamp, integer, numeric, varchar, jsonb, index } from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";

export const clinics = vtTable("vt_clinics", {
  id: text("id").primaryKey(),
  /** IANA timezone for clinic-local day boundaries (tasks, scheduling). */
  timezone: text("timezone").notNull().default("Asia/Jerusalem"),
  pharmacyEmail: text("pharmacy_email"),
  forecastPdfSourceFormat: varchar("forecast_pdf_source_format", { length: 20 }).notNull().default("smartflow"),
  erModeState: varchar("er_mode_state", { length: 20 }).notNull().default("disabled"),
  /** Minutes until a low-severity intake auto-escalates to medium (SLA aging). */
  erIntakeEscalateLowMinutes: integer("er_intake_escalate_low_minutes").notNull().default(15),
  /** Minutes a medium-severity intake waits before auto-escalating to high. */
  erIntakeEscalateMediumMinutes: integer("er_intake_escalate_medium_minutes").notNull().default(15),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = vtTable("vt_users", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  clerkId: text("clerk_id").unique().notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  role: varchar("role", { length: 20 }).notNull().default("technician"),
  secondaryRole: varchar("secondary_role", { length: 20 }),
  allowedOperationalRoles: jsonb("allowed_operational_roles").notNull().default(sql`'[]'::jsonb`),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  preferredLocale: varchar("preferred_locale", { length: 10 }).notNull().default("he"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
});

export const owners = vtTable("vt_owners", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  fullName: text("full_name").notNull().default(""),
  phone: text("phone"),
  nationalId: text("national_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const animals = vtTable("vt_animals", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").references(() => owners.id, { onDelete: "set null" }),
  name: text("name").notNull().default(""),
  species: text("species"),
  recordNumber: text("record_number"),
  breed: text("breed"),
  sex: text("sex"),
  color: text("color"),
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  externalSyncedAt: timestamp("external_synced_at"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  clinicDeletedIdx: index("idx_vt_animals_clinic_deleted").on(table.clinicId, table.deletedAt),
}));

// status stored as TEXT CHECK — consistent with codeBlueOutcome pattern
export type HospitalizationStatus = "admitted" | "observation" | "critical" | "recovering" | "discharged" | "deceased";

export const hospitalizations = vtTable(
  "vt_hospitalizations",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "cascade" }),
    animalId: text("animal_id").notNull().references(() => animals.id, { onDelete: "cascade" }),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull().defaultNow(),
    dischargedAt: timestamp("discharged_at", { withTimezone: true }),
    status: text("status").$type<HospitalizationStatus>().notNull().default("admitted"),
    ward: text("ward"),
    bay: text("bay"),
    admissionReason: text("admission_reason"),
    admittingVetId: text("admitting_vet_id").references(() => users.id, { onDelete: "set null" }),
    dischargeNotes: text("discharge_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicActiveIdx: index("idx_vt_hospitalizations_clinic_active").on(table.clinicId, table.admittedAt),
    animalIdx: index("idx_vt_hospitalizations_animal").on(table.animalId),
  }),
);
