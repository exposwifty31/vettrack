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
