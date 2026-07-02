import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { ForwardChevron } from "@/components/ui/directional-chevron";

export interface ListRowProps extends React.HTMLAttributes<HTMLElement> {
  /** Leading affordance — a status dot, icon, or avatar. */
  leading?: React.ReactNode;
  label: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  /** Trailing value shown before the chevron. */
  meta?: React.ReactNode;
  /** Show the reading-forward drill-in chevron. */
  chevron?: boolean;
  /** Highlighted (current) row. */
  selected?: boolean;
  /** Render onto a child element (e.g. a router <Link>) instead of a button. */
  asChild?: boolean;
  disabled?: boolean;
}

/**
 * iOS-style list row (§6.18). Renders as a <button> when interactive, a <div>
 * when static, or merges onto a child via `asChild`. Hover/pressed read the
 * surface ramp; layout uses logical properties so it mirrors in RTL.
 */
export const ListRow = React.forwardRef<HTMLElement, ListRowProps>(
  (
    {
      leading,
      label,
      description,
      meta,
      chevron = false,
      selected = false,
      asChild = false,
      disabled,
      className,
      onClick,
      ...props
    },
    ref,
  ) => {
    const interactive = asChild || typeof onClick === "function";
    const Comp = (asChild ? Slot : interactive ? "button" : "div") as React.ElementType;
    return (
      <Comp
        ref={ref}
        type={interactive && !asChild ? "button" : undefined}
        onClick={onClick}
        disabled={interactive && !asChild ? disabled : undefined}
        aria-current={selected || undefined}
        data-selected={selected || undefined}
        className={cn(
          "flex w-full items-center gap-3 min-h-11 px-4 py-2.5 text-start",
          interactive &&
            "cursor-pointer transition-colors hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)] motion-safe:active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50",
          selected && "bg-[var(--surface-active)]",
          className,
        )}
        {...props}
      >
        {leading != null && <span className="flex shrink-0 items-center">{leading}</span>}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-base font-medium text-foreground">{label}</span>
          {description != null && (
            <span className="truncate text-sm text-muted-foreground">{description}</span>
          )}
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {meta != null && <span className="text-sm text-muted-foreground">{meta}</span>}
          {chevron && (
            <ForwardChevron className="size-4 text-muted-foreground/70" aria-hidden="true" />
          )}
        </span>
      </Comp>
    );
  },
);
ListRow.displayName = "ListRow";
