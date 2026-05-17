// Phase 9 PR 9.3 — Realtime reconciliation hook.
//
// Centralizes the doctrine §3.2 / §3.5 reconciliation triggers so the
// Department Display, ER Command Center, Code Blue overlay, and other
// realtime-consuming pages share one implementation. Avoids drift between
// per-page event handlers.
//
// Triggers (all four are wired):
//   - visibilitychange (when transitioning to visible)
//   - pageshow with event.persisted === true (BFCache restore)
//   - online (browser reports network restoration)
//   - freeze / resume (Page Lifecycle API)
//
// Actions on each trigger:
//   - replayHttpCatchUpAfter() — when an EventIngestor is provided, catches
//     any outbox events the SSE stream missed while suspended.
//   - forceResyncWardErCaches() — invalidates the authoritative ward + ER
//     caches so subsequent renders read from the server.
//
// Additive only. Does not modify EventIngestor. Does not change SSE / outbox
// transport. Does not introduce shared workers, leader election, or new
// realtime event types.

import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EventIngestor } from "@/lib/realtime";
import { forceResyncWardErCaches } from "@/lib/event-reducer";

type ResyncTrigger = "visibility" | "pageshow" | "online" | "version_mismatch" | "gap" | "peer_ahead" | "emergency_uncertain";

function reportForcedResync(trigger: ResyncTrigger): void {
  void api.realtime.telemetry({ displayForcedResyncTrigger: trigger }).catch(() => {});
}

type ReconcileArgs = {
  queryClient: QueryClient;
  /** Optional — when present, also replays missed outbox events on each trigger. */
  ingestor?: EventIngestor;
  /** Optional — extra refetch on every trigger; used by pages with bespoke caches. */
  extraRefetch?: () => void | Promise<void>;
};

const RECONCILE_DEBOUNCE_MS = 250;

export function useRealtimeReconciliation(args: ReconcileArgs): void {
  const { queryClient, ingestor, extraRefetch } = args;

  // Capture latest references so the effect's setup never has to re-run when
  // the caller renders. Reconciliation lifecycle is tied to the page mount,
  // not to ingestor identity changes.
  const ingestorRef = useRef(ingestor);
  const extraRef = useRef(extraRefetch);
  const qcRef = useRef(queryClient);
  useEffect(() => {
    ingestorRef.current = ingestor;
    extraRef.current = extraRefetch;
    qcRef.current = queryClient;
  }, [ingestor, extraRefetch, queryClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let scheduled = false;
    let cancelled = false;
    let pendingTrigger: ResyncTrigger | null = null;

    function schedule(trigger: ResyncTrigger): void {
      // If a different trigger arrives while one is pending, keep the
      // earliest non-null trigger — it represents the original cause.
      if (!pendingTrigger) pendingTrigger = trigger;
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        if (cancelled) return;
        const fired = pendingTrigger;
        pendingTrigger = null;
        if (fired) reportForcedResync(fired);
        void run();
      }, RECONCILE_DEBOUNCE_MS);
    }

    async function run(): Promise<void> {
      try {
        const ing = ingestorRef.current;
        if (ing) {
          try {
            await ing.replayHttpCatchUpAfter(ing.getLastAppliedEventId());
          } catch {
            // Replay is best-effort; the snapshot refetch below still converges.
          }
        }
        try {
          await forceResyncWardErCaches(qcRef.current);
        } catch {
          // Refetch is best-effort.
        }
        const extra = extraRef.current;
        if (extra) {
          try {
            await extra();
          } catch {
            // Caller-provided refetch is best-effort.
          }
        }
      } catch {
        // never throw out of a reconciliation pass
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") schedule("visibility");
    }

    function onPageShow(ev: PageTransitionEvent): void {
      if (ev.persisted) schedule("pageshow");
    }

    function onOnline(): void {
      schedule("online");
    }

    function onResume(): void {
      // Page Lifecycle API `resume` — treat as visibility-equivalent for
      // telemetry purposes. The plan §3.9 enum does not include a separate
      // "resume" trigger; map to "visibility" since the recovery action is
      // identical.
      schedule("visibility");
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    // Page Lifecycle API — supported in Chromium-based browsers, no-op elsewhere.
    // `resume` fires after the page returns from a frozen state.
    document.addEventListener("resume", onResume as EventListener);
    // `freeze` has no action — wake-from-freeze is covered by `resume` + the
    // subsequent visibilitychange / pageshow that almost always accompany it.

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("resume", onResume as EventListener);
    };
  }, []);
}
