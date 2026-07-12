// CommandBoardScreen — the single owner of the Command Center board UI and its
// Phase-9 realtime data path (SSE connect+replay, snapshot poll, reconciliation,
// keepalive, build-tag + code-blue gossip, heartbeat). The canonical /board route
// (through BoardShell) mounts this ONE screen as <CommandBoardScreen kioskMode/>;
// the legacy /equipment/board now redirects to /board (Phase 10), so there is a
// single board host.
// Because only the one matched route mounts this component, connectRealtime's
// module-global subscription refcount can never reach 2.
//
// Verbatim relocation of the former WardDisplayPage (display.tsx:601-771). Two
// deltas only: (a) useKioskWakeLock is SUBTRACTED — wake-lock is host-owned now;
// (b) an additive optional `kioskMode` prop is threaded into the heartbeat and
// the board's exit-button guard (falls back to the internal ?kiosk=1 read when
// omitted, so /equipment/board stays byte-identical).
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectRealtime,
  disconnectRealtime,
  EventIngestor,
  publishBuildTagGossip,
  publishCodeBlueSeenGossip,
} from "@/lib/realtime";
import { useDisplaySnapshot } from "@/hooks/useDisplaySnapshot";
import { useDisplayHeartbeat } from "@/hooks/useDisplayHeartbeat";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useCodeBlueKeepaliveReconciliation } from "@/hooks/useCodeBlueKeepaliveReconciliation";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ReadinessBadge } from "@/components/ui/readiness-badge";
import type { EquipmentStatus } from "@/types";
import { STATUS_BG } from "./status-tokens";
import { CommandBoard } from "./components/CommandBoard";
import { CodeBlueOverlay } from "./components/CodeBlueOverlay";
import { useKioskModeFromUrl } from "./use-kiosk-mode-from-url";

interface CommandBoardScreenProps {
  kioskMode?: boolean;
}

function CommandBoardScreen({ kioskMode: kioskModeProp }: CommandBoardScreenProps) {
  const qc = useQueryClient();
  const realtimeIngestor = useMemo(() => new EventIngestor(qc), [qc]);

  // Phase 9 PR 9.2 — `?kiosk=1` opts a Department Display surface into TV-grade
  // behavior. The /board route passes kioskMode explicitly (it wins); the
  // /equipment/board wrapper leaves it undefined and this URL read applies.
  // Wake-lock is now host-owned (display.tsx wrapper / BoardShell), so kioskMode
  // here only feeds the operational heartbeat + the board's exit-button guard.
  const kioskModeFromUrl = useKioskModeFromUrl();
  const kioskMode = kioskModeProp ?? kioskModeFromUrl;

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
      <div
        className="dark flex flex-col min-h-screen bg-[rgb(var(--ivory-bg))] text-ivory-text"
        dir="rtl"
        data-testid="board-skeleton"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">{t.board.loading}</span>
        {/* Header bar */}
        <div className="bg-[var(--brand-navy)] flex items-center gap-4 px-5 py-3 shrink-0">
          <div className="h-6 w-16 rounded bg-white/15 motion-safe:animate-pulse" />
          <div className="h-4 w-24 rounded bg-white/10 motion-safe:animate-pulse" />
          <div className="h-4 w-14 rounded bg-white/10 ms-auto motion-safe:animate-pulse" />
        </div>
        {/* Body */}
        <div className="flex-1 p-4 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">
          <div className="flex flex-col gap-4 items-center lg:w-64 shrink-0">
            <div className="h-36 w-36 rounded-full bg-muted motion-safe:animate-pulse" />
            <div className="h-24 w-full rounded-xl bg-muted motion-safe:animate-pulse" />
          </div>
          <div className="flex flex-col gap-4 min-w-0">
            <div className="h-40 rounded-xl border border-ivory-border bg-muted motion-safe:animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl border border-ivory-border bg-muted motion-safe:animate-pulse" />
              ))}
            </div>
          </div>
        </div>
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
          <span className="vt-text-2xs text-emergency-amber ms-auto">{t.board.fallbackBoardUnavailable}</span>
        </div>
        <div className="flex-1 p-4 space-y-2" data-testid="ward-display-equipment-pane">
          {snapshot.equipment.map((eq) => (
            <div
              key={eq.id}
              data-testid={`ward-display-equipment-row-${eq.id}`}
              className="rounded-lg border border-ivory-border bg-[rgb(var(--ivory-surface))] px-3 py-2.5 flex items-center gap-3 min-h-11"
            >
              <span className="flex-1 vt-text-sm font-semibold text-ivory-text">{eq.name}</span>
              {/* eq.status is the raw vt_equipment.status (server/routes/display.ts),
                  loosely typed as `string` on DisplaySnapshotEquipment — glance-only,
                  additive; this fallback pane owns no interactivity or reload logic. */}
              <ReadinessBadge status={eq.status as EquipmentStatus} />
              <span
                data-testid={`ward-display-equipment-deployable-${eq.id}`}
                className={cn(
                  "vt-text-xs font-bold px-2 py-0.5 rounded border",
                  eq.isDeployable ? STATUS_BG.ready : STATUS_BG.blocked,
                )}
              >
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
        kioskMode={kioskMode}
      />
    </div>
  );
}

export default CommandBoardScreen;
