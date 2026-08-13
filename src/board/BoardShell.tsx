import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { KioskAwake } from "./KioskAwake";
import { BoardErrorBoundary } from "./BoardErrorBoundary";
import { useBoardAutoReload } from "./useBoardAutoReload";
import { useBoardCoPresence } from "./useBoardCoPresence";
import { BoardCoPresenceOverlay } from "./BoardCoPresenceOverlay";
import { BoardCoPresenceProvider } from "./board-copresence-context";
import { useTvModeFromUrl } from "@/features/command-board/use-tv-mode-from-url";
import { useNightDim } from "./use-night-dim";
import { classifyBoardState, type BoardStateKind } from "@/features/command-board/board-state";
import { DISPLAY_SNAPSHOT_QUERY_KEY } from "@/lib/event-reducer";
import type { DisplaySnapshot } from "@/types/safety-surfaces";

/**
 * READ-ONLY chrome signals from the display-snapshot query cache — the same
 * no-second-poller pattern as useBoardAutoReload's useEmergencyActive. BoardShell
 * still never fetches; CommandBoardScreen stays the single data-path owner.
 * Connection health lives in the screen, so the chrome classifies with "live" —
 * for dimming, only the alert/Code-Blue overrides matter and both derive purely
 * from snapshot content.
 */
function useBoardDimSignals(): { state: BoardStateKind | null; codeBlueActive: boolean } {
  const qc = useQueryClient();
  const codeBlueActive = useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    () => qc.getQueryData<DisplaySnapshot>(DISPLAY_SNAPSHOT_QUERY_KEY)?.codeBlueSession != null,
    () => false,
  );
  const state = useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    (): BoardStateKind | null => {
      const snapshot = qc.getQueryData<DisplaySnapshot>(DISPLAY_SNAPSHOT_QUERY_KEY);
      return snapshot ? classifyBoardState({ snapshot, connection: "live" }) : null;
    },
    () => null,
  );
  return { state, codeBlueActive };
}

/**
 * Kiosk chrome styles, co-located so the shell owns its own hygiene layer:
 *   - night dim: brightness cut while [data-night-dim] is set (alert/Code Blue
 *     never set it — see useNightDim), smooth-faded so the wall never snaps.
 *   - burn-in drift: an always-on 1–2 px translate that steps to a new offset
 *     every 6 minutes (24-min cycle, step-end — discrete jumps, no continuous
 *     motion) so static pixels never park in one spot overnight.
 * Both respect prefers-reduced-motion (drift off, dim still applies statically).
 */
const BOARD_CHROME_CSS = `
[data-board-shell] { transition: filter 2s ease; }
[data-board-shell][data-night-dim] { filter: brightness(0.35); }
[data-board-shell] .board-drift {
  width: 100%;
  height: 100%;
  animation: board-burnin-drift 1440s step-end infinite;
}
@keyframes board-burnin-drift {
  0% { transform: translate(0, 0); }
  25% { transform: translate(1px, -1px); }
  50% { transform: translate(2px, 1px); }
  75% { transform: translate(-1px, 2px); }
  100% { transform: translate(0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-board-shell] { transition: none; }
  [data-board-shell] .board-drift { animation: none; }
}
`;

type Props = { children: ReactNode };

/**
 * Chrome-only kiosk host for the /board platform target. It never touches the
 * FROZEN realtime transport (SSE `/api/realtime/*`) and never reads the snapshot;
 * CommandBoardScreen (the {children}) remains the single data-path owner, and
 * BoardShell renders {children}, never CommandBoardScreen itself, so the SSE
 * subscription refcount can never reach 2.
 *
 * It DOES mount the additive R-RTC-1.3 collaboration channel (socket.io, a
 * DISTINCT ephemeral+advisory transport — not SSE): useBoardCoPresence lazily
 * acquires the ref-counted collab socket and feeds peer cursors/presence to the
 * overlay and per-entity selection to the board content via BoardCoPresenceProvider.
 * This channel is glance-only — it never gates board rendering and degrades to a
 * static board when the socket is unavailable.
 *
 * Behaviors, all from existing primitives:
 *   1. Dark full-bleed — fixed inset-0 bg-black. Deliberately NO `dark` class on
 *      the outer container: the screen applies `dark` per-branch (and NOT on the
 *      CodeBlueOverlay branch), so a hoisted wrapper would change emergency-token
 *      resolution. bg-black is a constant color, so it perturbs nothing.
 *   2. Error reset-to-/board — BoardErrorBoundary wraps only the children.
 *   3. Fullscreen on first interaction — the Fullscreen API needs a user gesture.
 *   4. Wake-lock — KioskAwake owns useKioskWakeLock(true); re-keyed on a BFCache
 *      pageshow(persisted) restore so the lock re-acquires. This handler is
 *      wake-lock-scoped only — realtime reconciliation stays owned by the screen.
 */
