// TV board phase 1 (Task 10) — the Equipment stage: the state-driven center of
// the board, replacing the old calm/pressure mode branches of CommandBoard.
//
// Two compositions:
//   - Evidence (attention / all_clear): the readiness ring + mix, one
//     monitored-equipment tile per byType row, locations, queue depths — every
//     positive claim shows its evidence (configured count, checked-now phrase).
//     Never a lone checkmark in a void.
//   - Exceptions (alert, or an active emergency): exception cards sorted
//     severity → elapsed downtime (minute granularity, never ticking), capped
//     at 3 with an overflow line, plus the PressureMain-era linked-equipment
//     cards and one-line ticker (ported verbatim contracts: co-presence,
//     RFID chips, data-tv-* focus metadata from PR #178).
//
// The classifier is deliberately emergency-blind (Code Blue is handled by
// CommandBoardScreen's frozen early return) — so the stage ALSO switches to the
// exception composition whenever the snapshot itself carries down units or an
// active emergency, keeping the wall truthful even before the container wires
// the state machine (Task 12).
import { CheckCircle2, Settings2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useBoardEntityCoPresence } from "@/board/board-copresence-context";
import type { BoardResponsibles, EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";
import type { EquipmentBoardUnitRow, EquipmentReadinessStatus } from "../../../../shared/equipment-board";
import { STATUS_BG, STATUS_BAR_COLOR, statusLabel } from "../status-tokens";
import type { BoardStateKind } from "../board-state";
import { CustodyPanel, StagingPanel, WaitlistPanel } from "./board-panels";

/** The six readiness buckets that make up a stacked readiness bar. */
type ReadinessCounts = {
  ready: number;
  inUse: number;
  stale: number;
  blocked: number;
  overdue: number;
  unknown: number;
};

/** Non-empty readiness segments in fixed display order. */
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

  // No critical equipment tagged for this clinic: a "0 / 0 · 0%" ring reads as
  // an alarm (green numeral over what looks like a failed readiness score).
  // Render an explicit empty/config state instead of the numeric ring.
  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2" data-testid="board-ring-no-critical">
        <div
          className="relative flex items-center justify-center rounded-full border-4 border-dashed border-ivory-border"
          style={{ width: size, height: size }}
        >
          <Settings2 className="h-8 w-8 text-ivory-text3" aria-hidden="true" />
        </div>
        <div className="max-w-[160px] text-center">
          <div className="vt-text-sm font-bold text-ivory-text leading-tight">
            {t.board.noCriticalConfigured}
          </div>
          <div className="vt-text-xs text-ivory-text3 mt-0.5">{t.board.noCriticalConfiguredHint}</div>
        </div>
      </div>
    );
  }

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
    <div className="flex-1 min-w-0 w-full">
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

// ── Monitored-equipment tile (evidence composition) ──────────────────────────

function TypeTile({
  row,
  tvMode,
}: {
  row: EquipmentCommandBoardSnapshot["byType"][number];
  tvMode?: boolean;
}) {
  const belowMin = row.belowMinimumReady && row.minimumReady != null;
  return (
    <div
      data-testid={`board-type-tile-${row.typeId ?? row.typeName}`}
      className={cn(
        "rounded-xl border flex flex-col gap-1",
        tvMode ? "p-4" : "p-3",
        belowMin
          ? "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)]"
          : "bg-[rgb(var(--ivory-surface))] border-ivory-border",
      )}
    >
      <span
        className={cn(
          "font-semibold truncate",
          tvMode ? "vt-text-sm" : "vt-text-xs",
          belowMin ? "text-[var(--status-issue-fg)]" : "text-ivory-text",
        )}
      >
        {row.typeName}
      </span>
      <span
        className={cn(
          "board-nums font-black tabular-nums leading-none",
          tvMode ? "vt-text-xl" : "vt-text-lg",
          belowMin ? "text-[var(--status-issue-fg)]" : "text-ivory-text",
        )}
      >
        <bdi dir="ltr">{`${row.ready}/${row.total}`}</bdi>
      </span>
      {belowMin && (
        <span className="vt-text-2xs font-bold text-[var(--status-issue-fg)]">
          ⚠ {row.ready}/{row.minimumReady} {t.board.ready}
        </span>
      )}
    </div>
  );
}

// ── LocationCard ─────────────────────────────────────────────────────────────

