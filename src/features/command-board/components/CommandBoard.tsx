// Presentational Command Center board (TV board phase 1, Task 10).
// State-driven: the container (CommandBoardScreen) computes `state` via
// useBoardState/useDisplayConnection and passes it down — this component stays
// presentational and testable with plain props. The old calm/pressure mode
// machine (useBoardMode) is replaced by the BoardStateKind stage switch:
//   stale        → StaleTakeover (last-known state, clearly labeled)
//   unconfigured → UnconfiguredTakeover (configuration hole, never good news)
//   alert        → EquipmentStage locked on exception cards
//   attention / all_clear → EquipmentStage evidence composition (Task 11 adds
//                  the Equipment↔Ops rotation here)
// Anchor invariant: the top band + tinted state strip and the bottom band
// (responsibles + power + docks, absent ≠ zero) render in every state.
// A real Code Blue never reaches this component — CommandBoardScreen's frozen
// early return renders the overlay above all of this.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { reportBoardAnomalyActivated } from "@/lib/realtime";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useDirection } from "@/hooks/useDirection";
import type { DisplayConnection } from "@/hooks/use-display-connection";
import type {
  BoardResponsibles,
  DisplaySnapshot,
  EquipmentCommandBoardSnapshot,
} from "@/types/safety-surfaces";
import type { BoardStateKind } from "../board-state";
import { useKioskModeFromUrl } from "../use-kiosk-mode-from-url";
import { useTvModeFromUrl } from "../use-tv-mode-from-url";
import { useBoardTvNav } from "../use-board-tv-nav";
import { BoardAttentionSection } from "./BoardAttentionSection";
import { BoardStateStrip, BoardTopBand } from "./board-status-band";
import { StaleTakeover, UnconfiguredTakeover } from "./board-takeovers";
import { EquipmentStage } from "./board-stage-equipment";
import { OpsStage } from "./board-stage-ops";
import { opsHasContent, useStageRotation } from "../use-stage-rotation";
import {
  DocksPanel,
  PowerPanel,
  ResponsiblesPanel,
  UnknownBlock,
} from "./board-panels";

/**
 * Container-less renders (legacy tests / the pre-Task-12 screen) have no
 * connection tracker yet: treat as live-but-never-polled, which renders the
 * "updating…" freshness copy — never a fabricated timestamp.
 */
const NEVER_POLLED_CONNECTION: DisplayConnection = {
  state: "live",
  lastSuccessAt: null,
  missedPolls: 0,
};

/**
 * 300 ms opacity cross-fade on stage view swap (Task 11). The wrapper remounts
 * per `viewKey` and fades the incoming view in; under prefers-reduced-motion
 * the swap is instant (`transition: none`). Purely presentational — layout is
 * owned by the stage components themselves.
 */
function StageFade({
  viewKey,
  reducedMotion,
  children,
}: {
  viewKey: string;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    setFaded(false);
    const id = requestAnimationFrame(() => setFaded(true));
    return () => cancelAnimationFrame(id);
  }, [viewKey]);
  return (
    <div
      key={viewKey}
      data-testid="board-stage-fade"
      className="flex-1 min-h-0 flex flex-col"
      style={{
        opacity: reducedMotion || faded ? 1 : 0,
        transition: reducedMotion ? "none" : "opacity 300ms ease",
      }}
    >
      {children}
    </div>
  );
}

