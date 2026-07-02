// Lands at: src/components/ui/context-chip.tsx
// Design System Alignment — Phase 21 (review item 11, "Clinical Context
// Chips" — small metadata pills like ICU / VENTILATOR / CRITICAL CARE).
//
// Standalone component, deliberately NOT a Badge variant. Badge's cva base
// (src/components/ui/badge.tsx) already owns text-xs/px-2.5/py-0.5 for
// EVERY existing variant — none of ok/issue/maintenance/sterilized/etc.
// override size, only color. This chip's spec (h-5/11px/uppercase) genuinely
// conflicts with that shared sizing. cva's `variants` classes are appended
// to `base` via plain clsx, with NO tailwind-merge pass between them — so a
// variant that redeclares px-2.5-vs-px-2 or text-xs-vs-text-[11px] leaves
// two same-specificity utility classes in one string with an unpredictable
// winner. Rather than risk that footgun, this ships as its own tiny
// component with one, fully-owned className string.
import * as React from "react";
import { cn } from "@/lib/utils";

export function ContextChip({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
