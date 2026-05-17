// Phase 9 PR 9.2 — Department Display heartbeat (operational liveness only).
//
// Contract (plan §3.2):
//   - Posts once per 30 s to /api/display/heartbeat.
//   - Failure is silent and never affects display rendering, Code Blue
//     overlay, audit, authority, billing, or any clinical workflow.
//   - Server coalesces by displaySessionId at ≤ 1 per 10 s — additional
//     heartbeats are dropped silently. The 30 s client cadence stays
//     comfortably above that ceiling.
//   - Heartbeat presence/absence has no clinical meaning.
//
// Wire payload is intentionally minimal: only `displaySessionId` and
// `kioskMode`. The server doesn't read anything else; transmitting extra
// fields from every display tab every 30 s would just waste bytes on a
// hot polling path. If a future PR needs to correlate by build tag or
// last applied event id, add the field back when the server actually
// reads it.

import { useEffect } from "react";
import { api } from "@/lib/api";
import { getOrCreateDisplaySessionId } from "@/lib/display-session";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useDisplayHeartbeat(args: { kioskMode: boolean }): void {
  const { kioskMode } = args;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const displaySessionId = getOrCreateDisplaySessionId();

    let cancelled = false;

    async function postOnce(): Promise<void> {
      if (cancelled) return;
      try {
        await api.display.heartbeat({ displaySessionId, kioskMode });
      } catch {
        // Silent — operational only. Heartbeat failure must never affect
        // display rendering or any clinical workflow.
      }
    }

    void postOnce();
    const timer = window.setInterval(() => {
      void postOnce();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [kioskMode]);
}
