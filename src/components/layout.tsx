import { t } from "@/lib/i18n";
import { Link, useLocation } from "wouter";
import { useQRScanner } from "@/hooks/use-qr-scanner";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { computeAlerts } from "@/lib/utils";
import { buildAlertAckSet, countActiveAlerts, countCriticalAlerts } from "@/lib/alert-counts";
import {
  ArrowLeft,
  ArrowRight,
  Home,
  Package,
  Grid,
  Bell,
  MapPin,
  BarChart3,
  AlertTriangle,
  Siren,
  QrCode,
  Stethoscope,
  Shield,
  Menu,
  X,
  WifiOff,
  PackageOpen,
  Clock,
  CloudUpload,
  CalendarDays,
  XCircle,
  RefreshCw,
  CheckCircle,
  CheckCircle2,
  LayoutDashboard,
  ReceiptText,
  Globe,
  Settings,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  BellRing,
  AlignJustify,
  Bug,
  CloudOff,
  Radar,
  HelpCircle,
  ClipboardList,
  Search,
  Map,
  Pill,
  ShoppingCart,
  Syringe,
  Lock,
  Sparkles,
  FileText,
  Monitor,
  Gauge,
} from "lucide-react";
import { OnboardingWalkthrough } from "@/components/onboarding-walkthrough";
import { useDirection } from "@/hooks/useDirection";
import { NfcForegroundScan } from "@/components/nfc-foreground-scan";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import type { RestockContainerView } from "@/types";
import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useAuth } from "@/hooks/use-auth";
import { useSync } from "@/hooks/use-sync";
import { QrScanner } from "@/components/qr-scanner";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "sonner";
import { SettingsToggle, SettingsSelect } from "@/components/settings-controls";
import { playFeedbackTone, playMuteTone, playCriticalAlertTone } from "@/lib/sounds";
import { ReportIssueDialog } from "@/components/report-issue-dialog";
import { SyncQueueSheet } from "@/components/sync-queue-sheet";
import { AlertsDropdown } from "@/components/alerts-dropdown";
import { useScanAffordance } from "@/lib/scan-affordance";
import { UpdateBanner } from "@/components/update-banner";
import { haptics } from "@/lib/haptics";
import {
  isOnline as getOnlineStatus,
  safeStorageGetItem,
  safeStorageSetItem,
} from "@/lib/safe-browser";
import { DispenseSheet } from "@/features/containers/components/DispenseSheet";
import { CANONICAL_HREFS } from "@/lib/routes/canonical-hrefs";
import { matchesRouteFamily } from "@/lib/routes/matches-route-family";
import { resolveNavItemActive } from "@/lib/routes/resolve-nav-active";
import { ROUTE_ALIAS_GROUPS } from "@/lib/routes/route-alias-groups";
import type { NavNode } from "@/lib/routes/nav-model";
interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  /** Product-owner / configured allowlist — clinic-wide ER lock control surface */
  menuOnly?: boolean;
  badgeCount?: number;
}

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  /** Page-controlled scan: optional patient/animal id when opening from a contextual action (e.g. ER card). Bottom nav calls with no args. */
  onScan?: (patientId?: string) => void;
  /** When `onScan` is used, pass open state so the bottom nav scan control matches the page scanner. */
  scannerOpen?: boolean;
  /** When `onScan` is used, call to close the scanner from the bottom nav (e.g. setState false). */
  onCloseScan?: () => void;
  /**
   * When true, a capture-phase click handler blocks navigation outside the flow; allowlisted
   * controls must sit under a DOM ancestor with `data-restock-allow` (see effect below).
   */
  navigationLocked?: boolean;
  /** NAV-model items for the mobile bottom bar. Passed from AppShell. */
  bottomNavItems?: NavNode[];
}

const BOTTOM_NAV_ICON_MAP: Record<string, React.ElementType> = {
  Home, Package, Grid, Bell, MapPin, Settings, Siren,
};

function navLabel(key: string): string {
  const k = key.startsWith("nav.") ? key.slice(4) : key;
  return (t.nav as Record<string, string>)[k] ?? key;
}

