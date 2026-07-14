/**
 * @vitest-environment happy-dom
 *
 * CodeRabbit PR #86 review (src/components/qr-scanner.tsx) — guard in-flight
 * scanner starts from being adopted after stop.
 *
 * Bug: startScanner() sets scannerRef.current before awaiting
 * scanner.start(). stopScanner() can run while that await is still pending;
 * because getState() legitimately reports NOT_STARTED until the underlying
 * start() promise settles internally, stopScanner()'s own `state !== 1`
 * guard skips calling .stop() on it. Without a generation token, the late
 * start() resolve would still flip phase to "scanning" over an orphaned
 * camera instance, and the visibility-resume effect
 * (`phase === "scanning" && !scannerRef.current`) would then start a SECOND
 * camera on top of it.
 *
 * This test holds scanner.start() pending, forces a stop (visibilitychange
 * -> hidden) while it's in flight, then resolves start() late and asserts
 * the superseded instance tears itself down (its own .stop() called)
 * instead of the component silently adopting it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

class MockHtml5Qrcode {
  state = 1; // NOT_STARTED
  successCallback: ((decodedText: string) => void) | null = null;
  stopCallCount = 0;
  private startResolve: (() => void) | null = null;
  readonly startPromise: Promise<void>;

  constructor() {
    mockScannerInstances.push(this);
    this.startPromise = new Promise((resolve) => {
      this.startResolve = () => {
        this.state = 2; // SCANNING — matches html5-qrcode's internal transition
        resolve();
      };
    });
  }

  start(
    _cameraConfig: unknown,
    _config: unknown,
    successCallback: (decodedText: string) => void,
  ) {
    this.successCallback = successCallback;
    return this.startPromise;
  }

  stop() {
    this.stopCallCount++;
    this.state = 1;
    return Promise.resolve();
  }

  getState() {
    return this.state;
  }

  resolveStart() {
    this.startResolve?.();
  }
}

const mockScannerInstances: MockHtml5Qrcode[] = [];

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: MockHtml5Qrcode,
  Html5QrcodeScannerState: { NOT_STARTED: 1, SCANNING: 2, PAUSED: 3 },
}));

vi.mock("@/lib/api", () => ({
  api: {
    equipment: {
      get: vi.fn(),
      checkout: vi.fn(),
      return: vi.fn(),
      scan: vi.fn(),
      seen: vi.fn(),
    },
    containers: {
      getByNfcTag: vi.fn(),
    },
    home: {
      // Never settles — keeps the query in a stable pending state for this test.
      dashboard: vi.fn(() => new Promise(() => {})),
    },
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "user-1", isAdmin: false }),
}));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), scanSuccess: vi.fn(), celebrate: vi.fn() },
}));

vi.mock("@/lib/first-scan-day", () => ({
  hasCelebratedFirstScanToday: () => true,
  markFirstScanCelebratedToday: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/scan", vi.fn()],
}));

import { QrScanner } from "@/components/qr-scanner";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("QrScanner — supersedes an in-flight scanner.start() after a stop (start/stop race)", () => {
  beforeEach(() => {
    mockScannerInstances.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("tears down a late-resolving scanner.start() instead of adopting it as active", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <QrScanner onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockScannerInstances.length).toBe(1));
    const first = mockScannerInstances[0];

    // Background the app while scanner.start() is still pending.
    await act(async () => {
      setVisibility("hidden");
    });

    // stopScanner's own `state !== 1` guard skipped calling .stop() on this
    // instance — it still believes it's NOT_STARTED.
    expect(first.stopCallCount).toBe(0);

    // The pending start() now resolves late, after the stop.
    await act(async () => {
      first.resolveStart();
    });

    // The generation-token guard must have torn this superseded instance
    // down itself, rather than letting it become the adopted "scanning" state.
    await waitFor(() => expect(first.stopCallCount).toBe(1));

    // No second scanner should have been spun up as a side effect of this
    // late resolve.
    expect(mockScannerInstances.length).toBe(1);
  });
});
