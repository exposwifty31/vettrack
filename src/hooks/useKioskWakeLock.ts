// Phase 9 PR 9.2 — Kiosk wake-lock with bounded reacquire discipline.
//
// Contract (plan §3.2):
//   - Kiosk-only: requested ONLY on the Department Display surface, opted-in
//     via `?kiosk=1`. Never requested on any other PWA surface.
//   - Bounded reacquire: at most 5 attempts within any rolling 60 s window.
//     After exhaustion: 60 s cooldown, log once, no further attempts until
//     reset.
//   - Per-rejection backoff: 2 s, 4 s, 8 s (ceiling 8 s).
//   - Visibility-gated: no reacquire while hidden/backgrounded. On hidden,
//     pending timers are cancelled; the lock is implicitly released by the
//     browser. On `visibilitychange → visible`, the attempt budget and
//     cooldown state reset to zero.
//   - Silent degradation when the platform does not support wake-lock (iOS
//     PWA, older browsers).

import { useEffect } from "react";
import { api } from "@/lib/api";

const ATTEMPT_BUDGET = 5;
const BUDGET_WINDOW_MS = 60_000;
const EXHAUSTION_COOLDOWN_MS = 60_000;
const REJECTION_BACKOFF_MS = [2_000, 4_000, 8_000];

type WakeLockSentinelMinimal = {
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (kind: "screen") => Promise<WakeLockSentinelMinimal>;
  };
};

function isWakeLockSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return !!(navigator as WakeLockNavigator).wakeLock;
}

export function useKioskWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!isWakeLockSupported()) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelMinimal | null = null;
    // Single-flight guard so a second `tryAcquire` does not start while a
    // first `wakeLock.request("screen")` is still in-flight. Without this,
    // rapid visibility toggling (visible → hidden → visible during the
    // initial await) can race: both awaits eventually resolve, both write
    // to `sentinel`, and the earlier lock becomes orphaned — only
    // released by the browser's implicit hidden-tab release.
    let acquiring = false;
    let attemptTimestamps: number[] = [];
    let consecutiveRejections = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    let inCooldownUntilMs = 0;
    let exhaustedLogged = false;

    function resetBudget(): void {
      attemptTimestamps = [];
      consecutiveRejections = 0;
      inCooldownUntilMs = 0;
      exhaustedLogged = false;
    }

    function clearPending(): void {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    }

    function withinBudget(now: number): boolean {
      attemptTimestamps = attemptTimestamps.filter((ts) => ts + BUDGET_WINDOW_MS >= now);
      return attemptTimestamps.length < ATTEMPT_BUDGET;
    }

    async function tryAcquire(): Promise<void> {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      if (sentinel) return;
      if (acquiring) return;
      const now = Date.now();
      if (now < inCooldownUntilMs) return;
      if (!withinBudget(now)) {
        if (!exhaustedLogged) {
          exhaustedLogged = true;
          inCooldownUntilMs = now + EXHAUSTION_COOLDOWN_MS;
          console.warn("[wake-lock] reacquire budget exhausted; cooling down");
          // Phase 9 PR 9.2 — bump the bounded
          // `display_wake_lock_reacquire_exhausted` counter via the
          // existing telemetry endpoint. Fire-and-forget, never blocks
          // the hook. Best-effort under offline conditions; the kiosk
          // mode is operational-only telemetry per plan §3.2.
          void api.realtime
            .telemetry({ displayWakeLockReacquireExhausted: true })
            .catch(() => {});
        }
        return;
      }
      attemptTimestamps.push(now);

      acquiring = true;
      const nav = navigator as WakeLockNavigator;
      try {
        const result = await nav.wakeLock!.request("screen");
        // Re-check on every async path that could have changed state during
        // the in-flight request. Three cases:
        //   1. Effect was disposed (`cancelled`) — release and bail.
        //   2. Page went hidden during the await — release and bail; the
        //      next visibilitychange → visible will arm a fresh tryAcquire.
        //   3. Another (somehow concurrent) acquisition already populated
        //      `sentinel` — release the duplicate and bail. The
        //      `acquiring` guard above should prevent this in practice;
        //      this branch is defensive.
        if (cancelled || document.visibilityState !== "visible" || sentinel) {
          result.release().catch(() => {});
          return;
        }
        sentinel = result;
        consecutiveRejections = 0;
        // When the browser releases the lock (tab hidden, suspend), null it
        // so the visibilitychange → visible handler can re-acquire.
        result.addEventListener?.("release", () => {
          if (sentinel === result) sentinel = null;
        });
      } catch {
        const delay = REJECTION_BACKOFF_MS[Math.min(consecutiveRejections, REJECTION_BACKOFF_MS.length - 1)];
        consecutiveRejections += 1;
        clearPending();
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          void tryAcquire();
        }, delay);
      } finally {
        acquiring = false;
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        resetBudget();
        void tryAcquire();
      } else {
        // Browser implicitly releases the screen lock on hidden, but the
        // sentinel reference can become stale if a release event hasn't
        // fired yet. Explicitly release here so we don't leak the handle
        // if the browser's implicit release semantics differ across
        // engines or the in-flight acquisition resolves after the page
        // returns to visible.
        clearPending();
        if (sentinel) {
          sentinel.release().catch(() => {});
          sentinel = null;
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void tryAcquire();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearPending();
      if (sentinel) {
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [enabled]);
}