function LocationCard({
  row,
  tvMode,
}: {
  row: EquipmentCommandBoardSnapshot["byLocation"][number];
  tvMode?: boolean;
}) {
  const hasIssues = row.totalCritical > row.ready;
  return (
    <div
      className={cn(
        "rounded-xl border flex flex-col gap-1",
        tvMode ? "p-4" : "p-3",
        hasIssues
          ? "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)]"
          : "bg-[rgb(var(--ivory-surface))] border-ivory-border",
      )}
      data-tv-focusable={tvMode ? "" : undefined}
      data-tv-id={tvMode ? `loc-${row.locationId ?? row.locationName}` : undefined}
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

// ── RFID chip ─────────────────────────────────────────────────────────────────

/**
 * R-M1.3 — advisory RFID last-seen chip. The pinned `locationKind` discriminator
 * renders three DISTINCT, non-blank surfaces — 'external_zone' (left clinic) and
 * 'unresolved' (no resolvable room) never collapse to the same/blank surface, and
 * a resolved room shows its name. Advisory only: the human-confirmed room stays the
 * unit's resolved location (never overridden here).
 */
function RfidChip({ unit }: { unit: EquipmentBoardUnitRow }) {
  const rfid = unit.rfid;
  if (!rfid) return null;
  const kindStyle =
    rfid.locationKind === "external_zone"
      ? "border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)]"
      : rfid.locationKind === "unresolved"
        ? "border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] text-[var(--status-stale-fg)]"
        : "border-ivory-border bg-[rgb(var(--ivory-surface))] text-ivory-text2";
  const label =
    rfid.locationKind === "external_zone"
      ? t.board.rfidExternalZone
      : rfid.locationKind === "unresolved"
        ? t.board.rfidUnresolved
        : (rfid.locationName ?? t.board.rfidTag);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 vt-text-2xs font-semibold px-1.5 py-0.5 rounded border",
        kindStyle,
      )}
      data-testid={`board-unit-rfid-${unit.equipmentId}`}
      data-rfid-kind={rfid.locationKind}
    >
      <span>{t.board.rfidTag}</span>
      <span>{label}</span>
    </span>
  );
}

// ── Exception ordering (severity → elapsed downtime) ─────────────────────────

/** Lower = more severe. A hard block outranks everything; staleness is the mildest. */
const EXCEPTION_SEVERITY_RANK: Record<EquipmentReadinessStatus, number> = {
  blocked: 0,
  overdue: 1,
  unknown: 2,
  stale: 3,
  ready: 9,
  in_use: 9,
};

