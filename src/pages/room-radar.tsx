import { t } from "@/lib/i18n";
import { useState, useEffect, useRef } from "react";
import { useParams, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { Layout } from "@/components/layout";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { MoveRoomSheet } from "@/components/move-room-sheet";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Package,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldCheck,
  MapPin,
  MoveRight,
  Eye,
  EyeOff,
  Radar,
  Activity,
  User,
  LogIn,
  LogOut,
  PawPrint,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { STATUS_LABELS } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import type { Equipment, Room, RoomActivityEntry, EquipmentStatus } from "@/types";
import { ReturnPlugDialog } from "@/components/return-plug-dialog";
import { haptics } from "@/lib/haptics";

function toInitials(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase() + ".";
  return parts[0][0].toUpperCase() + "." + parts[parts.length - 1][0].toUpperCase() + ".";
}

function activityActionLabel(entry: RoomActivityEntry): string {
  const rr = t.roomRadarPage;
  if (entry.note?.startsWith("Room verified:")) return rr.verifiedReset;
  if (entry.status === "ok") return rr.activityScannedOk;
  if (entry.status === "issue") return rr.activityIssue;
  if (entry.status === "maintenance") return rr.activityMaintenance;
  return rr.activityScannedStatus.replace("{status}", entry.status);
}

function SyncBadge({ status }: { status: string }) {
  const rr = t.roomRadarPage;
  if (status === "synced") {
    return (
      <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-300 rounded-full px-2.5 py-1">
        <CheckCircle2 className="w-3 h-3" />
        {rr.syncedBadge}
      </div>
    );
  }
  if (status === "requires_audit") {
    return (
      <div className="flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300 rounded-full px-2.5 py-1">
        <AlertTriangle className="w-3 h-3" />
        {rr.auditBadge}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300 rounded-full px-2.5 py-1">
      <Clock className="w-3 h-3" />
      {rr.staleBadge}
    </div>
  );
}

const STATUS_BAR_COLORS: Record<EquipmentStatus, string> = {
  ok: "border-s-status-ok",
  issue: "border-s-status-issue",
  maintenance: "border-s-status-maintenance",
  sterilized: "border-s-status-sterilized",
  critical: "border-s-destructive",
  needs_attention: "border-s-orange-500",
};

interface RadarEquipmentCardProps {
  equipment: Equipment;
  justVerified?: boolean;
}

function RadarEquipmentCard({ equipment: eq, justVerified }: RadarEquipmentCardProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [tapped, setTapped] = useState(false);
  const busyRef = useRef(false);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const { userId, isAdmin } = useAuth();
  const isCheckedOut = !!eq.checkedOutById;
  const checkedOutByMe = eq.checkedOutById === userId;
  const statusVariant = statusToBadgeVariant(eq.status);

  useEffect(() => {
    return () => { if (tapTimerRef.current) clearTimeout(tapTimerRef.current); };
  }, []);

  const checkoutMut = useMutation({
    mutationFn: () => api.equipment.checkout(eq.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast.success(`${t.roomRadarPage.checkoutSuccess} — ${eq.name}`);
    },
    onError: () => toast.error(t.roomRadarPage.checkoutError),
    onSettled: () => { busyRef.current = false; },
  });

  const returnMut = useMutation({
    mutationFn: (payload: { isPluggedIn: boolean; plugInDeadlineMinutes?: number }) =>
      api.equipment.return(eq.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast.success(`${t.roomRadarPage.returnSuccess} — ${eq.name}`);
    },
    onError: () => toast.error(t.roomRadarPage.returnError),
    onSettled: () => { busyRef.current = false; },
  });

  const quickAction = !isCheckedOut && eq.status === "ok"
    ? { label: t.roomRadarPage.checkoutLabel, icon: LogIn, action: () => checkoutMut.mutate(), pending: checkoutMut.isPending, cls: "text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40" }
    : isCheckedOut && (checkedOutByMe || isAdmin) && eq.status === "ok"
    ? { label: t.roomRadarPage.returnLabel, icon: LogOut, action: () => setReturnDialogOpen(true), pending: returnMut.isPending, cls: "text-primary border-primary/30 hover:bg-primary/10 dark:hover:bg-primary/15" }
    : null;

  const handleQuickAction = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!quickAction || quickAction.pending || busyRef.current) return;
    busyRef.current = true;
    setTapped(true);
    tapTimerRef.current = setTimeout(() => setTapped(false), 300);
    try { quickAction.action(); } catch { busyRef.current = false; toast.error(t.roomRadarPage.actionFailed); }
  };

  const verifierInitials = justVerified ? null : toInitials(eq.lastVerifiedByName);
  const verifiedLabel = justVerified
    ? t.roomRadarPage.verifiedNow
    : eq.lastVerifiedAt
    ? `${t.roomRadarPage.verifiedPrefix} ${formatRelativeTime(eq.lastVerifiedAt)}${verifierInitials ? ` · ${verifierInitials}` : ""}`
    : null;

  const holderLabel = isCheckedOut
    ? eq.checkedOutByEmail?.split("@")[0] ?? "Someone"
    : null;
  const locationLabel = eq.checkedOutLocation || eq.location || eq.roomName || null;

  return (
    <>
      <Card
        className={cn(
          "border-border/60 shadow-sm transition-all overflow-hidden",
          justVerified && "border-emerald-300 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20",
          tapped && "scale-[0.98]"
        )}
        data-testid={`radar-item-${eq.id}`}
      >
        <div className={cn("flex border-s-[6px]", STATUS_BAR_COLORS[eq.status] ?? "border-s-gray-400")}>
          <CardContent className="p-3 flex-1 min-w-0">
            {/* Row 1: icon + name + badges */}
            <div className="flex items-center gap-3">
              {eq.imageUrl ? (
                <img
                  src={eq.imageUrl}
                  alt={eq.name}
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-muted-foreground" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <Link href={`/equipment/${eq.id}`}>
                  <p className="font-bold text-base truncate leading-snug hover:text-primary transition-colors">
                    {eq.name}
                  </p>
                </Link>
                {eq.linkedAnimalName && (
                  <p className="flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300 mt-0.5">
                    <PawPrint className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    {t.equipmentList.linkedInUse(eq.linkedAnimalName)}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge variant={statusVariant} className="text-[10px] py-0 px-2 h-5">
                    {STATUS_LABELS[eq.status as keyof typeof STATUS_LABELS] ?? eq.status}
                  </Badge>
                  {isCheckedOut ? (
                    <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">{t.roomRadarPage.inUseCard}</span>
                  ) : (
                    <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{t.roomRadarPage.availableCard}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Row 2: holder + location + verified */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              {holderLabel && (
                <span className="flex items-center gap-1 truncate">
                  <User className="w-3 h-3 shrink-0" />
                  {holderLabel}
                </span>
              )}
              {locationLabel && (
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {locationLabel}
                </span>
              )}
              {verifiedLabel ? (
                <span className={cn(
                  "flex items-center gap-1",
                  justVerified ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""
                )}>
                  {justVerified && <CheckCircle2 className="w-2.5 h-2.5" />}
                  {verifiedLabel}
                </span>
              ) : (
                <span className="text-muted-foreground/60">{t.roomRadarPage.notVerified}</span>
              )}
            </div>

            {/* Row 3: actions */}
            <div className="flex items-center gap-2 mt-2.5">
              {quickAction && (
                <button
                  onClick={handleQuickAction}
                  disabled={quickAction.pending}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-bold transition-all min-h-[44px] active:scale-[0.97]",
                    quickAction.cls
                  )}
                  data-testid={`quick-action-${eq.id}`}
                >
                  {quickAction.pending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <quickAction.icon className="w-3.5 h-3.5" />
                  )}
                  {quickAction.label}
                </button>
              )}
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMoveOpen(true); }}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors min-h-[44px]"
                title={`${t.roomRadarPage.moveButton} ${eq.name}`}
              >
                <MoveRight className="w-3 h-3" />
                {t.roomRadarPage.moveButton}
              </button>
              <Link href={`/equipment/${eq.id}`} className="ml-auto">
                <div className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            </div>
          </CardContent>
        </div>
      </Card>

      <MoveRoomSheet
        equipment={eq}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onMoved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
          queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
        }}
      />
      <ReturnPlugDialog
        open={returnDialogOpen}
        onOpenChange={setReturnDialogOpen}
        defaultDeadlineMinutes={30}
        onConfirm={(payload) => {
          returnMut.mutate(payload, {
            onSettled: () => setReturnDialogOpen(false),
          });
        }}
      />
    </>
  );
}

