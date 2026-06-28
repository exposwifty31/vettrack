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
  /** @deprecated Ignored — page titles are handled by PageShell internally. */
  title?: string;
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