function downSinceMs(unit: EquipmentBoardUnitRow): number | null {
  const iso = unit.lastEvidenceAt ?? unit.lastHumanConfirmationAt;
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Severity first, then longest-down first; unknown downtime sorts last within a tier. */
function sortExceptions(units: EquipmentBoardUnitRow[]): EquipmentBoardUnitRow[] {
  return [...units].sort((a, b) => {
    const bySeverity = EXCEPTION_SEVERITY_RANK[a.status] - EXCEPTION_SEVERITY_RANK[b.status];
    if (bySeverity !== 0) return bySeverity;
    return (downSinceMs(a) ?? Number.POSITIVE_INFINITY) - (downSinceMs(b) ?? Number.POSITIVE_INFINITY);
  });
}

/** Minute-granularity downtime — coarse by doctrine (numbers never tick). */
function downForMinutes(unit: EquipmentBoardUnitRow, nowMs: number): number | null {
  const since = downSinceMs(unit);
  if (since == null) return null;
  return Math.max(0, Math.floor((nowMs - since) / 60_000));
}

/** Stage cap — everything beyond it collapses into the overflow line. */
const MAX_EXCEPTION_CARDS = 3;

// ── ExceptionCard ─────────────────────────────────────────────────────────────

/**
 * One down critical unit, 10-foot sized. Preserves the full UnitRow contract:
 * `board-unit-row-*` testid, R-RTC-1.3 co-presence (producer + visible peer
 * highlight), the advisory RFID chip, and the PR #178 D-pad focus metadata.
 */
function ExceptionCard({
  unit,
  downMinutes,
  tvMode,
}: {
  unit: EquipmentBoardUnitRow;
  downMinutes: number | null;
  tvMode?: boolean;
}) {
  const blocking = unit.blockingReasons[0] ?? unit.nextAction ?? null;
  const { isPeerSelected, peerNames, onSelect, onClear } = useBoardEntityCoPresence(unit.equipmentId);
  return (
    <div
      className={cn(
        "relative flex items-start gap-4 overflow-hidden rounded-2xl border border-[var(--status-issue-border)] bg-[rgb(var(--ivory-surface))]",
        tvMode ? "p-5 ps-8" : "p-3.5 ps-6",
        isPeerSelected &&
          "ring-2 ring-[hsl(var(--status-ok))] ring-offset-1 ring-offset-[rgb(var(--ivory-surface))]",
      )}
      data-testid={`board-unit-row-${unit.equipmentId}`}
      data-board-entity-id={unit.equipmentId}
      data-board-peer-selected={isPeerSelected ? "true" : undefined}
      data-severity={unit.status}
      data-tv-focusable={tvMode ? "" : undefined}
      data-tv-id={tvMode ? `unit-${unit.equipmentId}` : undefined}
      onPointerEnter={onSelect}
      onPointerLeave={onClear}
      onFocus={onSelect}
      onBlur={onClear}
    >
      {/* Severity edge rail — color rides the data-severity attribute in CSS;
          the inline fallback keeps it visible without the token sheet. */}
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 w-1.5 rounded-full bg-[hsl(var(--status-issue))]"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "font-bold text-ivory-text truncate",
              tvMode ? "text-[40px] leading-tight" : "vt-text-lg",
            )}
          >
            {unit.displayName}
          </span>
          {unit.typeName && (
            <span className="vt-text-xs text-ivory-text3 truncate shrink-0">{unit.typeName}</span>
          )}
          <span
            className={cn(
              "shrink-0 vt-text-xs font-bold px-2 py-0.5 rounded border",
              STATUS_BG[unit.status],
            )}
          >
            {statusLabel(unit.status)}
          </span>
          {isPeerSelected && peerNames.length > 0 && (
            <span
              className="vt-text-2xs font-semibold text-white bg-[hsl(var(--status-ok))] rounded-full px-2 py-0.5 shrink-0"
              data-board-peer-selection-label
            >
              {peerNames.join(", ")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {unit.locationName && (
            <span className={cn("text-ivory-text3", tvMode ? "text-[32px]" : "vt-text-sm")}>
              {unit.locationName}
            </span>
          )}
          {unit.custodianName && (
            <span className="vt-text-xs text-ivory-text2">{unit.custodianName}</span>
          )}
          {blocking && (
            <span className="vt-text-xs text-[hsl(var(--status-issue))]">{blocking}</span>
          )}
        </div>
        {unit.rfid && (
          <div className="mt-1">
            <RfidChip unit={unit} />
          </div>
        )}
      </div>
      {downMinutes != null && (
        <span
          className={cn(
            "board-nums shrink-0 font-bold tabular-nums text-[hsl(var(--status-issue))]",
            tvMode ? "text-[64px] leading-none" : "vt-text-2xl",
          )}
        >
          {t.board.downFor(downMinutes)}
        </span>
      )}
    </div>
  );
}

// ── Ticker (ported from PressureMain) ────────────────────────────────────────

function TickerStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className="text-ivory-text3">{label}</span>
      <span className="board-nums font-bold tabular-nums text-ivory-text">{value}</span>
    </span>
  );
}

// ── EquipmentStage ───────────────────────────────────────────────────────────

