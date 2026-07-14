/**
 * @vitest-environment happy-dom
 *
 * T-34 (R-SC-02 / CLICK-PATH-015) — QR scanner resumes camera on visible.
 *
 * Bug: the visibilitychange handler in src/components/qr-scanner.tsx STOPS
 * the camera when the tab/app goes hidden, but has no resume branch — on
 * return, the phase stays "scanning" over a dead camera (blank scanner).
 *
 * This test drives the real QrScanner: waits for the camera to start, fires
 * visibilitychange -> hidden (camera stops, scannerRef cleared), then
 * visibilitychange -> visible while still in the "scanning" phase. Correct
 * behavior: the camera restarts (Html5Qrcode.start is invoked again).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface MockHtml5QrcodeInstance {
  successCallback: ((decodedText: string) => void) | null;
  stop: () => Promise<void>;
  getState: () => number;
}

const mockScannerInstances: MockHtml5QrcodeInstance[] = [];
let startCallCount = 0;
let stopCallCount = 0;

vi.mock("html5-qrcode", () => {
  class MockHtml5Qrcode implements MockHtml5QrcodeInstance {
    successCallback: ((decodedText: string) => void) | null = null;
    constructor() {
      mockScannerInstances.push(this);
    }
    start(
      _cameraConfig: unknown,
      _config: unknown,
      successCallback: (decodedText: string) => void,
    ) {
      startCallCount++;
      this.successCallback = successCallback;
      return Promise.resolve();
    }
    stop() {
      stopCallCount++;
      return Promise.resolve();
    }
    getState() {
      return 2; // SCANNING
    }
  }
  return {
    Html5Qrcode: MockHtml5Qrcode,
    Html5QrcodeScannerState: { NOT_STARTED: 1, SCANNING: 2, PAUSED: 3 },
  };
});

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

describe("QrScanner — resumes camera on visible (T-34 / R-SC-02)", () => {
  beforeEach(() => {
    mockScannerInstances.length = 0;
    startCallCount = 0;
    stopCallCount = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("restarts the camera when the tab becomes visible again while still in the scanning phase", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <QrScanner onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockScannerInstances.length).toBe(1));
    await waitFor(() => expect(mockScannerInstances[0].successCallback).not.toBeNull());
    expect(startCallCount).toBe(1);

    // App goes to background — camera stops.
    await act(async () => {
      setVisibility("hidden");
    });
    await waitFor(() => expect(stopCallCount).toBe(1));

    // App returns to foreground while still in the "scanning" phase.
    await act(async () => {
      setVisibility("visible");
    });

    await waitFor(() => expect(mockScannerInstances.length).toBe(2));
    await waitFor(() => expect(startCallCount).toBe(2));
  });
});
