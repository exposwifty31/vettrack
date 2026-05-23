import { t } from "@/lib/i18n";
import { useState, useRef, useEffect } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { STATUS_LABELS } from "@/types";
import type { EquipmentStatus, Equipment } from "@/types";
import {
  ArrowLeft,
  QrCode,
  Scan,
  ClipboardEdit,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Droplets,
  MessageCircle,
  Package,
  MapPin,
  Calendar,
  Hash,
  Clock,
  FolderOpen,
  Loader2,
  LogIn,
  LogOut,
  User,
  Camera,
  Copy,
  MoveHorizontal,
  CalendarX,
  CalendarClock,
  CalendarCheck,
} from "lucide-react";
import {
  cn,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  buildWhatsAppUrl,
  isOverdue,
  isSterilizationDue,
  getExpiryBadgeState,
} from "@/lib/utils";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { toast } from "sonner";
import { toastSuccess } from "@/lib/ui-toast";
import { useAuth } from "@/hooks/use-auth";
import { useSyncQueue } from "@/hooks/use-sync";
import { MoveRoomSheet } from "@/components/move-room-sheet";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { useSettings } from "@/hooks/use-settings";
import { playCriticalAlertTone } from "@/lib/sounds";
import { haptics } from "@/lib/haptics";
import { safeStorageSetItem } from "@/lib/safe-browser";
import { isOnline } from "@/lib/safe-browser";
import { isPilotMode } from "@/lib/pilot-mode";

