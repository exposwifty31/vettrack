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
        ok: "border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]",
        issue: "border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)]",
        maintenance: "border-[var(--status-maint-border)] bg-[var(--status-maint-bg)] text-[var(--status-maint-fg)]",
        sterilized: "border-primary/30 bg-primary/10 text-primary",
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
};

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

// ── StatusBadge — Ivory design system ──────────────────────────────────────
// Dot-prefix pill for equipment / patient status. Separate from the existing
// Badge component — do not merge; they serve different contexts.

export type EquipmentStatus =
  | "Operational"
  | "Due Check"
  | "Review Needed"
  | "Sterilized"
  | "Maintenance";

interface StatusConfig {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  ok: {
    bg: "bg-[var(--status-ok-bg)]",
    text: "text-[var(--status-ok-fg)]",
    border: "border-[var(--status-ok-border)]",
    dot: "bg-[var(--status-ok-fg)]",
  },
  issue: {
    bg: "bg-[var(--status-issue-bg)]",
    text: "text-[var(--status-issue-fg)]",
    border: "border-[var(--status-issue-border)]",
    dot: "bg-[var(--status-issue-fg)]",
  },
  maintenance: {
    bg: "bg-[var(--status-maint-bg)]",
    text: "text-[var(--status-maint-fg)]",
    border: "border-[var(--status-maint-border)]",
    dot: "bg-[var(--status-maint-fg)]",
  },
  sterilized: {
    bg: "bg-[var(--status-steril-bg)]",
    text: "text-[var(--status-steril-fg)]",
    border: "border-[var(--status-steril-border)]",
    dot: "bg-[var(--status-steril-fg)]",
  },
  critical: {
    bg: "bg-[var(--status-issue-bg)]",
    text: "text-[var(--status-issue-fg)]",
    border: "border-[var(--status-issue-border)]",
    dot: "bg-[var(--status-issue-fg)]",
  },
  needs_attention: {
    bg: "bg-[var(--status-maint-bg)]",
    text: "text-[var(--status-maint-fg)]",
    border: "border-[var(--status-maint-border)]",
    dot: "bg-[var(--status-maint-fg)]",
  },
  Operational: {
    bg: "bg-[var(--status-ok-bg)]",
    text: "text-[var(--status-ok-fg)]",
    border: "border-[var(--status-ok-border)]",
    dot: "bg-[var(--status-ok-fg)]",
  },
  "Due Check": {
    bg: "bg-[var(--status-maint-bg)]",
    text: "text-[var(--status-maint-fg)]",
    border: "border-[var(--status-maint-border)]",
    dot: "bg-[var(--status-maint-fg)]",
  },
  "Review Needed": {
    bg: "bg-[var(--status-issue-bg)]",
    text: "text-[var(--status-issue-fg)]",
    border: "border-[var(--status-issue-border)]",
    dot: "bg-[var(--status-issue-fg)]",
  },
  Sterilized: {
    bg: "bg-[var(--status-steril-bg)]",
    text: "text-[var(--status-steril-fg)]",
    border: "border-[var(--status-steril-border)]",
    dot: "bg-[var(--status-steril-fg)]",
  },
  Maintenance: {
    bg: "bg-[var(--status-maint-bg)]",
    text: "text-[var(--status-maint-fg)]",
    border: "border-[var(--status-maint-border)]",
    dot: "bg-[var(--status-maint-fg)]",
  },
};

const FALLBACK: StatusConfig = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  border: "border-border",
  dot: "bg-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_CONFIG[status] ?? FALLBACK;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-px rounded-[4px] border",
        "text-[11px] font-semibold",
        s.bg,
        s.text,
        s.border
      )}
    >
      <span className={cn("w-[5px] h-[5px] rounded-full shrink-0", s.dot)} aria-hidden />
      {status}
    </span>
  );
}