export function CommandBoard({
  board,
  currentTime,
  currentShift,
  kioskMode: kioskModeProp,
  tvMode: tvModeProp,
  proposalCount,
  responsibles,
  state,
  connection = NEVER_POLLED_CONNECTION,
  snapshot,
}: {
  board: EquipmentCommandBoardSnapshot;
  currentTime: string;
  currentShift: Array<{ employeeName: string; role: string }>;
  kioskMode?: boolean;
  /**
   * `?tv=1` — 10-foot presentation: board-scoped type scale (via `data-board-tv`),
   * inverted density (fewer/larger cells), and the D-pad focus/spatial-nav layer.
   * Resolved prop ?? URL, mirroring kioskMode. Purely presentation + input —
   * no data/transport change.
   */
  tvMode?: boolean;
  /**
   * Doctor shift gate (spec 2026-08-13) — snapshot `responsibles` section
   * (doctor teams + senior technician + equipment coordinator). Optional and
   * tolerant: ResponsiblesPanel mounts unconditionally; null/undefined renders
   * the muted-unavailable treatment (absent ≠ zero), never the 0/5 aggregate.
   */
  responsibles?: BoardResponsibles | null;
  /**
   * VetTrack 2.0, Task 1.1 §6 (deliverable H) — bounded ambient count of
   * Shift Autopilot proposals awaiting approval, count only. (Cut in Task 12
   * by owner decision; the prop survives until the container drops it.)
   */
  proposalCount?: number;
  /**
   * The board state computed by the container (useBoardState over the snapshot
   * + connection). Drives the stage switch and the state-strip tint.
   */
  state: BoardStateKind;
  /** Connection tracker output (useDisplayConnection) — feeds the freshness chip. */
  connection?: DisplayConnection;
  /** Last-known snapshot, shown (clearly labeled) inside the stale takeover. */
  snapshot?: DisplaySnapshot;
}) {
  const [, navigate] = useLocation();
  const dir = useDirection();
  // Same ?kiosk=1 contract as WardDisplayPage — wall displays get no exit button.
  // The /board route passes kioskMode explicitly; it wins over the URL read.
  const kioskModeFromUrl = useKioskModeFromUrl();
  const kioskMode = kioskModeProp ?? kioskModeFromUrl;
  // Same prop ?? URL contract for ?tv=1 (10-foot presentation + D-pad nav).
  const tvModeFromUrl = useTvModeFromUrl();
  const tvMode = tvModeProp ?? tvModeFromUrl;
  const reducedMotion = usePrefersReducedMotion();

  // D-pad / TV-remote spatial navigation over the board content. Inert unless
  // tvMode; degrades to plain glance + pointer when a remote never arrives.
  const rootRef = useRef<HTMLDivElement>(null);
  useBoardTvNav({ enabled: tvMode, containerRef: rootRef, reducedMotion });
  const anomalies = board.anomalies ?? [];
  const now = new Date(currentTime);
  const timeStr = now.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // BoardAttentionSection's emphasis contract predates the state machine:
  // "pressure" escalates card color/size. Alert is the only escalating state.
  const attentionMode = state === "alert" ? "pressure" : "calm";

  // Equipment↔Ops rotation (Task 11): quiet states only; alert/takeover lock
  // the stage on equipment; an empty Ops view is never rotated in.
  const stageView = useStageRotation({
    state,
    opsHasContent: opsHasContent(board, currentShift),
  });

  return (
    <div
      ref={rootRef}
      // Scopes the 10-foot type ramp + focus-ring CSS ([data-board-tv] in index.css).
      // In tvMode the board fills the overscan flex column instead of min-h-screen,
      // so it fits the title-safe area exactly. Desktop /board is byte-unchanged.
      data-board-tv={tvMode ? "" : undefined}
      className={cn(
        "flex flex-col bg-[rgb(var(--ivory-bg))] text-ivory-text",
        tvMode ? "min-h-0 flex-1 overflow-hidden" : "min-h-screen",
      )}
      dir={dir}
    >

      {/* Header — the shift strip moved to the Ops stage view (Task 11) */}
      <header className="bg-[var(--brand-navy)] flex items-center gap-4 px-5 py-3 shrink-0 flex-wrap">
        <span
          className={cn(
            "font-mono font-black tabular-nums text-white min-w-[52px]",
            tvMode ? "text-4xl" : "text-xl",
          )}
        >
          {timeStr}
        </span>
        <div className="w-px h-5 bg-white/20 shrink-0" />

        <span className="vt-text-xs font-bold tracking-widest uppercase text-[var(--brand-green-bright)] flex-1">
          {t.board.ward}
        </span>

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
            data-tv-focusable={tvMode ? "" : undefined}
            data-tv-id={tvMode ? "exit" : undefined}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/85 transition-colors hover:bg-white/20 motion-safe:active:scale-95",
              tvMode ? "h-14 w-14" : "h-11 w-11",
            )}
          >
            <X className={tvMode ? "h-6 w-6" : "h-4 w-4"} aria-hidden />
          </button>
        )}
      </header>

      {/* Anchor: top band (identity, ready/total, freshness heartbeat, clock)
          + the tinted state strip — present in EVERY state. */}
      <BoardTopBand
        departmentLabel={t.board.ward}
        readyCount={board.overview.ready}
        totalCount={board.overview.totalCritical}
        currentTime={currentTime}
        connection={connection}
      />
      <BoardStateStrip state={state} />

      {/* Ambient anomaly attention (R-BDF-1.2) — glance-only, present in every state */}
      {(anomalies.length > 0 || (proposalCount ?? 0) > 0) && (
        <BoardAttentionSection
          anomalies={anomalies}
          mode={attentionMode}
          reducedMotion={reducedMotion}
          onAnomalyActivated={reportBoardAnomalyActivated}
          proposalCount={proposalCount}
          tvMode={tvMode}
        />
      )}

      {/* Stage — state-driven: takeovers replace it wholesale; the quiet states
          rotate Equipment↔Ops (alert locks on equipment, empty Ops never shows). */}
      <main id="main-content" className="flex-1 min-h-0 flex flex-col p-4" dir={dir}>
        {state === "stale" ? (
          <StaleTakeover connection={connection} lastSnapshot={snapshot} />
        ) : state === "unconfigured" ? (
          <UnconfiguredTakeover />
        ) : (
          <StageFade viewKey={stageView} reducedMotion={reducedMotion}>
            {stageView === "ops" ? (
              <OpsStage board={board} currentShift={currentShift} tvMode={tvMode} />
            ) : (
              <EquipmentStage board={board} state={state} tvMode={tvMode} responsibles={responsibles} />
            )}
          </StageFade>
        )}
      </main>

      {/* Bottom band (fixed): responsibles + power + docks. Absent ≠ zero —
          an undefined block renders the muted-unknown card, never zeros. */}
      <div
        data-testid="board-bottom-band"
        className={cn(
          "shrink-0 grid grid-cols-1 sm:grid-cols-3 items-start px-4 pb-3",
          tvMode ? "gap-4" : "gap-3",
        )}
      >
        <ResponsiblesPanel responsibles={responsibles} />
        {board.power ? <PowerPanel power={board.power} /> : <UnknownBlock title={t.board.power} />}
        {board.docks ? <DocksPanel docks={board.docks} /> : <UnknownBlock title={t.board.docks} />}
      </div>

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
