// AppShell — single responsive entry point for all authenticated pages.
// Desktop (lg+): Topbar + NAV sidebar (PageShell).
// Mobile: sticky header + bottom-nav (Layout).
// Inside NativeShell (Capacitor native): passthrough — NativeShell owns all chrome.
import type { ReactNode } from "react";
import { useNativeShellContext } from "@/native/NativeShellContext";
import { WebShell } from "@/desktop/WebShell";
import type { SidebarItem } from "@/components/layout/IconSidebar";
import type { WebShellProps } from "@/desktop/WebShell";

export interface AppShellProps {
  children: ReactNode;
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

/**
 * Chrome dispatcher for authenticated pages.
 *
 * Native: passthrough (NativeShell in PlatformRouter already owns all chrome).
 * Web: delegates to WebShell which picks PageShell (desktop) or Layout (mobile web).
 */
export function AppShell({
  children,
  sidebarItems,
  onScan,
  scannerOpen,
  onCloseScan,
  navigationLocked,
  title,
}: AppShellProps) {
  const insideNativeShell = useNativeShellContext();

  if (insideNativeShell) return <>{children}</>;

  const webProps: WebShellProps = {
    children,
    sidebarItems,
    onScan,
    scannerOpen,
    onCloseScan,
    navigationLocked,
    title,
  };

  return <WebShell {...webProps} />;
}
