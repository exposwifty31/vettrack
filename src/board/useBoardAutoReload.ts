import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CHUNK_RECOVERY_GUARD_KEY, recoverFromChunkLoadFailure } from "@/lib/chunk-load-recovery";
import { DISPLAY_SNAPSHOT_QUERY_KEY } from "@/lib/event-reducer";

type SwUpdateDetail = { worker?: ServiceWorker | null; buildTag?: string | null };

/**
 * True ONLY for the confirmed-activated new-worker source of `sw-update-available`
 * (main.tsx:139-143: worker = registration.active, buildTag = a real string the
 * main.tsx guard already proved ≠ the bundle tag). Excludes the two other emitters
 * of the same event:
 *   - waiting-worker (main.tsx:158-162): buildTag is null.
 *   - peer split-version gossip (realtime.ts:232): worker is null — and its
 *     buildTag IS a real remote string, so ONLY the worker check excludes it.
 * The `typeof ServiceWorker` guard keeps this safe on browsers without SW support
 * (and under happy-dom), where `instanceof ServiceWorker` would otherwise throw.
 */
export function isConfirmedNewWorker(detail: SwUpdateDetail | undefined | null): boolean {
  if (!detail) return false;
  const bundleTag = typeof __VT_BUILD_TAG__ !== "undefined" ? __VT_BUILD_TAG__ : "unknown";
  return (
    typeof ServiceWorker !== "undefined" &&
    detail.worker instanceof ServiceWorker &&
    typeof detail.buildTag === "string" &&
    detail.buildTag !== bundleTag
  );
}

/**
 * Read-only observation of server-confirmed emergency state from the display
 * snapshot cache. NOT a fetch — subscribes to the React Query cache and reads the
 * same DISPLAY_SNAPSHOT_QUERY_KEY the screen polls, so there is no second poller
 * and no cadence/key change. `codeBlueSession != null` is the identical field the
 * overlay renders on.
 */
function useEmergencyActive(): boolean {
  const qc = useQueryClient();
  return useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    () => qc.getQueryData<{ codeBlueSession?: unknown }>(DISPLAY_SNAPSHOT_QUERY_KEY)?.codeBlueSession != null,
    () => false,
  );
}

/**
 * Kiosk auto-reload for the /board wall display. On a confirmed byte-different
 * service worker, reload so the kiosk never drifts a stale build — BUT defer while
 * a Code Blue is active and reload only once the server snapshot drops the session
 * ("calm"; never a local timer or keepalive-inferred signal, which would be
 * de-facto optimistic termination). The loop guard is the existing
 * CHUNK_RECOVERY_GUARD_KEY: at most one auto-reload per tab session across all
 * triggers (the owner-approved posture for an unattended wall display).
 *
 * Consumes only the existing `sw-update-available` window event — it adds no
 * second navigator.serviceWorker message listener and never calls
 * registration.update()/unregister(), so it touches nothing in the SW.
 */
export function useBoardAutoReload(): void {
  const emergencyActive = useEmergencyActive();
  const emergencyActiveRef = useRef(emergencyActive);
  const prevEmergencyRef = useRef(emergencyActive);
  const pendingReloadRef = useRef(false);

  // Keep the ref current BEFORE the edge-detect effect runs. Both depend on
  // emergencyActive and effects run in declaration order, so this must come first
  // — performGuardedReload's re-check reads emergencyActiveRef.
  useEffect(() => {
    emergencyActiveRef.current = emergencyActive;
  }, [emergencyActive]);

  const performGuardedReload = useCallback(async () => {
    // Re-check at the top to close the start-during-decision race.
    if (emergencyActiveRef.current) return;
    let suppressed = false;
    try {
      suppressed = sessionStorage.getItem(CHUNK_RECOVERY_GUARD_KEY) === "1";
    } catch {
      suppressed = false;
    }
    // Classify BEFORE recover() reloads/no-ops (it reloads synchronously after an
    // async cache clear, too late to post telemetry from its return path).
    if (suppressed) {
      void api.realtime.telemetry({ swForcedReloadLoopSuppressed: true }).catch(() => {});
    } else {
      void api.realtime.telemetry({ swForcedReloadSurface: "kiosk" }).catch(() => {});
    }
    void recoverFromChunkLoadFailure({ unregisterServiceWorkers: false });
  }, []);

  // Fire the deferred reload on the emergency true → false edge. "Calm" is ONLY
  // the server snapshot dropping codeBlueSession.
  useEffect(() => {
    const wasActive = prevEmergencyRef.current;
    prevEmergencyRef.current = emergencyActive;
    if (wasActive && !emergencyActive && pendingReloadRef.current) {
      pendingReloadRef.current = false;
      void performGuardedReload();
    }
  }, [emergencyActive, performGuardedReload]);

  // Listen for confirmed SW updates.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onSwUpdate(event: Event): void {
      const detail = (event as CustomEvent<SwUpdateDetail>).detail;
      if (!isConfirmedNewWorker(detail)) return;
      if (emergencyActiveRef.current) {
        // Defer — never reload during an active Code Blue. No telemetry: there is
        // no bounded "deferred" enum and inventing one is out of fence.
        pendingReloadRef.current = true;
        return;
      }
      void performGuardedReload();
    }
    window.addEventListener("sw-update-available", onSwUpdate);
    return () => window.removeEventListener("sw-update-available", onSwUpdate);
  }, [performGuardedReload]);
}