export function Layout({ children, title: _title, onScan, scannerOpen: scannerOpenFromParent, onCloseScan, navigationLocked, bottomNavItems }: LayoutProps) {
  const lh = t.layoutHebrew;
  const QUICK_SETTINGS_PANEL_WIDTH = 288;
  const QUICK_SETTINGS_MARGIN = 8;

  const [location, navigate] = useLocation();
  const currentPath = location.split("?")[0] ?? location;

  // Capacitor / mobile: wouter does not reset scroll — menu routes can open mid-page
  // with the title clipped under the sticky header.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPath]);

  const isNavItemActive = (href: string) => resolveNavItemActive(location, href);

  const [menuOpen, setMenuOpen] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  // Web must never surface scan UI (scan-affordance model, BUG-016). The raised
  // FAB stays byte-for-byte on native (tab/fab); only "none" (web) suppresses it.
  const scanAffordance = useScanAffordance();
  const [quickSettingsUseViewportRight, setQuickSettingsUseViewportRight] = useState(false);
  const [quickSettingsViewportTop, setQuickSettingsViewportTop] = useState(0);
  const [syncQueueOpen, setSyncQueueOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(getOnlineStatus());
  const [internalScannerOpen, setInternalScannerOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [qsMounted, setQsMounted] = useState(false);
  const [qsVisible, setQsVisible] = useState(false);
  const [alertBadgeAnimating, setAlertBadgeAnimating] = useState(false);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [dispenseContainerId, setDispenseContainerId] = useState<string | null>(null);
  const navLockToastDebounceRef = useRef(false);
  const prevAlertCountRef = useRef(0);
  const prevCriticalCountRef = useRef<number | null>(null);
  const soundToggleRequestIdRef = useRef(0);
  const { isAdmin, role, userId, effectiveRole } = useAuth();
  const resolvedNavRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  const { pendingCount, failedCount, isSyncing, justSynced, triggerSync } = useSync();
  const { settings, update } = useSettings();
  const quickSettingsRef = useRef<HTMLDivElement>(null);
  const quickSettingsToggleRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();

  // Permanent sync-failure toasts (sync-engine) dispatch this event so
  // their "view queue" action can open the sync sheet from outside React.
  useEffect(() => {
    const openSyncQueue = () => setSyncQueueOpen(true);
    window.addEventListener("vettrack:open-sync-queue", openSyncQueue);
    return () => window.removeEventListener("vettrack:open-sync-queue", openSyncQueue);
  }, []);

  useEffect(() => {
    if (!navigationLocked) return;
    // Restock UIs: put `data-restock-allow` on a wrapper around controls that must stay clickable
    // when the shell blocks other navigation (parent passes `navigationLocked`).
    const blockExternalNav = (e: MouseEvent) => {
      for (const n of e.composedPath()) {
        if (n instanceof Element && n.closest("[data-restock-allow]")) return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      haptics.locked();
      if (!navLockToastDebounceRef.current) {
        navLockToastDebounceRef.current = true;
        toast.info(lh.restockNavLockedToast, {
          icon: <Lock className="w-4 h-4" aria-hidden />,
          duration: 2000,
          id: "nav-locked",
        });
        setTimeout(() => {
          navLockToastDebounceRef.current = false;
        }, 2500);
      }
    };
    document.addEventListener("click", blockExternalNav, true);
    return () => document.removeEventListener("click", blockExternalNav, true);
  }, [navigationLocked, lh.restockNavLockedToast]);

  useEffect(() => {
    if (!quickSettingsOpen) return;

    const updateQuickSettingsPlacement = () => {
      const toggle = quickSettingsToggleRef.current;
      if (!toggle) return;
      const rect = toggle.getBoundingClientRect();
      const wouldClipLeft = rect.right < QUICK_SETTINGS_PANEL_WIDTH + QUICK_SETTINGS_MARGIN;
      setQuickSettingsUseViewportRight(wouldClipLeft);
      setQuickSettingsViewportTop(rect.bottom + QUICK_SETTINGS_MARGIN);
    };

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedUpdateQuickSettingsPlacement = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(updateQuickSettingsPlacement, 100);
    };

    updateQuickSettingsPlacement();
    window.addEventListener("resize", debouncedUpdateQuickSettingsPlacement);
    window.addEventListener("scroll", debouncedUpdateQuickSettingsPlacement, true);
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      window.removeEventListener("resize", debouncedUpdateQuickSettingsPlacement);
      window.removeEventListener("scroll", debouncedUpdateQuickSettingsPlacement, true);
    };
  }, [quickSettingsOpen]);

  useEffect(() => {
    if (menuOpen) {
      setMenuMounted(true);
      const raf = requestAnimationFrame(() => setMenuVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setMenuVisible(false);
    const t = setTimeout(() => setMenuMounted(false), 220);
    return () => clearTimeout(t);
  }, [menuOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  // Close the slide-in menu whenever the user navigates (bottom nav, back gesture, etc.)
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  useEffect(() => {
    if (quickSettingsOpen) {
      setQsMounted(true);
      const raf = requestAnimationFrame(() => setQsVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setQsVisible(false);
    const t = setTimeout(() => setQsMounted(false), 180);
    return () => clearTimeout(t);
  }, [quickSettingsOpen]);

  const scannerUIOpen = onScan ? Boolean(scannerOpenFromParent) : internalScannerOpen;

  const openScanner = () => {
    if (onScan) {
      onScan();
    } else {
      setInternalScannerOpen(true);
    }
  };

  const closeScanner = () => {
    if (onScan) onCloseScan?.();
    else setInternalScannerOpen(false);
  };

  const handleScanButtonClick = () => {
    haptics.tap();
    if (scannerUIOpen) {
      closeScanner();
    } else {
      openScanner();
    }
  };

  useQRScanner(async (assetId) => {
    if (assetId.startsWith("inv-container:")) {
      const containerId = assetId.slice("inv-container:".length).trim();
      if (!containerId) {
        toast.error(t.nfc.error.invalidContainerTag);
        return;
      }
      const rawActive = safeStorageGetItem("vt_active_restock_session");
      if (rawActive) {
        try {
          const parsed = JSON.parse(rawActive) as { containerId?: string };
          if (parsed.containerId && parsed.containerId !== containerId) {
            haptics.warning();
            toast.warning(lh.restockSwitchContainerWarning);
            return;
          }
        } catch {
          /* ignore */
        }
      }
      safeStorageSetItem("vt_auto_restock_container", containerId, "session");
      haptics.scanSuccess();
      navigate(`/inventory?container=${encodeURIComponent(containerId)}`);
      return;
    }

    if (assetId.startsWith("inv-item:")) {
      const nfcTagId = assetId.slice("inv-item:".length).trim();
      if (!nfcTagId) {
        toast.error(t.nfc.error.invalidInventoryItemTag);
        return;
      }
      const raw = safeStorageGetItem("vt_active_restock_session");
      if (!raw) {
        toast.error(t.nfc.error.restockSessionRequired);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as { sessionId?: string; containerId?: string };
        if (!parsed.sessionId) {
          toast.error(t.nfc.error.noActiveRestockSession);
          return;
        }
        const cachedView = qc.getQueryData<RestockContainerView>(["/api/restock/container-items", parsed.containerId]);
        const cachedLine = cachedView?.lines?.find((l) => l.nfcTagId === nfcTagId);
        const currentActual = cachedLine?.sessionObservedQuantity ?? cachedLine?.actual ?? 0;
        const result = await api.restock.scan(parsed.sessionId, { nfcTagId, observedQuantity: currentActual + 1 });
        // Seed the inventory page's NFC counter so the next tap on this same tag
        // sends the correct observedQuantity.
        safeStorageSetItem(
          "vt_nfc_scan_seed",
          JSON.stringify({ tagId: nfcTagId, count: result.observedQuantity })
        );
        haptics.scanSuccess();
        if (parsed.containerId) {
          qc.invalidateQueries({ queryKey: ["/api/restock/container-items", parsed.containerId] });
        }
        navigate("/inventory");
        return;
      } catch {
        haptics.error();
        toast.error(t.nfc.error.scanFailed);
        return;
      }
    }

    // Try equipment first
    try {
      await api.equipment.get(assetId);
      haptics.scanSuccess();
      navigate(`/equipment/${assetId}`);
      return;
    } catch {
      // Not equipment — try container by NFC tag
    }

    try {
      const container = await api.containers.getByNfcTag(assetId);
      if (container?.id) {
        haptics.scanSuccess();
        setDispenseContainerId(container.id);
        return;
      }
    } catch {
      // Not a container either
    }

    toast.error(t.layout.toast.equipmentNotFound);
  }, 1500);

  const { data: equipment } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: myEquipment } = useQuery({
    queryKey: ["/api/equipment/my"],
    queryFn: api.equipment.listMy,
    enabled: Boolean(userId),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: alertAcks } = useQuery({
    queryKey: ["/api/alert-acks"],
    queryFn: api.alertAcks.list,
    enabled: Boolean(userId),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!quickSettingsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (quickSettingsRef.current && !quickSettingsRef.current.contains(e.target as Node)) {
        setQuickSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [quickSettingsOpen]);

  const alerts = equipment ? computeAlerts(equipment) : [];
  const alertAckSet = buildAlertAckSet(alertAcks);
  const alertCount = countActiveAlerts(alerts, alertAckSet);
  const criticalCount = countCriticalAlerts(alerts, alertAckSet);
  const myCount = myEquipment?.length ?? 0;

  useEffect(() => {
    if (alertCount > prevAlertCountRef.current) {
      setAlertBadgeAnimating(true);
      const timer = setTimeout(() => setAlertBadgeAnimating(false), 420);
      prevAlertCountRef.current = alertCount;
      return () => clearTimeout(timer);
    }
    prevAlertCountRef.current = alertCount;
  }, [alertCount]);

  useEffect(() => {
    if (prevCriticalCountRef.current !== null && criticalCount > prevCriticalCountRef.current) {
      haptics.warning();
      void playCriticalAlertTone().catch((err) => {
        console.warn("[layout] playCriticalAlertTone failed", err);
      });
    }
    prevCriticalCountRef.current = criticalCount;
  }, [criticalCount]);

  const canAccessCodeBlue = isAdmin || role === "vet" || role === "senior_technician" || role === "technician";

  const canAccessInventoryNav =
    role === "admin" || role === "vet" || role === "senior_technician" || role === "technician";

  const navItems: NavItem[] = useMemo(() => {
    const allItems: NavItem[] = [
    { href: "/", label: lh.home, icon: <Home className="w-5 h-5" /> },
    { href: "/equipment", label: t.equipment.title, icon: <Package className="w-5 h-5" /> },
    {
      href: CANONICAL_HREFS.equipmentBoard,
      label: t.layout.nav.equipmentCommandBoard,
      icon: <Monitor className="w-5 h-5" />,
    },
    {
      href: CANONICAL_HREFS.equipmentTasks,
      label: t.layout.nav.equipmentTasks,
      icon: <CalendarDays className="w-5 h-5" />,
    },
    ...(canAccessCodeBlue
      ? [{
          href: CANONICAL_HREFS.criticalKitCheck,
          label: t.layout.nav.criticalKitCheck,
          icon: <CheckCircle2 className="w-5 h-5" />,
        } satisfies NavItem]
      : []),
    {
      href: CANONICAL_HREFS.locations,
      label: t.nav.rooms,
      icon: <Radar className="w-5 h-5" />,
    },
    {
      href: "/my-equipment",
      label: t.layout.nav.mine,
      icon: <PackageOpen className="w-5 h-5" />,
      badgeCount: myCount,
    },
    {
      href: "/alerts",
      label: t.layout.nav.alerts,
      icon: <AlertTriangle className="w-5 h-5" />,
      badgeCount: alertCount,
      menuOnly: true,
    },
    ...(canAccessCodeBlue
      ? [{
          href: CANONICAL_HREFS.emergencyEquipmentLog,
          label: t.layout.nav.emergencyEquipmentLog,
          icon: <Siren className="w-5 h-5 text-red-500" />,
          menuOnly: true,
        } satisfies NavItem]
      : []),
    ...(canAccessInventoryNav
      ? [{ href: "/inventory", label: lh.inventory, icon: <Package className="w-5 h-5" /> } satisfies NavItem]
      : []),
    { href: "/analytics", label: lh.analytics, icon: <BarChart3 className="w-5 h-5" /> },
    { href: "/dashboard", label: lh.dashboard, icon: <LayoutDashboard className="w-5 h-5" />, menuOnly: true },
    { href: "/print", label: lh.printQr, icon: <QrCode className="w-5 h-5" />, menuOnly: true },
    { href: "/inventory-items", label: lh.inventoryItems, icon: <Package className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/procurement", label: lh.procurement, icon: <ShoppingCart className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/admin", label: lh.admin, icon: <Shield className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/admin/shifts", label: lh.adminShifts, icon: <CalendarDays className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/whats-new", label: lh.whatsNew, icon: <Sparkles className="w-5 h-5" />, menuOnly: true },
    { href: "/help", label: lh.quickGuide, icon: <HelpCircle className="w-5 h-5" />, menuOnly: true },
    { href: "/audit-log", label: lh.auditLog, icon: <FileText className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    {
      href: CANONICAL_HREFS.emergencyEquipmentHistory,
      label: t.layout.nav.emergencyEquipmentHistory,
      icon: <Clock className="w-5 h-5" />,
      adminOnly: true,
      menuOnly: true,
    },
    { href: "/settings", label: lh.settings, icon: <Settings className="w-5 h-5" />, menuOnly: true },
    ];
    return allItems;
  }, [
    alertCount,
    canAccessCodeBlue,
    canAccessInventoryNav,
    myCount,
    lh,
    t,
  ]);

  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  const operationMenuItems = useMemo(
    () =>
      [
        "/",
        "/equipment",
        CANONICAL_HREFS.equipmentBoard,
        CANONICAL_HREFS.equipmentTasks,
        CANONICAL_HREFS.criticalKitCheck,
        CANONICAL_HREFS.locations,
        "/my-equipment",
        "/alerts",
        "/inventory",
      ]
        .map((href) => visibleItems.find((i) => i.href === href))
        .filter((x): x is NavItem => x != null),
    [visibleItems],
  );
  const managementMenuItems = useMemo(
    () =>
      ["/analytics", "/dashboard", "/inventory-items", "/procurement", "/admin", "/admin/shifts", "/print"]
        .map((href) => visibleItems.find((i) => i.href === href))
        .filter((x): x is NavItem => x != null),
    [visibleItems],
  );
  const operationalControlMenuItems = useMemo(() => [] as NavItem[], []);
  const systemMenuItems = useMemo(
    () =>
      [
        "/whats-new",
        "/help",
        "/audit-log",
        CANONICAL_HREFS.emergencyEquipmentHistory,
        CANONICAL_HREFS.emergencyEquipmentLog,
        "/settings",
      ]
        .map((href) => visibleItems.find((i) => i.href === href))
        .filter((x): x is NavItem => x != null),
    [visibleItems],
  );

  const activeTabIndex = useMemo(() => {
    if (!bottomNavItems) return -1;
    if (menuOpen) return bottomNavItems.length;
    return bottomNavItems.findIndex((n) => resolveNavItemActive(location, n.href));
  }, [bottomNavItems, location, menuOpen]);

  const useLegacyBottomNav = !bottomNavItems?.length;

  const bottomNavActive = useMemo(
    () => ({
      home: location === "/home" || location === "/" || location === "",
      equipment: matchesRouteFamily(location, ["/equipment"]),
    }),
    [location],
  );

  const legacyActiveTabIndex = useMemo(() => {
    if (menuOpen) return 4;
    if (bottomNavActive.equipment) return 1;
    if (bottomNavActive.home) return 0;
    return -1;
  }, [bottomNavActive, menuOpen]);

  // NAV-driven bottom bar splits its items around a center scan FAB:
  // [first half] · [Scan FAB] · [second half] · [Menu].
  const navCenterSplit = bottomNavItems ? Math.ceil(bottomNavItems.length / 2) : 0;
  // Columns = items + scan FAB + menu (NAV-driven); legacy is a fixed 5.
  const bottomNavColCount = useLegacyBottomNav ? 5 : (bottomNavItems?.length ?? 0) + 2;
  // Map the active destination (or open menu) to its visual column, accounting
  // for the FAB column that sits between the two item halves.
  const bottomNavPillIndex = useMemo(() => {
    if (useLegacyBottomNav) return legacyActiveTabIndex;
    if (!bottomNavItems) return -1;
    if (menuOpen) return bottomNavColCount - 1; // menu is the last column
    if (activeTabIndex < 0) return -1;
    return activeTabIndex < navCenterSplit ? activeTabIndex : activeTabIndex + 1;
  }, [useLegacyBottomNav, legacyActiveTabIndex, bottomNavItems, menuOpen, bottomNavColCount, activeTabIndex, navCenterSplit]);

  const renderBottomNavTab = (n: NavNode) => {
    const Icon = BOTTOM_NAV_ICON_MAP[n.icon];
    const isActive = resolveNavItemActive(location, n.href);
    return (
      <Link
        key={n.id}
        href={n.href}
        className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 motion-safe:active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
        data-testid={`bottom-nav-${n.id}`}
      >
        {Icon && (
          <Icon
            className={cn(
              "w-6 h-6 transition-all duration-200",
              isActive ? "text-ivory-green scale-110" : "text-ivory-text3 scale-100",
            )}
            aria-hidden
          />
        )}
        <span
          className={cn(
            "vt-text-2xs font-semibold leading-tight text-center max-w-[4.5rem] truncate",
            isActive ? "text-ivory-green" : "text-ivory-text3",
          )}
        >
          {navLabel(n.labelKey)}
        </span>
      </Link>
    );
  };

  // iPhone (affordance "tab") gets a flat emphasized scan tab, not the raised FAB
  // (scan-affordance model — "never a FAB" on phone). Same scan action + brand
  // tint; occupies the same center grid slot so the bar layout is unchanged.
  const renderScanTab = () => (
    <button
      type="button"
      onClick={handleScanButtonClick}
      className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 motion-safe:active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
      aria-label={scannerUIOpen ? lh.closeScannerAria : lh.bottomScan}
      data-testid="bottom-nav-scan"
    >
      {scannerUIOpen ? (
        <X className="w-6 h-6 text-ivory-green scale-110 transition-all duration-200" aria-hidden />
      ) : (
        <QrCode className="w-6 h-6 text-ivory-green transition-all duration-200" aria-hidden />
      )}
      <span className="vt-text-2xs font-semibold leading-tight text-center max-w-[4.5rem] truncate text-ivory-green">
        {lh.bottomScan}
      </span>
    </button>
  );

  // Center scan affordance — equipment-first primary action. iPad ("fab") keeps
  // the raised FAB; iPhone ("tab") uses the flat tab above; web ("none") shows
  // nothing. Shared by the legacy and NAV-driven bottom-bar renderers.
  const renderScanFab = () =>
    scanAffordance === "none" ? null :
    scanAffordance === "tab" ? renderScanTab() : (
    <div className="flex flex-col items-center justify-end pb-1 relative">
      {!scannerUIOpen && !navigationLocked && (
        <span
          className="absolute top-[-24px] w-[3.75rem] h-[3.75rem] rounded-2xl bg-ivory-green/20 pointer-events-none"
          style={{ animation: "scanAmbient 2.8s ease-in-out infinite" }}
          aria-hidden
        />
      )}
      <button
        type="button"
        onClick={handleScanButtonClick}
        className={cn(
          "-mt-6 mb-0.5 flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-2xl",
          "ring-4 ring-background dark:ring-background",
          "active:scale-[0.93] motion-reduce:active:scale-100 transition-all duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "cursor-pointer",
          scannerUIOpen
            ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-600"
            : navigationLocked
              ? "bg-amber-500 text-white shadow-lg shadow-amber-500/35 hover:bg-amber-600"
              : "vt-scan-fab bg-ivory-green text-white shadow-lg shadow-ivory-green/30 hover:bg-ivory-greenMid",
        )}
        aria-label={scannerUIOpen ? lh.closeScannerAria : lh.bottomScan}
        data-testid="bottom-nav-scan"
      >
        {scannerUIOpen ? (
          <X className="w-8 h-8 transition-transform duration-150" aria-hidden />
        ) : (
          <QrCode
            className={cn(
              "w-8 h-8 transition-transform duration-150",
              navigationLocked && "[animation:scanAmbient_1.4s_ease-in-out_infinite]",
            )}
            aria-hidden
          />
        )}
      </button>
      <span
        className={cn(
          "vt-text-2xs font-bold leading-tight text-center transition-colors duration-200",
          scannerUIOpen
            ? "text-emerald-600"
            : navigationLocked
              ? "text-amber-600"
              : "text-ivory-text2",
        )}
      >
        {scannerUIOpen ? lh.bottomScanClose : lh.bottomScan}
      </span>
    </div>
  );

  const hasPending = pendingCount > 0;
  const hasFailed = failedCount > 0;

  // Mobile back affordance: any page that isn't a bottom-nav root gets a
  // header back button — without it sub-pages (dashboard, settings, details)
  // have no visible exit on iOS, where there is no system back button.
  const dir = useDirection();
  // currentPath defined above (scroll-to-top on route change).
  // Every page except home gets the back affordance — iOS has no system back
  // button, and section roots (rooms, admin, …) need an exit too.
  const showBack = currentPath !== "/" && currentPath !== "/home" && !navigationLocked;
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;
  const handleBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate("/home");
  };

  const handleSoundToggle = async (v: boolean) => {
    const requestId = ++soundToggleRequestIdRef.current;
    if (v) {
      update({ soundEnabled: true });
      await playFeedbackTone().catch((err) => {
        console.warn("[layout] playFeedbackTone failed", err);
      });
    } else {
      try {
        await playMuteTone();
      } catch (err) {
        console.warn("[layout] playMuteTone failed", err);
      } finally {
        if (soundToggleRequestIdRef.current === requestId) {
          update({ soundEnabled: false });
        }
      }
    }
  };

  const handleCriticalAlertsToggle = async (v: boolean) => {
    if (settings.soundEnabled) {
      if (v) {
        await playFeedbackTone();
      } else {
        await playMuteTone();
      }
    }
    update({ criticalAlertsSound: v });
  };

  const openSettingsPage = () => {
    setQuickSettingsOpen(false);
    setMenuOpen(false);
    navigate("/settings");
  };

  /** Slide-menu navigation — explicit navigate() for reliable iOS WebView taps. */
  const closeMenuAndNavigate = (href: string) => {
    setMenuOpen(false);
    navigate(href);
  };

  return (
    <div className="min-h-[100dvh] min-w-0 bg-ivory-bg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:top-2 focus:start-2 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-medium"
      >
        {lh.skipToMainContent}
      </a>
      <header
        className={cn(
          "sticky top-0 header-safe-bleed border-b bg-ivory-navy backdrop-blur supports-[backdrop-filter]:bg-ivory-navy/95 z-40",
          navigationLocked ? "border-amber-400/60" : "border-black/40",
          "transition-colors duration-300"
        )}
      >
        {navigationLocked && (
          <div
            className="h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent w-full"
            style={{ animation: "scanningBar 1.8s ease-in-out infinite" }}
            role="status"
            aria-label={lh.navLockActiveAria}
          />
        )}
        <UpdateBanner />
        <div className="flex h-14 items-center justify-between px-4 max-w-2xl mx-auto">
          <div className="flex min-w-0 items-center gap-1">
          {showBack && (
            <button
              type="button"
              onClick={handleBack}
              aria-label={t.common.back}
              data-testid="mobile-back-button"
              className="-ms-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 motion-safe:active:scale-95"
            >
              <BackIcon className="w-5 h-5" aria-hidden />
            </button>
          )}
          <Link
            href="/home"
            className="flex cursor-pointer items-center gap-2 group select-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div
              className={cn(
                "w-8 h-8 rounded-2xl flex items-center justify-center",
                "bg-ivory-green/30",
                "group-hover:bg-ivory-green/50 group-hover:scale-110 group-hover:shadow-sm group-hover:shadow-ivory-green/20",
                "group-active:scale-95",
                "transition-all duration-200 ease-out"
              )}
            >
              <Stethoscope
                className="w-4 h-4 text-[var(--brand-green-bright)] transition-transform duration-300 ease-out group-hover:scale-110"
                aria-hidden
              />
            </div>
            <span className="text-lg font-bold tracking-tight transition-colors duration-200 text-white group-hover:text-[var(--brand-green-bright)]">
              Vet<em className="text-[var(--brand-green-bright)] not-italic group-hover:text-white">Track</em>
            </span>
          </Link>
          </div>

          <div className="flex items-center gap-1.5">
            {!isOnline && (
              <div className="flex items-center gap-1 text-xs text-amber-300 bg-amber-900/40 border border-amber-700/50 rounded-full px-2.5 py-1">
                <WifiOff className="w-3 h-3" />
                <span>{lh.offline}</span>
              </div>
            )}

            {isOnline && isSyncing && (
              <div className="flex items-center gap-1 text-xs text-[var(--brand-green-bright)] bg-white/[0.08] border border-white/10 rounded-full px-2.5 py-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>{lh.syncing}</span>
              </div>
            )}

            {isOnline && justSynced && !isSyncing && pendingCount === 0 && (
              <div
                className="flex items-center gap-1 text-xs text-emerald-400 rounded-full px-2.5 py-1 border border-emerald-700/50"
                style={{ animation: "syncSuccessBoom 2.2s ease-out forwards" }}
                data-testid="sync-synced-indicator"
              >
                <CheckCircle
                  className="w-3 h-3"
                  style={{ animation: "checkPop 300ms cubic-bezier(0.34,1.56,0.64,1) forwards" }}
                  aria-hidden
                />
                <span>{lh.synced}</span>
              </div>
            )}

            {isOnline && hasPending && !isSyncing && (
              <button
                onClick={triggerSync}
                className="flex items-center gap-1 text-xs text-[var(--brand-green-bright)] bg-white/[0.08] border border-white/10 rounded-full px-2.5 py-1 hover:bg-white/15 transition-colors"
                title={lh.pendingTitle(pendingCount)}
                data-testid="sync-pending-indicator"
              >
                <CloudUpload className="w-3 h-3" />
                <span>{lh.pendingShort(pendingCount)}</span>
              </button>
            )}

            {hasFailed && (
              <div
                className="flex items-center gap-1 text-xs text-red-400 bg-red-900/30 border border-red-700/50 rounded-full px-2.5 py-1"
                title={lh.failedTitle(failedCount)}
                data-testid="sync-failed-indicator"
              >
                <XCircle className="w-3 h-3" />
                <span>{lh.failedShort(failedCount)}</span>
              </div>
            )}

            {(hasPending || hasFailed) && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative text-[var(--brand-green-bright)] hover:text-white hover:bg-white/10"
                onClick={() => setSyncQueueOpen(true)}
                title={t.layout.sync.viewQueue}
                aria-label={t.layout.sync.viewQueue}
                data-testid="sync-queue-badge"
              >
                <CloudOff className="w-4 h-4" aria-hidden="true" />
                <span className="absolute -top-0.5 -end-0.5 w-3.5 h-3.5 bg-amber-400 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                  {(pendingCount + failedCount) > 9 ? "9+" : pendingCount + failedCount}
                </span>
              </Button>
            )}

            {(hasPending || hasFailed) && (
              <HelpTooltip
                side="bottom"
                content={
                  hasFailed
                    ? t.layout.sync.failedMessage
                    : lh.pendingTooltip(pendingCount)
                }
              />
            )}

            <AlertsDropdown
              alerts={alerts}
              alertCount={alertCount}
              badgeAnimating={alertBadgeAnimating}
            />

            <div className="relative" ref={quickSettingsRef}>
              {(
              <Button
                ref={quickSettingsToggleRef}
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setQuickSettingsOpen((o) => !o);
                  setMenuOpen(false);
                }}
                aria-label={t.common.quickSettings}
                data-testid="quick-settings-toggle"
                className="text-[var(--brand-green-bright)] hover:text-white hover:bg-white/10"
              >
                <Settings className="w-4 h-4" />
              </Button>
              )}

              {qsMounted && (
                <div
                  className={cn(
                    "w-72 bg-card border border-border rounded-2xl z-50 p-3 space-y-2",
                    "origin-top-right will-change-transform",
                    "shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_16px_48px_-8px_rgba(0,0,0,0.15)]",
                    quickSettingsUseViewportRight ? "fixed right-2" : "absolute right-0 top-full mt-2",
                    qsVisible
                      ? "[animation:menuReveal_160ms_cubic-bezier(0.16,1,0.3,1)_forwards]"
                      : "opacity-0 pointer-events-none scale-95"
                  )}
                  style={quickSettingsUseViewportRight ? { top: quickSettingsViewportTop } : undefined}
                  data-testid="quick-settings-panel"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1">
                    {lh.quickSettings}
                  </p>
                  <SettingsToggle
                    icon={
                      <span className="relative w-5 h-5 block">
                        <Moon
                          className={cn(
                            "w-5 h-5 absolute inset-0 transition-all duration-200",
                            (settings.appearance === "dark") ? "opacity-100 rotate-0" : "opacity-0 rotate-90"
                          )}
                        />
                        <Sun
                          className={cn(
                            "w-5 h-5 absolute inset-0 transition-all duration-200",
                            (settings.appearance === "dark") ? "opacity-0 -rotate-90" : "opacity-100 rotate-0"
                          )}
                        />
                      </span>
                    }
                    label={t.layout.settings.darkMode}
                    checked={(settings.appearance === "dark")}
                    onCheckedChange={(v) => update({ appearance: v ? "dark" : "system" })}
                    data-testid="quick-dark-mode"
                  />
                  <SettingsSelect
                    icon={<AlignJustify className="w-5 h-5" />}
                    label={t.layout.settings.displaySize}
                    value={settings.density}
                    options={[
                      { value: "comfortable", label: t.layout.settings.comfortable },
                      { value: "compact", label: t.layout.settings.compact },
                    ]}
                    onValueChange={(v) => update({ density: v as "comfortable" | "compact" })}
                    data-testid="quick-density"
                  />
                  <SettingsToggle
                    icon={
                      <span className="relative w-5 h-5 block">
                        <Volume2
                          className={cn(
                            "w-5 h-5 absolute inset-0 transition-all duration-200",
                            settings.soundEnabled ? "opacity-100 rotate-0" : "opacity-0 rotate-90"
                          )}
                        />
                        <VolumeX
                          className={cn(
                            "w-5 h-5 absolute inset-0 transition-all duration-200",
                            settings.soundEnabled ? "opacity-0 -rotate-90" : "opacity-100 rotate-0"
                          )}
                        />
                      </span>
                    }
                    label={t.layout.settings.masterSound}
                    checked={settings.soundEnabled}
                    onCheckedChange={handleSoundToggle}
                    data-testid="quick-sound"
                  />
                  <SettingsToggle
                    icon={<BellRing className="w-5 h-5" />}
                    label={t.layout.settings.criticalAlerts}
                    checked={settings.criticalAlertsSound}
                    onCheckedChange={handleCriticalAlertsToggle}
                    data-testid="quick-critical-sound"
                  />
                  <div className="pt-1 border-t border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-xs text-muted-foreground"
                      onClick={openSettingsPage}
                    >
                      <Settings className="w-3.5 h-3.5" />
                      {lh.allSettings}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {menuMounted && (
        <>
          <div
            className="fixed inset-0 z-[54] bg-black/50 backdrop-blur-[2px]"
            aria-hidden
            onClick={() => setMenuOpen(false)}
          />
          <aside
            className={cn(
              "fixed inset-y-0 inset-inline-start-0 z-[55] w-[min(20rem,88vw)]",
              "bg-ivory-bg border-e border-ivory-border shadow-2xl overflow-y-auto",
              "transition-transform duration-220 ease-out will-change-transform",
              menuVisible
                ? "translate-x-0"
                : "-translate-x-full rtl:translate-x-full pointer-events-none",
            )}
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            role="dialog"
            aria-modal="true"
            aria-label={lh.bottomMenu}
            data-testid="mobile-nav-drawer"
          >
            <div className="flex items-center justify-between gap-2 border-b border-ivory-border px-4 py-3">
              <p className="text-sm font-bold text-ivory-text">{lh.bottomMenu}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setMenuOpen(false)}
                aria-label={t.common.closeNavigationMenu}
              >
                <X className="w-5 h-5" aria-hidden />
              </Button>
            </div>
            <div className="px-4 py-3">
            <nav className="vt-header-menu flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-1 pb-0.5">{t.layout.nav.operationsSection}</p>
              {operationMenuItems.map((item, index) => {
                const isActive = isNavItemActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(e) => {
                      e.preventDefault();
                      closeMenuAndNavigate(item.href);
                    }}
                    data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                    className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                    style={{ animationDelay: menuVisible ? `${index * 16}ms` : "0ms" }}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                        "relative overflow-hidden",
                        isActive
                          ? "bg-ivory-greenBg text-ivory-green font-semibold ps-4 pe-3"
                          : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 ps-3 hover:ps-4 pe-3"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
                          style={{ animation: "accentGrow 200ms ease-out forwards", transformOrigin: "top" }}
                          aria-hidden
                        />
                      )}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className={cn(
                            "transition-all duration-150 flex-shrink-0",
                            isActive ? "opacity-100 scale-110" : "opacity-60 scale-100"
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      {item.badgeCount ? (
                        <Badge variant="issue" className="h-5 min-w-5 px-1.5 flex-shrink-0">
                          {item.badgeCount}
                        </Badge>
                      ) : null}
                    </div>
                  </Link>
                );
              })}

              {operationalControlMenuItems.length > 0 ? (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-2 pb-0.5">
                    {t.layout.nav.operationalControlSection}
                  </p>
                  {operationalControlMenuItems.map((item, index) => {
                    const isActive = isNavItemActive(item.href);
                    const stagger = operationMenuItems.length + index;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={(e) => {
                          e.preventDefault();
                          closeMenuAndNavigate(item.href);
                        }}
                        data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                        className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                        style={{ animationDelay: menuVisible ? `${stagger * 16}ms` : "0ms" }}
                      >
                        <div
                          className={cn(
                            "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                            "relative overflow-hidden",
                            isActive
                              ? "bg-ivory-greenBg text-ivory-green font-semibold ps-4 pe-3"
                              : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 ps-3 hover:ps-4 pe-3",
                          )}
                        >
                          {isActive && (
                            <span
                              className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
                              style={{ animation: "accentGrow 200ms ease-out forwards", transformOrigin: "top" }}
                              aria-hidden
                            />
                          )}
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={cn(
                                "transition-all duration-150 flex-shrink-0",
                                isActive ? "opacity-100 scale-110" : "opacity-60 scale-100",
                              )}
                            >
                              {item.icon}
                            </span>
                            <span className="text-sm font-medium">{item.label}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </>
              ) : null}

              {managementMenuItems.length > 0 ? (
                <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-2 pb-0.5">{t.layout.nav.managementSection}</p>
              {managementMenuItems.map((item, index) => {
                const isActive = isNavItemActive(item.href);
                const stagger = operationMenuItems.length + operationalControlMenuItems.length + index;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(e) => {
                      e.preventDefault();
                      closeMenuAndNavigate(item.href);
                    }}
                    data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                    className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                    style={{ animationDelay: menuVisible ? `${stagger * 16}ms` : "0ms" }}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                        "relative overflow-hidden",
                        isActive
                          ? "bg-ivory-greenBg text-ivory-green font-semibold ps-4 pe-3"
                          : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 ps-3 hover:ps-4 pe-3"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
                          style={{ animation: "accentGrow 200ms ease-out forwards", transformOrigin: "top" }}
                          aria-hidden
                        />
                      )}
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            "transition-all duration-150 flex-shrink-0",
                            isActive ? "opacity-100 scale-110" : "opacity-60 scale-100"
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
                </>
              ) : null}

              {systemMenuItems.length > 0 ? (
                <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-2 pb-0.5">{t.layout.nav.systemSection}</p>
              {systemMenuItems.map((item, index) => {
                const isActive = isNavItemActive(item.href);
                const stagger =
                  operationMenuItems.length + operationalControlMenuItems.length + managementMenuItems.length + index;
                if (item.href === "/settings") {
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={openSettingsPage}
                      data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                      className="w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                      style={{ animationDelay: menuVisible ? `${stagger * 16}ms` : "0ms" }}
                    >
                      <div
                        className={cn(
                          "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                          "relative overflow-hidden",
                          isActive
                            ? "bg-primary/8 text-primary font-semibold ps-4 pe-3"
                            : "text-foreground hover:bg-muted/70 active:bg-muted ps-3 hover:ps-4 pe-3"
                        )}
                      >
                        {isActive && (
                          <span
                            className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
                            style={{ animation: "accentGrow 200ms ease-out forwards", transformOrigin: "top" }}
                            aria-hidden
                          />
                        )}
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={cn(
                              "transition-all duration-150 flex-shrink-0",
                              isActive ? "opacity-100 scale-110" : "opacity-60 scale-100"
                            )}
                          >
                            {item.icon}
                          </span>
                          <span className="text-sm font-medium">{item.label}</span>
                        </div>
                      </div>
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(e) => {
                      e.preventDefault();
                      closeMenuAndNavigate(item.href);
                    }}
                    data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                    className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                    style={{ animationDelay: menuVisible ? `${stagger * 16}ms` : "0ms" }}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                        "relative overflow-hidden",
                        isActive
                          ? "bg-ivory-greenBg text-ivory-green font-semibold ps-4 pe-3"
                          : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 ps-3 hover:ps-4 pe-3"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
                          style={{ animation: "accentGrow 200ms ease-out forwards", transformOrigin: "top" }}
                          aria-hidden
                        />
                      )}
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            "transition-all duration-150 flex-shrink-0",
                            isActive ? "opacity-100 scale-110" : "opacity-60 scale-100"
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setReportIssueOpen(true);
                }}
                data-testid="nav-report-issue"
                className={cn(
                  "w-full cursor-pointer text-left min-h-[44px] relative overflow-hidden",
                  "opacity-0 [animation:navItemFade_160ms_ease-out_forwards] rounded-xl",
                  "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 ps-3 hover:ps-4 pe-3",
                  "flex items-center gap-3 transition-all duration-150 py-2.5"
                )}
                style={{
                  animationDelay: menuVisible
                    ? `${(operationMenuItems.length + operationalControlMenuItems.length + managementMenuItems.length + systemMenuItems.length) * 16}ms`
                    : "0ms",
                }}
              >
                <span
                  className="transition-all duration-150 flex-shrink-0 opacity-60 scale-100"
                >
                  <Bug className="w-5 h-5" />
                </span>
                <span className="text-sm font-medium">{lh.reportIssue}</span>
              </button>
            </nav>
            </div>
          </aside>
        </>
      )}

      <main
        id="main-content"
        tabIndex={-1}
        // scroll-mt clears the sticky header (~57px) so the skip-link jump and
        // any in-page #main-content anchors land below it, not under it.
        className={cn(
          "max-w-2xl mx-auto min-w-0 px-3.5 sm:px-4 pb-nav-safe scroll-mt-20 focus:outline-none flex flex-col",
          "min-h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px))]",
          settings.density === "compact" ? "py-2.5" : "py-4"
        )}
      >
        {children}
      </main>

      <nav
        className="bottom-bar fixed bottom-0 left-0 right-0 z-[52] border-t border-ivory-border backdrop-blur-xl shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.12)]"
        style={{
          background: "var(--nav-bg)",
          paddingBottom: "env(safe-area-inset-bottom)",
          willChange: "transform",
          WebkitTransform: "translateZ(0)",
          transform: "translateZ(0)",
        }}
        aria-label={lh.bottomMenu}
      >
        <div
          className="relative grid max-w-2xl mx-auto items-end min-h-[68px] px-0.5 pt-1"
          style={{ gridTemplateColumns: `repeat(${bottomNavColCount}, minmax(0, 1fr))` }}
        >
          {bottomNavPillIndex >= 0 && (
            <div
              aria-hidden
              className="vt-bottom-nav-tab-pill absolute top-1 h-[3px] w-6 rounded-full bg-[var(--brand)] pointer-events-none"
              style={{
                insetInlineStart: `calc(${bottomNavPillIndex} * ${100 / bottomNavColCount}% + ${100 / bottomNavColCount / 2}% - 12px)`,
              }}
            />
          )}
          {useLegacyBottomNav ? (
            <>
              <Link
                href="/home"
                className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 motion-safe:active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
                data-testid="bottom-nav-home"
              >
                <Home
                  className={cn(
                    "w-6 h-6 transition-all duration-200",
                    bottomNavActive.home ? "text-ivory-green scale-110" : "text-ivory-text3 scale-100",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-tight text-center max-w-[4.5rem] truncate",
                    bottomNavActive.home ? "text-ivory-green" : "text-ivory-text3",
                  )}
                >
                  {lh.bottomHome}
                </span>
              </Link>

              <Link
                href="/equipment"
                className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 motion-safe:active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
                data-testid="bottom-nav-equipment"
              >
                <Package
                  className={cn(
                    "w-6 h-6 transition-all duration-200",
                    bottomNavActive.equipment ? "text-ivory-green scale-110" : "text-ivory-text3 scale-100",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-tight text-center max-w-[4.5rem] truncate",
                    bottomNavActive.equipment ? "text-ivory-green" : "text-ivory-text3",
                  )}
                >
                  {lh.bottomEquipment}
                </span>
              </Link>

              {renderScanFab()}

              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className={cn(
                  "flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] w-full",
                  "transition-opacity duration-150 motion-safe:active:opacity-80 motion-reduce:active:opacity-100",
                  "rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "cursor-pointer",
                  navigationLocked && "opacity-40",
                )}
                aria-expanded={menuOpen}
                aria-label={
                menuOpen
                  ? t.common.closeNavigationMenu
                  : alertCount > 0
                    ? `${lh.bottomMenu} · ${t.layout.alertsDropdown.activeCount(alertCount)}`
                    : lh.bottomMenu
              }
                data-testid="bottom-nav-menu"
              >
                {menuOpen ? (
                  <X
                    className={cn("w-6 h-6 transition-all duration-200", "text-ivory-green scale-110")}
                    aria-hidden
                  />
                ) : (
                  <Menu
                    className={cn("w-6 h-6 transition-all duration-200", "text-ivory-text3 scale-100")}
                    aria-hidden
                  />
                )}
                <span className={cn("text-[10px] font-semibold", menuOpen ? "text-ivory-green" : "text-ivory-text3")}>
                  {lh.bottomMenu}
                </span>
              </button>
            </>
          ) : (
            <>
              {bottomNavItems!.slice(0, navCenterSplit).map(renderBottomNavTab)}
              {renderScanFab()}
              {bottomNavItems!.slice(navCenterSplit).map(renderBottomNavTab)}
            </>
          )}
          {!useLegacyBottomNav && (
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className={cn(
                "flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] w-full",
                "transition-opacity duration-150 motion-safe:active:opacity-80 motion-reduce:active:opacity-100",
                "rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "cursor-pointer",
                navigationLocked && "opacity-40",
              )}
              aria-expanded={menuOpen}
              aria-label={
                menuOpen
                  ? t.common.closeNavigationMenu
                  : alertCount > 0
                    ? `${lh.bottomMenu} · ${t.layout.alertsDropdown.activeCount(alertCount)}`
                    : lh.bottomMenu
              }
              data-testid="bottom-nav-menu"
            >
              {menuOpen ? (
                <X
                  className={cn("w-6 h-6 transition-all duration-200", "text-ivory-green scale-110")}
                  aria-hidden
                />
              ) : (
                <span className="relative">
                  <Menu
                    className={cn("w-6 h-6 transition-all duration-200", "text-ivory-text3 scale-100")}
                    aria-hidden
                  />
                  {alertCount > 0 && (
                    <Badge
                      variant="issue"
                      aria-hidden
                      className="absolute -top-1.5 -end-2 h-4 min-w-4 px-1 vt-text-2xs font-bold pointer-events-none"
                    >
                      {alertCount > 99 ? "99+" : alertCount}
                    </Badge>
                  )}
                </span>
              )}
              <span className={cn("vt-text-2xs font-semibold", menuOpen ? "text-ivory-green" : "text-ivory-text3")}>
                {lh.bottomMenu}
              </span>
            </button>
          )}
        </div>
      </nav>

      {!onScan && scannerUIOpen && (
        <QrScanner
          onClose={() => setInternalScannerOpen(false)}
          onDispense={(containerId) => {
            setInternalScannerOpen(false);
            setDispenseContainerId(containerId);
          }}
        />
      )}

      <ReportIssueDialog
        open={reportIssueOpen}
        onOpenChange={setReportIssueOpen}
      />

      <SyncQueueSheet
        open={syncQueueOpen}
        onClose={() => setSyncQueueOpen(false)}
      />

      {dispenseContainerId && (
        <DispenseSheet
          containerId={dispenseContainerId}
          isOpen={Boolean(dispenseContainerId)}
          openedViaScan
          onClose={() => setDispenseContainerId(null)}
        />
      )}

      {userId ? <NfcForegroundScan /> : null}

      <OnboardingWalkthrough />
    </div>
  );
}
