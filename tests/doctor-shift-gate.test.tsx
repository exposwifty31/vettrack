/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const SNOOZE_KEY = "vt_doctor_gate_snooze_until";

const activeMock = vi.fn();
const openMock = vi.fn();
const meMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

let authRole = "vet";

vi.mock("@/lib/api", () => ({
  api: {
    checkIn: {
      active: (...a: unknown[]) => activeMock(...a),
      open: (...a: unknown[]) => openMock(...a),
      switch: vi.fn(),
      close: vi.fn(),
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
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { DoctorShiftGate } from "@/features/shift-gate";

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DoctorShiftGate />
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
  localStorage.clear();
  activeMock.mockReset().mockResolvedValue({ active: null });
  openMock.mockReset().mockResolvedValue(makeRow());
  meMock.mockReset().mockResolvedValue({
    id: "u-vet-1",
    role: "vet",
    seniorDoctorEligible: false,
  });
  toastError.mockReset();
  toastSuccess.mockReset();
});

afterEach(() => cleanup());

describe("DoctorShiftGate — mobile shell popup (doctor shift gate)", () => {
  it("renders nothing for a technician (no check-in query issued)", async () => {
    authRole = "technician";
    renderGate();
    // Give queries a tick — nothing should fire and nothing should render.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(t.doctorGate.areYouOnShift)).toBeNull();
    expect(activeMock).not.toHaveBeenCalled();
  });

  it("renders step 1 for a vet with no active check-in and no snooze", async () => {
    renderGate();
    expect(await screen.findByText(t.doctorGate.areYouOnShift)).toBeTruthy();
    expect(screen.getByTestId("doctor-gate-yes")).toBeTruthy();
    expect(screen.getByTestId("doctor-gate-no")).toBeTruthy();
  });

  it("renders nothing when an active check-in already exists", async () => {
    activeMock.mockResolvedValue({ active: makeRow() });
    renderGate();
    await waitFor(() => expect(activeMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(t.doctorGate.areYouOnShift)).toBeNull();
  });

  it("'No' sets an 8h snooze key and closes; a remount within the window renders nothing", async () => {
    const before = Date.now();
    renderGate();
    fireEvent.click(await screen.findByTestId("doctor-gate-no"));

    const raw = localStorage.getItem(SNOOZE_KEY);
    expect(raw).not.toBeNull();
    const until = Number(raw);
    expect(until).toBeGreaterThanOrEqual(before + 8 * 3_600_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 8 * 3_600_000);
    await waitFor(() =>
      expect(screen.queryByText(t.doctorGate.areYouOnShift)).toBeNull(),
    );

    cleanup();
    renderGate();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(t.doctorGate.areYouOnShift)).toBeNull();
  });

  it("'Yes' → team step; a team tap posts { operationalRole: 'icu', isSenior: false } and closes on success", async () => {
    renderGate();
    fireEvent.click(await screen.findByTestId("doctor-gate-yes"));

    expect(await screen.findByText(t.doctorGate.pickTeam)).toBeTruthy();
    fireEvent.click(screen.getByTestId("doctor-gate-team-icu"));

    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith({
        operationalRole: "icu",
        isSenior: false,
        source: "doctor_gate",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(t.doctorGate.pickTeam)).toBeNull(),
    );
  });

  it("stays hidden until the seniorDoctorEligible lookup settles, so the senior option cannot be raced past", async () => {
    // Safe definite-assignment: the Promise executor runs synchronously, so
    // resolveMe is assigned before mockReturnValue returns.
    let resolveMe!: (v: unknown) => void;
    meMock.mockReturnValue(new Promise((r) => { resolveMe = r; }));
    renderGate();

    await waitFor(() => expect(meMock).toHaveBeenCalled());
    expect(screen.queryByText(t.doctorGate.areYouOnShift)).toBeNull();

    resolveMe({ id: "u-vet-1", role: "vet", seniorDoctorEligible: true });
    expect(await screen.findByText(t.doctorGate.areYouOnShift)).toBeTruthy();
    fireEvent.click(screen.getByTestId("doctor-gate-yes"));
    expect(await screen.findByTestId("doctor-gate-senior-toggle")).toBeTruthy();
  });

  it("hides the senior toggle when seniorDoctorEligible=false", async () => {
    renderGate();
    fireEvent.click(await screen.findByTestId("doctor-gate-yes"));
    await screen.findByText(t.doctorGate.pickTeam);
    await waitFor(() => expect(meMock).toHaveBeenCalled());
    expect(screen.queryByTestId("doctor-gate-senior-toggle")).toBeNull();
  });

  it("shows the senior toggle for an eligible vet and posts isSenior: true when checked", async () => {
    meMock.mockResolvedValue({ id: "u-vet-1", role: "vet", seniorDoctorEligible: true });
    renderGate();
    fireEvent.click(await screen.findByTestId("doctor-gate-yes"));

    const toggle = await screen.findByTestId("doctor-gate-senior-toggle");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("doctor-gate-team-admission"));

    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith({
        operationalRole: "admission",
        isSenior: true,
        source: "doctor_gate",
      }),
    );
  });

  it("409 SENIOR_ALREADY_ASSIGNED shows the replace-confirm and retries with replaceSenior: true", async () => {
    meMock.mockResolvedValue({ id: "u-vet-1", role: "vet", seniorDoctorEligible: true });
    const conflict = Object.assign(new Error("senior already assigned"), {
      status: 409,
      code: "SENIOR_ALREADY_ASSIGNED",
      payload: { details: { currentSeniorName: "Dr. Cohen" } },
    });
    openMock.mockRejectedValueOnce(conflict).mockResolvedValueOnce(makeRow({ isSenior: true }));

    renderGate();
    fireEvent.click(await screen.findByTestId("doctor-gate-yes"));
    fireEvent.click(await screen.findByTestId("doctor-gate-senior-toggle"));
    fireEvent.click(screen.getByTestId("doctor-gate-team-icu"));

    expect(await screen.findByText(t.doctorGate.replaceSeniorTitle)).toBeTruthy();
    expect(
      screen.getByText(t.doctorGate.replaceSeniorBody("Dr. Cohen", t.doctorGate.teamIcu)),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("doctor-gate-replace-confirm"));
    await waitFor(() =>
      expect(openMock).toHaveBeenLastCalledWith({
        operationalRole: "icu",
        isSenior: true,
        replaceSenior: true,
        source: "doctor_gate",
      }),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("replace-cancel returns to the team step without posting again", async () => {
    meMock.mockResolvedValue({ id: "u-vet-1", role: "vet", seniorDoctorEligible: true });
    const conflict = Object.assign(new Error("senior already assigned"), {
      status: 409,
      code: "SENIOR_ALREADY_ASSIGNED",
      payload: { details: { currentSeniorName: "Dr. Cohen" } },
    });
    openMock.mockRejectedValueOnce(conflict);

    renderGate();
    fireEvent.click(await screen.findByTestId("doctor-gate-yes"));
    fireEvent.click(await screen.findByTestId("doctor-gate-senior-toggle"));
    fireEvent.click(screen.getByTestId("doctor-gate-team-icu"));

    fireEvent.click(await screen.findByTestId("doctor-gate-replace-cancel"));
    expect(await screen.findByText(t.doctorGate.pickTeam)).toBeTruthy();
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("generic failure surfaces the error toast and keeps the dialog open", async () => {
    openMock.mockRejectedValueOnce(new Error("network down"));
    renderGate();
    fireEvent.click(await screen.findByTestId("doctor-gate-yes"));
    fireEvent.click((await screen.findAllByTestId("doctor-gate-team-internal_medicine"))[0]);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(t.doctorGate.checkInFailed),
    );
    expect(screen.getByText(t.doctorGate.pickTeam)).toBeTruthy();
  });
});