const STATUS_CONFIG = {
  ok: { icon: CheckCircle2, color: "text-emerald-600", iconBg: "bg-emerald-50" },
  issue: { icon: AlertTriangle, color: "text-red-500", iconBg: "bg-red-50" },
  maintenance: { icon: Wrench, color: "text-amber-500", iconBg: "bg-amber-50" },
  sterilized: { icon: Droplets, color: "text-teal-500", iconBg: "bg-teal-50" },
};

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
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const { isAdmin, email, userId, role, effectiveRole } = useAuth();
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
  const { settings } = useSettings();
  const { discard } = useSyncQueue();
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

  const { data: transfers, isLoading: transfersLoading } = useQuery({
    queryKey: [`/api/equipment/${id}/transfers`],
    queryFn: () => api.equipment.transfers(id!),
    enabled: !!id && queryEnabled,
    retry: false,
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
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setJustConfirmed(true);
      setTimeout(() => setJustConfirmed(false), 1500);
    } catch {
      toast.error("Couldn't confirm — check connection");
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
    if (equipment.model) params.set("copyModel", equipment.model);
    if (equipment.manufacturer) params.set("copyManuf", equipment.manufacturer);
    if (equipment.purchaseDate) params.set("copyPurchaseDate", equipment.purchaseDate);
    if (equipment.location) params.set("copyLocation", equipment.location);
    if (equipment.folderId) params.set("copyFolder", equipment.folderId);
    if (equipment.maintenanceIntervalDays)
      params.set("copyMaint", String(equipment.maintenanceIntervalDays));
    params.set("copiedFrom", equipment.name);
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

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;

  if (isLoading) {
    return <EquipmentDetailSkeleton />;
  }

  if (isError) {
    const errorContent = (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <AlertTriangle className="w-10 h-10 text-destructive opacity-60" />
        <div>
          <p className="font-semibold text-foreground">טעינת הציוד נכשלה</p>
          <p className="text-sm text-muted-foreground mt-1">בדוק את החיבור ונסה שוב</p>
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
    if (isDesktop) return <PageShell>{errorContent}</PageShell>;
    return <Layout>{errorContent}</Layout>;
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
    if (isDesktop) return <PageShell>{notFoundContent}</PageShell>;
    return <Layout>{notFoundContent}</Layout>;
  }

  const statusConf = STATUS_CONFIG[equipment.status as keyof typeof STATUS_CONFIG];
  const StatusIcon = statusConf?.icon || Package;
  const overdue = isOverdue(equipment);
  const sterilizationDue = isSterilizationDue(equipment);
  const isCheckedOut = !!equipment.checkedOutById;
  const checkedOutByMe = equipment.checkedOutById === userId;

  const pageContent = (
    <>
      <Helmet>
        <title>{equipment.name} — VetTrack</title>
        <meta name="description" content={`Equipment detail for ${equipment.name}. Status: ${equipment.status}${equipment.location ? `. Location: ${equipment.location}` : ""}. Update status, check out, report issues, and view full history.`} />
        <link rel="canonical" href={`https://vettrack.replit.app/equipment/${equipment.id}`} />
      </Helmet>
      <div className="flex flex-col gap-4 pb-28 animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate("/equipment")}
              data-testid="btn-back"
              aria-label="Back to equipment list"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden />
            </Button>
            <div>
              <h1 className="text-2xl font-bold leading-tight">{equipment.name}</h1>
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
                aria-label="Duplicate equipment"
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
                aria-label="Edit equipment"
                data-testid="btn-edit"
              >
                <Pencil className="w-4 h-4" aria-hidden />
              </Button>
            )}
            {isAdmin && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    aria-label="Delete equipment"
                    data-testid="btn-delete"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {equipment.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This hides the equipment from active lists (soft-delete). Audit and scan history are preserved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMut.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Quick Action Bar — ICU-moment: 1–2 large, instantly tappable actions */}
        <div className="flex flex-col gap-2" data-testid="quick-action-bar">
          {/* Pilot mode: Confirm here replaces checkout/return */}
          {isPilotMode ? (
            <Button
              className={cn(
                "w-full h-12 gap-2 text-sm font-semibold rounded-2xl active:scale-[0.98] transition-all",
                justConfirmed
                  ? "bg-emerald-600 hover:bg-emerald-600 text-white border-emerald-600"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
              variant="outline"
              onClick={handleConfirmHere}
              disabled={confirmingHere}
              data-testid="btn-confirm-here"
            >
              {confirmingHere ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {justConfirmed ? t.equipmentDetail.confirmedHere : t.equipmentDetail.confirmHere}
            </Button>
          ) : !isCheckedOut ? (
            <Button
              variant="outline"
              className="w-full h-12 gap-2 text-sm font-semibold rounded-2xl active:scale-[0.98] transition-all border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              onClick={() => checkoutMut.mutate()}
              disabled={checkoutMut.isPending}
              data-testid="btn-checkout"
            >
              {checkoutMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              In Use
            </Button>
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
              Return
            </Button>
          ) : null}

          {/* Secondary action row — students: scan / take / return only (no room move). */}
          <div className={cn("grid gap-2", isStudentEquipmentRole ? "grid-cols-2" : "grid-cols-3")}>
            <Button
              variant="outline"
              className="h-11 gap-1.5 text-sm font-medium rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 active:scale-[0.98] transition-all"
              onClick={() => {
                setReportIssueNote("");
                setReportIssuePhoto(null);
                setReportIssueNoteError("");
                setReportIssueOpen(true);
              }}
              data-testid="btn-report-issue"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Issue
            </Button>
            <Button
              variant="outline"
              className="h-11 gap-1.5 text-sm font-medium rounded-xl active:scale-[0.98] transition-all"
              onClick={openScanDialog}
              data-testid="btn-scan"
            >
              <ClipboardEdit className="w-3.5 h-3.5" />
              Status
            </Button>
            {!isStudentEquipmentRole && (
              <Button
                variant="outline"
                className="h-11 gap-1.5 text-sm font-medium rounded-xl active:scale-[0.98] transition-all"
                onClick={() => setMoveRoomOpen(true)}
                data-testid="btn-move-room"
              >
                <MoveHorizontal className="w-3.5 h-3.5" />
                Move
              </Button>
            )}
          </div>

          {/* In-use context indicator — full-platform only */}
          {!isPilotMode && isCheckedOut && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/60 bg-muted/50 text-sm">
              <User className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-sm leading-tight">
                  {checkedOutByMe ? t.equipmentDetail.toast.checkedOutByYou : t.equipmentDetail.checkedOutBy(equipment.checkedOutByEmail || t.common.unknown)}
                </p>
                {equipment.checkedOutLocation && (
                  <p className="text-xs mt-0.5 opacity-80 truncate">{equipment.checkedOutLocation}</p>
                )}
                <p className="text-xs mt-0.5 opacity-70">Since {formatRelativeTime(equipment.checkedOutAt)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Status card */}
        <Card className="bg-card border-border/60 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${statusConf?.iconBg || "bg-muted"}`}>
                  <StatusIcon className={`w-5 h-5 ${statusConf?.color || ""}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current Status</p>
                  <p className="text-lg font-bold">
                    {STATUS_LABELS[equipment.status as keyof typeof STATUS_LABELS] || equipment.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last scan: {formatRelativeTime(equipment.lastSeen?.toString())}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 items-end shrink-0">
                <Button variant="outline" size="sm" onClick={handlePrintQr} data-testid="btn-print-qr" className="h-11">
                  <QrCode className="w-3.5 h-3.5 mr-1" />
                  {t.equipmentDetail.printQrButton}
                </Button>
                {!isStudentEquipmentRole && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const waUrl = buildWhatsAppUrl(
                        undefined,
                        equipment.name,
                        equipment.status as EquipmentStatus,
                        t.whatsAppMessage.statusReport(equipment.name),
                        t.whatsAppMessage
                      );
                      window.open(waUrl, "_blank");
                    }}
                    className="h-11 text-green-700 border-green-200 hover:bg-green-50"
                    data-testid="btn-whatsapp"
                  >
                    <MessageCircle className="w-3.5 h-3.5 mr-1" />
                    WhatsApp
                  </Button>
                )}
              </div>
            </div>

            {undoCountdown > 0 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 rounded-full transition-none"
                    style={{ width: `${(undoCountdown / (UNDO_WINDOW_MS / 1000)) * 100}%`, transition: "width 1s linear" }}
                  />
                </div>
              </div>
            )}

            {(overdue || sterilizationDue) && (
              <div className="mt-3 pt-3 border-t border-border/40 flex flex-col gap-1">
                {overdue && (
                  <div className="flex items-center gap-2 text-xs text-red-700 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Maintenance overdue!
                  </div>
                )}
                {sterilizationDue && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Sterilization due (7+ days)
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pilot: scan count — no names, aggregate only */}
        {isPilotMode && scanLogsPages && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span>{t.equipmentDetail.scanCount(scanLogsPages.pages[0]?.total ?? 0)}</span>
          </div>
        )}

        {/* Floor note — inline editable for technician+ */}
        {editingFloorNote ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200/60 bg-amber-50/60 dark:border-amber-800/30 dark:bg-amber-950/20 px-3.5 py-3">
            <Textarea
              autoFocus
              value={floorNoteText}
              onChange={(e) => setFloorNoteText(e.target.value.slice(0, 200))}
              placeholder={t.equipmentDetail.floorNotePlaceholder}
              className="min-h-[72px] resize-none text-xs bg-white/70 dark:bg-black/20 border-amber-200/60"
              maxLength={200}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-amber-700/60 dark:text-amber-400/60">
                {floorNoteText.length}/200
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => setEditingFloorNote(false)}
                  disabled={floorNoteMut.isPending}
                >
                  {t.equipmentDetail.floorNoteCancel}
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
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
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/60 bg-amber-50/60 dark:border-amber-800/30 dark:bg-amber-950/20 px-3.5 py-3">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="flex-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              {equipment.usuallyFoundHere}
            </p>
            {!isStudentEquipmentRole && (
              <button
                onClick={() => { setFloorNoteText(equipment.usuallyFoundHere ?? ""); setEditingFloorNote(true); }}
                className="shrink-0 text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200"
                aria-label="Edit floor note"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          !isStudentEquipmentRole && (
            <button
              onClick={() => { setFloorNoteText(""); setEditingFloorNote(true); }}
              className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 px-1 py-0.5"
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
        <Tabs defaultValue="details">
          <TabsList className="w-full">
            <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              History ({scanLogs?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="transfers" className="flex-1">
              Transfers ({transfers?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <Card className="bg-card border-border/60 shadow-sm">
              <CardContent className="p-4 flex flex-col gap-3">
                {[
                  { icon: Hash, label: t.equipmentDetail.serialNumber, value: equipment.serialNumber },
                  { icon: Package, label: t.equipmentDetail.model, value: equipment.model },
                  { icon: Package, label: t.equipmentDetail.manufacturer, value: equipment.manufacturer },
                  { icon: Calendar, label: t.equipmentDetail.purchaseDate, value: formatDate(equipment.purchaseDate) },
                  { icon: Calendar, label: "Expiry Date", value: formatDate(equipment.expiryDate) },
                  { icon: MapPin, label: t.equipmentDetail.location, value: equipment.location },
                  {
                    icon: Clock,
                    label: t.equipmentDetail.maintenanceInterval,
                    value: equipment.maintenanceIntervalDays
                      ? `${equipment.maintenanceIntervalDays} days`
                      : undefined,
                  },
                  {
                    icon: Wrench,
                    label: t.equipmentDetail.lastMaintenance,
                    value: formatDateTime(equipment.lastMaintenanceDate?.toString()),
                  },
                  {
                    icon: Droplets,
                    label: t.equipmentDetail.lastSterilization,
                    value: formatDateTime(equipment.lastSterilizationDate?.toString()),
                  },
                ]
                  .filter((r) => r.value && r.value !== "—")
                  .map((row, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <row.icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{row.label}</p>
                        <p className="text-sm font-medium">{row.value}</p>
                      </div>
                    </div>
                  ))}
                {(() => {
                  const expiryState = getExpiryBadgeState(equipment.expiryDate);
                  if (!expiryState) return null;
                  if (expiryState === "expired") {
                    return (
                      <Badge variant="issue" className="mt-1 text-xs font-medium">
                        <CalendarX className="w-3.5 h-3.5" />
                        Expired
                      </Badge>
                    );
                  }
                  if (expiryState === "expiring_soon") {
                    return (
                      <Badge variant="maintenance" className="mt-1 text-xs font-medium">
                        <CalendarClock className="w-3.5 h-3.5" />
                        Expiring Soon (≤7 days)
                      </Badge>
                    );
                  }
                  return (
                    <Badge variant="ok" className="mt-1 text-xs font-medium">
                      <CalendarCheck className="w-3.5 h-3.5" />
                      Valid
                    </Badge>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <div className="flex flex-col gap-2">
              {logsLoading ? (
                <>
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </>
              ) : !scanLogs || scanLogs.length === 0 ? (
                <Card className="bg-card border-border/60 shadow-sm">
                  <CardContent className="p-8 text-center">
                    <p className="text-muted-foreground text-sm">No scan history yet</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {scanLogs.map((log) => (
                    <Card key={log.id} className="bg-card border-border/60 shadow-sm">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant={statusToBadgeVariant(log.status)}>
                                {STATUS_LABELS[log.status as keyof typeof STATUS_LABELS] || log.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground truncate">
                                {log.userEmail}
                              </span>
                            </div>
                            {log.note && (
                              <p className="text-xs text-muted-foreground mt-1">{log.note}</p>
                            )}
                            {log.photoUrl && (
                              <img
                                src={log.photoUrl}
                                alt={t.equipmentDetail.issuePhoto}
                                width={96}
                                height={96}
                                loading="lazy"
                                decoding="async"
                                className="mt-2 rounded-lg w-24 h-24 object-cover border"
                                style={{ aspectRatio: "1 / 1" }}
                              />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground shrink-0">
                            {formatRelativeTime(log.timestamp.toString())}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {hasOlderLogs && (
                    <div className="flex justify-center pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 text-xs"
                        onClick={() => fetchOlderLogs()}
                        disabled={isFetchingOlderLogs}
                        data-testid="btn-load-older-logs"
                      >
                        {isFetchingOlderLogs ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" />טוען...</>
                        ) : (
                          t.equipmentDetail.loadOlder
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="transfers">
            <div className="flex flex-col gap-2">
              {transfersLoading ? (
                <>
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </>
              ) : !transfers || transfers.length === 0 ? (
                <Card className="bg-card border-border/60 shadow-sm">
                  <CardContent className="p-8 text-center">
                    <p className="text-muted-foreground text-sm">No transfers recorded</p>
                  </CardContent>
                </Card>
              ) : (
                transfers.map((transfer) => (
                  <Card key={transfer.id} className="bg-card border-border/60 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">
                              {transfer.fromFolderName ?? "—"} → {transfer.toFolderName ?? "—"}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {formatRelativeTime(transfer.timestamp.toString())}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ReturnPlugDialog
        open={returnDialogOpen}
        onOpenChange={setReturnDialogOpen}
        equipmentName={equipment.name}
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
            <DialogDescription>Log status for: {equipment.name}</DialogDescription>
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
                    {s === "ok" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {s === "issue" && <AlertTriangle className="w-4 h-4 text-red-500" />}
                    {s === "maintenance" && <Wrench className="w-4 h-4 text-amber-500" />}
                    {s === "sterilized" && <Droplets className="w-4 h-4 text-teal-500" />}
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">
                Note
                {scanStatus === "issue" && (
                  <span className="text-red-500 ml-1">*</span>
                )}
                {scanStatus !== "issue" && (
                  <span className="text-muted-foreground text-xs ml-1">(optional)</span>
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
                className={noteError ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {noteError && (
                <p className="text-xs text-red-600 font-medium">{noteError}</p>
              )}
            </div>

            {/* Photo — shown prominently for issues, available for all */}
            {scanStatus === "issue" && (
              <div className="flex flex-col gap-1.5">
                <Label>
                  Photo
                  <span className="text-muted-foreground text-xs ml-1">(strongly recommended)</span>
                </Label>
                {scanPhoto ? (
                  <div className="relative">
                    <img
                      src={scanPhoto}
                      alt="Issue photo"
                      className="w-full h-36 object-cover rounded-xl border-2 border-primary/30"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 bg-white/80 text-xs h-11 min-w-[44px]"
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
                    <span className="text-sm font-medium">Take / Upload Photo</span>
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
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ClipboardEdit className="w-4 h-4 mr-2" />
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
            <DialogDescription>{equipment.name}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-issue-note">
                Describe the issue
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <Textarea
                id="report-issue-note"
                placeholder="Describe the issue clearly..."
                value={reportIssueNote}
                onChange={(e) => {
                  setReportIssueNote(e.target.value);
                  if (e.target.value.trim()) setReportIssueNoteError("");
                }}
                rows={3}
                data-testid="report-issue-note"
                className={reportIssueNoteError ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {reportIssueNoteError && (
                <p className="text-xs text-red-600 font-medium">{reportIssueNoteError}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                Photo
                <span className="text-muted-foreground text-xs ml-1">(optional)</span>
              </Label>
              {reportIssuePhoto ? (
                <div className="relative">
                  <img
                    src={reportIssuePhoto}
                    alt="Issue photo"
                    className="w-full h-36 object-cover rounded-xl border-2 border-primary/30"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1 bg-white/80 text-xs h-11 min-w-[44px]"
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
                  <span className="text-sm font-medium">Take / Upload Photo</span>
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
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="btn-confirm-report-issue"
            >
              {reportIssueMut.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <AlertTriangle className="w-4 h-4 mr-2" />
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
                      {equipment.name}
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
                    {STATUS_LABELS[equipment.status as keyof typeof STATUS_LABELS] || equipment.status}
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
                        Location: {equipment.checkedOutLocation}
                      </p>
                    )}
                  </div>
                )}

                {/* Quick action buttons */}
                <div className="flex flex-col gap-2.5">
                  {!isCheckedOut && (
                    <Button
                      size="lg"
                      className="w-full gap-2.5"
                      onClick={() => checkoutMut.mutate()}
                      disabled={checkoutMut.isPending || returnMut.isPending}
                      data-testid="btn-scan-action-checkout"
                    >
                      {checkoutMut.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <LogIn className="w-5 h-5" />
                      )}
                      Check Out
                    </Button>
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
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-800">
                      Only the person who checked this out (or an admin) can return it.
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full gap-2.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
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
                <CheckCircle2 className="w-14 h-14 text-emerald-500" />
                <p className="font-bold text-lg">Done!</p>
                <p className="text-muted-foreground text-sm">Action completed for {equipment.name}.</p>
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
  if (isDesktop) return <PageShell>{pageContent}</PageShell>;
  return <Layout>{pageContent}</Layout>;
}
