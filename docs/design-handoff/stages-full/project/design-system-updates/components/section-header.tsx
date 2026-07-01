// Lands at: src/components/ui/section-header.tsx
// Design System Alignment — Phase 21 (review item 1, "Section Headers").
// Real gap: grepped equipment-list/rooms-list/inventory-page/admin/alerts/
// appointments — each hand-rolls its own title row (a bare <h1>/<h2>, no
// shared title+meta+subtitle+divider primitive). Sizes reconciled onto the
// REAL shipped scale (Phase 14's tailwind.config.ts fontSize extension):
// title uses text-lg (now 20px/700 via font-bold — matches the review's
// "20px/700" exactly), meta uses text-xs (now 13px, font-num — matches the
// review's "13px/font-num" exactly), subtitle uses text-sm (15px vs the
// review's 14px — 1px off the literal ask, kept on-scale rather than
// introducing an off-scale one-off per the "reconcile" instruction).
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Short right-aligned meta, e.g. "124 active". Rendered in font-num. */
  meta?: string;
  subtitle?: string;
  /** Optional trailing action (button/link) rendered next to meta. */
  action?: React.ReactNode;
  /** Render the hairline divider below the header. Default true. */
  divider?: boolean;
}

export function SectionHeader({
  title,
  meta,
  subtitle,
  action,
  divider = true,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)} {...props}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
        <div className="flex items-center gap-2 shrink-0">
          {meta ? (
            <span className="font-num text-xs font-semibold text-muted-foreground">{meta}</span>
          ) : null}
          {action}
        </div>
      </div>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      {divider ? <div className="mt-3 border-b border-border" /> : null}
    </div>
  );
}
