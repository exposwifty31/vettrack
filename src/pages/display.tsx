// src/pages/display.tsx — Equipment Command Center (Ward Display)
// Always-on TV display: dark theme, RTL, auto-refreshing via SSE + polling.
// Phase 9 realtime infrastructure preserved byte-for-byte.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import {
  connectRealtime,
  disconnectRealtime,
  EventIngestor,
  publishBuildTagGossip,
  publishCodeBlueSeenGossip,
} from "@/lib/realtime";
import { useDisplaySnapshot } from "@/hooks/useDisplaySnapshot";
import { useKioskWakeLock } from "@/hooks/useKioskWakeLock";
import { useDisplayHeartbeat } from "@/hooks/useDisplayHeartbeat";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useCodeBlueKeepaliveReconciliation } from "@/hooks/useCodeBlueKeepaliveReconciliation";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  DisplaySnapshotCodeBlueSession,
  EquipmentCommandBoardSnapshot,
} from "@/types/safety-surfaces";
import type { EquipmentBoardUnitRow, EquipmentReadinessStatus } from "../../shared/equipment-board";

// ── Status colour tokens ────────────────────────────────────────────────────

const STATUS_COLOR: Record<EquipmentReadinessStatus, string> = {
  ready:    "text-[var(--status-ok)]",
  in_use:   "text-[var(--status-sterilized)]",
  blocked:  "text-[var(--status-issue)]",
  stale:    "text-[var(--status-maintenance)]",
  overdue:  "text-[var(--status-issue)]",
  unknown:  "text-ivory-text3",
};

const STATUS_BG: Record<EquipmentReadinessStatus, string> = {
  ready:   "bg-[var(--status-ok-bg)]   border-[var(--status-ok-border)]   text-[var(--status-ok-fg)]",
  in_use:  "bg-[var(--status-steril-bg)] border-[var(--status-steril-border)] text-[var(--status-steril-fg)]",
  blocked: "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)] text-[var(--status-issue-fg)]",
  stale:   "bg-[var(--status-maint-bg)] border-[var(--status-maint-border)] text-[var(--status-maint-fg)]",
  overdue: "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)] text-[var(--status-issue-fg)]",
  unknown: "bg-muted border-ivory-border text-ivory-text3",
};

const STATUS_BAR_COLOR: Record<EquipmentReadinessStatus, string> = {
  ready:   "bg-[var(--status-ok)]",
  in_use:  "bg-[var(--status-sterilized)]",
  blocked: "bg-[var(--status-issue)]",
  stale:   "bg-[var(--status-maintenance)]",
  overdue: "bg-[var(--status-issue)]",
  unknown: "bg-ivory-text3",
};

function statusLabel(s: EquipmentReadinessStatus): string {
  const map: Record<EquipmentReadinessStatus, string> = {
    ready:   t.board.available,
    in_use:  t.board.deployed,
    blocked: t.board.down,
    stale:   t.board.stale,
    overdue: t.board.overdue,
    unknown: t.board.unconfirmed,
  };
  return map[s];
}

// ── ADRing ──────────────────────────────────────────────────────────────────

function ADRing({ pct, ready, total }: { pct: number; ready: number; total: number }) {
  const size = 140;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke="var(--status-ok)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ - dash}
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.4,0,.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[28px] font-black tabular-nums text-[var(--status-ok)] leading-none">
            {ready}
          </span>
          <span className="text-[11px] text-ivory-text3 leading-tight">
            {t.board?.of ?? "מתוך"} {total}
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-[13px] font-bold text-ivory-text leading-tight">
          {t.board?.deployableNow ?? "זמין לפריסה"}
        </div>
        <div className="text-[11px] text-ivory-text3">{Math.round(pct)}%</div>
      </div>
    </div>
  );
}

// ── ReadinessMix ─────────────────────────────────────────────────────────────

