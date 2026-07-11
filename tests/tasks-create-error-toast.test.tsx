/**
 * @vitest-environment happy-dom
 *
 * T3 (fail-loud audit, HIGH) — POST /api/appointments → 400 OUTSIDE_SHIFT was
 * swallowed by the task-create modal: spinner "שומר…" → modal stays open, no
 * feedback. Root cause (see tests/task-utils.test.ts): `toErrorMessage` /
 * the conflict branch compared `err.message` against bare server codes, but
 * `ApiError.message` is the human-readable text — the branches never matched
 * and the create mutation's `onError` (which DOES call `toast.error`) showed
 * either the raw unlocalized server string or, for the 409-conflict special
 * case, silently mis-routed. This test drives the real `AppointmentsPage`
 * default export end-to-end: mocks `api.appointments.create` to reject with
 * the server's actual OUTSIDE_SHIFT `ApiError`, and asserts the toast shows
 * the localized `errorOutsideShift` copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const toastError = vi.fn();
const toastSuccess = vi.fn();
const createMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    info: vi.fn(),
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "u-vet-1", role: "vet", effectiveRole: "vet", isLoaded: true }),
}));

vi.mock("@/hooks/useRealtime", () => ({ useRealtime: () => {} }));
vi.mock("@/hooks/useRealtimeReconciliation", () => ({ useRealtimeReconciliation: () => {} }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      users: { ...actual.api.users, me: () => Promise.resolve({ id: "u-vet-1", role: "vet" }) },
      equipment: {
        ...actual.api.equipment,
        list: () =>
          Promise.resolve([
            { id: "eq-1", name: "ICU Ventilator", nameHe: null, status: "ok", createdAt: "2026-01-01T00:00:00Z" },
          ]),
      },
      appointments: {
        ...actual.api.appointments,
        meta: () =>
          Promise.resolve({
            day: "2026-07-10",
            vets: [{ id: "u-vet-1", name: "Dr. Vet", displayName: "Dr. Vet", role: "vet", shifts: [] }],
            technicians: [],
          }),
        list: () => Promise.resolve([]),
        create: (...args: unknown[]) => createMock(...args),
      },
      tasks: {
        ...actual.api.tasks,
        dashboard: () =>
          Promise.resolve({
            today: [],
            overdue: [],
            upcoming: [],
            myTasks: [],
            counts: { today: 0, overdue: 0, myTasks: 0 },
          }),
        recommendations: () =>
          Promise.resolve({ nextBestTask: null, urgentTasks: [], overloaded: false, suggestions: [] }),
      },
    },
  };
});

import AppointmentsPage from "@/pages/Tasks";
import { ApiError } from "@/lib/api";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppointmentsPage />
    </QueryClientProvider>,
  );
}

async function openBookingDialogAndFillDevice() {
  // Several empty-state CTAs on the page share the "צור משימה" label — any of
  // them opens the same booking dialog (`openQuickBooking`); take the first.
  const openButtons = await screen.findAllByRole("button", { name: t.appointmentsPage.createTask });
  fireEvent.click(openButtons[0]);
  const dialog = await screen.findByRole("dialog");
  // T23: the device field is a real equipment picker (not free text) — open
  // it, type to filter, and select the matching equipment-record option.
  const deviceField = within(dialog).getByPlaceholderText(t.appointmentsPage.placeholderDevice);
  fireEvent.focus(deviceField);
  fireEvent.change(deviceField, { target: { value: "ICU" } });
  fireEvent.click(await within(dialog).findByText("ICU Ventilator"));
  return dialog;
}

describe("AppointmentsPage — task-create error toast (T3 fail-loud)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("surfaces the localized OUTSIDE_SHIFT reason when the create mutation is rejected", async () => {
    createMock.mockRejectedValueOnce(
      new ApiError(400, "Cannot schedule outside vet shift hours", {
        code: "OUTSIDE_SHIFT",
        error: "OUTSIDE_SHIFT",
        message: "Cannot schedule outside vet shift hours",
      }),
    );

    renderPage();
    const dialog = await openBookingDialogAndFillDevice();
    fireEvent.click(within(dialog).getByRole("button", { name: t.appointmentsPage.createTask }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t.appointmentsPage.errorOutsideShift));
    expect(toastSuccess).not.toHaveBeenCalled();
    // Never the raw, unlocalized server string leaking into the toast.
    expect(toastError).not.toHaveBeenCalledWith("Cannot schedule outside vet shift hours");
  });

  it("opens the conflict-override modal (not a raw toast) on a 409 APPOINTMENT_CONFLICT", async () => {
    createMock.mockRejectedValueOnce(
      new ApiError(409, "Appointment overlaps existing slot", {
        code: "APPOINTMENT_CONFLICT",
        error: "APPOINTMENT_CONFLICT",
        message: "Appointment overlaps existing slot",
      }),
    );

    renderPage();
    const dialog = await openBookingDialogAndFillDevice();
    fireEvent.click(within(dialog).getByRole("button", { name: t.appointmentsPage.createTask }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(t.appointmentsPage.conflictTitle)).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });
});
