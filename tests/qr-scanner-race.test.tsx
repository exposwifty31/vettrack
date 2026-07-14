/**
 * @vitest-environment happy-dom
 *
 * T-03 (R-SC-01 / CLICK-PATH-004) — QR auto-decode targets the last-scanned
 * tag exactly once.
 *
 * Bug: `handleScanResult` in `src/components/qr-scanner.tsx` only guarded
 * overlapping decodes with a 300ms debounce on `Date.now()`. The scanner
 * was never stopped before the awaited `resolveEquipmentId`, so two
 * overlapping decodes could resolve out of order — a slower EARLIER
 * resolve could overwrite the state set by a faster, physically LATER
 * scan (last-resolved-wins instead of last-scanned-wins). The
 * `scansToday` counter also incremented once per applied resolve, so a
 * stale resolve double-counted it.
 *
 * This test drives the real `QrScanner`. It captures the html5-qrcode
 * decode callback and fires two decodes for two different equipment ids
 * more than DEBOUNCE_MS apart (so neither is swallowed by the debounce),
 * making the FIRST scan's network resolve settle AFTER the SECOND scan's
 * resolve. Correct behavior: the second (later-scanned) equipment wins,
 * and `scansToday` increments exactly once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Equipment } from "@/types";
import type { HomeDashboardPulse } from "@/types/tasks";

interface MockHtml5QrcodeInstance {
  successCallback: ((decodedText: string) => void) | null;
  stop: () => Promise<void>;
  getState: () => number;
}

const mockScannerInstances: MockHtml5QrcodeInstance[] = [];

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
      this.successCallback = successCallback;
      return Promise.resolve();
    }
    stop() {
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

const getEquipmentMock = vi.fn();
const getByNfcTagMock = vi.fn();
const dashboardMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    equipment: {
      get: (...args: unknown[]) => getEquipmentMock(...args),
      checkout: vi.fn(),
      return: vi.fn(),
      scan: vi.fn(),
      seen: vi.fn(),
    },
    containers: {
      getByNfcTag: (...args: unknown[]) => getByNfcTagMock(...args),
    },
    home: {
      dashboard: (...args: unknown[]) => dashboardMock(...args),
    },
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "user-1", isAdmin: false }),
}));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), scanSuccess: vi.fn(), celebrate: vi.fn() },
}));

// Already-celebrated-today so every successful scan goes straight to the
// "result" phase — the first-scan celebration overlay is out of scope here.
vi.mock("@/lib/first-scan-day", () => ({
  hasCelebratedFirstScanToday: () => true,
  markFirstScanCelebratedToday: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/scan", vi.fn()],
}));

import { QrScanner } from "@/components/qr-scanner";

const DEBOUNCE_MS = 300;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeEquipment(overrides: Partial<Equipment>): Equipment {
  return {
    id: "eq-x",
    name: "Equipment X",
    status: "ok",
    createdAt: new Date().toISOString(),
    checkedOutById: null,
    ...overrides,
  } as Equipment;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("QrScanner — race between overlapping decodes (T-03 / R-SC-01)", () => {
  beforeEach(() => {
    mockScannerInstances.length = 0;
    getEquipmentMock.mockReset();
    getByNfcTagMock.mockReset();
    dashboardMock.mockReset();
    // Never settles during the test — keeps the query-cache value produced by
    // the component's own optimistic `setQueryData` observable for assertions.
    dashboardMock.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
  });

  it("the later physically-scanned tag wins even though its resolve settles first, and scansToday increments exactly once", async () => {
    const equipmentA = makeEquipment({ id: "eq-A", name: "Slow-Resolve Pump" });
    const equipmentB = makeEquipment({ id: "eq-B", name: "Fast-Resolve Monitor" });

    const deferredA = deferred<Equipment>();
    getEquipmentMock.mockImplementation((id: string) => {
      if (id === "eq-A") return deferredA.promise;
      if (id === "eq-B") return Promise.resolve(equipmentB);
      return Promise.resolve(null);
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const initialPulse: HomeDashboardPulse = {
      shift: null,
      nextShift: null,
      streak: 0,
      tasksCompletedToday: 0,
      scansToday: 5,
    };
    qc.setQueryData(["/api/home/dashboard"], initialPulse);

    render(
      <QueryClientProvider client={qc}>
        <QrScanner onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockScannerInstances.length).toBeGreaterThan(0));
    const scanner = mockScannerInstances[0];
    await waitFor(() => expect(scanner.successCallback).not.toBeNull());

    // Scan #1 (physically first): a slow-to-resolve tag. Its resolve stays
    // pending — deliberately settled only at the very end of the test.
    await act(async () => {
      scanner.successCallback!("eq-A");
    });

    // Real elapsed time past DEBOUNCE_MS so scan #2 is not swallowed by the
    // 300ms debounce guard.
    await act(async () => {
      await wait(DEBOUNCE_MS + 50);
    });

    // Scan #2 (physically second — the one that must win): resolves fast.
    await act(async () => {
      scanner.successCallback!("eq-B");
    });

    await waitFor(() =>
      expect(screen.getByTestId("scan-inline-equipment-name").textContent).toBe(
        equipmentB.name,
      ),
    );

    // Now let the slower scan #1 resolve settle. It must be discarded as
    // stale — it must NOT overwrite the state scan #2 already applied, and
    // must NOT increment scansToday a second time.
    await act(async () => {
      deferredA.resolve(equipmentA);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("scan-inline-equipment-name").textContent).toBe(
      equipmentB.name,
    );

    const finalPulse = qc.getQueryData<HomeDashboardPulse>(["/api/home/dashboard"]);
    expect(finalPulse?.scansToday).toBe(6);
  });
});
