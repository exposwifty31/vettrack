import * as React from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import {
  type StatusKind,
} from "@/lib/design-tokens";

// All *-bg/-fg/-border tokens are full color values (not bare HSL/RGB triplets).
const KIND: Record<
  StatusKind,
  { bg: string; fg: string; bd: string; dot: string }
> = {
  ok:          { bg: "var(--status-ok-bg)",       fg: "var(--status-ok-fg)",       bd: "var(--status-ok-border)",       dot: "hsl(var(--status-ok))" },
  issue:       { bg: "var(--status-issue-bg)",    fg: "var(--status-issue-fg)",    bd: "var(--status-issue-border)",    dot: "hsl(var(--status-issue))" },
  maintenance: { bg: "var(--status-maint-bg)",    fg: "var(--status-maint-fg)",    bd: "var(--status-maint-border)",    dot: "hsl(var(--status-maintenance))" },
  sterilized:  { bg: "var(--status-steril-bg)",   fg: "var(--status-steril-fg)",   bd: "var(--status-steril-border)",   dot: "hsl(var(--status-sterilized))" },
  info:        { bg: "var(--status-steril-bg)",   fg: "var(--status-steril-fg)",   bd: "var(--status-steril-border)",   dot: "var(--status-info)" },
  neutral:     { bg: "hsl(var(--muted))",         fg: "hsl(var(--muted-foreground))", bd: "rgb(var(--ivory-border))",   dot: "rgb(var(--ivory-text3))" },
  stale:       { bg: "var(--status-stale-bg)",    fg: "var(--status-stale-fg)",    bd: "var(--status-stale-border)",    dot: "var(--status-stale-fg)" },
  unknown:     { bg: "var(--status-unknown-bg)",  fg: "var(--status-unknown-fg)",  bd: "var(--status-unknown-border)",  dot: "var(--status-unknown-fg)" },
  in_use:      { bg: "var(--status-in-use-bg)",   fg: "var(--status-in-use-fg)",   bd: "var(--status-in-use-border)",   dot: "var(--status-in-use-fg)" },
  overdue:     { bg: "var(--status-overdue-bg)",  fg: "var(--status-overdue-fg)",  bd: "var(--status-overdue-border)",  dot: "var(--status-overdue-fg)" },
};

const STATUS_LABELS: Record<StatusKind, () => string> = {
  ok:          () => t.status.ok,
  issue:       () => t.status.issue,
  maintenance: () => t.status.maintenance,
  sterilized:  () => t.status.sterilized,
  info:    () => t.status.info,
  neutral: () => t.status.neutral,
  stale:   () => t.status.stale,
  unknown: () => t.status.unknown,
  in_use:  () => t.status.in_use,
  overdue: () => t.status.overdue,
};

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  kind: StatusKind;
  /** Override the label (rare). Falls back to STATUS_LABELS[kind](). */
  label?: string;
}

export function StatusBadge({
  kind,
  label,
  className,
  ...props
}: StatusBadgeProps) {
  const c = KIND[kind];
  const resolvedLabel = label ?? STATUS_LABELS[kind]();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-xs font-semibold",
        className,
      )}
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}
      {...props}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
        style={{ background: c.dot }}
      />
      {resolvedLabel}
    </span>
  );
}
