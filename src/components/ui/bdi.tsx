import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BdiProps {
  children: ReactNode;
  /**
   * Direction of the isolated run. "auto" (default) lets the browser detect the
   * first strong character — correct for user data that may be Hebrew or Latin.
   * Pass "ltr" for known-Latin content (serials, model codes, emails).
   */
  dir?: "ltr" | "rtl" | "auto";
  className?: string;
}

/**
 * Bidirectional isolation wrapper.
 *
 * Renders a native `<bdi>` so a neutral or opposite-direction run (English
 * names, numbers, em-dashes, relative-time strings) cannot reorder the
 * surrounding RTL text via the Unicode Bidi Algorithm. This is the fix for the
 * classic RTL defects: leading periods ("‏.No items"), swapped digits
 * ("days ago 22"), and misplaced commas next to Latin names.
 */
export function Bdi({ children, dir = "auto", className }: BdiProps) {
  return (
    <bdi dir={dir} className={cn("[unicode-bidi:isolate]", className)}>
      {children}
    </bdi>
  );
}
