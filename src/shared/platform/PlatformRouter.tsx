import { type ReactNode } from "react";
import { NativeShell } from "@/native/NativeShell";
import { usePlatformTarget } from "./index";

type Props = { children: ReactNode };

/**
 * Top-level platform dispatcher. Must wrap AppRoutes (and nothing else above
 * it in the tree that needs platform context).
 *
 *   native → NativeShell (owns safe-area, scroll, tab bar, more sheet)
 *   web    → passthrough (AppShell inside each page owns web chrome)
 *
 * This is the single branch point: every downstream component either reads
 * useNativeShellContext() to bail out of web chrome, or assumes web defaults.
 */
export function PlatformRouter({ children }: Props) {
  const target = usePlatformTarget();

  if (target === "native") {
    return <NativeShell>{children}</NativeShell>;
  }

  return <>{children}</>;
}
