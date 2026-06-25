// AppShell — single responsive entry point for all authenticated pages.
// Desktop (lg+): Topbar + NAV sidebar (PageShell).
// Mobile: sticky header + bottom-nav (Layout).
// Inside MobileShell (Capacitor native): renders content only — chrome is provided by MobileShell.
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { PageShell } from "@/components/layout/PageShell";
import { Layout } from "@/components/layout";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import { NAV } from "@/lib/routes/nav-model";
import type { NavNode } from "@/lib/routes/nav-model";

export interface AppShellProps {
  children: React.ReactNode;
  /**
   * Transitional prop retained for PageShell legacy compat until T2.2.
   * Desktop PageShell still accepts it; IconSidebar is NAV-driven and ignores it.
   */
  sidebarItems?: SidebarItem[];
  /** Forwarded to Layout on mobile for page-controlled scanner. */
  onScan?: (patientId?: string) => void;
  /** Forwarded to Layout on mobile. */
  scannerOpen?: boolean;
  /** Forwarded to Layout on mobile. */
  onCloseScan?: () => void;
  /** Forwarded to Layout on mobile. */
  navigationLocked?: boolean;
  /** Forwarded to Layout on mobile (advisory, currently unused). */
  title?: string;
}

export function AppShell({
  children,
  sidebarItems,
  onScan,
  scannerOpen,
  onCloseScan,
  navigationLocked,
  title,
}: AppShellProps) {
  const insideMobileShell = useMobileShellContext();
  const isDesktop = useIsDesktop();

  if (insideMobileShell) return <>{children}</>;
  // Bottom bar = three destinations either side of the center scan FAB:
  // Today · Equipment · [Scan] · Emergency · Menu. Board, Rooms, Alerts and the
  // rest live in the slide-out menu (Alerts count is badged on the Menu icon).
  // The scan FAB and Menu button are appended by Layout, not by NAV.
  const BOTTOM_NAV_IDS = ["today", "equipment", "emergency"];
  const bottomNavItems: NavNode[] = NAV.filter((n) => BOTTOM_NAV_IDS.includes(n.id));

  if (isDesktop) {
    return <PageShell sidebarItems={sidebarItems}>{children}</PageShell>;
  }

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
