import { t } from "@/lib/i18n";
import { Link, useLocation } from "wouter";
import { useQRScanner } from "@/hooks/use-qr-scanner";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ER_MODE_QUERY_KEY, getErMode } from "@/lib/er-api";
import { computeAlerts } from "@/lib/utils";
import {
  Home,
  Package,
  BarChart3,
  AlertTriangle,
  Siren,
  QrCode,
  Shield,
  Menu,
  X,
  WifiOff,
  PackageOpen,
  Clock,
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
  FlaskConical,
  Radar,
  HelpCircle,
  ClipboardList,
  Search,
  Map,
  Pill,
  ShoppingCart,
  Syringe,
  Lock,
  Film,
  Sparkles,
  FileText,
  Stethoscope,
  Monitor,
  Gauge,
} from "lucide-react";
import { OnboardingWalkthrough } from "@/components/onboarding-walkthrough";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useAuth } from "@/hooks/use-auth";
import { useSync } from "@/hooks/use-sync";
import { QrScanner } from "@/components/qr-scanner";
import { useSettings } from "@/hooks/use-settings";
import { toast } from "sonner";
import { SettingsToggle, SettingsSelect } from "@/components/settings-controls";
import { playFeedbackTone, playMuteTone } from "@/lib/sounds";
import { ReportIssueDialog } from "@/components/report-issue-dialog";
import { SyncQueueSheet } from "@/components/sync-queue-sheet";
import { UpdateBanner } from "@/components/update-banner";
import { haptics } from "@/lib/haptics";
import {
  isOnline as getOnlineStatus,
  safeStorageGetItem,
  safeStorageSetItem,
} from "@/lib/safe-browser";
import { DispenseSheet } from "@/features/containers/components/DispenseSheet";
import { ErModeToggle } from "@/features/er-admin/ErModeToggle";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  /** Product-owner / configured allowlist — clinic-wide ER lock control surface */
  erModeManagerOnly?: boolean;
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
}

