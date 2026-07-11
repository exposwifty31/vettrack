import { t } from "@/lib/i18n";
import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { EquipmentDetailScreen } from "@/features/equipment";
import { formatBundleGateReason } from "@/lib/equipment-truth-display";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { Bdi } from "@/components/ui/bdi";
import { useConfirm } from "@/hooks/use-confirm";
// TODO(arch): God-file split — see docs/architecture/equipment-god-files-split-plan.md (item 9 handoff; no implementation here).
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EquipmentDetailSkeleton } from "@/components/skeletons/equipment-detail-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { STATUS_LABELS } from "@/types";
import type { EquipmentStatus, Equipment } from "@/types";
import { equipmentStatusLabel } from "@/lib/equipment-status-label";
import { BackChevron } from "@/components/ui/directional-chevron";
import {
  ArrowLeft,
  Scan,
  ClipboardEdit,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Droplets,
  MapPin,
  FolderOpen,
  Loader2,
  LogIn,
  LogOut,
  User,
  Camera,
  Copy,
  MoveHorizontal,
  MoreHorizontal,
} from "lucide-react";
import {
  cn,
  formatRelativeTime,
  buildWhatsAppUrl,
  isOverdue,
  isSterilizationDue,
} from "@/lib/utils";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { toast } from "sonner";
import { toastSuccess } from "@/lib/ui-toast";
import { useAuth } from "@/hooks/use-auth";
import { useExperience } from "@/hooks/use-experience";
import { useActiveShift } from "@/hooks/use-active-shift";
import { usePendingSyncForEquipment, useSyncQueue } from "@/hooks/use-sync";
import { MoveRoomSheet } from "@/components/move-room-sheet";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { EquipmentTruthCard } from "@/components/equipment/EquipmentTruthCard";
import { AssetCopilotPanel } from "@/components/equipment/AssetCopilotPanel";
import { EquipmentDetailStatusStrip } from "@/components/equipment/EquipmentDetailStatusStrip";
import { EquipmentDetailToolsSheet } from "@/components/equipment/EquipmentDetailToolsSheet";
import { EquipmentDetailActivityTab } from "@/components/equipment/EquipmentDetailActivityTab";
import { EquipmentDetailScanLogTab } from "@/components/equipment/EquipmentDetailScanLogTab";
import { EquipmentDetailDetailsTab } from "@/components/equipment/EquipmentDetailDetailsTab";
import { DockReturnFlow } from "@/components/equipment/DockReturnFlow";
import { DockReturnNfc } from "@/components/dock-return-nfc";
import {
  markNfcToggleFired,
  runEquipmentQuickToggle,
  wasNfcToggleFiredRecently,
} from "@/lib/nfc-equipment-toggle";
import { StagingQueuePanel } from "@/components/equipment/StagingQueuePanel";
import { WaitlistPanel } from "@/components/equipment/WaitlistPanel";
import { ReservationBanner } from "@/components/equipment/ReservationBanner";
import { HolderReturnContext } from "@/components/equipment/HolderReturnContext";
import {
  shouldShowHolderReturnContext,
  shouldShowReservationBanner,
  shouldShowWaitlistJoinPanel,
} from "@/lib/equipment-waitlist-ui";
import { useSettings } from "@/hooks/use-settings";
import { useNfcSupported } from "@/hooks/use-nfc-supported";
import { writeNfcUrl } from "@/lib/nfc-platform";
import { UNIVERSAL_LINK_ORIGIN } from "@/lib/equipment-id";
import { playCriticalAlertTone } from "@/lib/sounds";
import { haptics } from "@/lib/haptics";
import { safeStorageSetItem } from "@/lib/safe-browser";
import { isOnline } from "@/lib/safe-browser";
import { isEquipmentRecoveryUiEnabled } from "@/lib/equipment-recovery-ui-flag";
import { deriveEquipmentRecoverySnapshotFromSource } from "@/lib/equipment-recovery-adapter";
import {
  resolveEquipmentDetailRecoveryBadgeKey,
  resolveEquipmentDetailRecoveryCalloutKey,
} from "@/lib/equipment-detail-recovery-labels";

const UNDO_WINDOW_MS = 15_000;

interface UndoState {
  actionLabel: string;
  previousEquipment: Equipment;
  undoToken?: string;
  pendingSyncId?: number;
  timeoutId: ReturnType<typeof setTimeout>;
  toastId: string | number;
}

export default function EquipmentDetailPage() {
  const inMobileShell = useMobileShellContext();
  return inMobileShell ? <EquipmentDetailPageMobile /> : <EquipmentDetailPageDesktop />;
}

function EquipmentDetailPageMobile() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  if (!id) {
    navigate("/equipment", { replace: true });
    return null;
  }
  return <EquipmentDetailScreen equipmentId={id} />;
}

