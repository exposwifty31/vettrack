// Presentational Command Center board + its single-consumer leaves.
// Verbatim move from src/pages/display.tsx:72-460 (Phase 4 C1). The only
// behavioral change is an additive optional `kioskMode` prop: when provided
// (the /board route) it wins over the internal ?kiosk=1 URL read; when omitted
// (/equipment/board) the URL read is byte-identical to the pre-move behavior.
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";
import type { EquipmentBoardUnitRow, EquipmentReadinessStatus } from "../../../../shared/equipment-board";
import { STATUS_BG, STATUS_BAR_COLOR, statusLabel } from "../status-tokens";
import { useKioskModeFromUrl } from "../use-kiosk-mode-from-url";
import { useBoardMode } from "../use-board-mode";
import { DocksPanel, PowerPanel, StagingPanel, WaitlistPanel } from "./board-panels";

/** The six readiness buckets that make up a stacked readiness bar. */
type ReadinessCounts = {
  ready: number;
  inUse: number;
  stale: number;
  blocked: number;
  overdue: number;
  unknown: number;
};

/** Non-empty readiness segments in fixed display order — shared by ReadinessMix + TypeRow. */
function buildSegments(counts: ReadinessCounts): Array<{ key: EquipmentReadinessStatus; count: number }> {
  return (
    [
      { key: "ready"   as const, count: counts.ready   },
      { key: "in_use"  as const, count: counts.inUse   },
      { key: "stale"   as const, count: counts.stale   },
      { key: "blocked" as const, count: counts.blocked },
      { key: "overdue" as const, count: counts.overdue },
      { key: "unknown" as const, count: counts.unknown },
    ] as Array<{ key: EquipmentReadinessStatus; count: number }>
  ).filter((s) => s.count > 0);
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
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke="hsl(var(--status-ok))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ - dash}
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.4,0,.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="vt-display font-black tabular-nums text-[hsl(var(--status-ok))] leading-none">
            {ready}
          </span>
          <span className="vt-text-xs text-ivory-text3 leading-tight">
            {t.board.of} {total}
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="vt-text-sm font-bold text-ivory-text leading-tight">
          {t.board.deployableNow}
        </div>
        <div className="vt-text-xs text-ivory-text3">{Math.round(pct)}%</div>
      </div>
    </div>
  );
}

// ── ReadinessMix ─────────────────────────────────────────────────────────────

