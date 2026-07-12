/**
 * @vitest-environment happy-dom
 *
 * T-35 (R-SC-03 · CLICK-PATH-016 · Tier S) — `handleEquipmentId` in
 * src/components/nfc-foreground-scan.tsx stamps the 8s success guard
 * (`markNfcToggleFired`) BEFORE `runEquipmentQuickToggle` runs, and never
 * clears it on failure (network / 409 / generic throw). That silently drops
 * a genuine retry for the full 8s `NFC_TOGGLE_GUARD_TTL_MS` window after any
 * failure.
 *
 * Fix: every failure path in `runEquipmentQuickToggle` clears the guard via
 * `clearNfcToggleFired(equipmentId)`, but a short `NFC_REFIRE_DEBOUNCE_MS`
 * (500ms) — distinct from the 8s guard — still absorbs duplicate `onRead`
 * fires from the physical NFC hardware for the same tap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Equipment, QuickScanToggleResult } from "@/types";
import { NfcForegroundScan } from "@/components/nfc-foreground-scan";
import { wasNfcToggleFiredRecently } from "@/lib/nfc-equipment-toggle";
import { ApiError } from "@/lib/api";
import type { NfcReadPayload } from "@/lib/nfc-platform";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
});

vi.mock("@/hooks/use-nfc-supported", () => ({
  useNfcSupported: () => ({ supported: true, loading: false }),
}));

const { startNfcScanSessionMock } = vi.hoisted(() => ({
  startNfcScanSessionMock: vi.fn(),
}));
vi.mock("@/lib/nfc-platform", () => ({
  startNfcScanSession: (...args: unknown[]) => startNfcScanSessionMock(...args),
}));

const { getCachedEquipmentByIdMock } = vi.hoisted(() => ({
  getCachedEquipmentByIdMock: vi.fn(),
}));
vi.mock("@/lib/offline-db", () => ({
  getCachedEquipmentById: (...args: unknown[]) => getCachedEquipmentByIdMock(...args),
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn(), error: vi.fn(), scanSuccess: vi.fn() },
}));

const { quickToggleMock } = vi.hoisted(() => ({ quickToggleMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        quickToggle: (...args: unknown[]) => quickToggleMock(...args),
      },
    },
  };
});

const EQUIPMENT_ID = "eq-1";
const EQUIPMENT_URL = `https://vettrack.uk/equipment/${EQUIPMENT_ID}`;

function baseEquipment(): Equipment {
  return {
    id: EQUIPMENT_ID,
    name: "Infusion Pump",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    custodyState: "checked_out",
  };
}

function checkoutResult(): QuickScanToggleResult {
  return {
    equipment: baseEquipment(),
    action: "checkout",
    scanLogId: "log-1",
    undoToken: "undo-1",
  };
}

async function renderAndCaptureOnRead(): Promise<(payload: NfcReadPayload) => Promise<void> | void> {
  getCachedEquipmentByIdMock.mockResolvedValue(undefined);
  let captured: ((payload: NfcReadPayload) => Promise<void> | void) | null = null;
  startNfcScanSessionMock.mockImplementation(
    async (opts: { onRead: (payload: NfcReadPayload) => Promise<void> | void }) => {
      captured = opts.onRead;
      return { stop: vi.fn().mockResolvedValue(undefined) };
    },
  );

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NfcForegroundScan
        renderTrigger={({ toggle }) => (
          <button data-testid="nfc-toggle" onClick={toggle}>
            toggle
          </button>
        )}
      />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByTestId("nfc-toggle"));
  await waitFor(() => expect(captured).not.toBeNull());
  return captured!;
}

describe("NFC toggle failure guard (T-35)", () => {
  const failureModes: Array<[string, () => unknown]> = [
    ["network error", () => new TypeError("Failed to fetch")],
    ["409 held-by-another-user error", () => new ApiError(409, "Held", { checkedOutByEmail: "vet@clinic.test" })],
    ["generic throw", () => new Error("boom")],
  ];

  it.each(failureModes)(
    "clears the 8s success guard on %s so a later genuine retry is not silently dropped",
    async (_label, makeError) => {
      const onRead = await renderAndCaptureOnRead();

      vi.useFakeTimers();
      vi.setSystemTime(0);

      quickToggleMock.mockRejectedValueOnce(makeError());
      // The generic-throw path deliberately rethrows past this call site (T-35 card,
      // "throw ~L97") — swallow it here since this test only asserts the guard was
      // cleared, not how the rethrow itself propagates.
      await Promise.resolve(onRead({ url: EQUIPMENT_URL, text: null, tagId: null })).catch(() => {});
      expect(quickToggleMock).toHaveBeenCalledTimes(1);
      expect(wasNfcToggleFiredRecently(EQUIPMENT_ID)).toBe(false);

      // Well past the 500ms re-fire debounce, still well inside the old 8s guard window.
      vi.setSystemTime(600);
      quickToggleMock.mockResolvedValueOnce(checkoutResult());
      await onRead({ url: EQUIPMENT_URL, text: null, tagId: null });
      expect(quickToggleMock).toHaveBeenCalledTimes(2);
    },
  );

  it("does NOT clear the guard on success — the 8s guard still suppresses a duplicate tap", async () => {
    const onRead = await renderAndCaptureOnRead();

    vi.useFakeTimers();
    vi.setSystemTime(0);

    quickToggleMock.mockResolvedValueOnce(checkoutResult());
    await onRead({ url: EQUIPMENT_URL, text: null, tagId: null });
    expect(quickToggleMock).toHaveBeenCalledTimes(1);
    expect(wasNfcToggleFiredRecently(EQUIPMENT_ID)).toBe(true);

    vi.setSystemTime(600);
    await onRead({ url: EQUIPMENT_URL, text: null, tagId: null });
    expect(quickToggleMock).toHaveBeenCalledTimes(1);
  });

  it("re-fire debounce boundary: 499ms is suppressed, 500ms fires exactly once", async () => {
    const onRead = await renderAndCaptureOnRead();

    vi.useFakeTimers();
    vi.setSystemTime(0);

    quickToggleMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await onRead({ url: EQUIPMENT_URL, text: null, tagId: null });
    expect(quickToggleMock).toHaveBeenCalledTimes(1);
    // Guard is cleared immediately — only the short debounce should still gate a re-fire.
    expect(wasNfcToggleFiredRecently(EQUIPMENT_ID)).toBe(false);

    vi.setSystemTime(499);
    await onRead({ url: EQUIPMENT_URL, text: null, tagId: null });
    expect(quickToggleMock).toHaveBeenCalledTimes(1); // still suppressed by the 500ms debounce

    vi.setSystemTime(500);
    quickToggleMock.mockResolvedValueOnce(checkoutResult());
    await onRead({ url: EQUIPMENT_URL, text: null, tagId: null });
    expect(quickToggleMock).toHaveBeenCalledTimes(2); // fires exactly once more
  });
});
