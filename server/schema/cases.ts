import { text, timestamp, varchar, index } from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";
import { clinics } from "./core.js";

/**
 * VetTrack 2.0 — Case Spine (task 0.2 spike).
 *
 * A first-class OPERATIONAL case object that physical×clinical events
 * (custody scans, dispenses, Code Blue sessions, tasks, damage reports)
 * attach to via a nullable `case_id`. Deliberately minimal: this table holds
 * NO PHI — the clinical source of truth stays in the external PMS. VetTrack
 * is the operational source of truth only, so the only PMS join key kept here
 * is an opaque `patient_external_id` (nullable — a case may exist before it is
 * linked to a PMS patient).
 *
 * Every column and query is `clinic_id`-scoped (repo-wide multi-tenancy rule).
 */
export const cases = vtTable(
  "vt_cases",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "restrict" }),
    /** Opaque PMS patient join key. Nullable — the PMS patient may be absent. */
    patientExternalId: text("patient_external_id"),
    /** Operational lifecycle only (never clinical state): open | closed. */
    status: varchar("status", { length: 20 }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clinicStatusIdx: index("idx_vt_cases_clinic_status").on(table.clinicId, table.status),
    clinicPatientIdx: index("idx_vt_cases_clinic_patient").on(table.clinicId, table.patientExternalId),
  }),
);

export type CaseRow = typeof cases.$inferSelect;
export type NewCaseRow = typeof cases.$inferInsert;
