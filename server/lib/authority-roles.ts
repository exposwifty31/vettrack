/**
 * Phase 2A: Pure legacy-role classifiers.
 *
 * All functions are pure (no DB access, no side effects, no throws).
 * They are additive scaffolding only — not wired into any middleware or route
 * gate in Phase 2A. Phase 2B will introduce enforcement helpers that consume
 * these classifiers.
 *
 * Inputs are raw legacy DB role strings. Outputs are Phase 2A types.
 *
 * Alias rules applied to clinical/shift mapping:
 *   lead_technician → senior_technician
 *   vet_tech        → technician
 *
 * Student & admin rules:
 *   - "student" never appears in ActiveShiftRole / EffectiveClinicalRole.
 *   - "admin" carries no clinical role; it is a system-level identity.
 */

import type {
  ActiveShiftRole,
  ClinicalRole,
  SystemRole,
} from "../../shared/authority.js";

const CLINICAL_ROLE_SET = new Set<ClinicalRole>([
  "vet",
  "senior_technician",
  "technician",
  "student",
]);

const ACTIVE_SHIFT_ROLE_SET = new Set<ActiveShiftRole>([
  "vet",
  "senior_technician",
  "technician",
]);

// Single alias map shared by both classifiers. Typed as ActiveShiftRole because
// every alias target is a shift-assignable role (ActiveShiftRole ⊆ ClinicalRole),
// so it satisfies both mapLegacyRoleToClinicalRole and normalizeShiftRoleToClinical.
const LEGACY_ROLE_ALIASES: Readonly<Record<string, ActiveShiftRole>> = {
  lead_technician: "senior_technician",
  vet_tech: "technician",
};

/**
 * Maps a raw legacy role string to its SystemRole.
 * "admin" (case-insensitive, whitespace-trimmed) → "Admin"; everything else → "User".
 * Always returns a SystemRole — never null.
 */
export function mapLegacyRoleToSystemRole(raw: string): SystemRole {
  return raw.trim().toLowerCase() === "admin" ? "Admin" : "User";
}

/**
 * Maps a raw legacy role string to its ClinicalRole.
 *   "admin"            → null   (system identity, no clinical role)
 *   "vet"              → "vet"
 *   "senior_technician"→ "senior_technician"
 *   "lead_technician"  → "senior_technician"   (legacy alias)
 *   "technician"       → "technician"
 *   "vet_tech"         → "technician"          (legacy alias)
 *   "student"          → "student"
 *   unknown            → null
 */
export function mapLegacyRoleToClinicalRole(raw: string): ClinicalRole | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "admin") return null;
  if (CLINICAL_ROLE_SET.has(normalized as ClinicalRole)) {
    return normalized as ClinicalRole;
  }
  return LEGACY_ROLE_ALIASES[normalized] ?? null;
}

/**
 * Normalizes a raw shift-role string to an ActiveShiftRole.
 * Never returns "student" (students are never elevated to shift authority).
 * Never returns "admin" (admin carries no clinical shift role).
 *
 *   "vet"              → "vet"
 *   "senior_technician"→ "senior_technician"
 *   "lead_technician"  → "senior_technician"   (legacy alias)
 *   "technician"       → "technician"
 *   "vet_tech"         → "technician"          (legacy alias)
 *   "student"          → null
 *   "admin"            → null
 *   null               → null
 *   unknown            → null
 */
export function normalizeShiftRoleToClinical(
  shiftRole: string | null,
): ActiveShiftRole | null {
  if (shiftRole === null) return null;
  const normalized = shiftRole.trim().toLowerCase();
  if (ACTIVE_SHIFT_ROLE_SET.has(normalized as ActiveShiftRole)) {
    return normalized as ActiveShiftRole;
  }
  return LEGACY_ROLE_ALIASES[normalized] ?? null;
}
