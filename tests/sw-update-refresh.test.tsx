/**
 * @vitest-environment happy-dom
 *
 * T-37 (R-SY-03 · CLICK-PATH-014) — SW-update banner Refresh must
 * deterministically reload exactly once.
 *
 * Defect: on the SW_UPDATED path the new SW has ALREADY claimed (so
 * `controllerchange` already fired) by the time the toast is shown. Posting
 * SKIP_WAITING to an already-active worker is a no-op — nothing reloads.
 *
 * GREEN policy pinned by this test (single race):
 *   (a) target worker is already the controller       → reload immediately
 *   (b) else post SKIP_WAITING, reload on controllerchange
 *   (c) neither fires within SW_UPDATE_RELOAD_TIMEOUT_MS (3000ms) → fallback reload
 * Precedence: an already-controller / controllerchange result wins over the
 * timeout; the reload runs exactly once (guard flag), and the timeout +
 * controllerchange listener are cleared once resolved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const toastFn = vi.fn();
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastFn(...args) }));

const safeReloadPageMock = vi.fn();
vi.mock("@/lib/safe-browser", () => ({
  isServiceWorkerSupported: () => true,
  safeReloadPage: (...args: unknown[]) => safeReloadPageMock(...args),
}));

import { SwUpdateBanner } from "@/components/sw-update-banner";

interface MockWorker {
  postMessage: ReturnType<typeof vi.fn>;
}

interface MockServiceWorkerContainer {
  controller: unknown;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fireControllerChange: () => void;
}

function createWorker(): MockWorker {
  return { postMessage: vi.fn() };
}

function createServiceWorkerContainer(controller: unknown = null): MockServiceWorkerContainer {
  const listeners = new Set<() => void>();
  return {
    controller,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      if (type === "controllerchange") listeners.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      if (type === "controllerchange") listeners.delete(cb);
    }),
    fireControllerChange: () => {
      for (const cb of Array.from(listeners)) cb();
    },
  };
}

function setServiceWorkerContainer(container: MockServiceWorkerContainer): void {
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });
}

function dispatchSwUpdate(worker: unknown): void {
  act(() => {
    window.dispatchEvent(new CustomEvent("sw-update-available", { detail: { worker } }));
  });
}

function clickRefresh(): void {
  const lastCall = toastFn.mock.calls[toastFn.mock.calls.length - 1];
  const options = lastCall[1] as { action: { onClick: () => void } };
  act(() => {
    options.action.onClick();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  toastFn.mockClear();
  safeReloadPageMock.mockClear();
  window.history.pushState({}, "", "/equipment");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SwUpdateBanner — Refresh deterministically reloads exactly once (T-37 · R-SY-03)", () => {
  it("(a) reloads immediately when the target worker is already the controller", () => {
    const worker = createWorker();
    setServiceWorkerContainer(createServiceWorkerContainer(worker));

    render(<SwUpdateBanner />);
    dispatchSwUpdate(worker);
    clickRefresh();

    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("(b) posts SKIP_WAITING and reloads exactly once when controllerchange fires before the timeout, clearing the timeout", () => {
    const worker = createWorker();
    const container = createServiceWorkerContainer(null);
    setServiceWorkerContainer(container);

    render(<SwUpdateBanner />);
    dispatchSwUpdate(worker);
    clickRefresh();

    expect(worker.postMessage).toHaveBeenCalledWith("SKIP_WAITING");
    expect(safeReloadPageMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    container.fireControllerChange();
    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);

    // The timeout must have been cleared — advancing past the original
    // 3000ms window must not trigger a second (fallback) reload.
    vi.advanceTimersByTime(3000);
    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);
  });

  it("(c) falls back to a single reload after SW_UPDATE_RELOAD_TIMEOUT_MS (3000ms) when neither resolves", () => {
    const worker = createWorker();
    setServiceWorkerContainer(createServiceWorkerContainer(null));

    render(<SwUpdateBanner />);
    dispatchSwUpdate(worker);
    clickRefresh();

    expect(safeReloadPageMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2999);
    expect(safeReloadPageMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);
  });

  it("never double-reloads — a late controllerchange arriving after the timeout fallback is a no-op", () => {
    const worker = createWorker();
    const container = createServiceWorkerContainer(null);
    setServiceWorkerContainer(container);

    render(<SwUpdateBanner />);
    dispatchSwUpdate(worker);
    clickRefresh();

    vi.advanceTimersByTime(3000);
    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);

    container.fireControllerChange();
    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);
  });

  it("never double-reloads — controllerchange firing twice only reloads once, and the timeout after it is also a no-op", () => {
    const worker = createWorker();
    const container = createServiceWorkerContainer(null);
    setServiceWorkerContainer(container);

    render(<SwUpdateBanner />);
    dispatchSwUpdate(worker);
    clickRefresh();

    container.fireControllerChange();
    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);

    container.fireControllerChange();
    vi.advanceTimersByTime(3000);
    expect(safeReloadPageMock).toHaveBeenCalledTimes(1);
  });
});
