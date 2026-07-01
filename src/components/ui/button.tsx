import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base: 44px min height, radius-lg (14px per spec), bold, press scale
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[14px] text-sm font-bold ring-offset-background transition-all duration-[120ms] ease-out focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:saturate-50 aria-[busy=true]:cursor-wait [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-safe:active:scale-[0.97] motion-safe:active:opacity-[0.92] motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default:     "bg-primary text-primary-foreground hover:bg-primary/92 shadow-sm",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/92 shadow-sm",
        outline:     "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:   "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-transparent",
        ghost:       "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        link:        "text-primary underline-offset-4 hover:underline motion-safe:active:scale-100",
        action:      "bg-[var(--action)] text-[var(--on-ink)] hover:bg-[var(--action-deep)] shadow-sm",
      },
      size: {
        default:   "h-11 min-h-[44px] px-4 py-2",
        sm:        "h-11 min-h-[44px] rounded-[10px] px-3 text-xs",
        lg:        "h-12 min-h-[44px] rounded-[14px] px-6 text-base",
        xl:        "h-12 min-h-[44px] rounded-[14px] px-8 text-base",
        icon:      "h-11 w-11 min-h-[44px] min-w-[44px]",
        "icon-sm": "h-11 w-11 min-h-[44px] min-w-[44px] rounded-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