export default function RoomRadarPage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useAuth();
  const searchStr = useSearch();
  const nfcParam = new URLSearchParams(searchStr).get("verify");
  const queryClient = useQueryClient();

  const [availableOnly, setAvailableOnly] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [nfcOverlayOpen, setNfcOverlayOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<"idle" | "verifying" | "done">("idle");
  const [verifiedCount, setVerifiedCount] = useState(0);
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current); };
  }, []);

  useEffect(() => {
    if (nfcParam === "true" && id) {
      setNfcOverlayOpen(true);
    }
  }, [nfcParam, id]);

  const { data: activityEntries, isLoading: activityLoading } = useQuery({
    queryKey: ["/api/rooms", id, "activity"],
    queryFn: () => api.rooms.activity(id!),
    enabled: !!userId && !!id && activityOpen,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: room, isLoading: roomLoading, isError: roomError } = useQuery({
    queryKey: ["/api/rooms", id],
    queryFn: () => api.rooms.get(id!),
    enabled: !!userId && !!id,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: allEquipment, isLoading: equipLoading } = useQuery({
    queryKey: ["/api/equipment"],
    queryFn: api.equipment.list,
    enabled: !!userId,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const roomEquipment = allEquipment?.filter((e) => e.roomId === id) ?? [];

  const filtered = availableOnly
    ? roomEquipment.filter((e) => !e.checkedOutById)
    : roomEquipment;

  const availableCount = roomEquipment.filter((e) => !e.checkedOutById).length;
  const inUseCount = roomEquipment.filter((e) => !!e.checkedOutById).length;
  const issueCount = roomEquipment.filter((e) => e.status === "issue" || e.status === "maintenance").length;

  const verifyMut = useMutation({
    mutationFn: () => api.rooms.bulkVerify(id!),
    onSuccess: (result) => {
      setVerifiedCount(result.affected);
      setVerifyState("done");
      haptics.scanSuccess();
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      verifyTimerRef.current = setTimeout(() => {
        setVerifyState("idle");
      }, 4000);
    },
    onError: (err: Error) => {
      setVerifyState("idle");
      toast.error(err.message || t.roomRadarPage.verifyFailed);
    },
  });

  const handleVerifyAll = () => {
    if (verifyState !== "idle") return;
    setVerifyState("verifying");
    verifyMut.mutate();
  };

  const isLoading = roomLoading || equipLoading;

  const handleNfcConfirm = () => {
    setNfcOverlayOpen(false);
    handleVerifyAll();
  };

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  const pageContent = (
    <>
      <Helmet>
        <title>{room ? `${room.name} — Asset Radar` : "Asset Radar"} — VetTrack</title>
      </Helmet>

      {/* NFC Room Reset Overlay — triggered by ?verify=true deep link */}
      {nfcOverlayOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setNfcOverlayOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-card rounded-2xl shadow-2xl border border-border overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header strip */}
            <div className="bg-primary/10 px-5 pt-6 pb-4 text-center">
              <div className="w-14 h-14 rounded-full bg-primary/15 border-2 border-primary/30 flex items-center justify-center mx-auto mb-3">
                <Radar className="w-7 h-7 text-primary" />
              </div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-primary/70 mb-1">{t.roomRadarPage.nfcResetLabel}</p>
              <h2 className="text-lg font-bold text-foreground leading-snug">
                {room?.name ?? t.roomRadarPage.loadingRoom}
              </h2>
              {room?.floor && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {room.floor}
                </p>
              )}
            </div>

            {/* Body */}
            <div className="px-5 py-4 flex flex-col gap-2">
              <p className="text-sm text-muted-foreground text-center leading-relaxed">
                Tapping this NFC tag will mark{" "}
                <span className="font-semibold text-foreground">all equipment in this room</span> as verified.
                Confirm only if all items are present and accounted for.
              </p>

              <div className="flex items-center justify-between text-xs bg-muted/60 border border-border rounded-lg px-3 py-2 mt-1">
                <span className="text-muted-foreground">{t.roomRadarPage.nfcItemsInRoom}</span>
                <span className="font-bold text-foreground">{roomEquipment.length}</span>
              </div>

              <p className="text-[11px] text-muted-foreground text-center mt-1">
                💡 Tap the door sticker to verify all items instantly — no scanning required.
              </p>
            </div>

            {/* Actions */}
            <div className="px-5 pb-6 flex flex-col gap-2">
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-white font-semibold h-12 text-base rounded-xl shadow-sm"
                onClick={handleNfcConfirm}
                disabled={verifyState === "verifying" || roomEquipment.length === 0}
              >
                {verifyState === "verifying" ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Verifying…</>
                ) : (
                  <><ShieldCheck className="w-4 h-4 mr-2" />{t.roomRadarPage.nfcConfirmInventory}</>
                )}
              </Button>
              <button
                className="w-full text-sm text-muted-foreground hover:text-foreground py-2 transition-colors font-medium"
                onClick={() => setNfcOverlayOpen(false)}
              >
                {t.roomRadarPage.nfcDismiss}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5 pb-20 animate-fade-in">
        {/* Back + Header */}
        <div className="pt-1">
          <Link href="/rooms">
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3 -ml-1">
              <ArrowLeft className="w-4 h-4" />
              {t.roomRadarPage.allRooms}
            </button>
          </Link>

          {roomLoading ? (
            <div className="flex flex-col gap-2" role="status" aria-live="polite" aria-busy="true">
              <span className="sr-only">{t.common.loading}</span>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                {t.common.loading}
              </p>
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-5 w-28" />
            </div>
          ) : roomError ? (
            <div className="flex flex-col gap-3 py-4">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p className="font-semibold text-base">{t.roomRadarPage.roomLoadError}</p>
              </div>
              <p className="text-sm text-muted-foreground">{t.roomRadarPage.roomLoadErrorDesc}</p>
              <Link href="/rooms">
                <Button variant="outline" size="sm" className="gap-2 mt-1">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {t.roomRadarPage.backToRooms}
                </Button>
              </Link>
            </div>
          ) : room ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold leading-tight">{room.name}</h1>
                  <SyncBadge status={room.syncStatus} />
                </div>
                {room.floor && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" />
                    {room.floor}
                  </p>
                )}
                {room.linkedPatientName ? (
                  <p className="flex items-center gap-2 text-sm font-semibold text-violet-800 dark:text-violet-200 mt-2">
                    <PawPrint className="w-4 h-4 shrink-0" aria-hidden />
                    <span>
                      {t.roomRadarPage.patientActive}: {room.linkedPatientName}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">{t.roomRadarPage.roomVacant}</p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Stats row */}
        {!isLoading && roomEquipment.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-semibold bg-primary/5 border border-primary/20 text-primary rounded-full px-3 py-1.5">
              <span className="font-bold">{availableCount}</span>
              <span className="text-[11px]">{t.roomRadarPage.availableStat}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold bg-muted border border-border text-muted-foreground rounded-full px-3 py-1.5">
              <span className="font-bold">{inUseCount}</span>
              <span className="text-[11px]">{t.roomRadarPage.inUseStat}</span>
            </div>
            {issueCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs font-semibold bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-full px-3 py-1.5">
                <AlertTriangle className="w-3 h-3" />
                <span className="font-bold">{issueCount}</span>
                <span className="text-[11px]">{issueCount !== 1 ? t.roomRadarPage.issuesStat : t.roomRadarPage.issueStat}</span>
              </div>
            )}
          </div>
        )}

        {/* Controls row: filter toggle + verify all */}
        {!isLoading && roomEquipment.length > 0 && (
          <div className="flex items-center gap-3">
            {/* Available-only toggle */}
            <button
              onClick={() => setAvailableOnly((v) => !v)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-all min-h-[44px]",
                availableOnly
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-foreground border-border hover:bg-muted"
              )}
            >
              {availableOnly ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              {t.roomRadarPage.availableOnly}
            </button>

            {/* Verify all button */}
            <button
              onClick={handleVerifyAll}
              disabled={verifyState !== "idle"}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all min-h-[44px] border",
                verifyState === "done"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-md"
                  : "bg-primary text-primary-foreground border-primary hover:bg-primary/90 active:scale-[0.98] shadow-sm"
              )}
            >
              {verifyState === "verifying" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.roomRadarPage.verifying}
                </>
              ) : verifyState === "done" ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {t.roomRadarPage.itemsVerified(verifiedCount)}
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  {t.roomRadarPage.verifyAllInRoom(room?.name ?? "Room")}
                </>
              )}
            </button>
          </div>
        )}

        {/* Equipment list */}
        {isLoading ? (
          <div className="flex flex-col gap-3" role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">{t.common.loading}</span>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              {t.common.loading}
            </p>
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : roomEquipment.length === 0 ? (
          <div className="flex flex-col items-center gap-5 py-10 text-center">
            <div className="w-16 h-16 rounded-full bg-muted/70 flex items-center justify-center border border-border">
              <Package className="w-8 h-8 text-muted-foreground/60" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-base text-foreground">{t.roomRadarPage.roomEmptyTitle}</p>
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                {t.roomRadarPage.roomEmptyDesc}
              </p>
            </div>
            <Link href="/equipment">
              <Button variant="outline" size="sm" className="gap-2">
                <Package className="w-3.5 h-3.5" />
                {t.roomRadarPage.browseEquipment}
              </Button>
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Radar}
            message={t.roomRadarPage.noAvailableEquipment}
            subMessage={t.roomRadarPage.allCheckedOutSubMessage}
            action={
              <Button variant="outline" size="sm" onClick={() => setAvailableOnly(false)}>
                {t.roomRadarPage.showAllItems}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((eq) => (
              <RadarEquipmentCard
                key={eq.id}
                equipment={eq}
                justVerified={verifyState === "done"}
              />
            ))}
          </div>
        )}

        {/* Filter hint when active */}
        {availableOnly && roomEquipment.length > 0 && filtered.length < roomEquipment.length && (
          <p className="text-xs text-center text-muted-foreground">
            {t.roomRadarPage.filterHint(filtered.length, roomEquipment.length)} ·{" "}
            <button className="text-primary font-medium" onClick={() => setAvailableOnly(false)}>
              {t.roomRadarPage.showAll}
            </button>
          </p>
        )}

        {/* Activity Feed — collapsible */}
        {!isLoading && (
          <div className="border border-border/60 rounded-xl overflow-hidden">
            <button
              onClick={() => setActivityOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{t.roomRadarPage.roomActivity}</span>
                <span className="text-[10px] font-medium text-muted-foreground bg-background border border-border rounded-full px-2 py-0.5">
                  {t.roomRadarPage.lastScans}
                </span>
              </div>
              {activityOpen
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
              }
            </button>

            {activityOpen && (
              <div className="divide-y divide-border/60 bg-card">
                {activityLoading ? (
                  <div className="flex flex-col gap-3 p-4" role="status" aria-live="polite" aria-busy="true">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground -mt-1">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      {t.common.loading}
                    </p>
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-10 rounded-lg" />
                    ))}
                  </div>
                ) : !activityEntries || activityEntries.length === 0 ? (
                  <div className="px-4 py-6 text-center flex flex-col gap-1">
                    <p className="text-sm text-muted-foreground">{t.roomRadarPage.noActivityYet}</p>
                    <p className="text-xs text-muted-foreground/70">{t.roomRadarPage.noActivityHint}</p>
                  </div>
                ) : (
                  activityEntries.map((entry) => {
                    const name = entry.userName || entry.userEmail.split("@")[0];
                    const initials = toInitials(entry.userName || name);
                    const action = activityActionLabel(entry);
                    return (
                      <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                        {/* Avatar */}
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[10px] font-bold text-primary">{initials}</span>
                        </div>
                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs leading-snug text-foreground">
                            <span className="font-semibold">{name}</span>
                            {" "}<span className="text-muted-foreground">{action}</span>
                            {entry.equipmentName && !entry.note?.startsWith("Room verified:") && (
                              <>{" "}<span className="font-medium">{entry.equipmentName}</span></>
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatRelativeTime(entry.timestamp)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
  if (isDesktop) return <PageShell>{pageContent}</PageShell>;
  return <Layout>{pageContent}</Layout>;
}
