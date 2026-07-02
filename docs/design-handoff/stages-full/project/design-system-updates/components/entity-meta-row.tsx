// Lands at: src/components/ui/entity-meta-row.tsx
// Design System Alignment — Phase 21 (review item 3, "Top Metadata Rows").
// Real gap: equipment-detail.tsx's <h1> (equipmentDisplayName) renders with
// no breadcrumb-style context above it — confirmed by reading the page
// directly (line ~987). Deliberately generic + presentational (explicit
// string segments, not coupled to the Equipment type) so it composes
// anywhere an entity needs a "Location · Type · Asset #" style line, not
// just equipment detail. Wired into equipment-detail.tsx via apply.sh using
// equipment.location / equipment.model / equipment.serialNumber — all three
// confirmed real, already-used optional fields (equipment-list.tsx's search
// predicate reads eq.location / eq.model / eq.serialNumber verbatim).
import * as React from "react";
import { cn } from "@/lib/utils";

export interface EntityMetaRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Joined with " · "; falsy segments are dropped so missing fields don't
   * leave a dangling separator. */
  segments: Array<string | null | undefined>;
  /** Render the hairline divider below the row. Default true, per the
   * review's own mock (a divider between the meta row and the title/status
   * block that follows). */
  divider?: boolean;
}

export function EntityMetaRow({
  segments,
  divider = true,
  className,
  ...props
}: EntityMetaRowProps) {
  const parts = segments.filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {parts.join(" · ")}
      </p>
      {divider ? <div className="border-b border-border" /> : null}
    </div>
  );
}