function ReadinessMix({ overview }: { overview: EquipmentCommandBoardSnapshot["overview"] }) {
  const total = overview.totalCritical || 1;
  const segments = buildSegments(overview);

  return (
    <div className="flex-1 min-w-0">
      <div className="vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3 mb-2">
        {t.board.readinessMix}
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
          <div key={key} className="flex items-center gap-1.5 vt-text-xs">
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
  const segments = buildSegments(row);

  const belowMin = row.belowMinimumReady && row.minimumReady != null;

  return (
    <div className="py-2 border-b border-ivory-border last:border-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn("vt-text-xs font-semibold text-ivory-text truncate flex-1", belowMin && "text-[hsl(var(--status-issue))]")}>
          {row.typeName}
        </span>
        {belowMin && (
          <span className="vt-text-2xs font-bold text-[var(--status-issue-fg)] bg-[var(--status-issue-bg)] border border-[var(--status-issue-border)] rounded px-1.5 py-0.5 shrink-0">
            ⚠ {row.ready}/{row.minimumReady} {t.board.ready}
          </span>
        )}
        <span className="vt-text-xs tabular-nums text-ivory-text3 shrink-0">{row.ready}/{row.total}</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {segments.map(({ key, count }) => (
          <div
            key={key}
            className={cn("transition-all duration-700", STATUS_BAR_COLOR[key])}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
        {/* Empty track — driven by the raw count (total is normalized to ≥1 above). */}
        {row.total === 0 && <div className="flex-1 bg-muted" />}
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
      <div className="vt-text-xs font-bold text-ivory-text truncate">{row.locationName || t.board.unassigned}</div>
      <div className="flex gap-2 flex-wrap">
        <span className={cn("vt-text-2xs font-semibold px-1.5 py-0.5 rounded border", STATUS_BG.ready)}>
          {row.ready} {t.board.available}
        </span>
        {row.inUse > 0 && (
          <span className={cn("vt-text-2xs font-semibold px-1.5 py-0.5 rounded border", STATUS_BG.in_use)}>
            {row.inUse} {t.board.deployed}
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
          <span className="vt-text-sm font-semibold text-ivory-text truncate">{unit.displayName}</span>
          {unit.typeName && (
            <span className="vt-text-2xs text-ivory-text3 truncate shrink-0">{unit.typeName}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {unit.locationName && (
            <span className="vt-text-xs text-ivory-text3">{unit.locationName}</span>
          )}
          {unit.custodianName && (
            <span className="vt-text-xs text-ivory-text2">{unit.custodianName}</span>
          )}
          {blocking && (
            <span className="vt-text-xs text-[hsl(var(--status-issue))]">{blocking}</span>
          )}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 vt-text-xs font-bold px-2 py-0.5 rounded border",
          STATUS_BG[unit.status],
        )}
      >
        {statusLabel(unit.status)}
      </span>
    </div>
  );
}

// ── PressureMain ─────────────────────────────────────────────────────────────

function TickerStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className="text-ivory-text3">{label}</span>
      <span className="font-bold tabular-nums text-ivory-text">{value}</span>
    </span>
  );
}

/**
 * Pressure-mode body (critical-alert surge, no server Code Blue): the
 * needs-attention block goes full-bleed and the calm panels demote to a
 * single-line ticker. Layout emphasis only — a real Code Blue is handled above
 * this by CommandBoardScreen's server-driven overlay.
 */
function PressureMain({
  board,
  needAttention,
}: {
  board: EquipmentCommandBoardSnapshot;
  needAttention: EquipmentBoardUnitRow[];
}) {
  const linked = board.activeEmergency?.linkedEquipment ?? [];
  return (
    <main id="main-content" className="flex-1 overflow-hidden p-4 flex flex-col gap-3" dir="rtl">
      <section className="flex-1 overflow-auto rounded-xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-3 h-3 rounded-full bg-[hsl(var(--status-issue))] motion-safe:animate-pulse" aria-hidden />
          <span className="vt-text-2xl font-black uppercase tracking-widest text-[var(--status-issue-fg)]">
            {t.board.highLoad}
          </span>
          <span className="vt-text-sm text-ivory-text2 ms-auto">
            {needAttention.length} {t.board.attention}
          </span>
        </div>
        {linked.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {linked.map((eq) => (
              <div
                key={eq.equipmentId}
                className="rounded-lg border border-[var(--status-issue-border)] bg-[rgb(var(--ivory-surface))] px-3 py-2"
              >
                <div className="vt-text-sm font-bold text-ivory-text truncate">{eq.displayName}</div>
                {eq.locationName && <div className="vt-text-xs text-ivory-text3">{eq.locationName}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            {needAttention.map((u) => (
              <UnitRow key={u.equipmentId} unit={u} />
            ))}
          </div>
        )}
      </section>
      <div className="shrink-0 flex items-center gap-4 overflow-x-auto rounded-xl border border-ivory-border bg-[rgb(var(--ivory-surface))] px-4 py-2 vt-text-xs">
        <TickerStat
          label={t.board.deployableNow}
          value={`${board.overview.ready}/${board.overview.totalCritical}`}
        />
        {board.power && <TickerStat label={t.board.powerAlert} value={String(board.power.alert)} />}
        {board.docks && (
          <TickerStat label={t.board.docks} value={`${board.docks.occupied}/${board.docks.total}`} />
        )}
        {board.waitlist && <TickerStat label={t.board.waitlist} value={String(board.waitlist.depth)} />}
        {board.staging && <TickerStat label={t.board.staging} value={String(board.staging.depth)} />}
      </div>
    </main>
  );
}

// ── CommandBoard ─────────────────────────────────────────────────────────────

export function CommandBoard({
  board,
  currentTime,
  currentShift,
  kioskMode: kioskModeProp,
}: {
  board: EquipmentCommandBoardSnapshot;
  currentTime: string;
  currentShift: Array<{ employeeName: string; role: string }>;
  kioskMode?: boolean;
}) {
  const [, navigate] = useLocation();
  // Same ?kiosk=1 contract as WardDisplayPage — wall displays get no exit button.
  // The /board route passes kioskMode explicitly; it wins over the URL read.
  const kioskModeFromUrl = useKioskModeFromUrl();
  const kioskMode = kioskModeProp ?? kioskModeFromUrl;
  const mode = useBoardMode(board);
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

        <span className="vt-text-xs font-bold tracking-widest uppercase text-[var(--brand-green-bright)] shrink-0">
          {t.board.ward}
        </span>

        {/* Shift staff */}
        <div className="flex flex-wrap gap-1.5 flex-1 justify-center">
          {currentShift.map((s) => (
            <div
              key={`${s.employeeName}-${s.role}`}
              className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-full px-3 py-0.5 vt-text-xs text-white/75"
            >
              {s.employeeName}
            </div>
          ))}
        </div>

        {/* LIVE badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-[hsl(var(--status-ok))] motion-safe:animate-pulse" aria-hidden />
          <span className="vt-text-xs font-bold uppercase tracking-widest text-[hsl(var(--status-ok))]">
            {t.board.live}
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/85 transition-colors hover:bg-white/20 motion-safe:active:scale-95"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </header>

      {/* Body */}
      {mode === "pressure" && <PressureMain board={board} needAttention={needAttention} />}
      {mode === "calm" && (
      <main id="main-content" className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">

        {/* Left: ADRing + ReadinessMix */}
        <div className="flex flex-col gap-4 items-center lg:w-64 shrink-0">
          <ADRing pct={pct} ready={board.overview.ready} total={board.overview.totalCritical} />
          <ReadinessMix overview={board.overview} />

          {/* Enrichment panels — tolerant-reader: each mounts only when present */}
          {board.power && <PowerPanel power={board.power} />}
          {board.docks && <DocksPanel docks={board.docks} />}

          {/* Alerts count */}
          {board.alerts.length > 0 && (
            <div className="w-full rounded-xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] px-3 py-2.5">
              <div className="vt-text-xs font-bold text-[var(--status-issue-fg)]">
                {board.alerts.length} {t.board.attention}
              </div>
              <div className="vt-text-2xs text-ivory-text3 mt-0.5">
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
              <h2 className="vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3 mb-2">
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
              <h2 className="vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3 mb-2">
                {t.board.whereTitle}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {board.byLocation.map((row) => (
                  <LocationCard key={row.locationId ?? row.locationName} row={row} />
                ))}
              </div>
            </section>
          )}

          {/* Waitlist / staging depth — tolerant-reader guarded */}
          {board.waitlist && <WaitlistPanel depth={board.waitlist.depth} />}
          {board.staging && <StagingPanel depth={board.staging.depth} />}

          {/* Critical Units — needs attention */}
          {needAttention.length > 0 && (
            <section className="rounded-xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-4">
              <h2 className="vt-text-2xs font-bold uppercase tracking-widest text-[var(--status-issue-fg)] mb-2">
                {t.board.attention} · {needAttention.length}
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
              <p className="vt-text-sm font-semibold text-[hsl(var(--status-ok))]">
                {t.board.allCriticalReady}
              </p>
            </div>
          )}
        </div>
      </main>
      )}

      {/* Footer — quiet status strip: last refresh + live indicator */}
      <footer className="shrink-0 flex items-center gap-3 border-t border-ivory-border bg-[rgb(var(--ivory-surface))] px-5 py-2">
        <span className="vt-text-2xs uppercase tracking-widest text-ivory-text3">
          {t.board.subtitle}
        </span>
        <span className="vt-text-2xs tabular-nums text-ivory-text3 ms-auto">
          {t.board.updated} {timeStr}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--status-ok))] motion-safe:animate-pulse" aria-hidden />
          <span className="vt-text-2xs font-bold uppercase tracking-widest text-[hsl(var(--status-ok))]">
            {t.board.live}
          </span>
        </span>
      </footer>
    </div>
  );
}
