// Lands at: src/components/ui/equipment-timeline.tsx
// Design System Alignment — Phase 21 (review item 15, "Clinical Timeline
// Component"). Real gap: EquipmentDetailActivityTab.tsx (equipment history)
// renders a flat stack of individually-carded rows, no dot/line timeline —
// even though Stage 6's own mockup ("ACCOUNTABILITY TIMELINE") already
// established exactly this visual (dot + connecting line) for the same
// content. Formalized here as a real, reusable primitive and wired into
// EquipmentDetailActivityTab (see apply.sh — full-file replacement, same
// reasoning as StatusBadge/Card in Phases 14/15: too many distinct spots
// for a safe sed).
import * as React from "react";
import { cn } from "@/lib/utils";

export function Timeline({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col", className)} {...props} />;
}

export interface TimelineRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Filled, larger dot = most recent / current state. Default false. */
  current?: boolean;
  tone?: "ok" | "issue" | "maintenance" | "neutral";
  /** Suppresses the connecting line below (last row in the list). */
  isLast?: boolean;
}

const DOT_TONE: Record<NonNullable<TimelineRowProps["tone"]>, string> = {
  ok: "var(--status-ok-fg)",
  issue: "var(--status-issue-fg)",
  maintenance: "var(--status-maint-fg)",
  neutral: "hsl(var(--muted-foreground))",
};

export function TimelineRow({
  current = false,
  tone = "neutral",
  isLast = false,
  className,
  children,
  ...props
}: TimelineRowProps) {
  const color = DOT_TONE[tone];
  return (
    <div className={cn("flex gap-3", className)} {...props}>
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: 18 }}>
        <span
          className="mt-1.5 flex-shrink-0 rounded-full"
          style={{
            width: current ? 10 : 8,
            height: current ? 10 : 8,
            background: current ? color : "transparent",
            border: `2px solid ${color}`,
          }}
          aria-hidden="true"
        />
        {!isLast ? <span className="mt-1 w-px flex-1 bg-border" style={{ minHeight: 24 }} /> : null}
      </div>
      <div className={cn("min-w-0 flex-1", !isLast && "pb-4")}>{children}</div>
    </div>
  );
}
