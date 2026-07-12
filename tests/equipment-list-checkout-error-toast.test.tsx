/**
 * @vitest-environment happy-dom
 *
 * T3 (fail-loud audit, HIGH) — the equipment LIST row checkout action gave
 * zero UI response on a rejected checkout (400), while the equipment DETAIL
 * page correctly gates the same action on `hasActiveShift` and shows a
 * reason. This test drives the real `EquipmentItem` list-row component and
 * asserts: (1) an off-shift click never calls the API and surfaces the same
 * reason the detail page uses, and (2) a rejected checkout call surfaces the
 * server's actual reason via toast — not a swallowed/generic-only message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

const toastError = vi.fn();
const toastSuccess = vi.fn();
const checkoutMock = vi.fn();
let hasActiveShift = true;
let shiftLoading = false;
let shiftError = false;

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1", isAdmin: false }) }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      equipment: {
        ...actual.api.equipment,
        checkout: (...args: unknown[]) => checkoutMock(...args),
      },
    },
  };
});

import { EquipmentItem } from "@/pages/equipment-list";
import { ApiError } from "@/lib/api";

const baseEquipment: Partial<Equipment> = {
  id: "eq-1",
  name: "Infusion Pump",
  status: "ok",
  checkedOutById: null,
};

function renderItem(equipment: Partial<Equipment> = baseEquipment) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EquipmentItem
        equipment={equipment as Equipment}
        selectMode={false}
        selected={false}
        onToggleSelect={() => {}}
        hasActiveShift={hasActiveShift}
        shiftLoading={shiftLoading}
        shiftError={shiftError}
      />
    </QueryClientProvider>,
  );
}

describe("EquipmentItem (list row) — checkout error toast (T3 fail-loud)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasActiveShift = true;
    shiftLoading = false;
    shiftError = false;
  });
  afterEach(() => cleanup());

  it("off-shift: clicking checkout never calls the API and surfaces the same reason as the detail page", () => {
    hasActiveShift = false;
    renderItem();
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));

    expect(checkoutMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(t.scan.offShiftBody);
  });

  it("shift-query error: checkout reaches the server (not a false off-shift block)", async () => {
    // A FAILED shift read (not a resolved off-shift) must not block client-side —
    // the request goes to the server, the authoritative roster gate.
    hasActiveShift = false;
    shiftError = true;
    checkoutMock.mockResolvedValueOnce({
      equipment: { ...baseEquipment, checkedOutById: "u1" },
      undoToken: "tok-1",
    });

    renderItem();
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));

    await waitFor(() => expect(checkoutMock).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalledWith(t.scan.offShiftBody);
  });

  it("surfaces the server's actual reason on a rejected checkout (400)", async () => {
    checkoutMock.mockRejectedValueOnce(
      new ApiError(400, "No open shift covers this checkout", {
        code: "OUTSIDE_SHIFT",
        error: "OUTSIDE_SHIFT",
        message: "No open shift covers this checkout",
      }),
    );

    renderItem();
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));

    await waitFor(() => expect(checkoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("No open shift covers this checkout"),
    );
    // Never the old silent/generic-only behavior for a specific server reason.
    expect(toastError).not.toHaveBeenCalledWith(t.equipmentList.toast.checkoutError);
  });

  it("falls back to the generic checkout-failed copy when the server gives no message", async () => {
    checkoutMock.mockRejectedValueOnce(new Error("network hiccup"));

    renderItem();
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));

    await waitFor(() => expect(checkoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t.equipmentList.toast.checkoutError));
  });

  it("succeeds normally when on-shift and the checkout call resolves", async () => {
    checkoutMock.mockResolvedValueOnce({
      equipment: { ...baseEquipment, checkedOutById: "u1" },
      undoToken: "tok-1",
    });

    renderItem();
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));

    await waitFor(() => expect(checkoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});

/**
 * CodeRabbit PR #83 finding (equipment-list.tsx ~1005-1007) — `hasActiveShift`
 * defaults to `false` while the shift query is still resolving, so gating the
 * checkout action on `hasActiveShift` alone (ignoring `isLoading`) would
 * flash a false "you're off-shift" error at an on-shift tech before the
 * query settles. The quick-action button must stay disabled (no click
 * side-effect at all) until the shift query resolves.
 */
describe("EquipmentItem (list row) — shift-loading gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasActiveShift = true;
    shiftLoading = true;
    shiftError = false;
  });
  afterEach(() => cleanup());

  it("disables the checkout quick-action while the shift query is still loading", () => {
    renderItem();
    const button = screen.getByTestId("quick-action-eq-1") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("clicking while loading calls neither the checkout API nor the off-shift toast", () => {
    renderItem();
    fireEvent.click(screen.getByTestId("quick-action-eq-1"));

    expect(checkoutMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalledWith(t.scan.offShiftBody);
  });

  it("re-enables and behaves normally once the shift query resolves", () => {
    shiftLoading = false;
    renderItem();
    const button = screen.getByTestId("quick-action-eq-1") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
