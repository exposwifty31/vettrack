import { type ReactNode } from "react";
import { NativeShell } from "@/native/NativeShell";
import { MarketingShell } from "@/desktop/marketing/MarketingShell";
import { usePlatformTarget } from "./index";

type Props = { children: ReactNode };

/**
 * Top-level platform dispatcher. Must wrap AppRoutes (and nothing else above
 * it in the tree that needs platform context).
 *
 *   mobile    → NativeShell (owns safe-area, scroll, tab bar, more sheet)
 *   marketing → MarketingShell (chrome-free passthrough for public routes)
 *   desktop   → passthrough (AppShell inside each page owns web chrome)
 *
 * This is the single branch point: every downstream component either reads
 * useNativeShellContext() to bail out of web chrome, or assumes web defaults.
 */
export function PlatformRouter({ children }: Props) {
  const target = usePlatformTarget();

  if (target === "mobile") {
    return <NativeShell>{children}</NativeShell>;
  }

  if (target === "marketing") {
    return <MarketingShell>{children}</MarketingShell>;
  }

  return <>{children}</>;
}
