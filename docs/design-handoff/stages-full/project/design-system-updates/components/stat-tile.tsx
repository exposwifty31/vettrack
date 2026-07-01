// Lands at: src/components/ui/stat-tile.tsx
// §20-D5 (Phase 1) + Phase 21 (review item 5, "Upgrade Stat Cards").
// Restructured to lead with icon+label (was value-first, trend-top-right),
// added min-h-[120px]. Sizes reconciled onto the REAL shipped scale
// (Phase 14): label -> text-xs (13px, was text-sm/15px) at font-semibold —
// matches the review's "13px/600" exactly. Value -> text-3xl (35px, an
// EXISTING token Phase 14 left untouched — closer to the review's "34px"
// than text-2xl's 32px) at font-bold tracking-tight (~-0.025em vs the
// review's -0.03em — on-scale, not re-derived to the exact decimal).
// trend/trendTone keep their original prop names: this component was never
// adopted at a real call site yet (management-dashboard.tsx etc. still
// hand-roll their own stat markup — confirmed Phase 18/§37-D1), so
// reshaping its layout breaks nothing real. `trend` now reads naturally as
// a full sentence ("+12.4% this month"), not just a bare delta — no type
// change needed, it was always a plain string.
import * as React from "react";
import { cn } from "@/lib/utils";

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  value: React.ReactNode;
  label: string;
  /** Full sentence, e.g. "+12.4% this month". Omit if not applicable. */
  trend?: string;
  trendTone?: "ok" | "issue" | "neutral";
}

const TREND_CLASS: Record<NonNullable<StatTileProps["trendTone"]>, string> = {
  ok: "text-[var(--status-ok-fg)]",
  issue: "text-[var(--status-issue-fg)]",
  neutral: "text-muted-foreground",
};

export function StatTile({
  icon,
  value,
  label,
  trend,
  trendTone = "neutral",
  className,
  ...props
}: StatTileProps) {
  return (
    <div
      className={cn(
        "flex min-h-[120px] flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-card",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span> : null}
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="font-num mt-2 text-3xl font-bold leading-none tracking-tight text-foreground">
        {value}
      </p>
      {trend ? (
        <p className={cn("font-num mt-2 text-xs font-medium", TREND_CLASS[trendTone])}>
          {trend}
        </p>
      ) : null}
    </div>
  );
}
