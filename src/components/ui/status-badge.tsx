import * as React from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import {
  type StatusKind,
} from "@/lib/design-tokens";

// --status-{ok,issue,maintenance,sterilized} and --muted/--muted-foreground are
// bare HSL triplets, --ivory-* are bare RGB triplets — they are only valid CSS
// colors wrapped in hsl()/rgb(). The *-bg/-fg/-border and --status-info vars are
// full color values and must NOT be wrapped.
const KIND: Record<
  StatusKind,
  { bg: string; fg: string; bd: string; dot: string }
> = {
  ok:          { bg: "var(--status-ok-bg)",     fg: "var(--status-ok-fg)",     bd: "var(--status-ok-border)",     dot: "hsl(var(--status-ok))" },
  issue:       { bg: "var(--status-issue-bg)",  fg: "var(--status-issue-fg)",  bd: "var(--status-issue-border)",  dot: "hsl(var(--status-issue))" },
  maintenance: { bg: "var(--status-maint-bg)",  fg: "var(--status-maint-fg)",  bd: "var(--status-maint-border)",  dot: "hsl(var(--status-maintenance))" },
  sterilized:  { bg: "var(--status-steril-bg)", fg: "var(--status-steril-fg)", bd: "var(--status-steril-border)", dot: "hsl(var(--status-sterilized))" },
  stale:       { bg: "var(--status-stale-bg)",  fg: "var(--status-stale-fg)",  bd: "var(--status-stale-border)",  dot: "hsl(var(--status-stale))" },
  unknown:     { bg: "var(--status-unknown-bg)",fg: "var(--status-unknown-fg)",bd: "var(--status-unknown-border)",dot: "hsl(var(--status-unknown))" },
  info:        { bg: "var(--status-steril-bg)", fg: "var(--status-steril-fg)", bd: "var(--status-steril-border)", dot: "var(--status-info)" },
  neutral:     { bg: "hsl(var(--muted))",       fg: "hsl(var(--muted-foreground))", bd: "rgb(var(--ivory-border))", dot: "rgb(var(--ivory-text3))" },
};

// Repository reality override: uses t.status.* accessor pattern
// (the app uses a typed t singleton from @/lib/i18n, not a useTranslation hook).
const STATUS_LABELS: Record<StatusKind, () => string> = {
  ok:          () => t.status.ok,
  issue:       () => t.status.issue,
  maintenance: () => t.status.maintenance,
  sterilized:  () => t.status.sterilized,
  stale:       () => (t.status as Record<string, string>)["stale"] ?? "Stale",
  unknown:     () => (t.status as Record<string, string>)["unknown"] ?? "Unknown",
  info:        () => (t.status as Record<string, string>)["info"] ?? "Info",
  neutral:     () => (t.status as Record<string, string>)["neutral"] ?? "Unknown",
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
