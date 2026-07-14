/**
 * @vitest-environment happy-dom
 *
 * T2.5-mobile (docking P2) — the scan result sheet gains a secondary
 * "Not taking — confirming it's here" action that fires the citizen-anchor
 * endpoint (`api.docking.citizenAnchor`). This is a positive, physical-
 * presence assertion: the tech scanned the tag (item is in hand), is not
 * taking it, and confirms it's at its home station.
 *
 * Gated on `!isCheckedOut && !!scannedEquipment.homeRoomId` — hidden for a
 * held item (accounted for) and hidden for non-docking clinics (no
 * `homeRoomId` means the citizen-anchor endpoint would 409 on a missing
 * resolvable home station).
 *
 * Mirrors the harness in tests/qr-scanner-race.test.tsx: mocks html5-qrcode
 * and drives the real QrScanner through a decode to the "result" phase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Equipment } from "@/types";

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
const citizenAnchorMock = vi.fn();

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
    docking: {
      citizenAnchor: (...args: unknown[]) => citizenAnchorMock(...args),
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

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { QrScanner } from "@/components/qr-scanner";
import { toast } from "sonner";
import { t } from "@/lib/i18n";

function makeEquipment(overrides: Partial<Equipment>): Equipment {
  return {
    id: "eq-1",
    name: "Infusion Pump",
    status: "ok",
    createdAt: new Date().toISOString(),
    checkedOutById: null,
    ...overrides,
  } as Equipment;
}

async function scanInto(equipment: Equipment) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  dashboardMock.mockReturnValue(new Promise(() => {}));
  getEquipmentMock.mockResolvedValue(equipment);

  render(
    <QueryClientProvider client={qc}>
      <QrScanner onClose={vi.fn()} />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(mockScannerInstances.length).toBeGreaterThan(0));
  const scanner = mockScannerInstances[mockScannerInstances.length - 1];
  await waitFor(() => expect(scanner.successCallback).not.toBeNull());

  await act(async () => {
    scanner.successCallback!(equipment.id);
  });

  await waitFor(() => expect(screen.getByTestId("scan-inline-sheet")).toBeTruthy());
  return qc;
}

describe("QrScanner — citizen-anchor 'confirm here' action (T2.5-mobile)", () => {
  beforeEach(() => {
    mockScannerInstances.length = 0;
    getEquipmentMock.mockReset();
    getByNfcTagMock.mockReset();
    dashboardMock.mockReset();
    citizenAnchorMock.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("(a) resting + homed: shows the button and clicking it calls api.docking.citizenAnchor(id)", async () => {
    citizenAnchorMock.mockResolvedValue({ id: "anchor-1" });
    const equipment = makeEquipment({ homeRoomId: "room-1" });
    await scanInto(equipment);

    const btn = screen.getByTestId("btn-scan-inline-confirm-here");
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    await waitFor(() => expect(citizenAnchorMock).toHaveBeenCalledWith("eq-1"));
  });

  it("(b) resting + NO homeRoomId: button is absent", async () => {
    const equipment = makeEquipment({ homeRoomId: null });
    await scanInto(equipment);

    expect(screen.queryByTestId("btn-scan-inline-confirm-here")).toBeNull();
  });

  it("(c) checked-out: button is absent even when homed", async () => {
    const equipment = makeEquipment({ homeRoomId: "room-1", checkedOutById: "user-2" });
    await scanInto(equipment);

    expect(screen.queryByTestId("btn-scan-inline-confirm-here")).toBeNull();
  });

  it("#13 — success invalidates the equipment-detail and equipment-list caches (anchor changes derived location)", async () => {
    citizenAnchorMock.mockResolvedValue({ id: "anchor-1" });
    const equipment = makeEquipment({ homeRoomId: "room-1" });
    const qc = await scanInto(equipment);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    fireEvent.click(screen.getByTestId("btn-scan-inline-confirm-here"));
    await waitFor(() => expect(citizenAnchorMock).toHaveBeenCalledWith("eq-1"));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [`/api/equipment/${equipment.id}`] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/equipment"] });
  });

  it("#23 — citizenAnchor failure fires the error toast and resets isActing (spinner clears, button re-enabled)", async () => {
    citizenAnchorMock.mockRejectedValue(new Error("boom"));
    const equipment = makeEquipment({ homeRoomId: "room-1" });
    await scanInto(equipment);

    const btn = screen.getByTestId("btn-scan-inline-confirm-here") as HTMLButtonElement;
    fireEvent.click(btn);

    await waitFor(() => expect(citizenAnchorMock).toHaveBeenCalledWith("eq-1"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));

    // isActing resets — the button is enabled again (not stuck mid-action).
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it("#23 — citizenAnchor failure without an Error instance falls back to the localized confirmHereFailed copy", async () => {
    citizenAnchorMock.mockRejectedValue("not an Error instance");
    const equipment = makeEquipment({ homeRoomId: "room-1" });
    await scanInto(equipment);

    fireEvent.click(screen.getByTestId("btn-scan-inline-confirm-here"));

    await waitFor(() => expect(citizenAnchorMock).toHaveBeenCalledWith("eq-1"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t.qrScanner.confirmHereFailed));
  });
});
