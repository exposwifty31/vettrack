// Lands at: src/components/ui/badge.tsx
// Design System Alignment — §33-D3 (Phase 14, status variants drop their
// border) + Phase 21 (review item 8, "Status Dots Everywhere" — adds an
// opt-in `dot` prop). Full-file replacement, not a sed diff: a new prop +
// conditional child is a structural change, same reasoning as
// StatusBadge/Card in Phase 14. Re-lands Phase 14's already-decided
// border-transparent status variants verbatim (this file's own sed from
// that phase still runs first and is harmless — same "no-op duplicate,
// kept so this phase's diff is self-contained" pattern as Card in
// Phases 15/16).
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        ok: "border-transparent bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]",
        issue: "border-transparent bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)]",
        maintenance: "border-transparent bg-[var(--status-maint-bg)] text-[var(--status-maint-fg)]",
        sterilized: "border-transparent bg-primary/10 text-primary",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export type BadgeProps = Omit<
  React.ComponentPropsWithoutRef<"div">,
  "children"
> & {
  variant?: BadgeVariant | null;
  children?: React.ReactNode;
  /** Phase 21 (review item 8) — small leading dot rendered in the variant's
   * own text color (bg-current), so it never needs its own color mapping. */
  dot?: boolean;
};

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-current opacity-90" />
      ) : null}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
