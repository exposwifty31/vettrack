// Presentational Command Center board (TV board phase 1, Task 10).
// State-driven: the container (CommandBoardScreen) computes `state` via
// useBoardState/useDisplayConnection and passes it down — this component stays
// presentational and testable with plain props. The old calm/pressure mode
// machine (deleted in Task 14) is replaced by the BoardStateKind stage switch:
//   stale        → StaleTakeover (last-known state, clearly labeled)
//   unconfigured → UnconfiguredTakeover (configuration hole, never good news)
//   alert        → EquipmentStage locked on exception cards
//   attention / all_clear → EquipmentStage evidence composition (Task 11 adds
//                  the Equipment↔Ops rotation here)
// Anchor invariant: the top band + tinted state strip and the bottom band
// (responsibles + power + docks, absent ≠ zero) render in every state.
// A real Code Blue never reaches this component — CommandBoardScreen's frozen
// early return renders the overlay above all of this.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
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
  // useLayoutEffect (not useEffect): reset to opacity 0 BEFORE the browser paints
  // the freshly-keyed inner div, then rAF → 1 to transition it in. A passive effect
  // runs after paint, so the incoming view would flash in at opacity 1 first — a
  // hard cut on every rotation swap instead of the spec §2 300 ms cross-fade.
  useLayoutEffect(() => {
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
  responsibles,
  state,
  connection = NEVER_POLLED_CONNECTION,
  snapshot,
}: {
  /**
   * Task 12 — nullable: when the snapshot has no commandBoard (build timeout /
   * pre-deploy server) the state machine classifies `unconfigured` (or a
   * connection takeover) and the takeover owns the stage; the top/bottom bands
   * render their muted-unknown treatments (absent ≠ zero), never zeros.
   */
  board: EquipmentCommandBoardSnapshot | null;
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
  const anomalies = board?.anomalies ?? [];
  // Exit is presentation chrome relocated into the single top band (spec §2);
  // wall kiosks (?kiosk=1) hide it — no operator to tap.
  const handleExit = () => {
    if (window.history.length > 1) window.history.back();
    else navigate("/home");
  };

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
        // Spec §3 elevation base — no pure black (#000 crushes to backlight bloom
        // on an LCD TV). --board-bg (#0F141A) is defined on [data-board-shell]; the
        // literal fallback covers container-less test renders.
        "flex flex-col bg-[color:var(--board-bg,#0f141a)] text-ivory-text",
        tvMode ? "min-h-0 flex-1 overflow-hidden" : "min-h-screen",
      )}
      dir={dir}
    >

      {/* Anchor: the single top band (identity, ready/total, freshness heartbeat,
          clock, exit) + the tinted state strip — present in EVERY state. The legacy
          navy header and footer were removed (spec §2 is a single top band): they
          re-rendered the clock, ward wordmark and a hardcoded-green LIVE badge that
          duplicated the band and kept signalling "LIVE" during stale/offline. */}
      <BoardTopBand
        departmentLabel={t.board.ward}
        readyCount={board ? board.overview.ready : null}
        totalCount={board ? board.overview.totalCritical : null}
        currentTime={currentTime}
        connection={connection}
        tvMode={tvMode}
        kioskMode={kioskMode}
        onExit={handleExit}
      />
      <BoardStateStrip state={state} />

      {/* Ambient anomaly attention (R-BDF-1.2) — glance-only, present in every state */}
      {anomalies.length > 0 && (
        <BoardAttentionSection
          anomalies={anomalies}
          mode={attentionMode}
          reducedMotion={reducedMotion}
          onAnomalyActivated={reportBoardAnomalyActivated}
          tvMode={tvMode}
        />
      )}

      {/* Stage — state-driven: takeovers replace it wholesale; the quiet states
          rotate Equipment↔Ops (alert locks on equipment, empty Ops never shows). */}
      <main id="main-content" className="flex-1 min-h-0 flex flex-col p-4" dir={dir}>
        {state === "stale" ? (
          <StaleTakeover connection={connection} lastSnapshot={snapshot} />
        ) : state === "unconfigured" || !board ? (
          // `!board` is a type-level guard only: classifyBoardState maps an
          // absent board to "unconfigured" (or a connection takeover), so a
          // quiet/alert state always carries a board.
          <UnconfiguredTakeover />
        ) : (
          <StageFade viewKey={stageView} reducedMotion={reducedMotion}>
            {stageView === "ops" ? (
              <OpsStage board={board} currentShift={currentShift} tvMode={tvMode} />
            ) : (
              <EquipmentStage board={board} state={state} tvMode={tvMode} />
            )}
          </StageFade>
        )}
      </main>

      {/* Bottom band (fixed): responsibles + power + docks. Absent ≠ zero —
          an undefined block renders the muted-unknown card, never zeros. */}
      <div
        data-testid="board-bottom-band"
        className={cn(
          // Responsibles carries up to five named people at the 10-foot type floor,
          // so it gets the wider column and lays them out in two columns (below) —
          // otherwise a single stacked list eats ~half the board and starves the stage.
          "shrink-0 grid grid-cols-1 items-start px-4 pb-3",
          tvMode ? "gap-4 sm:grid-cols-[1.7fr_1fr_1fr]" : "gap-3 sm:grid-cols-3",
        )}
      >
        <ResponsiblesPanel responsibles={responsibles} />
        {board?.power ? <PowerPanel power={board.power} /> : <UnknownBlock title={t.board.power} />}
        {board?.docks ? <DocksPanel docks={board.docks} /> : <UnknownBlock title={t.board.docks} />}
      </div>
    </div>
  );
}
