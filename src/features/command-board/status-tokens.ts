// Status colour tokens + label helper for the Equipment Command Center board.
// Verbatim move from src/pages/display.tsx (Phase 4 C1); only the shared-type
// import depth changed (../../ → ../../../, no @/shared alias exists).
import { t } from "@/lib/i18n";
import type { EquipmentReadinessStatus } from "../../../shared/equipment-board";

// STATUS_COLOR is currently unreferenced (kept verbatim, not exported, to keep
// the extraction a clean move — flag for a later knip sweep, not this commit).
const STATUS_COLOR: Record<EquipmentReadinessStatus, string> = {
  ready:    "text-[hsl(var(--status-ok))]",
  in_use:   "text-[hsl(var(--status-sterilized))]",
  blocked:  "text-[hsl(var(--status-issue))]",
  stale:    "text-[hsl(var(--status-maintenance))]",
  overdue:  "text-[hsl(var(--status-maintenance))]",
  unknown:  "text-ivory-text3",
};

export const STATUS_BG: Record<EquipmentReadinessStatus, string> = {
  ready:   "bg-[var(--status-ok-bg)]   border-[var(--status-ok-border)]   text-[var(--status-ok-fg)]",
  in_use:  "bg-[var(--status-steril-bg)] border-[var(--status-steril-border)] text-[var(--status-steril-fg)]",
  blocked: "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)] text-[var(--status-issue-fg)]",
  stale:   "bg-[var(--status-maint-bg)] border-[var(--status-maint-border)] text-[var(--status-maint-fg)]",
  overdue: "bg-[var(--status-maint-bg)] border-[var(--status-maint-border)] text-[var(--status-maint-fg)]",
  unknown: "bg-muted border-ivory-border text-ivory-text3",
};

export const STATUS_BAR_COLOR: Record<EquipmentReadinessStatus, string> = {
  ready:   "bg-[hsl(var(--status-ok))]",
  in_use:  "bg-[hsl(var(--status-sterilized))]",
  blocked: "bg-[hsl(var(--status-issue))]",
  stale:   "bg-[hsl(var(--status-maintenance))]",
  overdue: "bg-[hsl(var(--status-maintenance))]",
  unknown: "bg-ivory-text3",
};

export function statusLabel(s: EquipmentReadinessStatus): string {
  const map: Record<EquipmentReadinessStatus, string> = {
    ready:   t.board.available,
    in_use:  t.board.deployed,
    blocked: t.board.down,
    stale:   t.board.stale,
    overdue: t.board.overdue,
    unknown: t.board.unconfirmed,
  };
  return map[s];
}
