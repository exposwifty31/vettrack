import { type ReactNode } from "react";
import { PageShell } from "@/components/layout/PageShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";

export interface WebShellProps {
  children: ReactNode;
  /**
   * Transitional prop retained for PageShell legacy compat.
   * Desktop PageShell still accepts it; IconSidebar is NAV-driven and ignores it.
   */
  sidebarItems?: SidebarItem[];
}

/**
 * Sole chrome owner for the desktop web platform.
 *
 * Desktop (lg+): Topbar + icon sidebar (via PageShell).
 *
 * Mobile-web users are routed to NativeShell by PlatformRouter before they
 * reach this component, so the mobile-web Layout branch is no longer needed.
 *
 * This component is used by AppShell when NOT inside NativeShell.
 */
export function WebShell({ children, sidebarItems }: WebShellProps) {
  return <PageShell sidebarItems={sidebarItems}>{children}</PageShell>;
}