export function Layout({ children, title: _title, onScan, scannerOpen: scannerOpenFromParent, onCloseScan, navigationLocked }: LayoutProps) {
  const lh = t.layoutHebrew;
  const QUICK_SETTINGS_PANEL_WIDTH = 288;
  const QUICK_SETTINGS_MARGIN = 8;

  const [location, navigate] = useLocation();

  const isNavItemActive = (href: string) => {
    if (href === "/er") {
      return (
        location === "/er" ||
        location === "/er/" ||
        (location.startsWith("/er") && !location.startsWith("/er/impact"))
      );
    }
    if (href === "/er/impact") return location.startsWith("/er/impact");
    return location === href;
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
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
  const { isAdmin, role, userId, effectiveRole, canManageErMode } = useAuth();
  const { data: erMode } = useQuery({
    queryKey: ER_MODE_QUERY_KEY,
    queryFn: getErMode,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const erConcealment = erMode?.state === "enforced";
  const resolvedNavRole = String(effectiveRole ?? role ?? "").trim().toLowerCase();
  const canAccessPharmacyForecastNav =
    resolvedNavRole === "technician" ||
    resolvedNavRole === "lead_technician" ||
    resolvedNavRole === "vet_tech" ||
    resolvedNavRole === "senior_technician" ||
    resolvedNavRole === "vet" ||
    resolvedNavRole === "admin";
  const { pendingCount, failedCount, isSyncing, justSynced, triggerSync } = useSync();
  const { settings, update } = useSettings();
  const quickSettingsRef = useRef<HTMLDivElement>(null);
  const quickSettingsToggleRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();

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
        toast.error("Invalid container NFC tag");
        return;
      }
      const rawActive = safeStorageGetItem("vt_active_restock_session");
      if (rawActive) {
        try {
          const parsed = JSON.parse(rawActive) as { containerId?: string };
          if (parsed.containerId && parsed.containerId !== containerId) {
            haptics.warning();
            toast.warning("Finish restock before scanning another container.");
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
        toast.error("Invalid inventory item NFC tag");
        return;
      }
      const raw = safeStorageGetItem("vt_active_restock_session");
      if (!raw) {
        toast.error("Start a restock session before scanning item tags");
        return;
      }
      try {
        const parsed = JSON.parse(raw) as { sessionId?: string; containerId?: string };
        if (!parsed.sessionId) {
          toast.error("No active restock session found");
          return;
        }
        await api.restock.scan(parsed.sessionId, { nfcTagId, delta: 1 });
        haptics.scanSuccess();
        if (parsed.containerId) {
          qc.invalidateQueries({ queryKey: ["/api/restock/container-items", parsed.containerId] });
        }
        navigate("/inventory");
        return;
      } catch {
        haptics.error();
        toast.error("Inventory scan failed");
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
    enabled: Boolean(userId) && !erConcealment,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: myEquipment } = useQuery({
    queryKey: ["/api/equipment/my"],
    queryFn: api.equipment.listMy,
    enabled: Boolean(userId) && !erConcealment,
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

  const alertCount = equipment ? computeAlerts(equipment).length : 0;
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

  const canAccessCodeBlue = isAdmin || role === "vet" || role === "senior_technician" || role === "technician";

  const canAccessHandoverInventory =
    role === "admin" || role === "vet" || role === "technician";

  const navItems: NavItem[] = useMemo(() => {
    if (erConcealment) {
      return [
        { href: "/er", label: t.erCommandCenter.title, icon: <Monitor className="w-5 h-5" /> },
        {
          href: "/er/impact",
          label: t.erCommandCenter.impactLink,
          icon: <Gauge className="w-5 h-5" />,
          menuOnly: true,
        },
      ];
    }
    return [
    { href: "/", label: lh.home, icon: <Home className="w-5 h-5" /> },
    { href: "/equipment", label: t.equipment.title, icon: <Package className="w-5 h-5" /> },
    {
      href: "/alerts",
      label: t.layout.nav.alerts,
      icon: <AlertTriangle className="w-5 h-5" />,
      badgeCount: alertCount,
    },
    ...(canAccessCodeBlue
      ? [{
          href: "/code-blue",
          label: "Code Blue",
          icon: <Siren className="w-5 h-5 text-red-500" />,
        } satisfies NavItem]
      : []),
    ...(canAccessCodeBlue
      ? [{
          href: "/crash-cart",
          label: "עגלת החייאה",
          icon: <CheckCircle2 className="w-5 h-5" />,
        } satisfies NavItem]
      : []),
    {
      href: "/my-equipment",
      label: t.layout.nav.mine,
      icon: <PackageOpen className="w-5 h-5" />,
      badgeCount: myCount,
    },
    { href: "/appointments", label: "Tasks", icon: <CalendarDays className="w-5 h-5" />, menuOnly: true },
    { href: "/patients", label: "Active Patients", icon: <Stethoscope className="w-5 h-5" />, menuOnly: true },
    { href: "/display", label: "Ward Display", icon: <Monitor className="w-5 h-5" />, menuOnly: true },
    { href: "/meds", label: "Medication Hub", icon: <Pill className="w-5 h-5" />, menuOnly: true },
    ...(canAccessPharmacyForecastNav
      ? [{
          href: "/pharmacy-forecast",
          label: t.pharmacyForecast.navLabel,
          icon: <Syringe className="w-5 h-5" />,
          menuOnly: true,
        } satisfies NavItem]
      : []),
    { href: "/rooms", label: lh.radar, icon: <Radar className="w-5 h-5" /> },
    ...(canManageErMode
      ? [
          {
            href: "/er",
            label: t.layout.nav.operationalCommandCenter,
            icon: <Siren className="w-5 h-5 text-amber-500" />,
            menuOnly: true,
            erModeManagerOnly: true,
          } satisfies NavItem,
        ]
      : []),
    ...(canAccessHandoverInventory
      ? [
          { href: "/shift-handover", label: lh.shiftHandover, icon: <ClipboardList className="w-5 h-5" /> } satisfies NavItem,
          { href: "/inventory", label: lh.inventory, icon: <Package className="w-5 h-5" /> } satisfies NavItem,
        ]
      : []),
    { href: "/analytics", label: lh.analytics, icon: <BarChart3 className="w-5 h-5" /> },
    { href: "/billing", label: lh.billing, icon: <ReceiptText className="w-5 h-5" /> },
    { href: "/dashboard", label: lh.dashboard, icon: <LayoutDashboard className="w-5 h-5" />, menuOnly: true },
    { href: "/print", label: lh.printQr, icon: <QrCode className="w-5 h-5" />, menuOnly: true },
    { href: "/inventory-items", label: lh.inventoryItems, icon: <Package className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/procurement", label: lh.procurement, icon: <ShoppingCart className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/admin", label: lh.admin, icon: <Shield className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/admin/shifts", label: lh.adminShifts, icon: <CalendarDays className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/stability", label: lh.stability, icon: <FlaskConical className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/app-tour", label: lh.appTour, icon: <Film className="w-5 h-5" />, menuOnly: true },
    { href: "/whats-new", label: lh.whatsNew, icon: <Sparkles className="w-5 h-5" />, menuOnly: true },
    { href: "/help", label: lh.quickGuide, icon: <HelpCircle className="w-5 h-5" />, menuOnly: true },
    { href: "/audit-log", label: lh.auditLog, icon: <FileText className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    {
      href: "/admin/medication-integrity",
      label: lh.medIntegrity,
      icon: <Pill className="w-5 h-5" />,
      adminOnly: true,
      menuOnly: true,
    },
    {
      href: "/admin/ops-dashboard",
      label: lh.opsDashboard,
      icon: <Gauge className="w-5 h-5" />,
      adminOnly: true,
      menuOnly: true,
    },
    { href: "/admin/code-blue-history", label: "היסטוריית CODE BLUE", icon: <Clock className="w-5 h-5" />, adminOnly: true, menuOnly: true },
    { href: "/settings", label: lh.settings, icon: <Settings className="w-5 h-5" />, menuOnly: true },
    ];
  }, [
    erConcealment,
    alertCount,
    canAccessCodeBlue,
    canAccessHandoverInventory,
    canAccessPharmacyForecastNav,
    canManageErMode,
    myCount,
    lh,
    t,
  ]);

  const visibleItems = navItems.filter(
    (item) =>
      (!item.adminOnly || isAdmin) && (!item.erModeManagerOnly || canManageErMode),
  );

  const operationMenuItems = useMemo(
    () =>
      erConcealment
        ? visibleItems
        : ["/", "/equipment", "/alerts", "/code-blue", "/crash-cart", "/my-equipment", "/appointments", "/patients", "/display", "/meds", "/pharmacy-forecast", "/rooms", "/shift-handover", "/inventory"]
            .map((href) => visibleItems.find((i) => i.href === href))
            .filter((x): x is NavItem => x != null),
    [erConcealment, visibleItems],
  );
  const managementMenuItems = useMemo(
    () =>
      erConcealment
        ? []
        : ["/analytics", "/billing", "/dashboard", "/inventory-items", "/procurement", "/admin", "/admin/shifts", "/stability", "/print"]
            .map((href) => visibleItems.find((i) => i.href === href))
            .filter((x): x is NavItem => x != null),
    [erConcealment, visibleItems],
  );
  const operationalControlMenuItems = useMemo(
    () =>
      erConcealment
        ? []
        : ["/er"]
            .map((href) => visibleItems.find((i) => i.href === href))
            .filter((x): x is NavItem => x != null),
    [erConcealment, visibleItems],
  );
  const systemMenuItems = useMemo(
    () =>
      erConcealment
        ? []
        : ["/app-tour", "/whats-new", "/help", "/audit-log", "/admin/medication-integrity", "/admin/ops-dashboard", "/admin/code-blue-history", "/settings"]
            .map((href) => visibleItems.find((i) => i.href === href))
            .filter((x): x is NavItem => x != null),
    [erConcealment, visibleItems],
  );

  const bottomNavActive = useMemo(
    () => ({
      home: location === "/home" || location === "/" || location === "",
      erCommand:
        location === "/er" ||
        location === "/er/" ||
        (location.startsWith("/er") && !location.startsWith("/er/impact")),
      erImpact: location.startsWith("/er/impact"),
      equipment: location.startsWith("/equipment"),
      rooms: location.startsWith("/rooms"),
    }),
    [location],
  );

  const activeTabIndex = useMemo(() => {
    if (erConcealment) {
      if (menuOpen) return 2;
      if (location.startsWith("/er/impact")) return 1;
      if (location.startsWith("/er")) return 0;
      return -1;
    }
    if (menuOpen) return 4;
    if (bottomNavActive.rooms) return 3;
    if (bottomNavActive.equipment) return 1;
    if (bottomNavActive.home) return 0;
    return -1;
  }, [bottomNavActive, erConcealment, location, menuOpen]);

  const hasPending = pendingCount > 0;
  const hasFailed = failedCount > 0;

  const handleSoundToggle = async (v: boolean) => {
    if (v) {
      await playFeedbackTone();
    } else {
      await playMuteTone();
    }
    update({ soundEnabled: v });
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

  return (
    <div className="min-h-[100dvh] min-w-0 bg-ivory-bg">
      {menuMounted && (
        <div
          className="fixed inset-0 z-[39]"
          aria-hidden
          onClick={() => setMenuOpen(false)}
        />
      )}
      <header
        className={cn(
          "sticky top-safe z-40 border-b bg-ivory-navy backdrop-blur supports-[backdrop-filter]:bg-ivory-navy/95",
          navigationLocked ? "border-amber-400/60" : "border-[#0a1509]",
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
          <Link
            href={erConcealment ? "/er" : "/home"}
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
              <QrCode
                className="w-4 h-4 text-[#4cde6a] transition-transform duration-300 ease-out group-hover:rotate-[15deg]"
                aria-hidden
              />
            </div>
            <span className="text-lg font-bold tracking-tight transition-colors duration-200 text-white group-hover:text-[#4cde6a]">
              Vet<em className="text-[#4cde6a] not-italic group-hover:text-white">Track</em>
            </span>
          </Link>

          <div className="flex items-center gap-1.5">
            {!isOnline && (
              <div className="flex items-center gap-1 text-xs text-amber-300 bg-amber-900/40 border border-amber-700/50 rounded-full px-2.5 py-1">
                <WifiOff className="w-3 h-3" />
                <span>{lh.offline}</span>
              </div>
            )}

            {isOnline && isSyncing && (
              <div className="flex items-center gap-1 text-xs text-[#8ab89a] bg-white/[0.08] border border-white/10 rounded-full px-2.5 py-1">
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
                className="flex items-center gap-1 text-xs text-[#8ab89a] bg-white/[0.08] border border-white/10 rounded-full px-2.5 py-1 hover:bg-white/15 transition-colors"
                title={lh.pendingTitle(pendingCount)}
                data-testid="sync-pending-indicator"
              >
                <Clock className="w-3 h-3" />
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
                className="relative text-[#8ab89a] hover:text-white hover:bg-white/10"
                onClick={() => setSyncQueueOpen(true)}
                title={t.layout.sync.viewQueue}
                aria-label={t.layout.sync.viewQueue}
                data-testid="sync-queue-badge"
              >
                <CloudOff className="w-4 h-4" aria-hidden="true" />
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
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

            {!erConcealment && alertCount > 0 && (
              <Link href="/alerts">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative text-[#8ab89a] hover:text-white hover:bg-white/10"
                  aria-label={lh.alertAria(alertCount)}
                  data-testid="alert-bell"
                >
                  <AlertTriangle
                    className={cn(
                      "w-4 h-4 transition-colors duration-200",
                      alertCount > 5 ? "text-red-500" : "text-amber-500"
                    )}
                    aria-hidden
                  />
                  <span
                    className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-400 pointer-events-none"
                    style={{ animation: "alertPing 2s ease-out infinite" }}
                    aria-hidden
                  />
                  <span
                    key={alertCount}
                    className={cn(
                      "absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[9px]",
                      "rounded-full flex items-center justify-center font-bold z-10",
                      alertBadgeAnimating && "[animation:badgePop_420ms_cubic-bezier(0.68,-0.55,0.265,1.55)_forwards]"
                    )}
                    aria-hidden
                  >
                    {alertCount > 9 ? "9+" : alertCount}
                  </span>
                </Button>
              </Link>
            )}

            <div className="relative" ref={quickSettingsRef}>
              {!erConcealment && (
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
                className="text-[#8ab89a] hover:text-white hover:bg-white/10"
              >
                <Settings className="w-4 h-4" />
              </Button>
              )}

              {!erConcealment && qsMounted && (
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
                            settings.darkMode ? "opacity-100 rotate-0" : "opacity-0 rotate-90"
                          )}
                        />
                        <Sun
                          className={cn(
                            "w-5 h-5 absolute inset-0 transition-all duration-200",
                            settings.darkMode ? "opacity-0 -rotate-90" : "opacity-100 rotate-0"
                          )}
                        />
                      </span>
                    }
                    label={t.layout.settings.darkMode}
                    checked={settings.darkMode}
                    onCheckedChange={(v) => update({ darkMode: v })}
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

        {menuMounted && (
          <div
            className={cn(
              "border-t border-ivory-border bg-ivory-bg px-4 py-3 max-w-2xl mx-auto max-h-[75dvh] overflow-y-auto",
              "origin-top will-change-transform",
              menuVisible
                ? "[animation:menuReveal_220ms_cubic-bezier(0.16,1,0.3,1)_forwards]"
                : "opacity-0 pointer-events-none"
            )}
          >
            <nav className="vt-header-menu flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-1 pb-0.5">Operations</p>
              {operationMenuItems.map((item, index) => {
                const isActive = isNavItemActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                    className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                    style={{ animationDelay: menuVisible ? `${index * 16}ms` : "0ms" }}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                        "relative overflow-hidden",
                        isActive
                          ? "bg-ivory-greenBg text-ivory-green font-semibold pl-4 pr-3"
                          : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 pl-3 hover:pl-4 pr-3"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
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

              {erConcealment && !canManageErMode ? (
                <p className="text-xs text-ivory-text3 px-3 py-2 leading-snug border-t border-ivory-border/40 mt-1">
                  {t.layout.nav.erConcealmentStaffHint}
                </p>
              ) : null}

              {canManageErMode || operationalControlMenuItems.length > 0 ? (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-2 pb-0.5">
                    {t.layout.nav.operationalControlSection}
                  </p>
                  {canManageErMode ? (
                    <div className="px-3 pb-2">
                      <ErModeToggle />
                    </div>
                  ) : null}
                  {operationalControlMenuItems.map((item, index) => {
                    const isActive = isNavItemActive(item.href);
                    const stagger = operationMenuItems.length + index;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                        className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                        style={{ animationDelay: menuVisible ? `${stagger * 16}ms` : "0ms" }}
                      >
                        <div
                          className={cn(
                            "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                            "relative overflow-hidden",
                            isActive
                              ? "bg-ivory-greenBg text-ivory-green font-semibold pl-4 pr-3"
                              : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 pl-3 hover:pl-4 pr-3",
                          )}
                        >
                          {isActive && (
                            <span
                              className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-2 pb-0.5">Management</p>
              {managementMenuItems.map((item, index) => {
                const isActive = isNavItemActive(item.href);
                const stagger = operationMenuItems.length + operationalControlMenuItems.length + index;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                    className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                    style={{ animationDelay: menuVisible ? `${stagger * 16}ms` : "0ms" }}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                        "relative overflow-hidden",
                        isActive
                          ? "bg-ivory-greenBg text-ivory-green font-semibold pl-4 pr-3"
                          : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 pl-3 hover:pl-4 pr-3"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-text3 px-3 pt-2 pb-0.5">System</p>
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
                            ? "bg-primary/8 text-primary font-semibold pl-4 pr-3"
                            : "text-foreground hover:bg-muted/70 active:bg-muted pl-3 hover:pl-4 pr-3"
                        )}
                      >
                        {isActive && (
                          <span
                            className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
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
                    onClick={() => setMenuOpen(false)}
                    data-testid={`nav-${item.href.replace("/", "") || "home"}`}
                    className="cursor-pointer block w-full text-left opacity-0 [animation:navItemFade_160ms_ease-out_forwards]"
                    style={{ animationDelay: menuVisible ? `${stagger * 16}ms` : "0ms" }}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 py-2.5 rounded-xl transition-all duration-150 min-h-[44px] w-full",
                        "relative overflow-hidden",
                        isActive
                          ? "bg-ivory-greenBg text-ivory-green font-semibold pl-4 pr-3"
                          : "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 pl-3 hover:pl-4 pr-3"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-ivory-green pointer-events-none"
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
                  "text-ivory-text hover:bg-ivory-border/40 active:bg-ivory-border/60 pl-3 hover:pl-4 pr-3",
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
        )}
      </header>

      <main
        className={cn(
          "max-w-2xl mx-auto min-w-0 px-3.5 sm:px-4 pb-nav-safe",
          settings.density === "compact" ? "py-2.5" : "py-4"
        )}
      >
        {children}
      </main>

      <nav
        className="bottom-bar fixed bottom-0 left-0 right-0 z-50 border-t border-ivory-border bg-ivory-surface/98 backdrop-blur-md shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.12)]"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          willChange: "transform",
          WebkitTransform: "translateZ(0)",
          transform: "translateZ(0)",
        }}
        aria-label={lh.bottomMenu}
      >
        <div
          className={cn(
            "relative grid max-w-2xl mx-auto items-end min-h-[68px] px-0.5 pt-1",
            erConcealment ? "grid-cols-3" : "grid-cols-5",
          )}
        >
          {activeTabIndex >= 0 && (
            <div
              aria-hidden
              className="vt-bottom-nav-tab-pill absolute top-1 h-[3px] w-6 rounded-full bg-ivory-green pointer-events-none"
              style={{
                left: erConcealment
                  ? `calc(${activeTabIndex} * (100% / 3) + (100% / 6) - 12px)`
                  : `calc(${activeTabIndex} * 20% + 10% - 12px)`,
              }}
            />
          )}
          {erConcealment ? (
            <>
              <Link
                href="/er"
                className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
                data-testid="bottom-nav-er-command"
              >
                <Monitor
                  className={cn(
                    "w-6 h-6 transition-all duration-200",
                    bottomNavActive.erCommand ? "text-ivory-green scale-110" : "text-ivory-text3 scale-100",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-tight text-center max-w-[5rem] truncate px-0.5",
                    bottomNavActive.erCommand ? "text-ivory-green" : "text-ivory-text3",
                  )}
                >
                  {t.erCommandCenter.title}
                </span>
              </Link>

              <Link
                href="/er/impact"
                className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
                data-testid="bottom-nav-er-impact"
              >
                <Gauge
                  className={cn(
                    "w-6 h-6 transition-all duration-200",
                    bottomNavActive.erImpact ? "text-ivory-green scale-110" : "text-ivory-text3 scale-100",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-tight text-center max-w-[5rem] truncate px-0.5",
                    bottomNavActive.erImpact ? "text-ivory-green" : "text-ivory-text3",
                  )}
                >
                  {t.erCommandCenter.impactLink}
                </span>
              </Link>

              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className={cn(
                  "flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] w-full",
                  "transition-opacity duration-150 active:opacity-80 motion-reduce:active:opacity-100",
                  "rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "cursor-pointer",
                  navigationLocked && "opacity-40",
                )}
                aria-expanded={menuOpen}
                aria-label={menuOpen ? t.common.closeNavigationMenu : lh.bottomMenu}
                data-testid="bottom-nav-menu"
              >
                {menuOpen ? (
                  <X
                    className={cn("w-6 h-6 transition-all duration-200", "text-ivory-green scale-110")}
                    aria-hidden
                  />
                ) : (
                  <Menu className={cn("w-6 h-6 transition-all duration-200", "text-ivory-text3 scale-100")} aria-hidden />
                )}
                <span className={cn("text-[10px] font-semibold", menuOpen ? "text-ivory-green" : "text-ivory-text3")}>
                  {lh.bottomMenu}
                </span>
              </button>
            </>
          ) : (
            <>
              <Link
                href="/home"
                className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
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
                className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
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
                        : "bg-ivory-green text-white shadow-lg shadow-ivory-green/30 hover:bg-ivory-greenMid",
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
                    "text-[10px] font-bold leading-tight text-center transition-colors duration-200",
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

              <Link
                href="/rooms"
                className="flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] transition-opacity duration-150 active:opacity-80 motion-reduce:active:opacity-100 rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface cursor-pointer"
                data-testid="bottom-nav-rooms"
              >
                <Map
                  className={cn(
                    "w-6 h-6 transition-all duration-200",
                    bottomNavActive.rooms ? "text-ivory-green scale-110" : "text-ivory-text3 scale-100",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-tight text-center max-w-[4.5rem] truncate px-0.5",
                    bottomNavActive.rooms ? "text-ivory-green" : "text-ivory-text3",
                  )}
                >
                  {lh.bottomRooms}
                </span>
              </Link>

              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className={cn(
                  "flex flex-col items-center justify-end gap-0.5 pb-2 min-h-[52px] w-full",
                  "transition-opacity duration-150 active:opacity-80 motion-reduce:active:opacity-100",
                  "rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "cursor-pointer",
                  navigationLocked && "opacity-40",
                )}
                aria-expanded={menuOpen}
                aria-label={menuOpen ? t.common.closeNavigationMenu : lh.bottomMenu}
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

      <OnboardingWalkthrough />
    </div>
  );
}
