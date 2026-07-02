/** Typed design-system helpers — mirrors CSS vars in src/index.css */

export type BadgeSemanticVariant = "ok" | "issue" | "maintenance" | "sterilized" | "secondary";

export function statusToBadgeVariant(status: string): BadgeSemanticVariant {
  const map: Record<string, BadgeSemanticVariant> = {
    ok: "ok",
    issue: "issue",
    maintenance: "maintenance",
    sterilized: "sterilized",
  };
  return map[status] ?? "secondary";
}

/** Equipment list triage tier (Pro pass ordering). */
export type EquipmentTriageTier = "attention" | "in_use" | "operational";

export function equipmentTriageTier(eq: {
  status: string;
  checkedOutById?: string | null;
}): EquipmentTriageTier {
  if (eq.checkedOutById) return "in_use";
  if (
    eq.status === "issue" ||
    eq.status === "maintenance" ||
    eq.status === "critical" ||
    eq.status === "needs_attention"
  ) {
    return "attention";
  }
  return "operational";
}

export const TRIAGE_ORDER: Record<EquipmentTriageTier, number> = {
  attention: 0,
  in_use: 1,
  operational: 2,
};

export const MOTION = {
  instant: "var(--motion-instant)",
  quick: "var(--motion-quick)",
  enter: "var(--motion-enter)",
  celebrate: "var(--motion-celebrate)",
  pill: "var(--motion-pill)",
  easeEnter: "var(--ease-enter)",
  easeReward: "var(--ease-reward)",
} as const;

// --- Unified status vocabulary (single source of truth) ---

export type StatusKind =
  | "ok"
  | "issue"
  | "maintenance"
  | "sterilized"
  | "stale"
  | "unknown"
  | "info"
  | "neutral";

// Fold every legacy status string into one StatusKind. Unmapped → "neutral".
const KNOWN_STATUS_KINDS = new Set<string>(["ok", "issue", "maintenance", "sterilized", "stale", "unknown", "info"]);

export function normalizeStatus(s: string): StatusKind {
  if (s === "critical" || s === "needs_attention") return "issue";
  if (s === "due" || s === "sterilization_due") return "maintenance";
  return KNOWN_STATUS_KINDS.has(s) ? (s as StatusKind) : "neutral";
}

// i18n key for each kind's label (resolved by the component, never inlined).
export const STATUS_LABEL_KEY: Record<StatusKind, string> = {
  ok: "status.ok",
  issue: "status.issue",
  maintenance: "status.maintenance",
  sterilized: "status.sterilized",
  stale: "status.stale",
  unknown: "status.unknown",
  info: "status.info",
  neutral: "status.neutral",
};
