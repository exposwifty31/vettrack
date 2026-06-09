// AppShell — single responsive entry point for all authenticated pages.
// Desktop (lg+): Topbar + NAV sidebar (PageShell).
// Mobile: sticky header + bottom-nav (Layout).
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { PageShell } from "@/components/layout/PageShell";
import { Layout } from "@/components/layout";
import type { SidebarItem } from "@/components/layout/IconSidebar";

export interface AppShellProps {
  children: React.ReactNode;
  /** @deprecated Sidebar is NAV-driven after T2.2; ignored on desktop. */
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
  const isDesktop = useIsDesktop();

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
    >
      {children}
    </Layout>
  );
}
