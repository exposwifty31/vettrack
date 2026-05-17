// Phase 9 PR 9.4 — Code Blue keepalive reconciliation.
//
// Consumes the structured KEEPALIVE SSE event (see server/lib/code-blue-
// keepalive.ts) and reconciles the locally observed Code Blue session id
// against the server's view.
//
// Doctrine (plan §3.3, §3.4):
//   - The server is the sole authority on whether a Code Blue session is
//     active. The client never decides locally that a session has ended.
//   - When the server reports a different `activeCodeBlueSessionId` than the
//     client's local snapshot, AND the disagreement persists past
//     RECONCILE_GRACE_MS, the client forces a snapshot refetch.
//   - The currently visible Code Blue overlay MUST remain visible during
//     this reconciliation; only the snapshot is refetched (the overlay is
//     driven by the snapshot, never cleared locally).
//   - `stormHint = "elevated"` is a hint only. It triggers a bounded extra
//     jitter delay on the next snapshot poll but never increases load or
//     creates new metric series.

import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { DISPLAY_SNAPSHOT_QUERY_KEY } from "@/lib/event-reducer";
import { subscribeKeepalive, type RealtimeKeepalivePayload } from "@/lib/realtime";

export const RECONCILE_GRACE_MS = 5_000;

/**
 * Factory for the pure reconciliation logic. Extracted from the React hook
 * so its retry-on-persistent-mismatch contract can be tested without React /
 * jsdom. The hook below is a thin wrapper that lifecycle-manages an
 * instance of this factory.
 */
export function createCodeBlueReconciler(deps: {
  invalidateSnapshot: () => void;
  reportSnapshotFallback: () => void;
  getLocalActiveSessionId: () => string | null | undefined;
  graceMs?: number;
}): { handleKeepalive: (payload: RealtimeKeepalivePayload) => void; dispose: () => void } {
  const graceMs = deps.graceMs ?? RECONCILE_GRACE_MS;

  let pendingReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMismatchSignature = "";

  function clearPending(): void {
    if (pendingReconcileTimer !== null) {
      clearTimeout(pendingReconcileTimer);
      pendingReconcileTimer = null;
    }
  }

  function handleKeepalive(payload: RealtimeKeepalivePayload): void {
    const local = deps.getLocalActiveSessionId() ?? null;
    const server = payload.activeCodeBlueSessionId;
    // Normalize null/undefined for comparison.
    const localKey = local ?? "";
    const serverKey = server ?? "";

    if (localKey === serverKey) {
      // No mismatch — drop any pending reconcile and reset state so the
      // next divergence (if any) gets a fresh grace window.
      lastMismatchSignature = "";
      clearPending();
      return;
    }

    const signature = `${localKey}|${serverKey}`;
    if (signature !== lastMismatchSignature) {
      // First time we've seen this specific divergence — start the grace
      // window. If the divergence persists past graceMs we force a
      // snapshot refetch.
      lastMismatchSignature = signature;
      // Capture the peer session id observed at arm time so the timer
      // callback can re-check convergence at fire time. If an SSE event
      // updates the local snapshot during the grace window WITHOUT a
      // subsequent agreement-keepalive arriving (clearPending isn't
      // called in that window), the timer would otherwise fire a
      // spurious refetch + telemetry increment.
      const armedAtServerKey = serverKey;
      clearPending();
      pendingReconcileTimer = setTimeout(() => {
        pendingReconcileTimer = null;
        // Reset the signature so subsequent keepalives reporting the same
        // mismatch arm a fresh grace window. Without this clear, the
        // refetch becomes one-shot per (localKey, serverKey) pair: if the
        // first invalidateSnapshot() does not resolve the disagreement
        // (e.g. transient server-side delay), the hook would never retry
        // and the overlay would stay permanently divergent from server
        // truth. Clearing here paces retries to the keepalive cadence
        // (~10 s) + grace (~5 s) ≈ 15 s between forced refetches.
        lastMismatchSignature = "";
        // Re-check before firing: if the local snapshot converged with
        // the peer during the grace window (e.g., an SSE event delivered
        // the matching CB state without an intervening keepalive), the
        // mismatch is gone — skip the spurious refetch and the
        // misleading `code_blue_snapshot_fallback` telemetry increment.
        const currentLocal = deps.getLocalActiveSessionId() ?? null;
        const currentLocalKey = currentLocal ?? "";
        if (currentLocalKey === armedAtServerKey) {
          return;
        }
        // Force a fresh fetch — never clear the overlay locally; the
        // snapshot drives overlay visibility.
        deps.invalidateSnapshot();
        // Best-effort telemetry: a snapshot fallback was triggered because
        // realtime certainty disagreed with local state.
        deps.reportSnapshotFallback();
      }, graceMs);
      return;
    }

    // Same mismatch persisting and a timer is already armed for it — wait
    // for the existing timer to fire. The post-fire clear above ensures we
    // re-arm on the next keepalive if the divergence remains.
  }

  function dispose(): void {
    clearPending();
  }

  return { handleKeepalive, dispose };
}

export function useCodeBlueKeepaliveReconciliation(args: {
  queryClient: QueryClient;
  getLocalActiveSessionId: () => string | null | undefined;
}): void {
  const { queryClient, getLocalActiveSessionId } = args;

  const localGetterRef = useRef(getLocalActiveSessionId);
  const qcRef = useRef(queryClient);
  useEffect(() => {
    localGetterRef.current = getLocalActiveSessionId;
    qcRef.current = queryClient;
  }, [getLocalActiveSessionId, queryClient]);

  useEffect(() => {
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: () => {
        void qcRef.current.invalidateQueries({ queryKey: DISPLAY_SNAPSHOT_QUERY_KEY });
      },
      reportSnapshotFallback: () => {
        void api.realtime.telemetry({ codeBlueSnapshotFallback: true }).catch(() => {});
      },
      getLocalActiveSessionId: () => localGetterRef.current(),
    });

    const unsubscribe = subscribeKeepalive(reconciler.handleKeepalive);
    return () => {
      unsubscribe();
      reconciler.dispose();
    };
  }, []);
}
