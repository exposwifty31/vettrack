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
  /**
   * Self-requested role captured at sign-up (Clerk `unsafeMetadata.requestedRole`).
   * ADVISORY / STAGING ONLY — distinct from the authoritative `role`. It never
   * auto-becomes `role`; an admin reads it as a hint and grants the real role
   * through the existing role-change mechanism. Like `secondaryRole`, it is
   * never propagated to clinical authority (`resolveAuthority`).
   */
  requestedRole: varchar("requested_role", { length: 20 }),
  /**
   * Doctor/license number captured at sign-up when the self-requested role is
   * `vet` (Clerk `unsafeMetadata.vetLicenseNumber`). Verification artifact only:
   * the admin reviews it before approving the vet grant (see `resolveApprovalRole`).
   * Not authoritative on its own; presence is required to auto-apply `vet` on approval.
   */
  vetLicenseNumber: varchar("vet_license_number", { length: 40 }),
  allowedOperationalRoles: jsonb("allowed_operational_roles").notNull().default(sql`'[]'::jsonb`),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  preferredLocale: varchar("preferred_locale", { length: 10 }).notNull().default("he"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
}, (t) => ({
  clinicIdx: index("idx_vt_users_clinic").on(t.clinicId),
  clinicRoleIdx: index("idx_vt_users_clinic_role").on(t.clinicId, t.role),
  clinicStatusIdx: index("idx_vt_users_clinic_status").on(t.clinicId, t.status),
}));

/**
 * Sign in with Apple refresh tokens, kept so the app can call Apple's
 * `/auth/revoke` endpoint when a user deletes their account (App Store
 * Guideline 5.1.1(v)). The token is stored AES-256-GCM encrypted via
 * `config-crypto` (the `enc:v1:` envelope) — never in plaintext.
 *
 * One row per user. The FK cascades on user hard-delete so the token is
 * removed automatically; the account-deletion flow revokes the token at
 * Apple BEFORE the row is gone.
 */
export const appleOauthTokens = vtTable("vt_apple_oauth_tokens", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  /** AES-256-GCM encrypted Apple refresh token (`enc:v1:` envelope). */
  refreshToken: text("refresh_token").notNull(),
  /** Apple `sub` (stable user identifier) from the id_token, for diagnostics. */
  appleSub: text("apple_sub"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  clinicIdx: index("idx_vt_apple_oauth_tokens_clinic").on(t.clinicId),
}));