export function EquipmentStage({
  board,
  state,
  tvMode,
}: {
  board: EquipmentCommandBoardSnapshot;
  state: BoardStateKind;
  tvMode?: boolean;
  /** Accepted for stage-composition parity (Task 11 rotation); the bottom band
   * in CommandBoard owns the always-mounted ResponsiblesPanel. */
  responsibles?: BoardResponsibles | null;
}): JSX.Element {
  const exceptions = sortExceptions(
    board.criticalUnits.filter((u) => u.status !== "ready" && u.status !== "in_use"),
  );
  const emergencyActive = board.activeEmergency != null;
  // The stage never renders a reassuring composition over a snapshot that
  // carries down units or an active emergency — even if the machine upstream
  // lags (hysteresis) or is not wired yet.
  const showExceptions = state === "alert" || emergencyActive || exceptions.length > 0;

  if (showExceptions) {
    const nowMs = Date.now();
    const linked = board.activeEmergency?.linkedEquipment ?? [];
    const visible = exceptions.slice(0, MAX_EXCEPTION_CARDS);
    const overflow = exceptions.length - visible.length;
    return (
      <section
        data-testid="board-stage"
        data-stage="alert"
        className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-4 flex flex-col gap-3"
      >
        {linked.length > 0 && (
          <div className={cn("grid", tvMode ? "grid-cols-2 gap-4" : "grid-cols-2 lg:grid-cols-3 gap-2")}>
            {linked.map((eq) => (
              <div
                key={eq.equipmentId}
                data-tv-focusable={tvMode ? "" : undefined}
                data-tv-id={tvMode ? `linked-${eq.equipmentId}` : undefined}
                className={cn(
                  "rounded-lg border border-[var(--status-issue-border)] bg-[rgb(var(--ivory-surface))]",
                  tvMode ? "px-4 py-3" : "px-3 py-2",
                )}
              >
                <div className="vt-text-sm font-bold text-ivory-text truncate">{eq.displayName}</div>
                {eq.locationName && <div className="vt-text-xs text-ivory-text3">{eq.locationName}</div>}
              </div>
            ))}
          </div>
        )}
        <div className={cn("flex flex-col", tvMode ? "gap-4" : "gap-2.5")}>
          {visible.map((u) => (
            <ExceptionCard key={u.equipmentId} unit={u} downMinutes={downForMinutes(u, nowMs)} tvMode={tvMode} />
          ))}
        </div>
        {overflow > 0 && (
          <div
            data-testid="board-alert-overflow"
            className={cn(
              "board-nums font-bold tabular-nums text-[var(--status-issue-fg)]",
              tvMode ? "text-[32px]" : "vt-text-sm",
            )}
          >
            {t.board.alertOverflow(overflow)}
          </div>
        )}
        {/* One-line ticker — the calm panels demoted, present-guarded (absent ≠ zero). */}
        <div className="mt-auto shrink-0 flex items-center gap-4 overflow-x-auto rounded-xl border border-ivory-border bg-[rgb(var(--ivory-surface))] px-4 py-2 vt-text-xs">
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
      </section>
    );
  }

  const pct =
    board.overview.totalCritical > 0
      ? (board.overview.ready / board.overview.totalCritical) * 100
      : 0;

  return (
    <section
      data-testid="board-stage"
      data-stage="evidence"
      className={cn(
        "flex-1 min-h-0 overflow-auto grid grid-cols-1 lg:grid-cols-[auto_1fr]",
        tvMode ? "gap-6" : "gap-4",
      )}
    >
      {/* Left: emblem + ADRing + ReadinessMix — one D-pad region (initial focus) in tvMode */}
      <div
        className={cn(
          "flex flex-col items-center shrink-0",
          tvMode ? "gap-6 lg:w-[22rem]" : "gap-4 lg:w-64",
        )}
        data-tv-focusable={tvMode ? "" : undefined}
        data-tv-id={tvMode ? "overview" : undefined}
        data-tv-focus-initial={tvMode ? "" : undefined}
      >
        {state === "all_clear" && (
          // Evidence, not a lone checkmark: the emblem always carries the
          // configured-count phrase ("N of M · checked now") beside it.
          <div data-testid="board-allclear" className="flex flex-col items-center gap-1.5 text-center">
            <CheckCircle2
              aria-hidden="true"
              className={cn("text-[hsl(var(--status-ok))]", tvMode ? "h-16 w-16" : "h-10 w-10")}
            />
            <p
              className={cn(
                "font-bold text-[hsl(var(--status-ok))]",
                tvMode ? "vt-text-lg" : "vt-text-sm",
              )}
            >
              {t.board.allCriticalReady}
            </p>
            <p className="board-nums vt-text-xs tabular-nums text-ivory-text2">
              {t.board.allClearEvidence(board.overview.ready, board.overview.totalCritical)}
            </p>
          </div>
        )}
        <ADRing pct={pct} ready={board.overview.ready} total={board.overview.totalCritical} />
        <ReadinessMix overview={board.overview} />
      </div>

      {/* Right: monitored-equipment tiles, locations, queue depths, custody */}
      <div className="flex flex-col gap-4 min-w-0">
        {board.byType.length > 0 && (
          <section
            data-tv-focusable={tvMode ? "" : undefined}
            data-tv-id={tvMode ? "bytype" : undefined}
          >
            <h2 className="vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3 mb-2">
              {t.board.byType}
            </h2>
            <div
              className={cn(
                "grid",
                tvMode ? "grid-cols-2 xl:grid-cols-3 gap-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2",
              )}
            >
              {board.byType.map((row) => (
                <TypeTile key={row.typeId ?? row.typeName} row={row} tvMode={tvMode} />
              ))}
            </div>
          </section>
        )}

        {board.byLocation.length > 0 && (
          <section>
            <h2 className="vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3 mb-2">
              {t.board.whereTitle}
            </h2>
            <div
              className={cn(
                "grid",
                tvMode ? "grid-cols-2 xl:grid-cols-3 gap-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2",
              )}
            >
              {board.byLocation.map((row) => (
                <LocationCard key={row.locationId ?? row.locationName} row={row} tvMode={tvMode} />
              ))}
            </div>
          </section>
        )}

        {/* Waitlist / staging depth — tolerant-reader guarded (Task 11 relocates to the Ops view) */}
        {board.waitlist && <WaitlistPanel depth={board.waitlist.depth} />}
        {board.staging && <StagingPanel depth={board.staging.depth} />}
        {board.custody && board.custody.units.length > 0 && <CustodyPanel custody={board.custody} />}
      </div>
    </section>
  );
}
