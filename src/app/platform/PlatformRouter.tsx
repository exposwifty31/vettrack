import { type ReactNode } from "react";
import { NativeShell } from "@/native/NativeShell";
import { usePlatformTarget } from "./index";

type Props = { children: ReactNode };

/**
 * Top-level platform dispatcher. Must wrap AppRoutes (and nothing else above
 * it in the tree that needs platform context).
 *
 *   mobile  → NativeShell (owns safe-area, scroll, tab bar, more sheet)
 *   desktop → passthrough (AppShell inside each page owns web chrome)
 */
export function PlatformRouter({ children }: Props) {
  const target = usePlatformTarget();

  if (target === "mobile") {
    return <NativeShell>{children}</NativeShell>;
  }

  return <>{children}</>;
}
