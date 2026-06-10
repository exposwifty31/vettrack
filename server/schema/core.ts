import { sql } from "drizzle-orm";
import { text, timestamp, varchar, jsonb, index } from "drizzle-orm/pg-core";
import { vtTable } from "./helpers.js";

export const clinics = vtTable("vt_clinics", {
  id: text("id").primaryKey(),
  /** IANA timezone for clinic-local day boundaries (tasks, scheduling). */
  timezone: text("timezone").notNull().default("Asia/Jerusalem"),
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
}, (t) => ({
  clinicIdx: index("idx_vt_users_clinic").on(t.clinicId),
  clinicRoleIdx: index("idx_vt_users_clinic_role").on(t.clinicId, t.role),
  clinicStatusIdx: index("idx_vt_users_clinic_status").on(t.clinicId, t.status),
}));
