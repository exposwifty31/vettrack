// Phase 9 PR 9.4 — regression test for the Code Blue keepalive reconciliation
// retry-on-persistent-mismatch contract.
//
// Bug report (high severity):
//   After the pendingReconcileTimer fires and invalidates queries,
//   lastMismatchSignature was not cleared. Subsequent keepalives reporting
//   the SAME (localKey, serverKey) pair fell through "same mismatch
//   persisting" and never re-armed the timer — if the first refetch did
//   not resolve the divergence (transient server delay, snapshot fetch
//   failure, etc.) the overlay would stay permanently divergent from
//   server truth.
//
// Fix:
//   The timer callback now clears lastMismatchSignature, so the next
//   keepalive (server cadence ~10 s) arms a fresh grace window. Net retry
//   cadence is ~15 s between forced refetches when the divergence
//   stubbornly persists.
//
// The reconciliation logic was extracted into the pure factory
// `createCodeBlueReconciler` (see src/hooks/useCodeBlueKeepaliveReconciliation.ts)
// so its behavior can be exercised without React rendering / jsdom. The
// hook itself is a thin wrapper around that factory.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodeBlueReconciler } from "../src/hooks/useCodeBlueKeepaliveReconciliation";

type KeepalivePayload = { activeCodeBlueSessionId: string | null; stormHint: "none" | "elevated" };

describe("createCodeBlueReconciler — retry-on-persistent-mismatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates the display snapshot when a mismatch persists past the grace window", () => {
    const invalidate = vi.fn();
    const reportFallback = vi.fn();
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: reportFallback,
      getLocalActiveSessionId: () => null,
    });

    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });
    vi.advanceTimersByTime(4_500);
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(reportFallback).toHaveBeenCalledTimes(1);

    reconciler.dispose();
  });

  it("RE-ARMS the reconcile timer when the same mismatch persists after the first refetch", () => {
    const invalidate = vi.fn();
    const reportFallback = vi.fn();
    // getLocalActiveSessionId stays null forever — the refetch never
    // resolves the divergence in this scenario. This is the regression
    // path: without clearing lastMismatchSignature inside the timer
    // callback, the hook used to fall through "same mismatch persisting"
    // on every subsequent keepalive and never re-arm.
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: reportFallback,
      getLocalActiveSessionId: () => null,
    });

    const mismatch: KeepalivePayload = { activeCodeBlueSessionId: "session-A", stormHint: "none" };

    reconciler.handleKeepalive(mismatch);
    vi.advanceTimersByTime(5_000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // Second keepalive ~10 s in with the SAME mismatch (refetch didn't
    // resolve). Hook must arm a NEW grace window.
    vi.advanceTimersByTime(5_000);
    reconciler.handleKeepalive(mismatch);

    vi.advanceTimersByTime(4_500);
    expect(invalidate).toHaveBeenCalledTimes(1); // grace not yet elapsed

    vi.advanceTimersByTime(1_000);
    expect(invalidate).toHaveBeenCalledTimes(2); // retry fired
    expect(reportFallback).toHaveBeenCalledTimes(2);

    // Third keepalive — retry again.
    vi.advanceTimersByTime(4_000);
    reconciler.handleKeepalive(mismatch);
    vi.advanceTimersByTime(5_000);
    expect(invalidate).toHaveBeenCalledTimes(3);

    reconciler.dispose();
  });

  it("does NOT fire when the local snapshot agrees with the server keepalive", () => {
    const invalidate = vi.fn();
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: vi.fn(),
      getLocalActiveSessionId: () => "session-A",
    });

    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });
    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled();
    reconciler.dispose();
  });

  it("cancels a pending reconcile when a keepalive resolves the mismatch within the grace window", () => {
    const invalidate = vi.fn();
    let localId: string | null = null;
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: vi.fn(),
      getLocalActiveSessionId: () => localId,
    });

    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });
    vi.advanceTimersByTime(2_000);

    // Local state catches up before the grace window elapses.
    localId = "session-A";
    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });

    vi.advanceTimersByTime(5_000);
    expect(invalidate).not.toHaveBeenCalled();
    reconciler.dispose();
  });

  it("re-arms on the first keepalive after a new (different) mismatch signature appears", () => {
    const invalidate = vi.fn();
    let localId: string | null = null;
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: vi.fn(),
      getLocalActiveSessionId: () => localId,
    });

    // First mismatch: local=null, server=session-A. Fires at t=5 s.
    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });
    vi.advanceTimersByTime(5_000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // Local catches up; mismatch resolves.
    localId = "session-A";
    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });

    // New mismatch: local=session-A, server=session-B (e.g., the previous
    // CB ended and a brand new one started but local hasn't seen the SSE
    // event yet).
    vi.advanceTimersByTime(3_000);
    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-B", stormHint: "none" });
    vi.advanceTimersByTime(5_000);

    expect(invalidate).toHaveBeenCalledTimes(2);
    reconciler.dispose();
  });

  it("dispose cancels a pending reconcile so disposed instances do not fire", () => {
    const invalidate = vi.fn();
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: vi.fn(),
      getLocalActiveSessionId: () => null,
    });

    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });
    vi.advanceTimersByTime(2_000);
    reconciler.dispose();
    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("re-checks convergence at fire time and skips refetch if local matches the peer (SSE convergence without keepalive)", () => {
    // Regression — Cursor Bugbot: the pending reconcile timer used to fire
    // unconditionally after the grace window. If the local snapshot
    // converged with the peer between keepalives (e.g., an SSE event
    // delivered the matching CB state without a subsequent
    // agreement-keepalive arriving in time), the timer still called
    // invalidateSnapshot() and reportSnapshotFallback() — producing both a
    // spurious refetch and a misleading `code_blue_snapshot_fallback`
    // telemetry increment.
    const invalidate = vi.fn();
    const reportFallback = vi.fn();
    let localId: string | null = null;
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: reportFallback,
      getLocalActiveSessionId: () => localId,
    });

    // Mismatch keepalive arms the 5s timer.
    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });
    vi.advanceTimersByTime(3_000);

    // Local converges mid-grace via an SSE event (NOT a keepalive — that
    // would otherwise call clearPending). The timer is still armed.
    localId = "session-A";

    // Cross the grace window. Timer fires, but the re-check sees local
    // matches the peer, so it skips both the refetch and the telemetry.
    vi.advanceTimersByTime(3_000);
    expect(invalidate).not.toHaveBeenCalled();
    expect(reportFallback).not.toHaveBeenCalled();
    reconciler.dispose();
  });

  it("still fires when the mismatch genuinely persists at the grace boundary", () => {
    // Counter-regression: the convergence re-check must NOT short-circuit
    // when the divergence is still real at fire time.
    const invalidate = vi.fn();
    let localId: string | null = null;
    const reconciler = createCodeBlueReconciler({
      invalidateSnapshot: invalidate,
      reportSnapshotFallback: vi.fn(),
      getLocalActiveSessionId: () => localId,
    });

    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-A", stormHint: "none" });
    vi.advanceTimersByTime(5_000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // Local "converges" to a DIFFERENT session id mid-grace on a new
    // mismatch — the re-check must still fire because the peer's session
    // (session-B in this run) ≠ the local one (session-C).
    vi.advanceTimersByTime(5_000);
    reconciler.handleKeepalive({ activeCodeBlueSessionId: "session-B", stormHint: "none" });
    vi.advanceTimersByTime(2_000);
    localId = "session-C";
    vi.advanceTimersByTime(3_500);
    expect(invalidate).toHaveBeenCalledTimes(2);
    reconciler.dispose();
  });
});