function EquipmentDetailPageDesktop() {
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const { isAdmin, email, userId, role, effectiveRole } = useAuth();
  const experience = useExperience();
  const queryEnabled = !!userId;
  const ROLE_LEVEL: Record<string, number> = {
    admin: 40,
    vet: 30,
    senior_technician: 25,
    technician: 20,
    // Backward compatibility for any stale session values.
    viewer: 10,
    student: 10,
  };
  const resolvedEquipmentRole = String(effectiveRole ?? role ?? "").toLowerCase();
  /** Baseline DB/shift role is student — not elevated technician/vet for this session. */
  const isStudentEquipmentRole = resolvedEquipmentRole === "student";
  const canDuplicate = (ROLE_LEVEL[resolvedEquipmentRole] ?? 0) >= 20;
  const hasVetAccess = experience.can("equipment.vetActions");
  const { settings } = useSettings();
  const { supported: nfcWriteSupported } = useNfcSupported();
  const { discard } = useSyncQueue();
  const { localState: equipmentLocalSyncState } = usePendingSyncForEquipment(id);
  const queryClient = useQueryClient();
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanActionSheetOpen, setScanActionSheetOpen] = useState(false);
  const [scanActionDone, setScanActionDone] = useState(false);
  const [scanStatus, setScanStatus] = useState<EquipmentStatus>("ok");
  const [scanNote, setScanNote] = useState("");
  const [scanPhoto, setScanPhoto] = useState<string | null>(null);
  const [noteError, setNoteError] = useState("");
  const [checkoutLocation, setCheckoutLocation] = useState("");
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [dockReturnOpen, setDockReturnOpen] = useState(false);
  const [dockReturnNfcOpen, setDockReturnNfcOpen] = useState(false);
  const nfcDeepLinkToggleRef = useRef(false);
  const [isPluggedIn, setIsPluggedIn] = useState<boolean>(false);
  const [plugInDeadlineMinutes, setPlugInDeadlineMinutes] = useState<number>(30);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const reportIssuePhotoRef = useRef<HTMLInputElement>(null);
  const undoStateRef = useRef<UndoState | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(0);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [editingFloorNote, setEditingFloorNote] = useState(false);
  const [floorNoteText, setFloorNoteText] = useState("");
  const [confirmingHere, setConfirmingHere] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [scanHistoryRange, setScanHistoryRange] = useState<"today" | "7d" | "all">("today");
  const [detailTab, setDetailTab] = useState("details");
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  const [isNfcToggling, setIsNfcToggling] = useState(false);

  const [moveRoomOpen, setMoveRoomOpen] = useState(false);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [reportIssueNote, setReportIssueNote] = useState("");
  const [reportIssuePhoto, setReportIssuePhoto] = useState<string | null>(null);
  const [reportIssueNoteError, setReportIssueNoteError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    if (params.get("action") === "scan") {
      setScanActionSheetOpen(true);
    } else if (params.get("action") === "issue") {
      setReportIssueOpen(true);
    }
  }, [searchStr]);

  useEffect(() => {
    if (id) {
      safeStorageSetItem("vettrack_last_equipment_id", id);
    }
    return () => {};
  }, [id]);

  function clearUndoState() {
    if (undoStateRef.current) {
      clearTimeout(undoStateRef.current.timeoutId);
      toast.dismiss(undoStateRef.current.toastId);
      undoStateRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setUndoCountdown(0);
  }

  async function handleUndo(state: UndoState) {
    clearUndoState();

    const prev = state.previousEquipment;

    if (state.pendingSyncId !== undefined) {
      await discard(state.pendingSyncId);
      queryClient.setQueryData([`/api/equipment/${id}`], prev);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}/logs`] });
      // Phase 6 PR 6.4 light adoption (1 of 2): canonical client toast wrapper.
      toastSuccess(t.equipmentDetail.toast.undone);
      return;
    }

    if (!state.undoToken) {
      // Offline action with no sync ID — restore optimistic state locally
      queryClient.setQueryData([`/api/equipment/${id}`], prev);
      invalidateAll();
      toast.success(t.equipmentDetail.toast.undone);
      return;
    }

    try {
      const reverted = await api.equipment.revert(id!, state.undoToken);
      queryClient.setQueryData([`/api/equipment/${id}`], reverted);
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}/logs`] });
      toast.success(t.equipmentDetail.toast.undone);
    } catch {
      toast.error(t.equipmentDetail.toast.undoFailed);
    }
  }

  function startUndoTimer(state: Omit<UndoState, "timeoutId" | "toastId">) {
    clearUndoState();

    const startTime = Date.now();
    setUndoCountdown(Math.ceil(UNDO_WINDOW_MS / 1000));

    const toastId = `undo-${Date.now()}`;
    const getLabel = (secs: number) => `Undo (${secs}s)`;

    toast(`${state.actionLabel}`, {
      id: toastId,
      duration: UNDO_WINDOW_MS,
      onDismiss: () => clearUndoState(),
      action: {
        label: getLabel(Math.ceil(UNDO_WINDOW_MS / 1000)),
        onClick: () => {
          if (undoStateRef.current) {
            handleUndo(undoStateRef.current);
          }
        },
      },
    });

    const intervalId = setInterval(() => {
      if (!undoStateRef.current || undoStateRef.current.toastId !== toastId) {
        clearInterval(intervalId);
        return;
      }
      const remaining = Math.ceil((UNDO_WINDOW_MS - (Date.now() - startTime)) / 1000);
      if (remaining <= 0) {
        clearInterval(intervalId);
        setUndoCountdown(0);
      } else {
        setUndoCountdown(remaining);
        toast(`${state.actionLabel}`, {
          id: toastId,
          duration: UNDO_WINDOW_MS - (Date.now() - startTime),
          onDismiss: () => clearUndoState(),
          action: {
            label: getLabel(remaining),
            onClick: () => {
              if (undoStateRef.current) {
                handleUndo(undoStateRef.current);
              }
            },
          },
        });
      }
    }, 1000);
    countdownIntervalRef.current = intervalId;

    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      setUndoCountdown(0);
      if (undoStateRef.current) {
        toast.dismiss(undoStateRef.current.toastId);
        undoStateRef.current = null;
      }
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}/logs`] });
    }, UNDO_WINDOW_MS);

    undoStateRef.current = { ...state, timeoutId, toastId };
  }

  const { data: equipment, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: [`/api/equipment/${id}`],
    queryFn: () => api.equipment.get(id!),
    enabled: !!id && queryEnabled,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const equipmentDisplayName = useMemo(
    () => (equipment ? getEquipmentDisplayName(equipment) : ""),
    [equipment],
  );

  // Re-arm the per-mount toggle guard on a warm re-scan. The deep-link router appends a fresh
  // &nfcTs=<epoch> on every scan, so a new nfcTs means "the user scanned again" → reset the ref
  // BEFORE the toggle effect reads it. Declaration order is load-bearing (B2): React runs effects
  // in source order, so this MUST stay immediately above the toggle effect — below it, the toggle
  // effect would early-return on the stale `true` ref and silently drop the re-scan. The `if (nfcTs)`
  // guard prevents the post-toggle URL strip (nfcTs→absent) from spuriously re-arming; the 8s
  // wasNfcToggleFiredRecently sessionStorage window remains the real dedupe.
  const nfcTs = new URLSearchParams(searchStr).get("nfcTs");
  useEffect(() => {
    if (nfcTs) nfcDeepLinkToggleRef.current = false;
  }, [nfcTs]);

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    if (params.get("nfcAction") !== "toggle" || !id || !equipment || !userId) return;
    if (nfcDeepLinkToggleRef.current) return;
    nfcDeepLinkToggleRef.current = true;
    navigate(`/equipment/${id}`, { replace: true });
    if (wasNfcToggleFiredRecently(id)) {
      toast.info(t.equipmentNfc.alreadyToggledRecently);
      toast.dismiss("nfc-open");
      return;
    }
    markNfcToggleFired(id);
    setIsNfcToggling(true);
    void runEquipmentQuickToggle(id, equipmentDisplayName, queryClient)
      .catch(() => {
        toast.error(t.equipmentNfc.onlineRequired);
      })
      .finally(() => {
        setIsNfcToggling(false);
        toast.dismiss("nfc-open");
      });
  }, [searchStr, id, equipment, userId, queryClient, navigate]);

  useEffect(() => {
    if (isError || (!isLoading && !equipment)) toast.dismiss("nfc-open");
  }, [isError, isLoading, equipment]);

  const {
    data: scanLogsPages,
    isLoading: logsLoading,
    fetchNextPage: fetchOlderLogs,
    hasNextPage: hasOlderLogs,
    isFetchingNextPage: isFetchingOlderLogs,
  } = useInfiniteQuery({
    queryKey: [`/api/equipment/${id}/logs`],
    queryFn: ({ pageParam = 1 }) => api.equipment.logsPaginated(id!, pageParam as number, 50),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    initialPageParam: 1,
    enabled: !!id && queryEnabled,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const scanLogs = scanLogsPages?.pages.flatMap((p) => p.items);

  const scanHistorySince = useMemo(() => {
    if (scanHistoryRange === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    if (scanHistoryRange === "7d") {
      return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    return undefined;
  }, [scanHistoryRange]);

  const { data: adminScanLogs, isLoading: adminLogsLoading } = useQuery({
    queryKey: [`/api/equipment/${id}/logs`, "admin", scanHistoryRange],
    queryFn: () => api.equipment.logsAdmin(id!, scanHistorySince),
    enabled: isAdmin && !!id && queryEnabled,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: transfers, isLoading: transfersLoading } = useQuery({
    queryKey: [`/api/equipment/${id}/transfers`],
    queryFn: () => api.equipment.transfers(id!),
    enabled: !!id && queryEnabled && detailTab === "activity",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const deployabilityQ = useQuery({
    queryKey: ["deployability", id],
    queryFn: () => api.operationalState.deployability(id!),
    enabled: !!id && equipment?.custodyState != null,
    refetchInterval: 5 * 60 * 1000,
  });

  const waitlistQ = useQuery({
    queryKey: ["equipment-waitlist", id],
    queryFn: () => api.equipment.waitlist(id!),
    enabled: !!id && !!userId && queryEnabled,
    refetchOnWindowFocus: false,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
    queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
    queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
  }

  async function handleConfirmHere() {
    if (confirmingHere || !id) return;
    setConfirmingHere(true);
    try {
      await api.equipment.scan(id, { status: "ok" });
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}/logs`] });
      queryClient.invalidateQueries({ queryKey: ["equipment-truth", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setJustConfirmed(true);
      setTimeout(() => setJustConfirmed(false), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t.roomRadarPage.pilotConfirmError);
    } finally {
      setConfirmingHere(false);
    }
  }

  const isOffline = !isOnline();

  const floorNoteMut = useMutation({
    mutationFn: (note: string | null) =>
      api.equipment.update(id!, { usuallyFoundHere: note }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Equipment>([`/api/equipment/${id}`], (prev) =>
        prev ? { ...prev, ...updated } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setEditingFloorNote(false);
      toast.success(t.equipmentDetail.floorNoteSaved);
    },
    onError: () => toast.error(t.equipmentDetail.floorNoteSaveFailed),
  });

  const scanMut = useMutation({
    mutationFn: async () => {
      const prev = queryClient.getQueryData<Equipment>([`/api/equipment/${id}`]);
      const capturedStatus = scanStatus;
      const capturedNote = scanNote;
      const capturedPhoto = scanPhoto;

      const result = await api.equipment.scan(id!, {
        status: capturedStatus,
        note: capturedNote,
        photoUrl: capturedPhoto || undefined,
      });
      return { result, prev, capturedStatus, wasOffline: result.pendingSyncId !== undefined };
    },
    onSuccess: ({ result, prev, capturedStatus, wasOffline }) => {
      haptics.tap();
      setScanDialogOpen(false);
      setScanNote("");
      setScanPhoto(null);
      setNoteError("");

      const { equipment: updated, scanLog, undoToken } = result;

      if (wasOffline) {
        if (prev) {
          queryClient.setQueryData([`/api/equipment/${id}`], updated);
          startUndoTimer({
            actionLabel: `Status updated to ${STATUS_LABELS[capturedStatus]}`,
            previousEquipment: prev,
            pendingSyncId: result.pendingSyncId,
          });
        }
        toast.info(t.equipmentDetail.toast.savedOffline);
        return;
      }

      queryClient.setQueryData([`/api/equipment/${id}`], updated);
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}/logs`] });
      queryClient.invalidateQueries({ queryKey: ["equipment-truth", id] });
      invalidateAll();

      if (prev && !isStudentEquipmentRole) {
        startUndoTimer({
          actionLabel: `Status updated to ${STATUS_LABELS[capturedStatus]}`,
          previousEquipment: prev,
          undoToken,
        });
      }

      if (capturedStatus === "issue") {
        if (settings.soundEnabled && settings.criticalAlertsSound) {
          playCriticalAlertTone();
        }
        setTimeout(() => {
          if (isOffline) {
            toast.warning(t.equipmentDetail.toast.issueReportedOffline);
          } else {
            const waUrl = buildWhatsAppUrl(undefined, updated.name, capturedStatus, scanLog?.note || "", t.whatsAppMessage);
            toast.success(t.equipmentDetail.toast.issueReported, {
              duration: 10000,
              action: isStudentEquipmentRole ? undefined : {
                label: t.equipmentDetail.sendWhatsApp,
                onClick: () => window.open(waUrl, "_blank"),
              },
            });
          }
        }, 300);
      }
    },
    onError: (err: Error) => {
      toast.error(t.equipmentDetail.toast.scanFailed(err.message));
    },
  });

  // Off-shift: taking equipment ownership is not permitted (roster-derived).
  const { hasActiveShift } = useActiveShift();

  const checkoutMut = useMutation({
    mutationFn: async () => {
      const prev = queryClient.getQueryData<Equipment>([`/api/equipment/${id}`]);
      const capturedLocation = checkoutLocation;
      const result = await api.equipment.checkout(id!, capturedLocation || undefined);
      return { result, prev };
    },
    onSuccess: ({ result, prev }) => {
      haptics.tap();
      setCheckoutLocation("");

      const { equipment: updated, undoToken } = result;
      const wasOffline = result.pendingSyncId !== undefined;

      queryClient.setQueryData([`/api/equipment/${id}`], updated);

      if (wasOffline) {
        toast.info(t.equipmentDetail.toast.savedOffline);
        if (prev) {
          startUndoTimer({
            actionLabel: t.equipmentDetail.toast.checkedOut,
            previousEquipment: prev,
            pendingSyncId: result.pendingSyncId,
          });
        }
        setScanActionDone(true);
        return;
      }

      if (prev && !isStudentEquipmentRole) {
        startUndoTimer({
          actionLabel: t.equipmentDetail.toast.checkedOut,
          previousEquipment: prev,
          undoToken,
        });
      }
      setScanActionDone(true);
    },
    onError: (err: Error) => {
      toast.error(t.equipmentDetail.toast.checkoutFailed(err.message));
    },
  });

  // Single choke point for every checkout affordance — blocks off-shift ownership.
  const handleCheckout = () => {
    if (!hasActiveShift) {
      toast.error(t.scan.offShiftBody);
      return;
    }
    checkoutMut.mutate();
  };

  // Reason shown beside the (disabled) checkout buttons so an off-shift tech knows
  // why the action is unavailable — a disabled button can't surface the toast itself.
  const offShiftCheckoutNote = !hasActiveShift ? (
    <p className="px-2 text-center text-xs text-muted-foreground" data-testid="checkout-offshift-note">
      {t.scan.offShiftBody}
    </p>
  ) : null;

  const returnMut = useMutation({
    mutationFn: async ({ isPluggedIn: nextPluggedIn, plugInDeadlineMinutes: nextDeadline }: { isPluggedIn: boolean; plugInDeadlineMinutes: number }) => {
      const prev = queryClient.getQueryData<Equipment>([`/api/equipment/${id}`]);
      const result = await api.equipment.return(id!, {
        isPluggedIn: nextPluggedIn,
        plugInDeadlineMinutes: nextPluggedIn ? undefined : nextDeadline,
      });
      return { result, prev, usedPluggedIn: nextPluggedIn, usedDeadline: nextDeadline };
    },
    onSuccess: ({ result, prev, usedPluggedIn, usedDeadline }) => {
      haptics.tap();
      const { equipment: updated, undoToken } = result;
      const wasOffline = result.pendingSyncId !== undefined;
      setReturnDialogOpen(false);

      queryClient.setQueryData([`/api/equipment/${id}`], updated);

      if (wasOffline) {
        toast.info(t.equipmentDetail.toast.savedOffline);
        if (prev) {
          startUndoTimer({
            actionLabel: t.equipmentDetail.toast.returned,
            previousEquipment: prev,
            pendingSyncId: result.pendingSyncId,
          });
        }
        setScanActionDone(true);
        return;
      }

      invalidateAll();
      if (!usedPluggedIn) {
        toast.warning(`An alert will be sent after ${usedDeadline} minute${usedDeadline !== 1 ? "s" : ""} if not plugged in.`);
      }

      if (prev && !isStudentEquipmentRole) {
        startUndoTimer({
          actionLabel: t.equipmentDetail.toast.returned,
          previousEquipment: prev,
          undoToken,
        });
      }
      setScanActionDone(true);
    },
    onError: (err: Error) => {
      toast.error(t.equipmentDetail.toast.returnFailed(err.message));
    },
  });

  function handleConfirmReturn(values: { isPluggedIn: boolean; plugInDeadlineMinutes: number }) {
    setIsPluggedIn(values.isPluggedIn);
    setPlugInDeadlineMinutes(values.plugInDeadlineMinutes);
    returnMut.mutate(values);
  }

  const deleteMut = useMutation({
    mutationFn: () => api.equipment.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast.success(t.equipmentDetail.toast.deleted);
      navigate("/equipment");
    },
    onError: () => toast.error(t.equipmentDetail.toast.deleteFailed),
  });

  const reportIssueMut = useMutation({
    mutationFn: async () => {
      const prev = queryClient.getQueryData<Equipment>([`/api/equipment/${id}`]);
      const capturedNote = reportIssueNote;
      const capturedPhoto = reportIssuePhoto;
      const result = await api.equipment.scan(id!, {
        status: "issue",
        note: capturedNote,
        photoUrl: capturedPhoto || undefined,
      });
      return { result, prev, capturedNote };
    },
    onSuccess: ({ result, prev, capturedNote }) => {
      haptics.tap();
      setReportIssueOpen(false);
      setReportIssueNote("");
      setReportIssuePhoto(null);
      setReportIssueNoteError("");

      if (settings.soundEnabled && settings.criticalAlertsSound) {
        playCriticalAlertTone();
      }

      const { equipment: updated, scanLog, undoToken } = result;
      const wasOffline = result.pendingSyncId !== undefined;

      queryClient.setQueryData([`/api/equipment/${id}`], updated);
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}/logs`] });

      if (wasOffline) {
        toast.info(t.equipmentDetail.toast.savedOffline);
        if (prev) {
          startUndoTimer({
            actionLabel: t.equipmentDetail.toast.issueReported,
            previousEquipment: prev,
            pendingSyncId: result.pendingSyncId,
          });
        }
        return;
      }

      if (prev && !isStudentEquipmentRole) {
        startUndoTimer({
          actionLabel: t.equipmentDetail.toast.issueReported,
          previousEquipment: prev,
          undoToken,
        });
      }

      setTimeout(() => {
        if (!isOnline()) {
          toast.warning(t.equipmentDetail.toast.issueWhatsAppOffline);
        } else if (isStudentEquipmentRole) {
          toast.success(t.equipmentDetail.toast.issueReported);
        } else {
          const waUrl = buildWhatsAppUrl(undefined, updated.name, "issue", scanLog?.note || capturedNote || "", t.whatsAppMessage);
          toast.success(t.equipmentDetail.toast.issueReported, {
            duration: 10000,
            action: {
              label: t.equipmentDetail.sendWhatsApp,
              onClick: () => window.open(waUrl, "_blank"),
            },
          });
        }
      }, 300);
    },
    onError: (err: Error) => {
      toast.error(t.equipmentDetail.toast.reportFailed(err.message));
    },
  });

  function handleOpenReturnDialog() {
    setIsPluggedIn(false);
    setPlugInDeadlineMinutes(30);
    setReturnDialogOpen(true);
  }

  function handleDuplicate() {
    if (!equipment) return;
    const params = new URLSearchParams();
    if (equipment.name) params.set("copyName", equipment.name);
    if (equipment.nameHe) params.set("copyNameHe", equipment.nameHe);
    if (equipment.model) params.set("copyModel", equipment.model);
    if (equipment.manufacturer) params.set("copyManuf", equipment.manufacturer);
    if (equipment.purchaseDate) params.set("copyPurchaseDate", equipment.purchaseDate);
    if (equipment.location) params.set("copyLocation", equipment.location);
    if (equipment.folderId) params.set("copyFolder", equipment.folderId);
    if (equipment.maintenanceIntervalDays)
      params.set("copyMaint", String(equipment.maintenanceIntervalDays));
    params.set("copiedFrom", equipmentDisplayName);
    navigate(`/equipment/new?${params.toString()}`);
  }

  const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error(t.equipmentDetail.toast.photoSizeLimit);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setScanPhoto(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleReportIssuePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error(t.equipmentDetail.toast.photoSizeLimit);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setReportIssuePhoto(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleReportIssueSubmit() {
    setReportIssueNoteError("");
    reportIssueMut.mutate();
  }

  function handleScanSubmit() {
    if (scanStatus === "issue" && !scanNote.trim()) {
      setNoteError("A note is required when reporting an issue.");
      return;
    }
    setNoteError("");
    scanMut.mutate();
  }

  function openScanDialog() {
    setScanStatus("ok");
    setScanNote("");
    setScanPhoto(null);
    setNoteError("");
    setScanDialogOpen(true);
  }

  function handlePrintQr() {
    if (!equipment?.id) return;
    window.open(`/equipment/${id}/qr`, "_blank");
  }

  async function writeEquipmentNfcTag(equipmentId: string) {
    if (!nfcWriteSupported) {
      toast.error(t.equipmentNfc.writeUnsupported);
      return;
    }
    // MANDATORY hardcode (D5): the native WebView origin is capacitor://localhost (bundled app),
    // so window.location.origin would write a non-Universal-Link URL. UNIVERSAL_LINK_ORIGIN is the
    // single source of truth shared with the deep-link router's hostname check.
    const url = `${UNIVERSAL_LINK_ORIGIN}/equipment/${equipmentId}?nfcAction=toggle&source=nfc`;
    try {
      await writeNfcUrl(url);
      haptics.scanSuccess();
      toast.success(t.equipmentNfc.writeSuccess);
    } catch {
      haptics.error();
      toast.error(t.equipmentNfc.writeFailed);
    }
  }

  const isNfcEntry = new URLSearchParams(searchStr).get("nfcAction") === "toggle";

  if (isLoading) {
    return (
      <EquipmentDetailSkeleton
        statusLabel={isNfcEntry ? t.nfcEntry.openingEquipment : undefined}
      />
    );
  }

  if (isError) {
    const errorContent = (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <AlertTriangle className="w-10 h-10 text-destructive opacity-60" />
        <div>
          <p className="font-semibold text-foreground">{t.equipmentDetail.loadFailed}</p>
          <p className="text-sm text-muted-foreground mt-1">{t.equipmentDetail.loadFailedHint}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="gap-1.5"
          >
            <Loader2 className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`} />
            {isRefetching ? t.equipmentDetail.toast.trying : t.equipmentDetail.toast.tryAgain}
          </Button>
          <Button variant="ghost" onClick={() => navigate("/equipment")}>{t.equipmentDetail.backToList}</Button>
        </div>
      </div>
    );
    return <AppShell>{errorContent}</AppShell>;
  }

  if (!equipment) {
    const notFoundContent = (
      <div className="text-center py-20">
        <p className="text-muted-foreground">{t.equipmentDetail.notFound}</p>
        <Button variant="ghost" onClick={() => navigate("/equipment")} className="mt-2">
          {t.equipmentDetail.backToList}
        </Button>
      </div>
    );
    return <AppShell>{notFoundContent}</AppShell>;
  }

  const overdue = isOverdue(equipment);
  const sterilizationDue = isSterilizationDue(equipment);
  const isCheckedOut = !!equipment.checkedOutById;
  const checkedOutByMe = equipment.checkedOutById === userId;
  const showReservationBanner = shouldShowReservationBanner(
    waitlistQ.data?.myStatus,
    waitlistQ.data?.reservationExpiresAt,
  );
  const showWaitlistJoinPanel =
    !!userId && shouldShowWaitlistJoinPanel(equipment, userId);
  const showHolderReturnContext =
    !!userId &&
    shouldShowHolderReturnContext(equipment, userId, showReservationBanner);
  const showOperationalState =
    equipment.custodyState != null &&
    equipment.readinessState != null &&
    equipment.usageState != null;
  const recoverySnapshot = isEquipmentRecoveryUiEnabled
    ? deriveEquipmentRecoverySnapshotFromSource(equipment)
    : null;
  const recoveryBadgeKey = recoverySnapshot
    ? resolveEquipmentDetailRecoveryBadgeKey(recoverySnapshot)
    : null;
  const recoveryCalloutKey = recoverySnapshot
    ? resolveEquipmentDetailRecoveryCalloutKey(recoverySnapshot)
    : null;
  const showWriteNfc = isAdmin && nfcWriteSupported && !!id;
  const showWhatsAppTools = !isStudentEquipmentRole;

  const pageContent = (
    <>
      <Helmet>
        <title>{equipmentDisplayName} — VetTrack</title>
        <meta name="description" content={`Equipment detail for ${equipmentDisplayName}. Status: ${equipment.status}${equipment.location ? `. Location: ${equipment.location}` : ""}. Update status, check out, report issues, and view full history.`} />
        <link rel="canonical" href={`https://vettrack.replit.app/equipment/${equipment.id}`} />
      </Helmet>
      <Breadcrumb
        className="mb-1 hidden sm:flex"
        items={[
          { label: t.equipment.title, href: "/equipment" },
          { label: equipmentDisplayName },
        ]}
      />
      <div className="flex flex-col gap-4 pb-28 animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate("/equipment")}
              data-testid="btn-back"
              aria-label={t.equipmentDetail.backToList}
            >
              <BackChevron className="w-5 h-5" aria-hidden />
            </Button>
            <div>
              <h1 className="vt-page-title leading-tight"><Bdi>{equipmentDisplayName}</Bdi></h1>
              {equipment.folderName && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <FolderOpen className="w-3 h-3" />
                  {equipment.folderName}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-1">
            {canDuplicate && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDuplicate}
                title={t.equipmentDetail.toast.duplicateEquipment}
                aria-label={t.equipmentDetail.ariaDuplicate}
                data-testid="btn-duplicate"
              >
                <Copy className="w-4 h-4" aria-hidden />
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => navigate(`/equipment/${id}/edit`)}
                aria-label={t.equipmentDetail.ariaEdit}
                data-testid="btn-edit"
              >
                <Pencil className="w-4 h-4" aria-hidden />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setToolsSheetOpen(true)}
              aria-label={t.equipmentDetail.toolsSheetTitle}
              data-testid="btn-equipment-tools"
            >
              <MoreHorizontal className="w-4 h-4" aria-hidden />
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive h-11 w-11"
                aria-label={t.equipmentDetail.deleteAriaLabel}
                data-testid="btn-delete"
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: t.equipmentDetail.deleteTitle(equipmentDisplayName),
                      description: t.equipmentDetail.deleteBody,
                      confirmLabel: t.equipmentDetail.deleteConfirm,
                      destructive: true,
                    }))
                  ) {
                    return;
                  }
                  deleteMut.mutate();
                }}
              >
                <Trash2 className="w-4 h-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>

        {equipmentLocalSyncState !== "synced" && (
          <div
            className={cn(
              "rounded-xl border px-3 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
              equipmentLocalSyncState === "conflict"
                ? "bg-[var(--status-maint-bg)] border-[var(--status-maint-border)]"
                : equipmentLocalSyncState === "sync_failed"
                ? "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)]"
                : "bg-[var(--status-stale-bg)] border-[var(--status-stale-border)]",
            )}
            data-testid="equipment-local-sync-banner"
          >
            <p
              className={cn(
                "text-sm font-medium",
                equipmentLocalSyncState === "conflict"
                  ? "text-[var(--status-maint-fg)]"
                  : equipmentLocalSyncState === "sync_failed"
                  ? "text-[var(--status-issue-fg)]"
                  : "text-[var(--status-stale-fg)]",
              )}
            >
              {equipmentLocalSyncState === "pending_sync"
                ? t.equipmentDetail.localStatePendingSync
                : equipmentLocalSyncState === "conflict"
                ? t.equipmentDetail.localStateConflict
                : t.equipmentDetail.localStateSyncFailed}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 text-xs shrink-0"
              onClick={() => window.dispatchEvent(new CustomEvent("vettrack:open-sync-queue"))}
              data-testid="btn-open-sync-queue"
            >
              {t.equipmentDetail.openSyncQueue}
            </Button>
          </div>
        )}

        <EquipmentTruthCard equipmentId={equipment.id} equipmentName={equipmentDisplayName} />

        <AssetCopilotPanel defaultEquipmentId={equipment.id} className="mt-3" />

        {/* Quick Action Bar — ICU-moment: 1–2 large, instantly tappable actions */}
        <div className="flex flex-col gap-2" data-testid="quick-action-bar">
          {isNfcToggling && (
            <div
              className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
              data-testid="nfc-toggle-in-flight"
            >
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              <span>{t.equipmentNfc.toggling(equipmentDisplayName)}</span>
            </div>
          )}
          {showReservationBanner && waitlistQ.data?.reservationExpiresAt && (
            <ReservationBanner
              equipmentId={equipment.id}
              expiresAt={waitlistQ.data.reservationExpiresAt}
              onCheckout={handleCheckout}
              checkoutPending={checkoutMut.isPending}
              showNextInLine={waitlistQ.data.myPosition === 1}
            />
          )}

          {equipment.custodyState === "returned" && equipment.status === "ok" ? (
            <Button
              variant="outline"
              className="w-full h-12 gap-2 text-sm font-semibold rounded-2xl active:scale-[0.98] transition-all text-[rgb(var(--sys-blue))] border-[rgb(var(--sys-blue)/0.3)] hover:bg-[rgb(var(--sys-blue)/0.08)]"
              onClick={() => setDockReturnOpen(true)}
              data-testid="btn-dock-return"
            >
              <LogIn className="w-4 h-4" />
              {t.dockReturn.submit}
            </Button>
          ) : !isCheckedOut ? (
            <>
              <Button
                variant="outline"
                className="w-full h-12 gap-2 text-sm font-semibold rounded-2xl active:scale-[0.98] transition-all border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                onClick={handleCheckout}
                disabled={checkoutMut.isPending || !hasActiveShift}
                data-testid="btn-checkout"
              >
                {checkoutMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                {t.equipmentDetail.actionInUse}
              </Button>
              {offShiftCheckoutNote}
            </>
          ) : (checkedOutByMe || isAdmin) ? (
            <Button
              className="w-full h-12 gap-2 text-sm font-semibold rounded-2xl active:scale-[0.98] transition-all shadow-sm"
              variant="outline"
              onClick={handleOpenReturnDialog}
              disabled={returnMut.isPending}
              data-testid="btn-return"
            >
              {returnMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
              {t.equipmentDetail.actionReturn}
            </Button>
          ) : null}

          {/* Secondary action row — students: scan / take / return only (no room move). */}
          <div className={cn("grid gap-2", isStudentEquipmentRole ? "grid-cols-2" : "grid-cols-3")}>
            <Button
              variant="outline"
              className="h-11 gap-1.5 text-sm font-medium rounded-xl border-[var(--status-issue-border)] text-[var(--status-issue-fg)] hover:bg-[var(--status-issue-bg)] active:scale-[0.98] transition-all"
              onClick={() => {
                setReportIssueNote("");
                setReportIssuePhoto(null);
                setReportIssueNoteError("");
                setReportIssueOpen(true);
              }}
              data-testid="btn-report-issue"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {t.equipmentDetail.actionIssue}
            </Button>
            <Button
              variant="outline"
              className="h-11 gap-1.5 text-sm font-medium rounded-xl active:scale-[0.98] transition-all"
              onClick={openScanDialog}
              data-testid="btn-scan"
            >
              <ClipboardEdit className="w-3.5 h-3.5" />
              {t.equipmentDetail.statusLabel}
            </Button>
            {!isStudentEquipmentRole && (
              <Button
                variant="outline"
                className="h-11 gap-1.5 text-sm font-medium rounded-xl active:scale-[0.98] transition-all"
                onClick={() => setMoveRoomOpen(true)}
                data-testid="btn-move-room"
              >
                <MoveHorizontal className="w-3.5 h-3.5" />
                {t.equipmentDetail.actionMove}
              </Button>
            )}
          </div>

          {/* In-use context indicator — full-platform only */}
          {isCheckedOut && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/60 bg-muted/50 text-sm">
              <User className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-sm leading-tight">
                  {checkedOutByMe ? t.equipmentDetail.toast.checkedOutByYou : t.equipmentDetail.checkedOutBy(equipment.checkedOutByEmail || t.common.unknown)}
                </p>
                {equipment.checkedOutLocation && (
                  <p className="text-xs mt-0.5 opacity-80 truncate">{equipment.checkedOutLocation}</p>
                )}
                <p className="text-xs mt-0.5 opacity-70">{t.shiftSummaryPage.since} {formatRelativeTime(equipment.checkedOutAt)}</p>
              </div>
            </div>
          )}

          {showHolderReturnContext && (
            <HolderReturnContext equipment={equipment} />
          )}

          {showWaitlistJoinPanel && userId && (
            <WaitlistPanel
              equipment={equipment}
              currentUserId={userId}
              snapshot={waitlistQ.data}
            />
          )}
        </div>

        <EquipmentDetailStatusStrip
          equipment={equipment}
          recoveryCalloutKey={recoveryCalloutKey}
          recoveryBadgeKey={recoveryBadgeKey}
          undoCountdown={undoCountdown}
          undoWindowSec={Math.ceil(UNDO_WINDOW_MS / 1000)}
          showOperationalState={showOperationalState}
          overdue={overdue}
          sterilizationDue={sterilizationDue}
          onRfidAttention={() => setDockReturnNfcOpen(true)}
        />

        {/* Pilot: scan count — no names, aggregate only */}
        {scanLogsPages && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-ok-fg)] shrink-0" />
            <span>{t.equipmentDetail.scanCount(scanLogsPages.pages[0]?.total ?? 0)}</span>
          </div>
        )}

        {/* Floor note — inline editable for technician+ */}
        {editingFloorNote ? (
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] px-3.5 py-3">
            <Textarea
              autoFocus
              value={floorNoteText}
              onChange={(e) => setFloorNoteText(e.target.value.slice(0, 200))}
              placeholder={t.equipmentDetail.floorNotePlaceholder}
              className="min-h-[72px] resize-none text-xs bg-white/70 dark:bg-black/20 border-[var(--status-stale-border)]"
              maxLength={200}
            />
            <div className="flex items-center justify-between">
              <span className="vt-text-2xs text-[var(--status-stale-fg)]">
                {floorNoteText.length}/200
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-11 text-xs"
                  onClick={() => setEditingFloorNote(false)}
                  disabled={floorNoteMut.isPending}
                >
                  {t.equipmentDetail.floorNoteCancel}
                </Button>
                <Button
                  size="sm"
                  className="h-11 text-xs"
                  onClick={() => floorNoteMut.mutate(floorNoteText.trim() || null)}
                  disabled={floorNoteMut.isPending}
                >
                  {floorNoteMut.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    t.equipmentDetail.floorNoteSave
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : equipment.usuallyFoundHere ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] px-3.5 py-3">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-stale-fg)]" aria-hidden />
            <p className="flex-1 text-xs leading-relaxed text-[var(--status-stale-fg)]">
              {equipment.usuallyFoundHere}
            </p>
            {!isStudentEquipmentRole && (
              <button
                onClick={() => { setFloorNoteText(equipment.usuallyFoundHere ?? ""); setEditingFloorNote(true); }}
                className="shrink-0 text-[var(--status-stale-fg)] hover:opacity-80"
                aria-label={t.equipmentDetail.ariaEditFloorNote}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          !isStudentEquipmentRole && (
            <button
              onClick={() => { setFloorNoteText(""); setEditingFloorNote(true); }}
              className="flex items-center gap-1.5 text-xs text-[var(--status-stale-fg)] hover:opacity-80 px-1 py-0.5"
            >
              <Pencil className="h-3 w-3" />
              {t.equipmentDetail.floorNoteAdd}
            </button>
          )
        )}

        {/* Staff note */}
        {equipment.staffNote && (
          <div className="rounded-xl border border-border/40 bg-muted/30 px-3.5 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground/70 italic">
              {equipment.staffNote}
            </p>
          </div>
        )}

        {/* Info tabs */}
        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1">
              {t.equipmentDetail.tabDetails}
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex-1" data-testid="tab-activity">
              {t.equipmentDetail.tabActivity}
            </TabsTrigger>
            {equipment?.custodyState != null && (
              <TabsTrigger value="readiness" className="flex-1" data-testid="tab-readiness">
                {t.stagingQueue.readinessTab}
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="scanlog" className="flex-1">
                {t.equipmentDetail.scanLogTab}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="details">
            <EquipmentDetailDetailsTab equipment={equipment} />
          </TabsContent>

          <TabsContent value="activity">
            <EquipmentDetailActivityTab
              scanLogs={scanLogs}
              transfers={transfers}
              logsLoading={logsLoading}
              transfersLoading={transfersLoading}
              hasOlderLogs={!!hasOlderLogs}
              isFetchingOlderLogs={isFetchingOlderLogs}
              onLoadOlder={() => fetchOlderLogs()}
            />
          </TabsContent>

          {equipment?.custodyState != null && (
            <TabsContent value="readiness" className="space-y-4 p-4">
              {deployabilityQ.data &&
                !deployabilityQ.data.bundleGate.ok &&
                deployabilityQ.data.bundleGate.reason && (
                  <p className="text-xs text-muted-foreground">
                    {formatBundleGateReason(deployabilityQ.data.bundleGate.reason)}
                  </p>
                )}

              {userId && (
                <StagingQueuePanel equipment={equipment} currentUserId={userId} />
              )}

              <div className="flex flex-col gap-2">
                {equipment.custodyState === "returned" && (
                  <Button variant="outline" onClick={() => setDockReturnOpen(true)}>
                    {t.dockReturn.title}
                  </Button>
                )}
              </div>

              <DockReturnFlow
                equipment={equipment}
                open={dockReturnOpen}
                onClose={() => setDockReturnOpen(false)}
                onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}`] });
                  queryClient.invalidateQueries({ queryKey: ["deployability", id] });
                  queryClient.invalidateQueries({ queryKey: ["condition-states", id] });
                  queryClient.invalidateQueries({ queryKey: ["staging-queue", id] });
                  setDockReturnOpen(false);
                }}
              />

              <DockReturnNfc
                equipment={equipment}
                open={dockReturnNfcOpen}
                onClose={() => setDockReturnNfcOpen(false)}
                onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}`] });
                  queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
                  setDockReturnNfcOpen(false);
                }}
              />

            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="scanlog">
              <EquipmentDetailScanLogTab
                range={scanHistoryRange}
                onRangeChange={setScanHistoryRange}
                isLoading={adminLogsLoading}
                logs={adminScanLogs?.items}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <ReturnPlugDialog
        open={returnDialogOpen}
        onOpenChange={setReturnDialogOpen}
        equipmentName={equipmentDisplayName}
        isSubmitting={returnMut.isPending}
        onConfirm={({ isPluggedIn: nextPluggedIn, plugInDeadlineMinutes: nextDeadline }) => {
          returnMut.mutate({
            isPluggedIn: nextPluggedIn,
            plugInDeadlineMinutes: nextDeadline ?? 30,
          });
        }}
      />

      {/* Update Status dialog */}
      <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.equipmentDetail.updateStatusTitle}</DialogTitle>
            <DialogDescription>Log status for: {equipmentDisplayName}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t.equipmentDetail.statusLabel}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["ok", "issue", "maintenance", "sterilized"] as EquipmentStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setScanStatus(s);
                      if (s !== "issue") setNoteError("");
                    }}
                    className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      scanStatus === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/30"
                    }`}
                    data-testid={`scan-status-${s}`}
                  >
                    {s === "ok" && <CheckCircle2 className="w-4 h-4 text-[var(--status-ok-fg)]" />}
                    {s === "issue" && <AlertTriangle className="w-4 h-4 text-[var(--status-issue-fg)]" />}
                    {s === "maintenance" && <Wrench className="w-4 h-4 text-[var(--status-maint-fg)]" />}
                    {s === "sterilized" && <Droplets className="w-4 h-4 text-teal-500" />}
                    {equipmentStatusLabel(s)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">
                Note
                {scanStatus === "issue" && (
                  <span className="text-[var(--status-issue-fg)] ms-1">*</span>
                )}
                {scanStatus !== "issue" && (
                  <span className="text-muted-foreground text-xs ms-1">(optional)</span>
                )}
              </Label>
              <Textarea
                id="note"
                placeholder={
                  scanStatus === "issue"
                    ? t.equipmentDetail.describeIssue
                    : t.equipmentDetail.addObservations
                }
                value={scanNote}
                onChange={(e) => {
                  setScanNote(e.target.value);
                  if (e.target.value.trim()) setNoteError("");
                }}
                rows={3}
                data-testid="scan-note"
                className={noteError ? "border-[var(--status-issue-border)] focus-visible:ring-[var(--status-issue-border)]" : ""}
              />
              {noteError && (
                <p className="text-xs text-[var(--status-issue-fg)] font-medium">{noteError}</p>
              )}
            </div>

            {/* Photo — shown prominently for issues, available for all */}
            {scanStatus === "issue" && (
              <div className="flex flex-col gap-1.5">
                <Label>
                  Photo
                  <span className="text-muted-foreground text-xs ms-1">(strongly recommended)</span>
                </Label>
                {scanPhoto ? (
                  <div className="relative">
                    <img
                      src={scanPhoto}
                      alt={t.equipmentDetail.issuePhoto}
                      className="w-full h-36 object-cover rounded-xl border-2 border-primary/30"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 end-1 bg-white/80 text-xs h-11 min-w-[44px]"
                      onClick={() => setScanPhoto(null)}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 w-full h-24 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:bg-muted/50 transition-colors"
                    data-testid="btn-photo"
                  >
                    <Camera className="w-6 h-6" />
                    <span className="text-sm font-medium">{t.equipmentDetail.takePhoto}</span>
                  </button>
                )}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScanDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleScanSubmit}
              disabled={scanMut.isPending}
              data-testid="btn-confirm-scan"
            >
              {scanMut.isPending ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <ClipboardEdit className="w-4 h-4 me-2" />
              )}
              Log Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Issue dialog */}
      <Dialog open={reportIssueOpen} onOpenChange={setReportIssueOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.equipmentDetail.reportIssueTitle}</DialogTitle>
            <DialogDescription>{equipmentDisplayName}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-issue-note">
                Describe the issue
                <span className="text-[var(--status-issue-fg)] ms-1">*</span>
              </Label>
              <Textarea
                id="report-issue-note"
                placeholder={t.equipmentDetail.describeIssue}
                value={reportIssueNote}
                onChange={(e) => {
                  setReportIssueNote(e.target.value);
                  if (e.target.value.trim()) setReportIssueNoteError("");
                }}
                rows={3}
                data-testid="report-issue-note"
                className={reportIssueNoteError ? "border-[var(--status-issue-border)] focus-visible:ring-[var(--status-issue-border)]" : ""}
              />
              {reportIssueNoteError && (
                <p className="text-xs text-[var(--status-issue-fg)] font-medium">{reportIssueNoteError}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                Photo
                <span className="text-muted-foreground text-xs ms-1">(optional)</span>
              </Label>
              {reportIssuePhoto ? (
                <div className="relative">
                  <img
                    src={reportIssuePhoto}
                    alt={t.equipmentDetail.issuePhoto}
                    className="w-full h-36 object-cover rounded-xl border-2 border-primary/30"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 end-1 bg-white/80 text-xs h-11 min-w-[44px]"
                    onClick={() => setReportIssuePhoto(null)}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => reportIssuePhotoRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 w-full h-24 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:bg-muted/50 transition-colors"
                  data-testid="btn-report-issue-photo"
                >
                  <Camera className="w-6 h-6" />
                  <span className="text-sm font-medium">{t.equipmentDetail.takePhoto}</span>
                </button>
              )}
              <input
                ref={reportIssuePhotoRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleReportIssuePhotoChange}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportIssueOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleReportIssueSubmit}
              disabled={reportIssueMut.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
              data-testid="btn-confirm-report-issue"
            >
              {reportIssueMut.isPending ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <AlertTriangle className="w-4 h-4 me-2" />
              )}
              Submit Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan quick-action sheet (opened from QR scanner via ?action=scan) */}
      {scanActionSheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end"
          data-testid="scan-action-sheet"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setScanActionSheetOpen(false);
              setScanActionDone(false);
            }
          }}
        >
          <div className="bg-card rounded-t-3xl px-5 pt-5 pb-8 max-w-2xl mx-auto w-full">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />

            {!scanActionDone ? (
              <>
                {/* Equipment info */}
                <div className="flex items-start gap-3 mb-5">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg leading-tight" data-testid="scan-action-equipment-name">
                      {equipmentDisplayName}
                    </p>
                    {equipment.serialNumber && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        #{equipment.serialNumber}
                      </p>
                    )}
                    {equipment.location && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {equipment.location}
                      </p>
                    )}
                  </div>
                  <Badge variant={statusToBadgeVariant(equipment.status)} className="shrink-0 text-xs" data-testid="scan-action-status-badge">
                    {equipmentStatusLabel(equipment.status)}
                  </Badge>
                </div>

                {/* Checkout info if currently out */}
                {isCheckedOut && (
                  <div className="bg-primary/5 border border-primary/20 rounded-xl px-3 py-2.5 mb-4 text-sm">
                    <p className="font-medium text-foreground">
                      {checkedOutByMe
                        ? t.equipmentDetail.toast.checkedOutByYou
                        : `In use by ${equipment.checkedOutByEmail || "another user"}`}
                    </p>
                    {equipment.checkedOutLocation && (
                      <p className="text-primary text-xs mt-0.5">
                        {t.equipmentDetail.locationCard.title}: {equipment.checkedOutLocation}
                      </p>
                    )}
                  </div>
                )}

                {/* Quick action buttons */}
                <div className="flex flex-col gap-2.5">
                  {!isCheckedOut && (
                    <>
                      <Button
                        size="lg"
                        className="w-full gap-2.5"
                        onClick={handleCheckout}
                        disabled={checkoutMut.isPending || returnMut.isPending || !hasActiveShift}
                        data-testid="btn-scan-action-checkout"
                      >
                        {checkoutMut.isPending ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <LogIn className="w-5 h-5" />
                        )}
                        Check Out
                      </Button>
                      {offShiftCheckoutNote}
                    </>
                  )}

                  {isCheckedOut && (checkedOutByMe || isAdmin) && (
                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full gap-2.5"
                      onClick={handleOpenReturnDialog}
                      disabled={returnMut.isPending || checkoutMut.isPending}
                      data-testid="btn-scan-action-return"
                    >
                      {returnMut.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <LogOut className="w-5 h-5" />
                      )}
                      Return
                    </Button>
                  )}

                  {isCheckedOut && !checkedOutByMe && !isAdmin && (
                    <div className="bg-[var(--status-stale-bg)] border border-[var(--status-stale-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--status-stale-fg)]">
                      Only the person who checked this out (or an admin) can return it.
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full gap-2.5 border-[var(--status-issue-border)] text-[var(--status-issue-fg)] hover:bg-[var(--status-issue-bg)]"
                    onClick={() => {
                      setScanActionSheetOpen(false);
                      openScanDialog();
                    }}
                    data-testid="btn-scan-action-report-issue"
                  >
                    <Wrench className="w-5 h-5" />
                    Report Issue / Update Status
                  </Button>

                  <Button
                    variant="ghost"
                    className="w-full text-sm text-muted-foreground"
                    onClick={() => {
                      setScanActionSheetOpen(false);
                      setScanActionDone(false);
                    }}
                    data-testid="btn-scan-action-dismiss"
                  >
                    View Full Details
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <CheckCircle2 className="w-14 h-14 text-[var(--status-ok-fg)]" />
                <p className="font-bold text-lg">{t.equipmentDetail.actionDone}</p>
                <p className="text-muted-foreground text-sm">{t.equipmentDetail.actionDoneBody(equipmentDisplayName)}</p>
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    setScanActionDone(false);
                    navigate("/?scan=1");
                  }}
                  data-testid="btn-scan-another-item"
                >
                  <Scan className="w-4 h-4" />
                  Scan Another Item
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-sm"
                  onClick={() => {
                    setScanActionSheetOpen(false);
                    setScanActionDone(false);
                  }}
                >
                  Stay Here
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {equipment && id && (
        <EquipmentDetailToolsSheet
          equipment={equipment}
          equipmentId={id}
          open={toolsSheetOpen}
          onOpenChange={setToolsSheetOpen}
          onPrintQr={handlePrintQr}
          onWriteNfc={showWriteNfc ? () => void writeEquipmentNfcTag(id) : undefined}
          showWhatsApp={showWhatsAppTools}
          showWriteNfc={showWriteNfc}
        />
      )}

      {/* Move to Room bottom sheet */}
      {equipment && (
        <MoveRoomSheet
          equipment={equipment}
          open={moveRoomOpen}
          onOpenChange={setMoveRoomOpen}
          onMoved={(newRoomId) => {
            queryClient.setQueryData(
              [`/api/equipment/${id}`],
              (prev: Equipment | undefined) => prev ? { ...prev, roomId: newRoomId } : prev,
            );
            queryClient.invalidateQueries({ queryKey: [`/api/equipment/${id}`] });
          }}
        />
      )}
    </>
  );
  return <AppShell>{pageContent}</AppShell>;
}
