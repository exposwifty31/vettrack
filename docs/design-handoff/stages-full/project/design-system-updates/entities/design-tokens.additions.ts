/**
 * Design System Alignment — §20-D1/D2/D5 (Phase 1)
 * APPEND these exports into the existing src/core/entities/design-tokens.ts —
 * do NOT create a parallel file. Keeps the file's own "single source of truth"
 * promise for status-like vocabularies intact.
 */

// --- Roles (Stage 8 Admin, used anywhere a person's role renders a badge) ---

export type RoleKind =
  | "admin"
  | "vet"
  | "senior_technician"
  | "lead_technician"
  | "vet_tech"
  | "technician"
  | "student";

/**
 * Roles are not a StatusKind, but every role badge reuses the StatusKind
 * palette rather than inventing new colors (§20-D5) — RoleBadge is a thin
 * wrapper around StatusBadge. Verified against the REAL, already-shipped
 * `t.roles` dictionary (locales/en.json ~line 3785) — it already has every
 * one of these seven keys; no i18n additions needed for roles at all (§27-D1).
 */
export function roleToStatusKind(role: RoleKind): StatusKind {
  const map: Record<RoleKind, StatusKind> = {
    admin: "info",
    vet: "sterilized",
    senior_technician: "ok",
    lead_technician: "ok",
    vet_tech: "neutral",
    technician: "neutral",
    student: "neutral",
  };
  return map[role] ?? "neutral";
}

export const ROLE_LABEL_KEY: Record<RoleKind, string> = {
  admin: "roles.admin",
  vet: "roles.vet",
  senior_technician: "roles.senior_technician",
  lead_technician: "roles.lead_technician",
  vet_tech: "roles.vet_tech",
  technician: "roles.technician",
  student: "roles.student",
};

// --- Location-confidence (Stage 6 Equipment Detail — companion to
//     DeployabilityBadge/EquipmentTruthCard, NOT a replacement; §20-D2) ---

export type ConfidenceKind = "high" | "medium" | "low" | "unknown";

export function confidenceToStatusKind(c: ConfidenceKind): StatusKind {
  const map: Record<ConfidenceKind, StatusKind> = {
    high: "ok",
    medium: "sterilized",
    low: "stale",
    unknown: "unknown",
  };
  return map[c] ?? "unknown";
}

/**
 * §27-D2 — deliberately NOT `confidence.*`: the real dictionary already has
 * an unrelated `confidence: { low, medium, high }` (no "unknown") in at least
 * two other namespaces (locales/en.json ~527, ~2360) for a different existing
 * feature. Reusing that key path risks colliding with or overloading a label
 * that means something else in context. `locationConfidence.*` is net-new,
 * unambiguous, and still needs its own "unknown" entry either way.
 */
export const CONFIDENCE_LABEL_KEY: Record<ConfidenceKind, string> = {
  high: "locationConfidence.high",
  medium: "locationConfidence.medium",
  low: "locationConfidence.low",
  unknown: "locationConfidence.unknown",
};

// --- Podium rank (Stage 7 Shift Leaderboard — genuinely new; §20-D5) ---

export type PodiumRank = 1 | 2 | 3;

export const PODIUM_RANK_VAR: Record<PodiumRank, string> = {
  1: "rgb(var(--podium-gold))",
  2: "rgb(var(--podium-silver))",
  3: "rgb(var(--podium-bronze))",
};

// --- Inventory stock taxonomy (Stage 5 Inventory — kept separate from
//     equipment StatusKind; different domain, §20-D1) ---

export type StockKind = "ok" | "low" | "out" | "expiring";

export function stockToStatusKind(s: StockKind): StatusKind {
  const map: Record<StockKind, StatusKind> = {
    ok: "ok",
    low: "stale",
    out: "issue",
    expiring: "stale",
  };
  return map[s] ?? "neutral";
}
