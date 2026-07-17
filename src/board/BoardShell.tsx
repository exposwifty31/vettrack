import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { KioskAwake } from "./KioskAwake";
import { BoardErrorBoundary } from "./BoardErrorBoundary";
import { useBoardAutoReload } from "./useBoardAutoReload";
import { useBoardCoPresence } from "./useBoardCoPresence";
import { BoardCoPresenceOverlay } from "./BoardCoPresenceOverlay";
import { BoardCoPresenceProvider } from "./board-copresence-context";

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
    <div className="fixed inset-0 h-full w-full overflow-hidden bg-black" data-board-shell>
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
          {children}
        </BoardCoPresenceProvider>
      </BoardErrorBoundary>
      <BoardCoPresenceOverlay
        peerCursors={coPresence.peerCursors}
        presentMembers={coPresence.presentMembers}
      />
    </div>
  );
}
