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
