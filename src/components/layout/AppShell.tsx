import type { ReactNode } from "react";
import { useNativeShellContext } from "@/native/NativeShellContext";
import { WebShell } from "@/desktop/WebShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";

export interface AppShellProps {
  children: ReactNode;
  /**
   * Transitional prop retained for PageShell legacy compat.
   * Desktop PageShell still accepts it; IconSidebar is NAV-driven and ignores it.
   */
  sidebarItems?: SidebarItem[];
  /** @deprecated Layout is retired — mobile chrome is owned by NativeShell. */
  title?: string;
  /** @deprecated Layout is retired — mobile scanner is owned by NativeShell ScanFab. */
  onScan?: (patientId?: string) => void;
  /** @deprecated Layout is retired. */
  scannerOpen?: boolean;
  /** @deprecated Layout is retired. */
  onCloseScan?: () => void;
  /** @deprecated Layout is retired. */
  navigationLocked?: boolean;
}

/**
 * Chrome dispatcher for authenticated pages.
 *
 * Native / mobile-web: passthrough — PlatformRouter already routed them to NativeShell.
 * Desktop web: delegates to WebShell → PageShell.
 */
export function AppShell({ children, sidebarItems }: AppShellProps) {
  const insideNativeShell = useNativeShellContext();

  if (insideNativeShell) return <>{children}</>;

  return <WebShell sidebarItems={sidebarItems}>{children}</WebShell>;
}
