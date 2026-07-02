import * as React from "react";
import { cn } from "@/lib/utils";

// Skeleton radius defaults to rounded-xl; pass a rounded-* class to match the
// element it stands in for (e.g. a card skeleton passes "rounded-2xl") so there
// is no shape "pop" when real content swaps in.
//
// A shimmer highlight band sweeps across the muted base. Under reduced motion the
// sweep stops (animate-none) and the element degrades to a static muted block.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl bg-muted/70 bg-no-repeat bg-[length:200%_100%]",
        "bg-[linear-gradient(90deg,transparent_0%,rgb(130_130_130/0.18)_50%,transparent_100%)]",
        "animate-shimmer motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
