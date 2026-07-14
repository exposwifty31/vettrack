/**
 * @vitest-environment happy-dom
 *
 * T2 — Admin bypasses the off-shift scan block.
 *
 * Owner decision (2026-07): an `admin` account does not need an active
 * roster shift to scan equipment. `ScanScreen` (src/features/scan/ScanScreen.tsx)
 * previously computed `scanBlocked = !shiftLoading && !hasActiveShift` with no
 * role check, so admins hit the same "אינך במשמרת" block as floor roles. This
 * test drives the real `ScanScreen` component: an admin with no active shift
 * must see the scanner (not the block), while a non-admin with no active
 * shift must still see the block, unchanged.
 *
 * `QrScanner` is mocked out — it owns camera/react-query/API concerns that
 * are out of scope for this gate test; only whether ScanScreen chooses to
 * mount it is under test here.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { t } from "@/lib/i18n";

let hasActiveShift = false;
let isAdmin = false;
let shiftLoading = false;

vi.mock("@/hooks/use-active-shift", () => ({
  useActiveShift: () => ({ hasActiveShift, isLoading: shiftLoading, nextShift: null }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAdmin }),
}));
vi.mock("@/components/qr-scanner", () => ({
  QrScanner: () => <div data-testid="qr-scanner-stub" />,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/scan", vi.fn()],
}));

import { ScanScreen } from "@/features/scan/ScanScreen";

describe("ScanScreen — admin shift-gate bypass (T2)", () => {
  afterEach(() => {
    cleanup();
    hasActiveShift = false;
    isAdmin = false;
    shiftLoading = false;
  });

  it("admin with NO active shift is not blocked — scanner renders", () => {
    hasActiveShift = false;
    isAdmin = true;

    render(<ScanScreen />);

    expect(screen.getByTestId("qr-scanner-stub")).toBeTruthy();
    expect(screen.queryByText(t.scan.offShiftTitle)).toBeNull();
  });

  it("non-admin with NO active shift is still blocked — unchanged", () => {
    hasActiveShift = false;
    isAdmin = false;

    render(<ScanScreen />);

    expect(screen.getByText(t.scan.offShiftTitle)).toBeTruthy();
    expect(screen.queryByTestId("qr-scanner-stub")).toBeNull();
  });

  it("non-admin WITH an active shift is not blocked (pre-existing behavior)", () => {
    hasActiveShift = true;
    isAdmin = false;

    render(<ScanScreen />);

    expect(screen.getByTestId("qr-scanner-stub")).toBeTruthy();
    expect(screen.queryByText(t.scan.offShiftTitle)).toBeNull();
  });

  it("admin WITH an active shift is not blocked", () => {
    hasActiveShift = true;
    isAdmin = true;

    render(<ScanScreen />);

    expect(screen.getByTestId("qr-scanner-stub")).toBeTruthy();
    expect(screen.queryByText(t.scan.offShiftTitle)).toBeNull();
  });

  it("scanner does not mount while shift query is pending", () => {
    hasActiveShift = false;
    isAdmin = false;
    shiftLoading = true;

    render(<ScanScreen />);

    expect(screen.queryByTestId("qr-scanner-stub")).toBeNull();
    expect(screen.queryByText(t.scan.offShiftTitle)).toBeNull();
  });
});
