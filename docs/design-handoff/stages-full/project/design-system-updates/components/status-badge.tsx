import * as React from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import {
  type StatusKind,
} from "@/lib/design-tokens";

// Design System Alignment — §33-D3 (Phase 14) + §35-D3 (Phase 16) + Phase 21
// (review item 8, "Status Dots Everywhere" — dot spec only; this component
// already had a dot since Phase 14, review's spec is 8px/8px margin vs the
// 6px/6px shipped here, bumped to match).
// Phase 14: rounded-[4px] + 1px border + font-semibold, no explicit height
// (an admin-table-style bracketed chip) -> full pill, tint-only background,
// no border, font-medium, explicit h-7 (28px).
// Phase 16 revision: tint-only-with-no-border tested badly for clinical
// lighting (hospital fluorescents wash out a border-less 4-6% tint chip to
// near-invisible) — brought a border BACK, but a subtle one (~15% of the
// status hue, using the existing --status-*-border tokens verbatim — no
// new colors), and bumped weight to font-semibold. Still a pill, still
// h-7, still no full admin-bracket box — the correction is "subtle border,
// not zero," not a reversal of the pill/height/dot direction.

// --status-{ok,issue,maintenance,sterilized} and --muted/--muted-foreground are
// bare HSL triplets, --ivory-* are bare RGB triplets — they are only valid CSS
// colors wrapped in hsl()/rgb(). The *-bg/-fg/-border and --status-info vars are
// full color values and must NOT be wrapped.
const KIND: Record<
  StatusKind,
  { bg: string; fg: string; bd: string; dot: string }
> = {
  ok:          { bg: "var(--status-ok-bg)",      fg: "var(--status-ok-fg)",      bd: "var(--status-ok-border)",      dot: "hsl(var(--status-ok))" },
  issue:       { bg: "var(--status-issue-bg)",   fg: "var(--status-issue-fg)",   bd: "var(--status-issue-border)",   dot: "hsl(var(--status-issue))" },
  maintenance: { bg: "var(--status-maint-bg)",   fg: "var(--status-maint-fg)",   bd: "var(--status-maint-border)",   dot: "hsl(var(--status-maintenance))" },
  sterilized:  { bg: "var(--status-steril-bg)",  fg: "var(--status-steril-fg)",  bd: "var(--status-steril-border)",  dot: "hsl(var(--status-sterilized))" },
  info:        { bg: "var(--status-steril-bg)",  fg: "var(--status-steril-fg)",  bd: "var(--status-steril-border)",  dot: "var(--status-info)" },
  neutral:     { bg: "hsl(var(--muted))",        fg: "hsl(var(--muted-foreground))", bd: "rgb(var(--ivory-border))", dot: "rgb(var(--ivory-text3))" },
  stale:       { bg: "var(--status-stale-bg)",   fg: "var(--status-stale-fg)",   bd: "var(--status-stale-border)",   dot: "var(--status-stale-fg)" },
  unknown:     { bg: "var(--status-unknown-bg)",  fg: "var(--status-unknown-fg)",  bd: "var(--status-unknown-border)",  dot: "var(--status-unknown-fg)" },
};

// Repository reality override: uses t.status.* accessor pattern
// (the app uses a typed t singleton from @/lib/i18n, not a useTranslation hook).
const STATUS_LABELS: Record<StatusKind, () => string> = {
  ok:          () => t.status.ok,
  issue:       () => t.status.issue,
  maintenance: () => t.status.maintenance,
  sterilized:  () => t.status.sterilized,
  info:        () => (t.status as Record<string, string>)["info"] ?? "Info",
  neutral:     () => (t.status as Record<string, string>)["neutral"] ?? "Unknown",
  stale:       () => (t.status as Record<string, string>)["stale"] ?? "Stale",
  unknown:     () => (t.status as Record<string, string>)["unknown"] ?? "Unknown",
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
        "inline-flex items-center gap-2 rounded-full px-2.5 h-7 text-xs font-semibold",
        className,
      )}
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}
      {...props}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full flex-shrink-0"
        style={{ background: c.dot }}
      />
      {resolvedLabel}
    </span>
  );
}