function ReadinessMix({ overview }: { overview: EquipmentCommandBoardSnapshot["overview"] }) {
  const total = overview.totalCritical || 1;
  const segments: Array<{ key: EquipmentReadinessStatus; count: number }> = (
    [
      { key: "ready"   as const, count: overview.ready   },
      { key: "in_use"  as const, count: overview.inUse   },
      { key: "stale"   as const, count: overview.stale   },
      { key: "blocked" as const, count: overview.blocked },
      { key: "overdue" as const, count: overview.overdue },
      { key: "unknown" as const, count: overview.unknown },
    ] as Array<{ key: EquipmentReadinessStatus; count: number }>
  ).filter((s) => s.count > 0);

  return (
    <div className="flex-1 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ivory-text3 mb-2">
        {t.board?.readinessMix ?? "תמהיל מוכנות"}
      </div>
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden mb-3 gap-px">
        {segments.map(({ key, count }) => (
          <div
            key={key}
            className={cn("transition-all duration-700", STATUS_BAR_COLOR[key])}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {segments.map(({ key, count }) => (
          <div key={key} className="flex items-center gap-1.5 text-[11px]">
            <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_BAR_COLOR[key])} />
            <span className="text-ivory-text2 truncate">{statusLabel(key)}</span>
            <span className="tabular-nums text-ivory-text3 ms-auto">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TypeRow ──────────────────────────────────────────────────────────────────

function TypeRow({ row }: { row: EquipmentCommandBoardSnapshot["byType"][number] }) {
  const total = row.total || 1;
  const segments: Array<{ key: EquipmentReadinessStatus; count: number }> = (
    [
      { key: "ready"   as const, count: row.ready   },
      { key: "in_use"  as const, count: row.inUse   },
      { key: "stale"   as const, count: row.stale   },
      { key: "blocked" as const, count: row.blocked },
      { key: "overdue" as const, count: row.overdue },
      { key: "unknown" as const, count: row.unknown },
    ] as Array<{ key: EquipmentReadinessStatus; count: number }>
  ).filter((s) => s.count > 0);

  const belowMin = row.belowMinimumReady && row.minimumReady != null;

  return (
    <div className="py-2 border-b border-ivory-border last:border-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn("text-[12px] font-semibold text-ivory-text truncate flex-1", belowMin && "text-[var(--status-issue)]")}>
          {row.typeName}
        </span>
        {belowMin && (
          <span className="text-[10px] font-bold text-[var(--status-issue-fg)] bg-[var(--status-issue-bg)] border border-[var(--status-issue-border)] rounded px-1.5 py-0.5 shrink-0">
            ⚠ {row.ready}/{row.minimumReady} {t.board?.ready ?? "מוכן"}
          </span>
        )}
        <span className="text-[11px] tabular-nums text-ivory-text3 shrink-0">{row.ready}/{row.total}</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {segments.map(({ key, count }) => (
          <div
            key={key}
            className={cn("transition-all duration-700", STATUS_BAR_COLOR[key])}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
        {/* Empty track */}
        {total === 0 && <div className="flex-1 bg-muted" />}
      </div>
    </div>
  );
}

// ── LocationCard ─────────────────────────────────────────────────────────────

function LocationCard({ row }: { row: EquipmentCommandBoardSnapshot["byLocation"][number] }) {
  const hasIssues = row.totalCritical > row.ready;
  return (
    <div
      className={cn(
        "rounded-xl border p-3 flex flex-col gap-1",
        hasIssues
          ? "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)]"
          : "bg-[rgb(var(--ivory-surface))] border-ivory-border",
      )}
    >
      <div className="text-[12px] font-bold text-ivory-text truncate">{row.locationName}</div>
      <div className="flex gap-2 flex-wrap">
        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", STATUS_BG.ready)}>
          {row.ready} {t.board?.available ?? "זמין"}
        </span>
        {row.inUse > 0 && (
          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", STATUS_BG.in_use)}>
            {row.inUse} {t.board?.deployed ?? "בשימוש"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── UnitRow ───────────────────────────────────────────────────────────────────

function UnitRow({ unit }: { unit: EquipmentBoardUnitRow }) {
  const blocking = unit.blockingReasons[0] ?? unit.nextAction ?? null;
  return (
    <div
      className="flex items-start gap-3 py-2.5 border-b border-ivory-border last:border-0"
      data-testid={`board-unit-row-${unit.equipmentId}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ivory-text truncate">{unit.displayName}</span>
          {unit.typeName && (
            <span className="text-[10px] text-ivory-text3 truncate shrink-0">{unit.typeName}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {unit.locationName && (
            <span className="text-[11px] text-ivory-text3">{unit.locationName}</span>
          )}
          {unit.custodianName && (
            <span className="text-[11px] text-ivory-text2">{unit.custodianName}</span>
          )}
          {blocking && (
            <span className="text-[11px] text-[var(--status-issue)]">{blocking}</span>
          )}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 text-[11px] font-bold px-2 py-0.5 rounded border",
          STATUS_BG[unit.status],
        )}
      >
        {statusLabel(unit.status)}
      </span>
    </div>
  );
}

// ── CommandBoard ─────────────────────────────────────────────────────────────

function CommandBoard({
  board,
  currentTime,
  currentShift,
}: {
  board: EquipmentCommandBoardSnapshot;
  currentTime: string;
  currentShift: Array<{ employeeName: string; role: string }>;
}) {
  const [, navigate] = useLocation();
  // Same ?kiosk=1 contract as WardDisplayPage — wall displays get no exit button.
  const kioskMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URL(window.location.href).searchParams.get("kiosk") === "1";
    } catch {
      return false;
    }
  }, []);
  const now = new Date(currentTime);
  const timeStr = now.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const pct = board.overview.totalCritical > 0
    ? (board.overview.ready / board.overview.totalCritical) * 100
    : 0;

  const needAttention = board.criticalUnits.filter(
    (u) => u.status !== "ready" && u.status !== "in_use",
  );

  return (
    <div className="flex flex-col min-h-screen bg-[rgb(var(--ivory-bg))] text-ivory-text" dir="rtl">

      {/* Header */}
      <header className="bg-[var(--brand-navy)] flex items-center gap-4 px-5 py-3 shrink-0 flex-wrap">
        <span className="font-mono text-xl font-black tabular-nums text-white min-w-[52px]">
          {timeStr}
        </span>
        <div className="w-px h-5 bg-white/20 shrink-0" />

        <span className="text-[11px] font-bold tracking-widest uppercase text-[var(--brand-green-bright)] shrink-0">
          {t.board?.ward ?? "המחלקה · ציוד קריטי"}
        </span>

        {/* Shift staff */}
        <div className="flex flex-wrap gap-1.5 flex-1 justify-center">
          {currentShift.map((s) => (
            <div
              key={`${s.employeeName}-${s.role}`}
              className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-full px-3 py-0.5 text-[11px] text-white/75"
            >
              {s.employeeName}
            </div>
          ))}
        </div>

        {/* LIVE badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-[hsl(var(--status-ok))] motion-safe:animate-pulse" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--status-ok))]">
            {t.board?.live ?? "חי"}
          </span>
        </div>

        {/* Exit — wall-mounted kiosks (?kiosk=1) have no operator to tap it */}
        {!kioskMode && (
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else navigate("/home");
            }}
            aria-label={t.common.back}
            data-testid="board-exit"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/85 transition-colors hover:bg-white/20 motion-safe:active:scale-95"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">

        {/* Left: ADRing + ReadinessMix */}
        <div className="flex flex-col gap-4 items-center lg:w-64 shrink-0">
          <ADRing pct={pct} ready={board.overview.ready} total={board.overview.totalCritical} />
          <ReadinessMix overview={board.overview} />

          {/* Alerts count */}
          {board.alerts.length > 0 && (
            <div className="w-full rounded-xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] px-3 py-2.5">
              <div className="text-[11px] font-bold text-[var(--status-issue-fg)]">
                {board.alerts.length} {t.board?.attention ?? "דורשים טיפול"}
              </div>
              <div className="text-[10px] text-ivory-text3 mt-0.5">
                {board.alerts.filter((a) => a.severity === "critical").length} {t.board.critical}
              </div>
            </div>
          )}
        </div>

        {/* Right: by-type, by-location, critical units */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* By Type */}
          {board.byType.length > 0 && (
            <section className="rounded-xl border border-ivory-border bg-[rgb(var(--ivory-surface))] p-4">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-ivory-text3 mb-2">
                {t.board.byType}
              </h2>
              <div className="divide-y divide-ivory-border">
                {board.byType.map((row) => (
                  <TypeRow key={row.typeId ?? row.typeName} row={row} />
                ))}
              </div>
            </section>
          )}

          {/* By Location */}
          {board.byLocation.length > 0 && (
            <section>
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-ivory-text3 mb-2">
                {t.board?.whereTitle ?? "מיקום הציוד"}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {board.byLocation.map((row) => (
                  <LocationCard key={row.locationId ?? row.locationName} row={row} />
                ))}
              </div>
            </section>
          )}

          {/* Critical Units — needs attention */}
          {needAttention.length > 0 && (
            <section className="rounded-xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-4">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--status-issue-fg)] mb-2">
                {t.board?.attention ?? "דורשים טיפול"} · {needAttention.length}
              </h2>
              <div>
                {needAttention.map((u) => (
                  <UnitRow key={u.equipmentId} unit={u} />
                ))}
              </div>
            </section>
          )}

          {/* No issues state */}
          {needAttention.length === 0 && board.overview.ready >= board.overview.totalCritical && (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
              <span className="text-4xl" aria-hidden>✓</span>
              <p className="text-[14px] font-semibold text-[var(--status-ok)]">
                {t.board.allCriticalReady}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CodeBlueOverlay ───────────────────────────────────────────────────────────

function CodeBlueOverlay({
  session,
}: {
  session: DisplaySnapshotCodeBlueSession;
}) {
  // Live timer — updates every second using server startedAt (not local clock)
  const [elapsedMs, setElapsedMs] = useState(
    () => Date.now() - new Date(session.startedAt).getTime(),
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - new Date(session.startedAt).getTime());
    }, 1_000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
  const timerStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const staleThreshold = Date.now() - 30_000;
  const activePresence = session.presence.filter(
    (p) => new Date(p.lastSeenAt).getTime() > staleThreshold,
  );

  const minutesSincePush = session.pushSentAt
    ? Math.floor((Date.now() - new Date(session.pushSentAt).getTime()) / 60_000)
    : null;

  const linkedEquipment = session.linkedEquipment ?? [];
  const displayedLogs = session.logEntries.slice(-15);

  return (
    <div className="flex flex-col min-h-screen bg-[#0d0505]" dir="rtl">
      {/* Pulsing red header */}
      <div className="flex items-center gap-4 px-6 py-4 bg-red-600 motion-safe:animate-pulse flex-wrap">
        <span className="text-2xl font-black tracking-wider text-white">⚠ CODE BLUE</span>
        <span className="font-mono text-[22px] font-bold text-white bg-black/25 px-3 py-1 rounded tabular-nums">
          {timerStr}
        </span>
        <span className="text-[14px] text-white/85 ms-auto">
          מנהל הפצה: {session.managerUserName}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {activePresence.map((p) => (
            <div
              key={p.userId}
              className="flex items-center gap-1.5 bg-red-900/40 border border-red-600/40 rounded-full px-3 py-0.5 text-[11px] text-red-200"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 motion-safe:animate-ping shrink-0" />
              {p.userName}
            </div>
          ))}
        </div>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 divide-x divide-red-900/30 divide-x-reverse">
        {/* Column 1 — Equipment */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            {t.codeBlue.overlay.equipmentColumn}
          </div>
          {linkedEquipment.length > 0 ? (
            <div className="space-y-2">
              {linkedEquipment.map((eq) => (
                <div key={eq.id} className="text-[16px] font-bold text-white">
                  {eq.name}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-[13px]">{t.codeBlue.noEquipmentInEvent}</div>
          )}
        </div>

        {/* Column 2 — Event timeline */}
        <div className="flex-1 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            {t.codeBlue.overlay.timelineColumn}
          </div>
          <div className="space-y-2">
            {displayedLogs.map((entry, idx) => {
              const em = Math.floor(entry.elapsedMs / 60_000);
              const es = Math.floor((entry.elapsedMs % 60_000) / 1_000);
              const entryTime = `${String(em).padStart(2, "0")}:${String(es).padStart(2, "0")}`;
              return (
                <div key={`${entry.elapsedMs}-${entry.label}-${idx}`} className="flex gap-2 text-[12px]">
                  <span className="text-red-500 tabular-nums min-w-[42px] text-[11px] shrink-0">
                    {entryTime}
                  </span>
                  <span className="flex-1 text-red-200">{entry.label}</span>
                  <span className="text-gray-600 text-[10px] shrink-0">{entry.loggedByName}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3 — Status */}
        <div className="w-64 shrink-0 p-5">
          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-3">
            {t.codeBlue.overlay.sidebarColumn}
          </div>

          <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
            {t.codeBlue.overlay.crashCart}
          </div>
          <div className={`text-[12px] mb-4 ${session.preCheckPassed === false ? "text-red-400" : "text-green-400"}`}>
            {session.preCheckPassed === false
              ? `⚠ ${t.codeBlue.overlay.cartNotChecked}`
              : `✓ ${t.codeBlue.overlay.cartReady}`}
          </div>

          {minutesSincePush !== null && (
            <>
              <div className="text-[10px] font-bold tracking-[.1em] uppercase text-red-700/80 mb-2">
                {t.codeBlue.display.present}
              </div>
              <div className="text-[11px] text-gray-400">
                {t.codeBlue.overlay.pushSent}
                <br />
                <span className="text-gray-600 text-[10px]">לפני {minutesSincePush} דק׳</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── WardDisplayPage ───────────────────────────────────────────────────────────

export default function WardDisplayPage() {
  const qc = useQueryClient();
  const realtimeIngestor = useMemo(() => new EventIngestor(qc), [qc]);

  // Phase 9 PR 9.2 — kiosk-only wake-lock + operational heartbeat.
  // `?kiosk=1` opts a Department Display surface into TV-grade behavior:
  // screen wake-lock with bounded reacquire discipline. Non-kiosk views of
  // /display (e.g. an operator's tab) do not request the wake-lock.
  const kioskMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URL(window.location.href).searchParams.get("kiosk") === "1";
    } catch {
      return false;
    }
  }, []);

  useKioskWakeLock(kioskMode);

  // Phase 9 PR 9.3 — visibility / pageshow / online / resume reconciliation.
  // Centralized so display, ER, and other realtime-consuming pages share one
  // implementation and never drift apart.
  useRealtimeReconciliation({ queryClient: qc, ingestor: realtimeIngestor });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await realtimeIngestor.replayHttpCatchUpAfter(realtimeIngestor.getLastAppliedEventId());
      } catch {
        // Replay is best-effort; SSE + snapshot queries still converge.
      }
      if (!cancelled) {
        connectRealtime(() => {}, { queryClient: qc, ingestor: realtimeIngestor });
      }
    })();
    return () => {
      cancelled = true;
      disconnectRealtime({ ingestor: realtimeIngestor });
      realtimeIngestor.dispose();
    };
  }, [qc, realtimeIngestor]);

  const snapshot = useDisplaySnapshot();

  // Phase 9 PR 9.2 — heartbeat (operational-only). Always runs while the
  // display surface is mounted; never gates rendering or any clinical path.
  useDisplayHeartbeat({ kioskMode });

  // Phase 9 PR 9.4 — Code Blue keepalive reconciliation. Compares the local
  // snapshot's active session id against the server's keepalive. After a
  // 5 s grace window on persistent disagreement, forces a snapshot refetch.
  // The overlay is never cleared locally — server snapshots drive overlay
  // visibility.
  useCodeBlueKeepaliveReconciliation({
    queryClient: qc,
    getLocalActiveSessionId: () => snapshot?.codeBlueSession?.id ?? null,
  });

  // Phase 9 PR 9.6 — BroadcastChannel split-version gossip.
  // On focus, gossip this tab's build tag so other tabs detect divergence
  // and surface the existing update banner once. Best-effort, no leader
  // election, no consensus.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onFocus(): void {
      publishBuildTagGossip();
    }
    window.addEventListener("focus", onFocus);
    publishBuildTagGossip();
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Phase 9 PR 9.6 — Code Blue split-brain gossip. When the active CB
  // session id this tab is rendering changes, gossip it so peer tabs can
  // re-establish baseline if they disagree.
  //
  // Skip the publish while `snapshot` is still loading on first mount:
  // the initial render produces `localCbId = null` before this tab
  // actually knows the server's CB state. Publishing a premature `null`
  // would wake peer tabs during an active emergency and have them all
  // re-fetch baseline based on this tab's not-yet-loaded view.
  const snapshotLoaded = snapshot !== undefined;
  const localCbId = snapshot?.codeBlueSession?.id ?? null;
  useEffect(() => {
    if (!snapshotLoaded) return;
    publishCodeBlueSeenGossip(localCbId);
  }, [snapshotLoaded, localCbId]);

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-[rgb(var(--ivory-bg))] flex items-center justify-center dark">
        <div className="text-ivory-text3 text-sm">{t.board.loading}</div>
      </div>
    );
  }

  if (snapshot.codeBlueSession) {
    return <CodeBlueOverlay session={snapshot.codeBlueSession} />;
  }

  const board = snapshot.commandBoard;

  if (!board) {
    // commandBoard timed out or service error — show legacy equipment list
    return (
      <div className="min-h-screen bg-[rgb(var(--ivory-bg))] text-ivory-text flex flex-col dark" dir="rtl">
        <div className="flex items-center gap-3 px-5 py-3 bg-[var(--brand-navy)]">
          <span className="text-sm font-bold text-white/70">{t.board.subtitle}</span>
          <span className="text-[10px] text-amber-300 ms-auto">{t.board.fallbackBoardUnavailable}</span>
        </div>
        <div className="flex-1 p-4 space-y-2" data-testid="ward-display-equipment-pane">
          {snapshot.equipment.map((eq) => (
            <div
              key={eq.id}
              data-testid={`ward-display-equipment-row-${eq.id}`}
              className="rounded-lg border border-ivory-border bg-[rgb(var(--ivory-surface))] px-3 py-2.5 flex items-center gap-3"
            >
              <span className="flex-1 text-[13px] font-semibold text-ivory-text">{eq.name}</span>
              <span className={cn(
                "text-[11px] font-bold px-2 py-0.5 rounded border",
                eq.isDeployable ? STATUS_BG.ready : STATUS_BG.blocked,
              )}>
                {eq.isDeployable ? t.board.deployable : t.board.notDeployable}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="dark">
      <CommandBoard
        board={board}
        currentTime={snapshot.currentTime}
        currentShift={snapshot.currentShift}
      />
    </div>
  );
}
