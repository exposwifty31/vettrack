// Lands at: src/components/ui/audit-log-row.tsx
// §21-D1 (Phase 2) + Phase 21 (review item 7, "Upgrade Tables" — hover/
// selected states + header treatment). Row shape/height is UNCHANGED (still
// pixel-matches AuditRowSkeleton, still minHeight:60 — do not change this
// structure without updating AuditRowSkeleton to match, its own comment
// says the same in reverse). This phase only adds interaction states using
// the real Phase 11 ivory-hover/ivory-active tokens (shipped, mostly
// unadopted at real call sites per README §30 — one of the "Good Phase 12
// candidate" spots finally landing) and a header-row companion.
//
// NOTE: the real audit-log.tsx PAGE does not actually import this shared
// component — it has its own local, hand-rolled `AuditLogRow` function
// (same name, different file, confirmed by reading the page directly).
// This component pixel-matches the loading skeleton and was clearly built
// to be used there; it never got swapped in. Not unified this phase (a
// bigger, riskier refactor than a hover-state tweak) — flagged in README
// §40 as a good Phase 22 candidate. The real page's OWN row gets the same
// ivory-hover treatment directly (apply.sh sed) so the visual fix lands
// either way.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface AuditLogRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Already locale-formatted by the caller, e.g. "Today · 09:14". */
  timestamp: string;
  /** Category tag, e.g. "Equipment" / "Users" / "Settings". */
  category: string;
  categoryTone?: React.ComponentProps<typeof Badge>["variant"];
  /** Actor + verb + target as one sentence. Plain string (not a node) so it
   * can carry a real `title` for the friction-audit's truncated-text fix
   * (findings #8) even though the row itself must stay single-line to match
   * AuditRowSkeleton's fixed height. */
  summary: string;
  /** Short target reference shown at the row's end, hidden below sm. */
  targetRef?: string;
  /** Row is part of a selectable list. Default false. */
  selected?: boolean;
  /** Row responds to hover — set when the row is actually clickable. Default false. */
  hoverable?: boolean;
}

export function AuditLogRow({
  timestamp,
  category,
  categoryTone = "secondary",
  summary,
  targetRef,
  selected = false,
  hoverable = false,
  className,
  ...props
}: AuditLogRowProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b px-4 py-3 last:border-b-0 transition-colors",
        selected
          ? "bg-[rgb(var(--ivory-active))]"
          : hoverable
            ? "hover:bg-[rgb(var(--ivory-hover))]"
            : "",
        className,
      )}
      style={{ minHeight: 60 }}
      {...props}
    >
      <span
        className="font-num mt-0.5 flex-shrink-0 text-xs text-muted-foreground"
        style={{ width: 130 }}
      >
        {timestamp}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={categoryTone} className="flex-shrink-0">
            {category}
          </Badge>
        </div>
        <p className="truncate text-sm text-foreground" title={summary}>
          {summary}
        </p>
      </div>
      {targetRef ? (
        <span
          className="font-num hidden flex-shrink-0 text-xs text-muted-foreground sm:block"
          title={targetRef}
        >
          {targetRef}
        </span>
      ) : null}
    </div>
  );
}

/** Column-header companion — 13px/semibold/uppercase/tracked, per review item 7. */
export function AuditLogHeaderRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
