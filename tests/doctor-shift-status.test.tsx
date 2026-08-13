/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const activeMock = vi.fn();
const switchMock = vi.fn();
const closeMock = vi.fn();
const meMock = vi.fn();
const toastError = vi.fn();
const confirmMock = vi.fn();

let authRole = "vet";

vi.mock("@/lib/api", () => ({
  api: {
    checkIn: {
      active: (...a: unknown[]) => activeMock(...a),
      open: vi.fn(),
      switch: (...a: unknown[]) => switchMock(...a),
      close: (...a: unknown[]) => closeMock(...a),
    },
    users: {
      me: (...a: unknown[]) => meMock(...a),
    },
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    userId: "u-vet-1",
    role: authRole,
    isLoaded: true,
    isSignedIn: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => confirmMock,
}));

import { DoctorShiftStatus } from "@/features/shift-gate";

function renderStatus() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DoctorShiftStatus />
    </QueryClientProvider>,
  );
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "u-vet-1",
    operationalRole: "icu",
    isSenior: false,
    clinicalRoleAtCheckIn: "vet",
    checkedInAt: "2026-08-13T06:00:00.000Z",
    checkedOutAt: null,
    checkOutReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  authRole = "vet";
  activeMock.mockReset().mockResolvedValue({ active: makeRow() });
  switchMock.mockReset().mockResolvedValue(makeRow({ operationalRole: "admission" }));
  closeMock.mockReset().mockResolvedValue(makeRow({ checkedOutAt: "2026-08-13T12:00:00.000Z" }));
  meMock.mockReset().mockResolvedValue({
    id: "u-vet-1",
    role: "vet",
    seniorDoctorEligible: false,
  });
  toastError.mockReset();
  confirmMock.mockReset().mockResolvedValue(true);
});

afterEach(() => cleanup());

describe("DoctorShiftStatus — on-shift status + exit surface", () => {
  it("renders nothing for a technician (no query issued)", async () => {
    authRole = "technician";
    renderStatus();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("doctor-shift-status")).toBeNull();
    expect(activeMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the vet has no open check-in", async () => {
    activeMock.mockResolvedValue({ active: null });
    renderStatus();
    await waitFor(() => expect(activeMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("doctor-shift-status")).toBeNull();
  });

  it("renders nothing for a non-team (legacy) operational role", async () => {
    activeMock.mockResolvedValue({ active: makeRow({ operationalRole: "ward" }) });
    renderStatus();
    await waitFor(() => expect(activeMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("doctor-shift-status")).toBeNull();
  });

  it("shows the on-shift status line with the team label", async () => {
    renderStatus();
    expect(await screen.findByTestId("doctor-shift-status")).toBeTruthy();
    expect(
      screen.getByText(t.doctorGate.onShiftStatus(t.doctorGate.teamIcu)),
    ).toBeTruthy();
    expect(screen.queryByText(t.doctorGate.onShiftSenior)).toBeNull();
  });

  it("appends the senior marker when the open check-in is senior", async () => {
    activeMock.mockResolvedValue({ active: makeRow({ isSenior: true }) });
    renderStatus();
    expect(await screen.findByTestId("doctor-shift-status")).toBeTruthy();
    expect(screen.getByText(t.doctorGate.onShiftSenior)).toBeTruthy();
  });

  it("end-shift asks for confirmation and calls api.checkIn.close on accept", async () => {
    renderStatus();
    fireEvent.click(await screen.findByTestId("doctor-status-end-shift"));
    await waitFor(() =>
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: t.doctorGate.endShiftConfirmTitle }),
      ),
    );
    await waitFor(() => expect(closeMock).toHaveBeenCalledTimes(1));
  });

  it("end-shift does NOT close when the confirmation is declined", async () => {
    confirmMock.mockResolvedValue(false);
    renderStatus();
    fireEvent.click(await screen.findByTestId("doctor-status-end-shift"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("switch-role opens the team picker; a team tap posts the switch", async () => {
    renderStatus();
    fireEvent.click(await screen.findByTestId("doctor-status-switch-role"));
    fireEvent.click(await screen.findByTestId("doctor-switch-team-admission"));
    await waitFor(() =>
      expect(switchMock).toHaveBeenCalledWith({
        operationalRole: "admission",
        isSenior: false,
      }),
    );
  });

  it("senior toggle shows for an eligible vet, defaults to the current senior state, and posts isSenior", async () => {
    activeMock.mockResolvedValue({ active: makeRow({ isSenior: true }) });
    meMock.mockResolvedValue({ id: "u-vet-1", role: "vet", seniorDoctorEligible: true });
    renderStatus();
    fireEvent.click(await screen.findByTestId("doctor-status-switch-role"));
    await screen.findByTestId("doctor-switch-senior-toggle");
    fireEvent.click(screen.getByTestId("doctor-switch-team-internal_medicine"));
    await waitFor(() =>
      expect(switchMock).toHaveBeenCalledWith({
        operationalRole: "internal_medicine",
        isSenior: true,
      }),
    );
  });

  it("409 SENIOR_ALREADY_ASSIGNED on switch shows the replace-confirm and retries with replaceSenior: true", async () => {
    meMock.mockResolvedValue({ id: "u-vet-1", role: "vet", seniorDoctorEligible: true });
    const conflict = Object.assign(new Error("senior already assigned"), {
      status: 409,
      code: "SENIOR_ALREADY_ASSIGNED",
      payload: { details: { currentSeniorName: "Dr. Cohen" } },
    });
    switchMock
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(makeRow({ operationalRole: "admission", isSenior: true }));

    renderStatus();
    fireEvent.click(await screen.findByTestId("doctor-status-switch-role"));
    fireEvent.click(await screen.findByTestId("doctor-switch-senior-toggle"));
    fireEvent.click(screen.getByTestId("doctor-switch-team-admission"));

    expect(await screen.findByText(t.doctorGate.replaceSeniorTitle)).toBeTruthy();
    fireEvent.click(screen.getByTestId("doctor-switch-replace-confirm"));
    await waitFor(() =>
      expect(switchMock).toHaveBeenLastCalledWith({
        operationalRole: "admission",
        isSenior: true,
        replaceSenior: true,
      }),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("generic switch failure surfaces the error toast", async () => {
    switchMock.mockRejectedValueOnce(new Error("network down"));
    renderStatus();
    fireEvent.click(await screen.findByTestId("doctor-status-switch-role"));
    fireEvent.click(await screen.findByTestId("doctor-switch-team-admission"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(t.doctorGate.checkInFailed),
    );
  });
});
