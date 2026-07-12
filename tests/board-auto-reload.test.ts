/**
 * @vitest-environment happy-dom
 *
 * Phase 4 (C1): the /board kiosk 3-condition auto-reload machine.
 *   1. reload on a CONFIRMED byte-different service worker OR an already-
 *      waiting service worker (T6 REVISED — the residual kiosk-audit case),
 *      but never on peer split-version gossip,
 *   2. DEFER while a Code Blue is active and fire only when the server snapshot
 *      goes calm (codeBlueSession dropped) — for BOTH update variants,
 *   3. reuse CHUNK_RECOVERY_GUARD_KEY as the loop guard — a guard-already-set
 *      reload is classified swForcedReloadLoopSuppressed, not swForcedReloadSurface.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { DISPLAY_SNAPSHOT_QUERY_KEY } from "@/lib/event-reducer";
import { CHUNK_RECOVERY_GUARD_KEY } from "@/lib/chunk-load-recovery";

const { telemetry, recoverSpy } = vi.hoisted(() => ({
  telemetry: vi.fn(() => Promise.resolve({ ok: true })),
  recoverSpy: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/api", () => ({ api: { realtime: { telemetry } } }));
vi.mock("@/lib/chunk-load-recovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chunk-load-recovery")>();
  return { ...actual, recoverFromChunkLoadFailure: recoverSpy };
});

import {
  isConfirmedNewWorker,
  isWaitingWorkerUpdate,
  useBoardAutoReload,
} from "@/board/useBoardAutoReload";

// Stubbed ServiceWorker so `detail.worker instanceof ServiceWorker` is exercisable
// under happy-dom (which has no ServiceWorker constructor).
class FakeServiceWorker {}
const worker = () => new FakeServiceWorker() as unknown as ServiceWorker;

const TAG = typeof __VT_BUILD_TAG__ !== "undefined" ? __VT_BUILD_TAG__ : "unknown";
const OTHER_TAG = `${TAG}-next`;

beforeEach(() => {
  telemetry.mockClear();
  recoverSpy.mockClear();
  vi.stubGlobal("ServiceWorker", FakeServiceWorker);
  try {
    sessionStorage.removeItem(CHUNK_RECOVERY_GUARD_KEY);
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function qcWith(codeBlueSession: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, { codeBlueSession });
  return qc;
}

function dispatchSwUpdate(detail: unknown): void {
  window.dispatchEvent(new CustomEvent("sw-update-available", { detail }));
}

describe("isConfirmedNewWorker discriminator", () => {
  it("accepts an activated worker with a byte-different build tag", () => {
    expect(isConfirmedNewWorker({ worker: worker(), buildTag: OTHER_TAG })).toBe(true);
  });

  it("rejects peer-gossip (worker: null) even with a real remote tag", () => {
    expect(isConfirmedNewWorker({ worker: null, buildTag: OTHER_TAG })).toBe(false);
  });

  it("rejects a waiting worker (buildTag: null)", () => {
    expect(isConfirmedNewWorker({ worker: worker(), buildTag: null })).toBe(false);
  });

  it("rejects a worker whose tag equals the bundle tag", () => {
    expect(isConfirmedNewWorker({ worker: worker(), buildTag: TAG })).toBe(false);
  });

  it("rejects empty / missing detail", () => {
    expect(isConfirmedNewWorker(undefined)).toBe(false);
    expect(isConfirmedNewWorker(null)).toBe(false);
  });
});

describe("isWaitingWorkerUpdate discriminator", () => {
  it("accepts a waiting worker (real worker, buildTag: null)", () => {
    expect(isWaitingWorkerUpdate({ worker: worker(), buildTag: null })).toBe(true);
  });

  it("rejects peer-gossip (worker: null) even with a real remote tag", () => {
    expect(isWaitingWorkerUpdate({ worker: null, buildTag: OTHER_TAG })).toBe(false);
  });

  it("rejects a confirmed new worker (buildTag is a string, not null)", () => {
    expect(isWaitingWorkerUpdate({ worker: worker(), buildTag: OTHER_TAG })).toBe(false);
    expect(isWaitingWorkerUpdate({ worker: worker(), buildTag: TAG })).toBe(false);
  });

  it("rejects empty / missing detail", () => {
    expect(isWaitingWorkerUpdate(undefined)).toBe(false);
    expect(isWaitingWorkerUpdate(null)).toBe(false);
  });
});

describe("useBoardAutoReload — reload + defer machine", () => {
  it("reloads immediately on a confirmed update when no emergency is active", () => {
    const qc = qcWith(null);
    renderHook(() => useBoardAutoReload(), { wrapper: wrapperFor(qc) });
    act(() => dispatchSwUpdate({ worker: worker(), buildTag: OTHER_TAG }));
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith({ unregisterServiceWorkers: false });
    expect(telemetry).toHaveBeenCalledWith({ swForcedReloadSurface: "kiosk" });
  });

  it("defers during an active Code Blue, then reloads once the snapshot goes calm", () => {
    const qc = qcWith({ id: "cb-1" });
    renderHook(() => useBoardAutoReload(), { wrapper: wrapperFor(qc) });

    act(() => dispatchSwUpdate({ worker: worker(), buildTag: OTHER_TAG }));
    // Deferred — no reload, no telemetry while the emergency is live.
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(telemetry).not.toHaveBeenCalled();

    // Server confirms the session ended → cache drops codeBlueSession (calm).
    act(() => {
      qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, { codeBlueSession: null });
    });
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledWith({ swForcedReloadSurface: "kiosk" });
  });

  it("classifies a loop-suppressed reload when the guard is already set", () => {
    sessionStorage.setItem(CHUNK_RECOVERY_GUARD_KEY, "1");
    const qc = qcWith(null);
    renderHook(() => useBoardAutoReload(), { wrapper: wrapperFor(qc) });
    act(() => dispatchSwUpdate({ worker: worker(), buildTag: OTHER_TAG }));
    expect(telemetry).toHaveBeenCalledWith({ swForcedReloadLoopSuppressed: true });
    expect(telemetry).not.toHaveBeenCalledWith({ swForcedReloadSurface: "kiosk" });
  });

  it("ignores peer-gossip events (no reload)", () => {
    const qc = qcWith(null);
    renderHook(() => useBoardAutoReload(), { wrapper: wrapperFor(qc) });
    act(() => dispatchSwUpdate({ worker: null, buildTag: OTHER_TAG })); // peer gossip
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(telemetry).not.toHaveBeenCalled();
  });

  // T6 (REVISED) — the residual kiosk-audit case: a waiting-worker update
  // (main.tsx's notifyIfWaiting path) must now reload too, through the SAME
  // Code-Blue-aware owner and loop guard as the confirmed-worker path.
  it("reloads immediately on a waiting-worker update when no emergency is active", () => {
    const qc = qcWith(null);
    renderHook(() => useBoardAutoReload(), { wrapper: wrapperFor(qc) });
    act(() => dispatchSwUpdate({ worker: worker(), buildTag: null }));
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledWith({ unregisterServiceWorkers: false });
    expect(telemetry).toHaveBeenCalledWith({ swForcedReloadSurface: "kiosk" });
  });

  it("defers a waiting-worker update during an active Code Blue, then reloads once calm", () => {
    const qc = qcWith({ id: "cb-1" });
    renderHook(() => useBoardAutoReload(), { wrapper: wrapperFor(qc) });

    act(() => dispatchSwUpdate({ worker: worker(), buildTag: null }));
    // Deferred — no reload, no telemetry while the emergency is live.
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(telemetry).not.toHaveBeenCalled();

    // Server confirms the session ended → cache drops codeBlueSession (calm).
    act(() => {
      qc.setQueryData(DISPLAY_SNAPSHOT_QUERY_KEY, { codeBlueSession: null });
    });
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledWith({ swForcedReloadSurface: "kiosk" });
  });

  it("classifies a loop-suppressed reload for a waiting-worker update when the guard is already set", () => {
    sessionStorage.setItem(CHUNK_RECOVERY_GUARD_KEY, "1");
    const qc = qcWith(null);
    renderHook(() => useBoardAutoReload(), { wrapper: wrapperFor(qc) });
    act(() => dispatchSwUpdate({ worker: worker(), buildTag: null }));
    expect(telemetry).toHaveBeenCalledWith({ swForcedReloadLoopSuppressed: true });
    expect(telemetry).not.toHaveBeenCalledWith({ swForcedReloadSurface: "kiosk" });
  });
});
