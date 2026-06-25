import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { EquipmentListScreen } from "@/features/equipment";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { Checkbox } from "@/components/ui/checkbox";
import { Bdi } from "@/components/ui/bdi";
import { TruncatedText } from "@/components/ui/truncated-text";
import { ForwardChevron, BackChevron } from "@/components/ui/directional-chevron";
import { useConfirm } from "@/hooks/use-confirm";
import { t } from "@/lib/i18n";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EquipmentListSkeleton } from "@/components/skeletons/equipment-list-skeleton";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageErrorBoundary } from "@/components/ui/page-error-boundary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_LABELS } from "@/types";
import type { Equipment } from "@/types";
import { equipmentTriageTier, TRIAGE_ORDER, statusToBadgeVariant, type EquipmentTriageTier } from "@/lib/design-tokens";
import {
  EquipmentStatStrip,
  EquipmentTriageList,
} from "@/components/equipment/EquipmentTriageList";
import { DeployabilityBadge } from "@/components/equipment/DeployabilityBadge";
import {
  isRfidSubtitleFresh,
  shouldShowRfidAttentionBadge,
} from "@/lib/equipment-rfid-display";
import { DockReturnFlow } from "@/components/equipment/DockReturnFlow";
import {
  Plus,
  Search,
  QrCode,
  Package,
  FolderOpen,
  CheckSquare,
  Square,
  Trash2,
  FolderInput,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Upload,
  Download,
  Loader2,
  LogIn,
  LogOut,
  AlertTriangle,
  CalendarX,
  CalendarClock,
  CalendarCheck,
  PawPrint,
  CheckCircle2,
} from "lucide-react";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatRelativeTime, getExpiryBadgeState } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useSync } from "@/hooks/use-sync";
import {
  buildLocalEntityStateByEquipmentId,
  type LocalEntityState,
} from "@/lib/local-entity-sync-state";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import { QrScanner } from "@/components/qr-scanner";
import { VirtualizedEquipmentList } from "@/components/VirtualizedEquipmentList";
import {
  getPaginatedEquipmentQueryOptions,
  usePaginatedEquipment,
} from "@/hooks/use-paginated-equipment";
import { exportEquipmentToExcel } from "@/lib/export-excel";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { haptics } from "@/lib/haptics";
import { isEquipmentRecoveryUiEnabled } from "@/lib/equipment-recovery-ui-flag";
import {
  deriveEquipmentRecoverySnapshotFromSource,
  filterEquipmentNeedingAttention,
} from "@/lib/equipment-recovery-adapter";
import {
  buildEquipmentListForDisplay,
  resolveEquipmentListRecoveryBadgeKey,
} from "@/lib/equipment-list-recovery-labels";
import { EquipmentHeroCoverageStrip } from "@/components/equipment/EquipmentHeroCoverageStrip";
import { EquipmentRoomSweepSheet } from "@/components/equipment/EquipmentRoomSweepSheet";

const VIRTUALIZATION_THRESHOLD = 100;
const SERVER_PAGE_SIZE = 100;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: t.status.all },
  { value: "ok", label: t.status.ok },
  { value: "issue", label: t.status.issue },
  { value: "maintenance", label: t.status.maintenance },
  { value: "sterilized", label: t.status.sterilized },
];

// 9 cards per page — DOM never holds more than 9 <div>s regardless of dataset size.
const PAGE_SIZE = 9;


export default function EquipmentListPage() {
  const inMobileShell = useMobileShellContext();
  return inMobileShell ? <EquipmentListScreen /> : <EquipmentListPageDesktop />;
}

