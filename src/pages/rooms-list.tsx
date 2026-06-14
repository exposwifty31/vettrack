import { t } from "@/lib/i18n";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DoorOpen,
  Plus,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MapPin,
  Loader2,
  Radar,
} from "lucide-react";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CreateRoomRequest, Room } from "@/types";

function SyncBadge({ status }: { status: string }) {
  if (status === "synced") {
    return (
      <div className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-300 rounded-full px-2 py-0.5 shrink-0">
        <CheckCircle2 className="w-2.5 h-2.5" />
        Synced
      </div>
    );
  }
  if (status === "requires_audit") {
    return (
      <div className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-red-700 bg-red-50 border border-red-200 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300 rounded-full px-2 py-0.5 shrink-0">
        <AlertTriangle className="w-2.5 h-2.5" />
        Audit
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300 rounded-full px-2 py-0.5 shrink-0">
      <Clock className="w-2.5 h-2.5" />
      Stale
    </div>
  );
}

function HealthRing({ total, recentlyVerified }: { total: number; recentlyVerified: number }) {
  if (total === 0) {
    return (
      <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 p-[2.5px]"
        style={{ background: "var(--border)" }}
      >
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
          <DoorOpen className="w-5 h-5 text-primary" />
        </div>
      </div>
    );
  }

  const pct = Math.round((recentlyVerified / total) * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
  const labelColor = pct >= 80
    ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800"
    : pct >= 40
    ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800"
    : "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800";

  return (
    <div className="relative shrink-0">
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center p-[2.5px]"
        style={{ background: `conic-gradient(${color} ${pct}%, var(--border) ${pct}%)` }}
        title={`${pct}% of items verified in last 24h`}
      >
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
          <DoorOpen className="w-5 h-5 text-primary" />
        </div>
      </div>
      <span className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold px-1 py-px rounded-full border whitespace-nowrap ${labelColor}`}>
        {pct}%
      </span>
    </div>
  );
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

function computeEffectiveStatus(room: Room): string {
  if (room.syncStatus === "requires_audit") return "requires_audit";
  const auditAge = room.lastAuditAt
    ? Date.now() - new Date(room.lastAuditAt).getTime()
    : Infinity;
  if (auditAge > STALE_THRESHOLD_MS) return "stale";
  return room.syncStatus;
}

function RoomCard({ room }: { room: Room }) {
  const available = room.availableCount ?? 0;
  const total = room.totalEquipment ?? 0;
  const inUse = room.inUseCount ?? 0;
  const issues = room.issueCount ?? 0;
  const recentlyVerified = room.recentlyVerifiedCount ?? 0;
  const utilPct = total > 0 ? (available / total) * 100 : 0;
  const effectiveStatus = computeEffectiveStatus(room);

  return (
    <Link href={`/rooms/${room.id}`}>
      <Card className="bg-card border-border/60 shadow-sm hover:shadow-md motion-safe:active:scale-[0.98] transition-all cursor-pointer h-full">
        <CardContent className="p-4 flex flex-col gap-3">
          {/* Top row: health ring + sync badge */}
          <div className="flex items-start justify-between gap-1">
            <HealthRing total={total} recentlyVerified={recentlyVerified} />
            <SyncBadge status={effectiveStatus} />
          </div>

          {/* Room name */}
          <div className="flex-1">
            <p className="font-bold text-sm leading-snug truncate">{room.name}</p>
            {room.floor ? (
              <p className="text-[11px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                <MapPin className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{room.floor}</span>
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-0.5">{total} item{total !== 1 ? "s" : ""}</p>
            )}
          </div>

          {/* Availability */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <div>
                <span className="text-xl font-bold text-primary">{available}</span>
                <span className="text-xs text-muted-foreground font-medium">/{total} avail.</span>
              </div>
              {issues > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 dark:bg-red-950/50 border border-red-100 dark:border-red-800 rounded-md px-1.5 py-0.5">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {issues}
                </span>
              )}
            </div>
            {/* Utilization bar */}
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${utilPct}%` }}
              />
            </div>
            {inUse > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">{inUse} in use</p>
            )}
          </div>

          <div className="flex justify-end">
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function RoomCardSkeleton() {
  return <Skeleton className="h-48 rounded-xl" />;
}

type Zone = "all" | "icu" | "er" | "surgery" | "other";

const zoneLabels = (): Record<Zone, string> => ({
  all: t.roomsListPage.zoneAll,
  icu: t.roomsListPage.zoneIcu,
  er: t.roomsListPage.zoneEr,
  surgery: t.roomsListPage.zoneSurgery,
  other: t.roomsListPage.zoneOther,
});

function inferZone(room: Room): Zone {
  const n = (room.name + " " + (room.floor ?? "")).toLowerCase();
  if (n.includes("icu") || n.includes("intensive")) return "icu";
  if (n.includes("er ") || n.includes("emergency") || n.includes("triage")) return "er";
  if (n.includes("surg") || n.includes("or ") || n.includes("operating")) return "surgery";
  return "other";
}

export default function RoomsListPage() {
  const { isAdmin, userId } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomFloor, setRoomFloor] = useState("");
  const [roomGatewayCode, setRoomGatewayCode] = useState("");
  const [activeZone, setActiveZone] = useState<Zone>("all");
  const roomZoneLabels = zoneLabels();

  const { data: rooms, isLoading, isError } = useQuery({
    queryKey: ["/api/rooms"],
    queryFn: api.rooms.list,
    staleTime: 30_000,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const zoneCounts: Record<Zone, number> = { all: 0, icu: 0, er: 0, surgery: 0, other: 0 };
  if (rooms) {
    zoneCounts.all = rooms.length;
    for (const r of rooms) zoneCounts[inferZone(r)]++;
  }

  const visibleZones: Zone[] = ["all", ...( ["icu", "er", "surgery", "other"] as Zone[]).filter((z) => zoneCounts[z] > 0)];

  const filteredRooms = rooms && activeZone !== "all"
    ? rooms.filter((r) => inferZone(r) === activeZone)
    : rooms;

  const createMut = useMutation({
    mutationFn: (data: CreateRoomRequest) => api.rooms.create(data),
    onSuccess: (room) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      toast.success(`"${room.name}" created`);
      setCreateOpen(false);
      setRoomName("");
      setRoomFloor("");
      setRoomGatewayCode("");
    },
    onError: (err: Error) => toast.error(err.message || t.roomsListPage.createRoomFailed),
  });

  const handleCreate = () => {
    if (!roomName.trim()) return;
    createMut.mutate({
      name: roomName.trim(),
      floor: roomFloor.trim() || undefined,
      gatewayCode: roomGatewayCode.trim() || undefined,
    });
  };

  const totalAvailable = rooms?.reduce((a, r) => a + (r.availableCount ?? 0), 0) ?? 0;
  const totalInUse = rooms?.reduce((a, r) => a + (r.inUseCount ?? 0), 0) ?? 0;
  const totalIssues = rooms?.reduce((a, r) => a + (r.issueCount ?? 0), 0) ?? 0;
  const syncedCount = rooms?.filter((r) => r.syncStatus === "synced").length ?? 0;

  const pageContent = (
    <>
      <Helmet>
        <title>{t.roomsListPage.title} — VetTrack</title>
        <meta name="description" content="Room-by-room equipment inventory. Verify all items in a room with one tap." />
      </Helmet>

      <div className="flex flex-col gap-5 pb-20 animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between pt-1 gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Radar className="w-4 h-4 text-primary" />
              </div>
              <h1 className="text-2xl font-bold leading-tight">{t.roomsListPage.title}</h1>
              <HelpTooltip
                side="bottom"
                content="Each room card shows a Health Ring: a coloured circle showing what % of items were verified in the last 24 hours. Green ≥ 80%, Amber ≥ 40%, Red < 40%. Stale = not audited in 24+ hours."
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {rooms ? t.roomsListPage.subtitle(rooms.length) : t.roomsListPage.subtitleEmpty}
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" className="h-11 gap-1.5 shrink-0" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />
              Add Room
            </Button>
          )}
        </div>

        {/* Summary pills */}
        {rooms && rooms.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-semibold bg-primary/5 border border-primary/20 text-primary rounded-full px-3 py-1.5">
              <span className="font-bold text-sm">{totalAvailable}</span>
              <span className="text-[11px]">Available</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold bg-muted border border-border text-muted-foreground rounded-full px-3 py-1.5">
              <span className="font-bold text-sm">{totalInUse}</span>
              <span className="text-[11px]">In Use</span>
            </div>
            {totalIssues > 0 && (
              <div className="flex items-center gap-1.5 text-xs font-semibold bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-full px-3 py-1.5">
                <AlertTriangle className="w-3 h-3" />
                <span className="font-bold text-sm">{totalIssues}</span>
                <span className="text-[11px]">Issue{totalIssues !== 1 ? "s" : ""}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-full px-3 py-1.5">
              <CheckCircle2 className="w-3 h-3" />
              <span className="font-bold text-sm">{syncedCount}/{rooms.length}</span>
              <span className="text-[11px]">Synced</span>
            </div>
          </div>
        )}

        {/* Zone switcher */}
        {rooms && rooms.length > 0 && visibleZones.length > 2 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
            {visibleZones.map((zone) => (
              <button
                key={zone}
                onClick={() => setActiveZone(zone)}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap min-h-[40px]",
                  activeZone === zone
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-foreground border-border hover:bg-muted"
                )}
              >
                {roomZoneLabels[zone]}
                <span className={cn(
                  "text-[10px] font-bold rounded-full px-1.5 py-px",
                  activeZone === zone ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {zoneCounts[zone]}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Grid — minHeight:240 prevents CLS when skeleton → rooms transition occurs */}
        {isLoading ? (
          <div
            className="flex flex-col gap-3"
            style={{ minHeight: 240 }}
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="sr-only">{t.common.loading}</span>
            <p className="flex items-center gap-2 text-sm text-muted-foreground -mb-1">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              {t.common.loading}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => (
                <RoomCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : isError ? (
          <ErrorCard message="טעינת החדרים נכשלה" />
        ) : !rooms || rooms.length === 0 ? (
          <EmptyState
            icon={DoorOpen}
            message={t.roomsListPage.emptyRooms}
            subMessage={
              isAdmin
                ? t.roomsListPage.createFirstRoomHint
                : "No rooms have been created yet. Ask an admin to set them up."
            }
            action={
              isAdmin ? (
                <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2 h-11">
                  <Plus className="w-4 h-4" />
                  Add First Room
                </Button>
              ) : undefined
            }
          />
        ) : filteredRooms && filteredRooms.length > 0 ? (
          <div className="grid grid-cols-2 gap-3" style={{ minHeight: 240 }}>
            {filteredRooms.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-10 gap-2 text-center">
            <DoorOpen className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No rooms in {roomZoneLabels[activeZone]}</p>
            <button className="text-xs text-primary font-medium" onClick={() => setActiveZone("all")}>
              Show all rooms
            </button>
          </div>
        )}
      </div>

      {/* create room dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) { setRoomName(""); setRoomFloor(""); setRoomGatewayCode(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.roomsListPage.createRoomDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-name">{t.roomsListPage.roomName}</Label>
              <Input
                id="room-name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Surgery A"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-floor">{t.roomsListPage.roomFloorOptional}</Label>
              <Input
                id="room-floor"
                value={roomFloor}
                onChange={(e) => setRoomFloor(e.target.value)}
                placeholder="e.g. Level 2"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-gateway">{t.rooms.gatewayCode.label}</Label>
              <Input
                id="room-gateway"
                value={roomGatewayCode}
                onChange={(e) => setRoomGatewayCode(e.target.value)}
                placeholder={t.rooms.gatewayCode.placeholder}
                className="font-mono"
                data-testid="input-room-gateway-code"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!roomName.trim() || createMut.isPending}
              className="gap-2"
            >
              {createMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {t.roomsListPage.createRoom}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  return <AppShell>{pageContent}</AppShell>;
}
