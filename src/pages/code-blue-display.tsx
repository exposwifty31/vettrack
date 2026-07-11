// src/pages/code-blue-display.tsx
//
// T20 (frozen-surface audit fix) — the Code Blue wall display is driven by the
// frozen SSE transport, exactly like the canonical Command Center board
// (CommandBoardScreen → CodeBlueOverlay). It reads the SSE-fed DISPLAY_SNAPSHOT
// (which the event-reducer refetches on CODE_BLUE_STATUS_CHANGED / KEEPALIVE)
// and mounts the same realtime client seam: an outbox-cursor EventIngestor,
// connectRealtime + HTTP replay catch-up, visibility/wake reconciliation, and
// Code Blue keepalive reconciliation. Session start/end propagate via SSE
// (server-confirmed; never optimistically terminated locally). The snapshot's
// own bounded poll (2 s during an active event, 5 s idle — the sanctioned board
// cadence) is the DEGRADED fallback + within-session detail refresh, not the
// primary transport. No parallel transport, no frozen-internal change.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Wifi, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import {
  connectRealtime,
  disconnectRealtime,
  EventIngestor,
} from "@/lib/realtime";
import { DISPLAY_SNAPSHOT_QUERY_KEY } from "@/lib/event-reducer";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useCodeBlueKeepaliveReconciliation } from "@/hooks/useCodeBlueKeepaliveReconciliation";
import type { DisplaySnapshot } from "@/types";
import { t } from "@/lib/i18n";

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function useElapsed(startedAt: string | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Date.now() - new Date(startedAt).getTime());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

