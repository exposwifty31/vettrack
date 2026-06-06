import * as React from "react";
import { cn } from "@/lib/utils";

// Skeleton radius defaults to rounded-xl; pass a rounded-* class to match the
// element it stands in for (e.g. a card skeleton passes "rounded-2xl") so there
// is no shape "pop" when real content swaps in.

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-xl bg-muted/70", className)}
      {...props}
    />
  );
}

export { Skeleton };