export function BoardShell({ children }: Props) {
  const [, navigate] = useLocation();
  const [resetSeq, setResetSeq] = useState(0);
  const [wakeEpoch, setWakeEpoch] = useState(0);

  // Confirmed-SW-update → reload, deferred while a Code Blue is active. Reads the
  // snapshot cache read-only; owns no poller. (See useBoardAutoReload.)
  useBoardAutoReload();

  // R-RTC-1.3 · Feature 2 — EPHEMERAL board co-presence (peer cursors / presence /
  // selection). Pure additive overlay: lazily acquires the ref-counted collab
  // socket on mount, degrades to a static board when unavailable, and NEVER gates
  // board rendering on the socket.
  const coPresence = useBoardCoPresence();

  // ?tv=1 — 10-foot presentation. Here it only drives the overscan-safe frame
  // (chrome concern); the type scale + D-pad focus layer live in the board content.
  // Read independently of CommandBoardScreen (same URL contract), not threaded.
  const tvMode = useTvModeFromUrl();

  // Night dim (22:00–06:00 client clock; alert + Code Blue override — see
  // use-night-dim.ts and docs/runbooks/board-kiosk.md). Signals are read-only
  // cache observations — no prop-drilling through the route boundary.
  const dimSignals = useBoardDimSignals();
  const nightDim = useNightDim(dimSignals);

  // Fullscreen on the first user gesture (Fullscreen API requires one). First of
  // either pointerdown/keydown fires it, then removes both listeners.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function enterFullscreen(): void {
      document.documentElement.requestFullscreen?.().catch((err) => {
        // Benign on a kiosk (browser policy / unsupported) — the display stays
        // windowed, but don't swallow it silently.
        console.warn("[board] fullscreen request rejected; continuing windowed", err);
      });
      window.removeEventListener("pointerdown", enterFullscreen);
      window.removeEventListener("keydown", enterFullscreen);
    }
    window.addEventListener("pointerdown", enterFullscreen);
    window.addEventListener("keydown", enterFullscreen);
    return () => {
      window.removeEventListener("pointerdown", enterFullscreen);
      window.removeEventListener("keydown", enterFullscreen);
    };
  }, []);

  // Re-acquire the wake-lock after a BFCache restore. A pure pageshow(persisted)
  // fires no visibilitychange, so useKioskWakeLock wouldn't otherwise re-run;
  // remounting KioskAwake (key bump) re-runs its [enabled] effect.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPageShow(event: PageTransitionEvent): void {
      if (event.persisted) setWakeEpoch((n) => n + 1);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <div
      className="fixed inset-0 h-full w-full overflow-hidden bg-black"
      data-board-shell
      data-night-dim={nightDim ? "" : undefined}
    >
      <style>{BOARD_CHROME_CSS}</style>
      <KioskAwake key={wakeEpoch} />
      <BoardErrorBoundary
        resetSeq={resetSeq}
        onRequestReset={() => {
          navigate("/board");
          setResetSeq((n) => n + 1);
        }}
      >
        <BoardCoPresenceProvider
          selectEntity={coPresence.selectEntity}
          peerSelections={coPresence.peerSelections}
          presentMembers={coPresence.presentMembers}
        >
          {/* Burn-in drift wrapper (always on — see BOARD_CHROME_CSS) around the
              overscan title-safe inner frame — TV bezels crop ~3–5%. tvMode-gated so
              desktop /board stays full-bleed to the pixel edge; the black backdrop
              above shows through the inset. */}
          <div className="board-drift">
            {tvMode ? <div className="board-tv-overscan">{children}</div> : children}
          </div>
        </BoardCoPresenceProvider>
      </BoardErrorBoundary>
      <BoardCoPresenceOverlay
        peerCursors={coPresence.peerCursors}
        presentMembers={coPresence.presentMembers}
      />
    </div>
  );
}
