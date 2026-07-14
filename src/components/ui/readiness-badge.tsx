import * as React from "react";
import { CheckCircle2, AlertTriangle, OctagonX, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusKind } from "@/lib/design-tokens";
import {
  getReadinessTier,
  type ReadinessTier,
} from "@/lib/equipment-readiness-tier";
import type { EquipmentStatus } from "@/types/equipment";

/**
 * Readiness tier → StatusBadge kind (T-23d · R-EQ-F2). Reuses the existing
 * ok/maintenance/issue pill tokens (already audited for AA text contrast)
 * instead of minting new colors. Exported so tests can assert against the
 * exact tokens this component paints — see tests/readiness-badge.test.tsx.
 */
export const READINESS_TIER_TO_STATUS_KIND: Record<ReadinessTier, StatusKind> = {
  ready: "ok",
  caution: "maintenance",
  not_ready: "issue",
};

// Distinct outer SHAPE (circle / triangle / octagon) with a distinct inner
// GLYPH mark per tier — status must never be conveyed by color alone (a11y).
const READINESS_GLYPH: Record<ReadinessTier, React.ComponentType<LucideProps>> = {
  ready: CheckCircle2,
  caution: AlertTriangle,
  not_ready: OctagonX,
};

// Same --status-*-fg var StatusBadge resolves for the paired kind (see
// status-badge.tsx:16-23) — the glyph is painted in this color so it clears
// the same audited contrast ratio as the rendered text.
const READINESS_GLYPH_COLOR: Record<ReadinessTier, string> = {
  ready: "var(--status-ok-fg)",
  caution: "var(--status-maint-fg)",
  not_ready: "var(--status-issue-fg)",
};

export interface ReadinessBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  status: EquipmentStatus;
}

export function ReadinessBadge({
  status,
  className,
  ...props
}: ReadinessBadgeProps) {
  const tier = getReadinessTier(status);
  const kind = READINESS_TIER_TO_STATUS_KIND[tier];
  const Glyph = READINESS_GLYPH[tier];

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    >
      <Glyph
        aria-hidden="true"
        data-readiness-tier={tier}
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: READINESS_GLYPH_COLOR[tier] }}
      />
      <StatusBadge kind={kind} />
    </span>
  );
}