function EquipmentListPageDesktop() {
  const confirm = useConfirm();
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const { userId, isAdmin, effectiveRole } = useAuth();
  const canRoomSweep = effectiveRole !== "student";
  const { items: syncQueueItems } = useSync();
  const localSyncByEquipmentId = useMemo(
    () => buildLocalEntityStateByEquipmentId(syncQueueItems),
    [syncQueueItems],
  );
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [folderSheetOpen, setFolderSheetOpen] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");
  const [page, setPage] = useState(1);
  const [recoveryAttentionFilterActive, setRecoveryAttentionFilterActive] = useState(false);
  const [roomSweepOpen, setRoomSweepOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const params = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const openScanFromUrl = params.get("scan") === "1";
  const search = params.get("q") ?? "";
  const statusFilter = params.get("status") ?? "all";
  const folderFilter = params.get("folder") ?? "all";
  const locationFilter = params.get("location") ?? "all";

  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchStrRef = useRef(searchStr);
  searchStrRef.current = searchStr;

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (openScanFromUrl) {
      setIsScannerOpen(true);
      const next = new URLSearchParams(searchStrRef.current);
      next.delete("scan");
      const qs = next.toString();
      navigate(qs ? `/equipment?${qs}` : "/equipment", { replace: true });
    }
  }, [openScanFromUrl, navigate]);

  function handleSearchInputChange(val: string) {
    setSearchInput(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      const next = new URLSearchParams(searchStrRef.current);
      if (val === "") {
        next.delete("q");
      } else {
        next.set("q", val);
      }
      const qs = next.toString();
      navigate(qs ? `/equipment?${qs}` : "/equipment", { replace: true });
      setSelected(new Set());
      setSelectMode(false);
      setPage(1);
    }, 250);
  }

  function updateParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchStr);
    for (const [k, v] of Object.entries(updates)) {
      if (v === "" || v === "all") {
        next.delete(k);
      } else {
        next.set(k, v);
      }
    }
    const qs = next.toString();
    navigate(qs ? `/equipment?${qs}` : "/equipment", { replace: true });
    setSelected(new Set());
    setSelectMode(false);
    setPage(1);
  }

  function setStatusFilter(val: string) { updateParams({ status: val }); }
  function setFolderFilter(val: string) { updateParams({ folder: val }); }
  function setLocationFilter(val: string) { updateParams({ location: val }); }

  // Server-side pagination: fetches one page at a time via usePaginatedEquipment (pageSize = SERVER_PAGE_SIZE, 100).
  // Client-side filters (q, status, folder, location) apply to loaded pages; list virtualizes when row count exceeds VIRTUALIZATION_THRESHOLD.
  const {
    data: equipmentPage,
    isLoading: isQueryLoading,
    isFetching,
    isError,
  } = usePaginatedEquipment({
    page: 1,
    pageSize: SERVER_PAGE_SIZE,
    enabled: !!userId,
    q: search,
    status: statusFilter,
    folder: folderFilter,
    location: locationFilter,
  });

  const equipment = equipmentPage?.items ?? [];
  const totalCount = equipmentPage?.total ?? 0;

  /** Clears paginated equipment cache, resets local UI state, and runs a fresh fetch (used by ErrorCard retry). */
  const refetchAll = useCallback(async () => {
    setSelected(new Set());
    setSelectMode(false);
    setPage(1);

    queryClient.removeQueries({ queryKey: ["/api/equipment", "paginated"] });

    const { queryKey, queryFn } = getPaginatedEquipmentQueryOptions({
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
      q: search,
      status: statusFilter,
      folder: folderFilter,
      location: locationFilter,
    });

    return queryClient.fetchQuery({ queryKey, queryFn });
  }, [
    queryClient,
    search,
    statusFilter,
    folderFilter,
    locationFilter,
  ]);

  // Block the list while initial load runs or while retrying after an error.
  // Avoid treating unrelated background refetches (when data already loaded) as full-page blocking load.
  const isLoading = isQueryLoading || (isFetching && isError);

  const { data: folders } = useQuery({
    queryKey: ["/api/folders"],
    queryFn: api.folders.list,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => api.equipment.bulkDelete({ ids }),
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setSelected(new Set());
      setSelectMode(false);
      setPage(1);
      toast.success(`Deleted ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error(t.equipmentList.toast.deleteError),
  });

  const bulkMoveMut = useMutation({
    mutationFn: ({ ids, folderId }: { ids: string[]; folderId: string | null }) =>
      api.equipment.bulkMove({ ids, folderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setSelected(new Set());
      setSelectMode(false);
      toast.success(t.equipmentList.toast.moveSuccess);
    },
    onError: () => toast.error(t.equipmentList.toast.moveError),
  });

  const locations = useMemo(() => {
    if (!equipment) return [];
    const locs: Set<string> = new Set();
    for (const eq of equipment) {
      if (eq.location) locs.add(eq.location);
      if (eq.checkedOutLocation) locs.add(eq.checkedOutLocation);
    }
    return Array.from(locs).sort();
  }, [equipment]);

  // Full filtered set (no DOM nodes yet — pure array computation)
  const filtered = useMemo(() => {
    if (!equipment) return [];
    return equipment.filter((eq) => {
      const matchesSearch =
        !search ||
        eq.name.toLowerCase().includes(search.toLowerCase()) ||
        eq.nameHe?.toLowerCase().includes(search.toLowerCase()) ||
        eq.serialNumber?.toLowerCase().includes(search.toLowerCase()) ||
        eq.model?.toLowerCase().includes(search.toLowerCase()) ||
        eq.location?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || eq.status === statusFilter;
      const matchesFolder =
        folderFilter === "all" ||
        (folderFilter === "unfiled" ? !eq.folderId : eq.folderId === folderFilter) ||
        folderFilter === eq.folderId;
      const matchesLocation =
        locationFilter === "all" ||
        eq.location === locationFilter ||
        eq.checkedOutLocation === locationFilter;
      return matchesSearch && matchesStatus && matchesFolder && matchesLocation;
    });
  }, [equipment, search, statusFilter, folderFilter, locationFilter]);

  const listForDisplay = useMemo(
    () =>
      buildEquipmentListForDisplay(filtered, {
        flag: isEquipmentRecoveryUiEnabled,
        attentionOnly: recoveryAttentionFilterActive,
      }),
    [filtered, recoveryAttentionFilterActive],
  );

  const recoveryAttentionCount = useMemo(() => {
    if (!isEquipmentRecoveryUiEnabled || filtered.length === 0) return 0;
    return filterEquipmentNeedingAttention(filtered).length;
  }, [filtered]);

  const displayList = isEquipmentRecoveryUiEnabled ? listForDisplay : filtered;

  // Virtualization is active when filtered results exceed threshold and select mode is off.
  const isVirtualized = displayList.length > VIRTUALIZATION_THRESHOLD && !selectMode;
  /** Matches compact vs comfortable list card padding (8px less vertical when compact). */
  const virtualizedItemHeight = settings.density === "compact" ? 104 : 112;

  // Stable pagination guards — out-of-bound pages are impossible.
  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);

  // Exactly PAGE_SIZE nodes rendered — DOM size is bounded regardless of dataset.
  const pageItems = useMemo(
    () => displayList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [displayList, safePage],
  );

  const triageCounts = useMemo(() => {
    let attention = 0;
    let inUse = 0;
    for (const eq of displayList) {
      const tier = equipmentTriageTier(eq);
      if (tier === "attention") attention += 1;
      else if (tier === "in_use") inUse += 1;
    }
    return { total: displayList.length, attention, inUse };
  }, [displayList]);

  const useMobileTriage = !selectMode && !isVirtualized && pageItems.length > 0;

  // Reset to page 1 when totalPages changes (filter changed to fewer results).
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === displayList.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(displayList.map((e) => e.id)));
    }
  };

  const renderVirtualizedRow = useCallback(
    (eq: Equipment) => (
      <div className="pb-3">
        <EquipmentItem
          equipment={eq}
          selectMode={false}
          selected={false}
          onToggleSelect={() => {}}
          virtualized
          localSyncState={localSyncByEquipmentId.get(eq.id) ?? "synced"}
        />
      </div>
    ),
    [localSyncByEquipmentId],
  );

  const manualFolders = folders?.filter((f) => f.type !== "smart") || [];

  const pageBody = (
    <>
      <Helmet>
        <title>Equipment — VetTrack</title>
        <meta name="description" content="Browse, search, and manage all veterinary equipment. Filter by status or folder, bulk-move items, and scan QR codes to quickly locate any asset." />
        <link rel="canonical" href="https://vettrack.replit.app/equipment" />
      </Helmet>
      <div className="flex flex-col gap-4 pb-24 animate-fade-in">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="vt-page-title whitespace-nowrap">{t.equipment.title}</h1>
            <p className="vt-text-xs text-muted-foreground mt-0.5 truncate">{t.equipmentTruth.heroTagline}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="default"
              className="hidden md:inline-flex h-11 text-xs"
              onClick={() => setIsScannerOpen(true)}
              data-testid="btn-scan-qr"
            >
              <QrCode className="w-4 h-4 me-1" />
              {t.equipmentTruth.scanFabLabel}
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="hidden md:inline-flex h-11 text-xs"
                onClick={() => setImportOpen(true)}
                data-testid="btn-import-csv"
              >
                <Upload className="w-4 h-4 me-1" />
                {t.equipment.importCsv}
              </Button>
            )}
            {isAdmin && filtered.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="hidden md:inline-flex h-11 text-xs"
                disabled={isExporting}
                onClick={async () => {
                  if (isExporting) return;
                  setIsExporting(true);
                  try {
                    await exportEquipmentToExcel(
                      filtered,
                      `equipment-${new Date().toISOString().slice(0, 10)}.xlsx`,
                    );
                  } catch (err) {
                    console.error("exportEquipmentToExcel failed", err);
                    toast.error(t.equipmentList.toast.exportError);
                  } finally {
                    setIsExporting(false);
                  }
                }}
                data-testid="btn-export-excel"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 me-1 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 me-1" />
                )}
                {t.equipmentList.actions.exportExcel}
              </Button>
            )}
            <Link href="/equipment/new">
              <Button size="sm" className="h-11 text-xs" data-testid="btn-add">
                <Plus className="w-4 h-4 me-1" />
                {t.home.addEquipment}
              </Button>
            </Link>
          </div>
        </div>

        <EquipmentHeroCoverageStrip
          recoveryAttentionCount={
            isEquipmentRecoveryUiEnabled ? recoveryAttentionCount : 0
          }
          recoveryFilterActive={recoveryAttentionFilterActive}
          onFilterNeedsAttention={() => {
            setRecoveryAttentionFilterActive((prev) => !prev);
            setPage(1);
          }}
          onOpenRoomSweep={() => setRoomSweepOpen(true)}
          showRoomSweep={canRoomSweep}
        />

        {/* Search + filters */}
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute start-3.5 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              id="equipment-search"
              name="equipment-search"
              type="search"
              autoComplete="off"
              aria-label={t.equipmentList.search.placeholder}
              placeholder={t.equipmentList.search.placeholder}
              className="ps-10"
              value={searchInput}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              data-testid="search-input"
            />
          </div>
          {/* Status chip filters */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" data-testid="status-filter-chips">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`shrink-0 flex items-center px-3 min-h-[44px] rounded-full vt-text-xs font-medium border transition-colors whitespace-nowrap ${
                  statusFilter === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
                data-testid={`status-chip-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
            {isEquipmentRecoveryUiEnabled && (
              <button
                type="button"
                onClick={() => {
                  setRecoveryAttentionFilterActive((prev) => !prev);
                  setPage(1);
                }}
                className={`shrink-0 flex items-center px-3 min-h-[44px] rounded-full vt-text-xs font-medium border transition-colors whitespace-nowrap ${
                  recoveryAttentionFilterActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
                data-testid="recovery-attention-filter"
              >
                {t.equipmentList.recoveryAttentionFilter}
              </button>
            )}
          </div>
          {/* Folder filter trigger */}
          <button
            onClick={() => setFolderSheetOpen(true)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm text-start transition-colors ${
              folderFilter !== "all"
                ? "border-primary bg-primary/5 text-primary"
                : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
            data-testid="folder-filter"
          >
            <FolderOpen className="w-4 h-4 shrink-0" />
            <span className="flex-1 truncate">
              {folderFilter === "all"
                ? t.equipmentList.folders.all
                : folderFilter === "unfiled"
                ? t.equipmentList.folders.unfiled
                : (folders?.find((f) => f.id === folderFilter)?.name ?? t.equipmentList.folders.unfiled)}
            </span>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 rotate-90" />
          </button>
          <Sheet open={folderSheetOpen} onOpenChange={(o) => { setFolderSheetOpen(o); if (!o) setFolderSearch(""); }}>
            <SheetContent side="bottom" className="max-h-[75dvh] flex flex-col p-0">
              <SheetHeader className="px-4 pt-5 pb-3 border-b">
                <SheetTitle>{t.equipmentList.folders.filterByFolder}</SheetTitle>
              </SheetHeader>
              <div className="px-4 py-3 border-b">
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t.equipmentList.folders.searchPlaceholder}
                    value={folderSearch}
                    onChange={(e) => setFolderSearch(e.target.value)}
                    className="ps-9"
                    data-testid="folder-search"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {[
                  { id: "all", name: t.equipmentList.folders.all },
                  { id: "unfiled", name: t.equipmentList.folders.unfiled },
                  ...(folders ?? []),
                ]
                  .filter(
                    (f) =>
                      !folderSearch ||
                      f.name.toLowerCase().includes(folderSearch.toLowerCase())
                  )
                  .map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setFolderFilter(f.id);
                        setFolderSheetOpen(false);
                        setFolderSearch("");
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-sm text-start border-b border-border/50 transition-colors ${
                        folderFilter === f.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-accent"
                      }`}
                      data-testid={`folder-option-${f.id}`}
                    >
                      <FolderOpen className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{f.name}</span>
                      {folderFilter === f.id && (
                        <CheckSquare className="w-4 h-4 shrink-0" />
                      )}
                    </button>
                  ))}
              </div>
              <div
                className="p-4 border-t"
                style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
              >
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setFolderSheetOpen(false)}
                >
                  Done
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          {/* Location filter chips */}
          {locations.length > 0 && (
            <div className="relative">
            <div
              className="flex gap-2 overflow-x-auto pb-1 scrollbar-none"
              data-testid="location-filter-chips"
            >
              <button
                onClick={() => setLocationFilter("all")}
                className={`shrink-0 flex items-center gap-1 px-3 min-h-[44px] rounded-full vt-text-xs font-medium border transition-colors ${
                  locationFilter === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
                data-testid="location-chip-all"
              >
                <MapPin className="w-3 h-3" />
                All Rooms
              </button>
              {locations.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setLocationFilter(loc)}
                  className={`shrink-0 flex items-center px-3 min-h-[44px] rounded-full vt-text-xs font-medium border transition-colors whitespace-nowrap ${
                    locationFilter === loc
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  }`}
                  data-testid={`location-chip-${loc}`}
                >
                  {loc}
                </button>
              ))}
            </div>
            {/* Fade gradient indicating more chips to scroll */}
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent" />
            </div>
          )}
        </div>

        {/* Bulk actions bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectMode(!selectMode);
              if (selectMode) setSelected(new Set());
            }}
            className="text-xs h-11"
            data-testid="btn-select-mode"
          >
            {selectMode ? (
              <Square className="w-4 h-4 me-1" />
            ) : (
              <CheckSquare className="w-4 h-4 me-1" />
            )}
            {selectMode ? t.equipmentList.actions.cancel : t.equipmentList.actions.select}
          </Button>

          {selectMode && (
            <>
              <Checkbox
                checked={displayList.length > 0 && selected.size === displayList.length}
                indeterminate={selected.size > 0 && selected.size < displayList.length}
                onCheckedChange={toggleAll}
                aria-label={
                  selected.size === displayList.length
                    ? t.equipmentList.selection.deselectAll
                    : t.equipmentList.selection.selectAll
                }
                data-testid="checkbox-select-all"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                className="text-xs h-11"
              >
                {selected.size === displayList.length
                  ? t.equipmentList.selection.deselectAll
                  : t.equipmentList.selection.selectAll}
              </Button>
              <span className="vt-text-xs text-muted-foreground">
                {t.equipmentList.selection.selectedCount(selected.size)}
              </span>
            </>
          )}

          {selectMode && selected.size > 0 && (
            <div className="flex gap-2 ms-auto w-full sm:w-auto">
                <Select
                  onValueChange={(folderId) => {
                    if (bulkMoveMut.isPending || bulkDeleteMut.isPending) return;
                    bulkMoveMut.mutate({
                      ids: Array.from(selected),
                      folderId: folderId === "none" ? null : folderId,
                    });
                  }}
                  disabled={bulkMoveMut.isPending || bulkDeleteMut.isPending}
                >
                  <SelectTrigger className="h-11 text-xs" disabled={bulkMoveMut.isPending || bulkDeleteMut.isPending}>
                    {bulkMoveMut.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 me-1 animate-spin" />
                    ) : (
                      <FolderInput className="w-3.5 h-3.5 me-1" />
                    )}
                    {bulkMoveMut.isPending ? t.equipmentList.actions.working : t.equipmentList.actions.move}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.equipmentList.folders.unfiled}</SelectItem>
                    {manualFolders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isAdmin && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-11 text-xs"
                    disabled={bulkDeleteMut.isPending || bulkMoveMut.isPending}
                    data-testid="btn-bulk-delete"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: t.equipmentList.bulkDelete.title(selected.size),
                          description: t.equipmentList.bulkDelete.description,
                          confirmLabel: t.equipmentList.bulkDelete.confirm,
                          destructive: true,
                        }))
                      ) {
                        return;
                      }
                      bulkDeleteMut.mutate(Array.from(selected));
                    }}
                  >
                    {bulkDeleteMut.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 me-1 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 me-1" />
                    )}
                    {bulkDeleteMut.isPending ? t.equipmentList.actions.working : t.equipmentList.actions.delete}
                  </Button>
                )}
              </div>
          )}
        </div>

        {/* Count + page info */}
        <p className="vt-text-xs text-muted-foreground -mt-2">
          {t.equipmentList.paginationCount(displayList.length, totalCount || equipment.length)}
          {!isLoading && !isVirtualized && totalPages > 1 && (
            <span className="ms-1">· {t.equipmentList.paginationPage(safePage, totalPages)}</span>
          )}
          {locationFilter !== "all" && (
            <span className="ms-1">· <button onClick={() => setLocationFilter("all")} className="underline">{t.equipmentList.clearRoomFilter}</button></span>
          )}
        </p>

        {/* Error state */}
        {isError && (
          <ErrorCard
            message={t.equipmentList.errors.loadFailed}
            onRetry={() => refetchAll()}
          />
        )}

        {/* Equipment list — uses virtualization for large datasets (>100 items) */}
        <PageErrorBoundary fallbackLabel={t.equipmentList.errors.renderFailed}>
          {isLoading ? (
            <EquipmentListSkeleton count={PAGE_SIZE} />
          ) : !isError && displayList.length === 0 ? (
            <EmptyState
              icon={Package}
              message={t.equipmentList.empty.message}
              subMessage={
                search ||
                statusFilter !== "all" ||
                folderFilter !== "all" ||
                locationFilter !== "all" ||
                recoveryAttentionFilterActive
                  ? t.equipmentList.empty.filteredHint
                  : t.equipmentList.empty.emptyHint
              }
              action={
                search ||
                statusFilter !== "all" ||
                folderFilter !== "all" ||
                locationFilter !== "all" ||
                recoveryAttentionFilterActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 text-xs"
                    onClick={() => navigate("/equipment", { replace: true })}
                  >
                    Clear all filters
                  </Button>
                ) : (
                  <Link href="/equipment/new">
                    <Button size="sm" className="h-11 text-xs">
                      <Plus className="w-4 h-4 me-1" />
                      Add Equipment
                    </Button>
                  </Link>
                )
              }
            />
          ) : displayList.length > VIRTUALIZATION_THRESHOLD && !selectMode ? (
            <div data-testid="equipment-list">
              {/*
                Row height 112 (comfortable) or 104 (compact): card padding p-4 vs p-3
                from settings.density, plus ~80px content. minHeight: 72 in the card
                keeps the row stable. pb-3 on the virtualized row wrapper is in the item height.
              */}
              <VirtualizedEquipmentList
                items={displayList}
                height={600}
                itemHeight={virtualizedItemHeight}
                renderItem={renderVirtualizedRow}
              />
            </div>
          ) : useMobileTriage ? (
            <div className="md:hidden space-y-3" data-testid="equipment-list-triage">
              <EquipmentStatStrip
                total={triageCounts.total}
                attention={triageCounts.attention}
                inUse={triageCounts.inUse}
              />
              <EquipmentTriageList items={pageItems} />
            </div>
          ) : null}
          {!isVirtualized && pageItems.length > 0 && (
            <div
              className={cn(
                "flex flex-col gap-3",
                useMobileTriage && "hidden md:flex",
              )}
              data-testid="equipment-list"
            >
              {(["attention", "in_use", "operational"] as EquipmentTriageTier[])
                .sort((a, b) => TRIAGE_ORDER[a] - TRIAGE_ORDER[b])
                .flatMap((tier) => {
                  const group = pageItems.filter(
                    (eq) => equipmentTriageTier(eq) === tier,
                  );
                  if (!group.length) return [];
                  const tierLabels: Record<EquipmentTriageTier, string> = {
                    attention: t.equipmentList.triageAttention,
                    in_use: t.equipmentList.triageInUse,
                    operational: t.equipmentList.triageOperational,
                  };
                  return [
                    <p
                      key={`tier-hd-${tier}`}
                      className="vt-text-2xs font-bold uppercase tracking-[0.18em] text-ivory-text3 pt-1 first:pt-0"
                    >
                      {tierLabels[tier]}
                    </p>,
                    ...group.map((eq) => (
                      <EquipmentItem
                        key={eq.id}
                        equipment={eq}
                        selectMode={selectMode}
                        selected={selected.has(eq.id)}
                        onToggleSelect={() => toggleSelect(eq.id)}
                        localSyncState={localSyncByEquipmentId.get(eq.id) ?? "synced"}
                      />
                    )),
                  ];
                })}
            </div>
          )}
        </PageErrorBoundary>

        {/* Pagination controls — only shown when not virtualized and there are multiple pages */}
        {!isLoading && !isError && !isVirtualized && totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-11 text-xs gap-1"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="btn-prev-page"
            >
              <BackChevron className="w-4 h-4" />
              {t.equipmentList.paginationPrevious}
            </Button>
            <span className="vt-text-sm text-muted-foreground">
              {t.equipmentList.paginationPage(safePage, totalPages)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-11 text-xs gap-1"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              data-testid="btn-next-page"
            >
              {t.equipmentList.paginationNext}
              <ForwardChevron className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {isScannerOpen && (
        <QrScanner onClose={() => setIsScannerOpen(false)} />
      )}

      <EquipmentRoomSweepSheet open={roomSweepOpen} onOpenChange={setRoomSweepOpen} />
    </>
  );

  return <AppShell>{pageBody}</AppShell>;
}

function EquipmentItem({
  equipment: eq,
  selectMode,
  selected,
  onToggleSelect,
  virtualized = false,
  localSyncState = "synced",
}: {
  equipment: Equipment;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  virtualized?: boolean;
  localSyncState?: LocalEntityState;
}) {
  const { settings } = useSettings();
  const { userId, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [dockReturnOpen, setDockReturnOpen] = useState(false);
  const statusVariant = statusToBadgeVariant(eq.status);
  const listCardContentPad = settings.density === "compact" ? "p-3" : "p-4";
  const isCheckedOut = !!eq.checkedOutById;
  const checkedOutByMe = eq.checkedOutById === userId;
  const expiryState = getExpiryBadgeState(eq.expiryDate);
  const displayName = getEquipmentDisplayName(eq);
  const recoveryBadgeKey = isEquipmentRecoveryUiEnabled
    ? resolveEquipmentListRecoveryBadgeKey(
        deriveEquipmentRecoverySnapshotFromSource(eq),
      )
    : null;

  const checkoutMut = useMutation({
    mutationFn: () => api.equipment.checkout(eq.id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/equipment"] });
      queryClient.setQueriesData(
        { queryKey: ["/api/equipment"] },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          if ("items" in (old as object)) {
            const page = old as { items: Equipment[]; total: number };
            return {
              ...page,
              items: page.items.map((item) =>
                item.id === eq.id ? { ...item, checkedOutById: "optimistic" } : item
              ),
            };
          }
          if (Array.isArray(old)) {
            return (old as Equipment[]).map((item) =>
              item.id === eq.id ? { ...item, checkedOutById: "optimistic" } : item
            );
          }
          return old;
        }
      );
    },
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast.success(`Checked out — ${displayName}`);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.error(t.equipmentList.toast.checkoutError);
    },
  });

  const returnMut = useMutation({
    mutationFn: (payload: { isPluggedIn: boolean; plugInDeadlineMinutes?: number }) =>
      api.equipment.return(eq.id, payload),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/equipment"] });
      queryClient.setQueriesData(
        { queryKey: ["/api/equipment"] },
        (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          if ("items" in (old as object)) {
            const page = old as { items: Equipment[]; total: number };
            return {
              ...page,
              items: page.items.map((item) =>
                item.id === eq.id ? { ...item, checkedOutById: null, checkedOutByEmail: null } : item
              ),
            };
          }
          if (Array.isArray(old)) {
            return (old as Equipment[]).map((item) =>
              item.id === eq.id ? { ...item, checkedOutById: null, checkedOutByEmail: null } : item
            );
          }
          return old;
        }
      );
    },
    onSuccess: () => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast.success(t.equipmentList.toast.returnSuccess(displayName));
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.error(t.equipmentList.toast.returnError);
    },
  });

  const quickAction = eq.custodyState === "returned" && eq.status === "ok"
    ? { label: t.dockReturn.submit, icon: LogIn, action: () => setDockReturnOpen(true), pending: false, className: "text-blue-700 border-blue-200 hover:bg-blue-50" }
    : !isCheckedOut && eq.status === "ok"
    ? { label: t.equipmentList.quickAction.checkout, icon: LogIn, action: () => checkoutMut.mutate(), pending: checkoutMut.isPending, className: "text-emerald-700 border-emerald-200 hover:bg-emerald-50" }
    : (isCheckedOut && (checkedOutByMe || isAdmin)) && eq.status === "ok"
    ? { label: t.equipmentList.quickAction.return, icon: LogOut, action: () => setReturnDialogOpen(true), pending: returnMut.isPending, className: "text-primary border-primary/30 hover:bg-primary/10" }
    : eq.status === "issue"
    ? { label: t.equipmentList.quickAction.viewIssue, icon: AlertTriangle, action: null, href: `/equipment/${eq.id}`, pending: false, className: "text-red-600 border-red-200 hover:bg-red-50" }
    : null;

  return (
    <>
    <div
      className={`flex items-center gap-2 ${selectMode ? "cursor-pointer" : ""}`}
      role={selectMode ? "checkbox" : undefined}
      aria-checked={selectMode ? selected : undefined}
      aria-label={selectMode ? t.equipmentList.selection.itemAriaLabel(displayName, selected) : undefined}
      tabIndex={selectMode ? 0 : undefined}
      onKeyDown={
        selectMode
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleSelect();
              }
            }
          : undefined
      }
      onClick={selectMode ? onToggleSelect : undefined}
    >
      {selectMode && (
        <Checkbox
          checked={selected}
          readOnly
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <Link href={`/equipment/${eq.id}`} onClick={(e) => selectMode && e.preventDefault()}>
          <Card
            className={`bg-card border-border/60 shadow-sm transition-all hover:shadow-md active:scale-[0.99] ${selected ? "bg-primary/5 ring-2 ring-primary/30" : ""}`}
            data-testid={`equipment-item-${eq.id}`}
          >
            {/*
              aspectRatio "5/4" — card always reserves its space before data arrives.
              minHeight 72 — floor so tiny-content cards stay tap-friendly.
              flexShrink 0 on all trailing elements prevents sibling shift during load.
            */}
            <CardContent
              className={cn(listCardContentPad, "flex items-center gap-3 min-h-[72px]")}
            >
              {/* Icon / Image — explicit w/h + loading=lazy prevents CLS */}
              {eq.imageUrl ? (
                <img
                  src={eq.imageUrl}
                  alt={displayName}
                  width={40}
                  height={40}
                  loading="lazy"
                  decoding="async"
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                  style={{ aspectRatio: "1 / 1" }}
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0"
                  style={{ aspectRatio: "1 / 1" }}
                >
                  <Package className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              {/* Main info */}
              <div className="flex-1 min-w-0">
                <Bdi>
                  <TruncatedText
                    text={displayName}
                    className="vt-text-lg font-bold leading-snug"
                    as="p"
                  />
                </Bdi>
                {(localSyncState === "pending_sync" || localSyncState === "conflict") && (
                  <p
                    className={cn(
                      "text-xs font-medium mt-0.5",
                      localSyncState === "conflict" ? "text-orange-700" : "text-amber-700",
                    )}
                    data-testid={`equipment-list-sync-hint-${eq.id}`}
                  >
                    {localSyncState === "pending_sync"
                      ? t.equipmentDetail.localStatePendingSync
                      : t.equipmentDetail.localStateConflict}
                  </p>
                )}
                {eq.linkedAnimalName && (
                  <p className="flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300 mt-0.5">
                    <PawPrint className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    {t.equipmentList.linkedInUse(eq.linkedAnimalName)}
                  </p>
                )}
                {isRfidSubtitleFresh(eq.lastRfidSeenAt) && eq.lastRfidRoomName && (
                  <p
                    className="text-xs text-muted-foreground mt-0.5"
                    data-testid={`equipment-rfid-last-seen-${eq.id}`}
                  >
                    {t.equipment.rfidLastSeen.line(
                      eq.lastRfidRoomName,
                      formatRelativeTime(eq.lastRfidSeenAt!),
                    )}
                  </p>
                )}
                {shouldShowRfidAttentionBadge(eq) && (
                  <button
                    type="button"
                    className="mt-1 vt-text-2xs font-medium border border-amber-300 text-amber-900 dark:text-amber-200 rounded px-2 py-0.5"
                    data-testid={`equipment-rfid-attention-${eq.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/equipment/${eq.id}`);
                    }}
                  >
                    {t.dockReturn.confirmAtDockCta}
                  </button>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {eq.folderName && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <FolderOpen className="w-3 h-3" />
                      <TruncatedText text={eq.folderName} className="text-xs max-w-[80px]" />
                    </span>
                  )}
                  {eq.location && !eq.folderName && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground max-w-[100px] min-w-0">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <TruncatedText text={eq.location} className="text-xs" />
                    </span>
                  )}
                  <span className="vt-text-xs text-muted-foreground">
                    <Bdi>{formatRelativeTime(eq.lastSeen?.toString())}</Bdi>
                  </span>
                  {expiryState === "expired" && (
                    <Badge variant="issue" className="px-2 py-0.5 vt-text-2xs font-medium">
                      <CalendarX className="w-3 h-3" />
                      {t.equipmentDetail.expiryExpired}
                    </Badge>
                  )}
                  {expiryState === "expiring_soon" && (
                    <Badge variant="maintenance" className="px-2 py-0.5 vt-text-2xs font-medium">
                      <CalendarClock className="w-3 h-3" />
                      {t.equipmentDetail.expirySoon}
                    </Badge>
                  )}
                  {expiryState === "healthy" && (
                    <Badge variant="ok" className="px-2 py-0.5 vt-text-2xs font-medium">
                      <CalendarCheck className="w-3 h-3" />
                      {t.equipmentDetail.expiryValid}
                    </Badge>
                  )}
                  {eq.custodyState != null && (
                    <DeployabilityBadge
                      custodyState={eq.custodyState}
                      readinessState={eq.readinessState}
                      usageState={eq.usageState}
                      fullDeployable={eq.custodyState === "docked" && eq.readinessState === "ready" && eq.usageState === "available"}
                      compact
                    />
                  )}
                  {recoveryBadgeKey && (
                    <Badge
                      variant="outline"
                      className="shrink-0 vt-text-2xs px-2 py-0.5"
                      data-testid={`equipment-list-recovery-badge-${eq.id}`}
                    >
                      {t.equipmentList[recoveryBadgeKey]}
                    </Badge>
                  )}
                </div>
              </div>
              {/* Trailing: compact in-card quick action or status badge + chevron.
                  flexShrink:0 + minWidth prevent these from collapsing during load. */}
              <div
                className="flex items-center gap-1.5"
                style={{ flexShrink: 0, minWidth: 0 }}
              >
                {!selectMode && quickAction ? (
                  quickAction.action ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); quickAction.action!(); }}
                      disabled={quickAction.pending}
                      className={`flex items-center gap-1.5 px-3 rounded-lg border text-xs font-semibold min-h-[44px] transition-colors ${quickAction.className}`}
                      style={{ flexShrink: 0 }}
                      data-testid={`quick-action-${eq.id}`}
                    >
                      {quickAction.pending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <quickAction.icon className="w-3.5 h-3.5" />
                      )}
                      <span>{quickAction.label}</span>
                    </button>
                  ) : (
                    <Link href={quickAction.href!} onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`flex items-center gap-1.5 px-3 rounded-lg border text-xs font-semibold min-h-[44px] transition-colors ${quickAction.className}`}
                        style={{ flexShrink: 0 }}
                        data-testid={`quick-action-${eq.id}`}
                      >
                        <quickAction.icon className="w-3.5 h-3.5" />
                        <span>{quickAction.label}</span>
                      </button>
                    </Link>
                  )
                ) : (
                  <>
                    <Badge
                      variant={statusVariant}
                      className="font-semibold"
                      style={{ flexShrink: 0 }}
                    >
                      {STATUS_LABELS[eq.status as keyof typeof STATUS_LABELS] || eq.status}
                    </Badge>
                    {!selectMode && (
                      <ForwardChevron className="w-4 h-4 text-muted-foreground" style={{ flexShrink: 0 }} />
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
    <ReturnPlugDialog
      open={returnDialogOpen}
      onOpenChange={setReturnDialogOpen}
      defaultDeadlineMinutes={30}
      onConfirm={(payload) =>
        returnMut.mutate(payload, {
          onSettled: () => setReturnDialogOpen(false),
        })
      }
    />
    <DockReturnFlow
      equipment={eq}
      open={dockReturnOpen}
      onClose={() => setDockReturnOpen(false)}
      onSuccess={() => {
        queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      }}
    />
    </>
  );
}
