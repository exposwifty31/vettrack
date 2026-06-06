import * as React from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import {
  type StatusKind,
} from "@/lib/design-tokens";

const KIND: Record<
  StatusKind,
  { bg: string; fg: string; bd: string; dot: string }
> = {
  ok:          { bg: "var(--status-ok-bg)",     fg: "var(--status-ok-fg)",     bd: "var(--status-ok-border)",     dot: "var(--status-ok)" },
  issue:       { bg: "var(--status-issue-bg)",  fg: "var(--status-issue-fg)",  bd: "var(--status-issue-border)",  dot: "var(--status-issue)" },
  maintenance: { bg: "var(--status-maint-bg)",  fg: "var(--status-maint-fg)",  bd: "var(--status-maint-border)",  dot: "var(--status-maintenance)" },
  sterilized:  { bg: "var(--status-steril-bg)", fg: "var(--status-steril-fg)", bd: "var(--status-steril-border)", dot: "var(--status-sterilized)" },
  info:        { bg: "var(--status-steril-bg)", fg: "var(--status-steril-fg)", bd: "var(--status-steril-border)", dot: "var(--status-info)" },
  neutral:     { bg: "var(--muted)",            fg: "var(--muted-foreground)", bd: "var(--ivory-border)",         dot: "var(--ivory-text-3)" },
};

// Repository reality override: uses t.status.* accessor pattern
// (the app uses a typed t singleton from @/lib/i18n, not a useTranslation hook).
// ivory-text-3 is referenced via CSS var because --ivory-text-3 is defined as RGB
// channels; use the Tailwind utility class instead for the neutral dot.
const STATUS_LABELS: Record<StatusKind, () => string> = {
  ok:          () => t.status.ok,
  issue:       () => t.status.issue,
  maintenance: () => t.status.maintenance,
  sterilized:  () => t.status.sterilized,
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
