import { type ReactNode } from "react";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { PageShell } from "@/components/layout/PageShell";
import { Layout } from "@/components/layout";
import { NAV } from "@/lib/routes/nav-model";
import type { NavNode } from "@/lib/routes/nav-model";
import type { SidebarItem } from "@/components/layout/IconSidebar";

export interface WebShellProps {
  children: ReactNode;
  /**
   * Transitional prop retained for PageShell legacy compat.
   * Desktop PageShell still accepts it; IconSidebar is NAV-driven and ignores it.
   */
  sidebarItems?: SidebarItem[];
  onScan?: (patientId?: string) => void;
  scannerOpen?: boolean;
  onCloseScan?: () => void;
  navigationLocked?: boolean;
  title?: string;
}

const BOTTOM_NAV_IDS = ["today", "equipment", "emergency"];

/**
 * Sole chrome owner for the web platform.
 *
 * Desktop (lg+): Topbar + icon sidebar (via PageShell).
 * Mobile web: sticky header + bottom nav (via Layout).
 *
 * This component is used by AppShell when NOT inside NativeShell.
 */
export function WebShell({
  children,
  sidebarItems,
  onScan,
  scannerOpen,
  onCloseScan,
  navigationLocked,
  title,
}: WebShellProps) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return <PageShell sidebarItems={sidebarItems}>{children}</PageShell>;
  }

  const bottomNavItems: NavNode[] = NAV.filter((n) => BOTTOM_NAV_IDS.includes(n.id));

  return (
    <Layout
      title={title}
      onScan={onScan}
      scannerOpen={scannerOpen}
      onCloseScan={onCloseScan}
      navigationLocked={navigationLocked}
      bottomNavItems={bottomNavItems}
    >
      {children}
    </Layout>
  );
}