export default function CodeBlueDisplay() {
  const queryClient = useQueryClient();

  // Frozen SSE transport — outbox-cursor ingestor drives the DISPLAY_SNAPSHOT
  // cache (event-reducer applyEvent refetches it on CODE_BLUE_STATUS_CHANGED),
  // so a Code Blue event propagates to this wall over SSE, not by polling.
  const realtimeIngestor = useMemo(() => new EventIngestor(queryClient), [queryClient]);

  // Reconnect / wake recovery: replay missed outbox rows + resync the snapshot.
  useRealtimeReconciliation({ queryClient, ingestor: realtimeIngestor });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await realtimeIngestor.replayHttpCatchUpAfter(realtimeIngestor.getLastAppliedEventId());
      } catch {
        // Replay is best-effort; SSE + the snapshot query still converge.
      }
      if (!cancelled) {
        connectRealtime(() => {}, { queryClient, ingestor: realtimeIngestor });
      }
    })();
    return () => {
      cancelled = true;
      disconnectRealtime({ ingestor: realtimeIngestor });
      realtimeIngestor.dispose();
    };
  }, [queryClient, realtimeIngestor]);

  // Bounded DEGRADED fallback + within-session detail refresh. SSE
  // (CODE_BLUE_STATUS_CHANGED / KEEPALIVE) is the primary propagation path;
  // this poll only backstops the stream and refreshes the log timeline /
  // presence (which carry no dedicated outbox event). Same cadence the
  // canonical board uses (useDisplaySnapshot): 2 s during an active event,
  // 5 s otherwise.
  const snapshotQ = useQuery<DisplaySnapshot>({
    queryKey: DISPLAY_SNAPSHOT_QUERY_KEY,
    queryFn: () => api.display.snapshot(),
    refetchInterval: (query) => {
      const snapshot = query.state.data as DisplaySnapshot | undefined;
      return snapshot?.codeBlueSession ? 2_000 : 5_000;
    },
    // Always poll even when the tab is in the background (this is a wall display).
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: (previous) => previous,
    retry: 2,
  });

  const session = snapshotQ.data?.codeBlueSession ?? null;
  const logEntries = session?.logEntries ?? [];
  const presence = session?.presence ?? [];
  const linkedEquipment = session?.linkedEquipment ?? [];

  // Server-confirmed session end: the keepalive-driven reconciler forces a
  // snapshot refetch on persistent divergence — the overlay/wall never
  // decides locally that a session ended (Phase 9 doctrine).
  useCodeBlueKeepaliveReconciliation({
    queryClient,
    getLocalActiveSessionId: () => session?.id ?? null,
  });

  const startedAtRef = useRef<string | null>(null);
  if (session?.startedAt) {
    startedAtRef.current = session.startedAt;
  } else {
    startedAtRef.current = null;
  }
  const elapsed = useElapsed(startedAtRef.current);
  const recentEntries = useMemo(
    () => [...logEntries].reverse().slice(0, 8),
    [logEntries]
  );

  const equipmentCount = linkedEquipment.length;

  return (
    <div
      className="relative min-h-screen bg-zinc-950 text-white flex flex-col"
      dir="rtl"
      style={{ borderTop: session ? "4px solid var(--destructive)" : "4px solid var(--border)" }}
    >
      {/* Connection indicator */}
      <div className="absolute top-2 start-2">
        {snapshotQ.isError
          ? <WifiOff className="h-4 w-4 text-red-400" />
          : <Wifi className="h-4 w-4 text-green-500/50" />
        }
      </div>
      {snapshotQ.isError && (
        <div className="text-center text-red-400 text-sm py-1 bg-red-950/30">
          {t.codeBlue.display.connectionLost}
        </div>
      )}

      {!session ? (
        /* Standby */
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-zinc-600">
            <div className="text-4xl font-black tracking-widest mb-4">{t.codeBlue.display.awaitingEvent}</div>
            <div className="text-lg">{t.codeBlue.display.autoUpdateNote}</div>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="px-8 py-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <div className="text-red-400 font-black tracking-widest text-2xl">⚠ CODE BLUE ACTIVE</div>
              {linkedEquipment.length > 0 && (
                <div className="text-amber-300/90 text-base mt-1">
                  {t.codeBlue.display.equipmentInEvent}: {linkedEquipment.map((e) => e.name).join(" · ")}
                </div>
              )}
            </div>
            <div className="text-end text-sm text-zinc-400 flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-400" />
              {session.managerUserName}
            </div>
          </div>

          {/* Giant timer */}
          <div className="px-8 py-10 bg-zinc-900/60 border-b border-zinc-800 text-center">
            <div className="font-black text-9xl tracking-widest font-mono leading-none">
              {formatElapsed(elapsed)}
            </div>
            <div className="flex gap-6 justify-center items-center mt-4 text-zinc-400 text-base">
              <span>{t.codeBlue.display.elapsedLabel}</span>
              {equipmentCount > 0 && (
                <span className="text-amber-300/90 font-semibold">
                  {t.codeBlue.display.equipmentCountLine(equipmentCount)}
                </span>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="flex-1 px-8 py-6 overflow-y-auto">
            <div className="text-sm text-zinc-500 tracking-widest uppercase mb-4">{t.codeBlue.display.events}</div>
            <div className="flex flex-col gap-4">
              {recentEntries.map((entry, idx) => (
                <div key={`${entry.elapsedMs}-${idx}`} className="flex gap-6 items-baseline">
                  <span className="text-2xl font-mono text-zinc-600 min-w-[60px]">{formatElapsed(entry.elapsedMs)}</span>
                  <span className="text-2xl text-white">{entry.label}</span>
                  <span className="text-base text-green-400 mr-auto">{entry.loggedByName}</span>
                </div>
              ))}
              {logEntries.length === 0 && (
                <p className="text-zinc-600 text-xl">{t.codeBlue.display.noEvents}</p>
              )}
            </div>
          </div>

          {/* Presence */}
          <div className="px-8 py-4 border-t border-zinc-800 flex gap-3 items-center">
            <span className="text-sm text-zinc-600">{t.codeBlue.display.present}</span>
            {presence.map((p) => (
              <span key={p.userId} className="bg-blue-900 text-blue-300 text-sm px-3 py-1 rounded-full">
                {p.userName}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
