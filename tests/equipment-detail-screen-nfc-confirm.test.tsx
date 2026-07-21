/**
 * @vitest-environment happy-dom
 *
 * Doctor pilot 2026-07 (Task 6, C4) — the mobile equipment record now consumes
 * the NFC deep-link (`?nfcAction=toggle`) with an explicit Take/Return confirm
 * dialog instead of silently dropping it (the desktop page auto-toggles; the
 * phone asks first). Models on tests/scan-screen-admin-shift-bypass.test.tsx —
 * happy-dom, mutable-`let` mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

let hasActiveShift = false;
let isAdmin = false;
let shiftLoading = false;
let shiftError = false;
let role = "technician";
let searchStr = "";
let equipment: Equipment = {
  id: "eq-1",
  name: "Ultrasound",
  status: "ok",
  custodyState: "returned",
  checkedOutById: null,
} as unknown as Equipment;

const navigateMock = vi.fn();
const refetchMock = vi.fn();

const toastDismiss = vi.fn();
const toastInfo = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastLoading = vi.fn();

const quickToggleMock = vi.fn().mockResolvedValue({
  action: "checkout",
  equipment: {},
  scanLogId: "",
  undoToken: "",
});

vi.mock("@/hooks/use-active-shift", () => ({
  useActiveShift: () => ({
    hasActiveShift,
    isLoading: shiftLoading,
    isError: shiftError,
    nextShift: null,
  }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    userId: "me-1",
    isAdmin,
    role,
    effectiveRole: role,
    roleSource: "permanent",
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/equipment/eq-1", navigateMock],
  useSearch: () => searchStr,
}));
vi.mock("sonner", () => ({
  toast: {
    dismiss: (...a: unknown[]) => toastDismiss(...a),
    info: (...a: unknown[]) => toastInfo(...a),
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    loading: (...a: unknown[]) => toastLoading(...a),
  },
}));
vi.mock("@/lib/haptics", () => ({
  haptics: {
    tap: vi.fn(),
    scanSuccess: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    itemAdded: vi.fn(),
    celebrate: vi.fn(),
    syncComplete: vi.fn(),
  },
}));
vi.mock("@/features/equipment/detail/hooks/use-equipment-detail", () => ({
  useEquipmentDetail: () => ({
    equipment,
    locationInference: null,
    isLoading: false,
    isError: false,
    refetch: refetchMock,
  }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    request: () => Promise.resolve([]),
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        quickToggle: (...a: unknown[]) => quickToggleMock(...a),
        waitlist: () =>
          Promise.resolve({
            equipmentId: "eq-1",
            queueSize: 0,
            myPosition: null,
            myStatus: null,
            reservationExpiresAt: null,
            notifiedUserId: null,
            entries: [],
          }),
      },
    },
  };
});
vi.mock("@/features/equipment/detail/ReportEquipmentIssueSheet", () => ({
  ReportEquipmentIssueSheet: ({ open }: { open: boolean }) => (
    <div data-testid="issue-sheet">{String(open)}</div>
  ),
}));

import { EquipmentDetailScreen } from "@/features/equipment/detail/EquipmentDetailScreen";

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EquipmentDetailScreen equipmentId="eq-1" />
    </QueryClientProvider>,
  );
}

describe("EquipmentDetailScreen — NFC deep-link confirm (Task 6, C4)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    hasActiveShift = false;
    isAdmin = false;
    shiftLoading = false;
    shiftError = false;
    role = "technician";
    searchStr = "";
    equipment = {
      id: "eq-1",
      name: "Ultrasound",
      status: "ok",
      custodyState: "returned",
      checkedOutById: null,
    } as unknown as Equipment;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("available unit — shows the Take confirm dialog, dismisses the deep-link toast, does NOT toggle yet", () => {
    searchStr = "nfcAction=toggle&nfcTs=1";

    renderScreen();

    expect(screen.getByText(t.equipmentNfc.confirmTakeTitle("Ultrasound"))).toBeTruthy();
    expect(quickToggleMock).not.toHaveBeenCalled();
    expect(toastDismiss).toHaveBeenCalledWith("nfc-open");
  });

  it("confirming Take fires the quick toggle", () => {
    searchStr = "nfcAction=toggle&nfcTs=1";

    renderScreen();
    fireEvent.click(screen.getByTestId("btn-nfc-confirm"));

    expect(quickToggleMock).toHaveBeenCalledTimes(1);
    expect(quickToggleMock).toHaveBeenCalledWith("eq-1");
  });

  it("cancelling closes the dialog without toggling", () => {
    searchStr = "nfcAction=toggle&nfcTs=1";

    renderScreen();
    fireEvent.click(screen.getByText(t.common.cancel));

    expect(quickToggleMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText(t.equipmentNfc.confirmTakeTitle("Ultrasound")),
    ).toBeNull();
  });

  it("unit held by another user — no dialog, error toast instead", () => {
    searchStr = "nfcAction=toggle&nfcTs=1";
    equipment = {
      ...equipment,
      checkedOutById: "someone-else",
      checkedOutByEmail: "o@x.com",
    } as unknown as Equipment;

    renderScreen();

    expect(
      screen.queryByText(t.equipmentNfc.confirmTakeTitle("Ultrasound")),
    ).toBeNull();
    expect(
      screen.queryByText(t.equipmentNfc.confirmReturnTitle("Ultrasound")),
    ).toBeNull();
    expect(toastError).toHaveBeenCalled();
  });

  it("unit held by me — shows the Return confirm dialog", () => {
    searchStr = "nfcAction=toggle&nfcTs=1";
    equipment = {
      ...equipment,
      checkedOutById: "me-1",
      checkedOutByEmail: "me@x.com",
    } as unknown as Equipment;

    renderScreen();

    expect(screen.getByText(t.equipmentNfc.confirmReturnTitle("Ultrasound"))).toBeTruthy();
  });

  it("no NFC params — no dialog; report-issue button opens the issue sheet", () => {
    searchStr = "";

    renderScreen();

    expect(
      screen.queryByText(t.equipmentNfc.confirmTakeTitle("Ultrasound")),
    ).toBeNull();
    expect(screen.getByTestId("btn-detail-report-issue")).toBeTruthy();
    expect(screen.getByTestId("issue-sheet").textContent).toBe("false");

    fireEvent.click(screen.getByTestId("btn-detail-report-issue"));

    expect(screen.getByTestId("issue-sheet").textContent).toBe("true");
  });
});
