/**
 * @vitest-environment happy-dom
 *
 * T23 (audit MEDIUM, UX) — the task form's "device" field used to be free
 * text stored straight into `animalId` (an unvalidated string, no link to a
 * real `vt_equipment` row). This test drives the real `AppointmentsPage`
 * default export end-to-end and proves the field is now a real
 * equipment-record picker:
 *
 *  1. The field is a combobox (role="combobox", aria-autocomplete="list")
 *     populated from the shared equipment fetch, not a plain text input —
 *     typing alone (never selecting) must NOT produce a submittable value.
 *  2. Selecting an option stores the equipment's real id in the create
 *     payload — never the typed search text. This is the non-vacuous
 *     assertion: against the old free-text input, the payload's `animalId`
 *     would be the literal typed string ("ICU"), never the equipment's uuid.
 *  3. A task whose `animalId` links to a known equipment row renders that
 *     equipment's NAME back (bidi-isolated), not the raw id and not the
 *     generic "linked device" placeholder used for unresolved links.
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

// Real vt_equipment ids are DB uuids — use canonical uuid shapes so
// `formatDevice`'s uuid detection (and therefore the equipmentById lookup)
// exercises the same path production data takes.
const VENTILATOR_ID = "3f1a2b4c-1111-4abc-8def-111111111111";
const INFUSION_PUMP_ID = "3f1a2b4c-2222-4abc-8def-222222222222";

const EQUIPMENT_LIST = [
  { id: VENTILATOR_ID, name: "ICU Ventilator", nameHe: null, status: "ok", createdAt: "2026-01-01T00:00:00Z" },
  { id: INFUSION_PUMP_ID, name: "Infusion Pump", nameHe: null, status: "ok", createdAt: "2026-01-01T00:00:00Z" },
];

let dashboardMyTasks: unknown[] = [];

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      users: { ...actual.api.users, me: () => Promise.resolve({ id: "u-vet-1", role: "vet" }) },
      equipment: {
        ...actual.api.equipment,
        list: () => Promise.resolve(EQUIPMENT_LIST),
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
            myTasks: dashboardMyTasks,
            counts: { today: 0, overdue: 0, myTasks: dashboardMyTasks.length },
          }),
        recommendations: () =>
          Promise.resolve({ nextBestTask: null, urgentTasks: [], overloaded: false, suggestions: [] }),
      },
    },
  };
});

import AppointmentsPage from "@/pages/Tasks";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppointmentsPage />
    </QueryClientProvider>,
  );
}

async function openBookingDialog() {
  const openButtons = await screen.findAllByRole("button", { name: t.appointmentsPage.createTask });
  fireEvent.click(openButtons[0]);
  return screen.findByRole("dialog");
}

describe("AppointmentsPage — device field is a real equipment picker (T23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardMyTasks = [];
  });
  afterEach(() => cleanup());

  it("renders a combobox populated from the equipment fetch, not a free-text input", async () => {
    renderPage();
    const dialog = await openBookingDialog();
    const deviceField = within(dialog).getByPlaceholderText(
      t.appointmentsPage.placeholderDevice,
    ) as HTMLInputElement;

    expect(deviceField.getAttribute("role")).toBe("combobox");
    expect(deviceField.getAttribute("aria-autocomplete")).toBe("list");

    fireEvent.focus(deviceField);
    fireEvent.change(deviceField, { target: { value: "ICU" } });

    // Populated from the real equipment list — the matching record appears...
    expect(await within(dialog).findByText("ICU Ventilator")).toBeTruthy();
    // ...and a non-matching record does not.
    expect(within(dialog).queryByText("Infusion Pump")).toBeNull();
  });

  it("does not let typed text alone become a submittable value (must select a real record)", async () => {
    renderPage();
    const dialog = await openBookingDialog();
    const deviceField = within(dialog).getByPlaceholderText(t.appointmentsPage.placeholderDevice);

    fireEvent.focus(deviceField);
    fireEvent.change(deviceField, { target: { value: "some junk text no equipment matches" } });

    const saveButton = within(dialog).getByRole("button", {
      name: t.appointmentsPage.createTask,
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("selecting an equipment option stores its real id, not the typed search text", async () => {
    renderPage();
    const dialog = await openBookingDialog();
    const deviceField = within(dialog).getByPlaceholderText(
      t.appointmentsPage.placeholderDevice,
    ) as HTMLInputElement;

    fireEvent.focus(deviceField);
    fireEvent.change(deviceField, { target: { value: "ICU" } });
    fireEvent.click(await within(dialog).findByText("ICU Ventilator"));

    // The field now shows the selected equipment's NAME, not the raw query.
    expect(deviceField.value).toBe("ICU Ventilator");

    fireEvent.click(within(dialog).getByRole("button", { name: t.appointmentsPage.createTask }));

    // Non-vacuous: against the old free-text input this payload's animalId
    // would be the literal typed string "ICU" — never the equipment's uuid.
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ animalId: VENTILATOR_ID }),
    );
  });

  it("displays the linked equipment's NAME (not a raw id or the generic placeholder) on an existing task", async () => {
    dashboardMyTasks = [
      {
        id: "task-1",
        clinicId: "dev-clinic-default",
        animalId: VENTILATOR_ID,
        ownerId: null,
        vetId: "u-vet-1",
        startTime: "2026-07-10T08:00:00.000Z",
        endTime: "2026-07-10T08:20:00.000Z",
        status: "scheduled",
        conflictOverride: false,
        notes: null,
        priority: "normal",
        taskType: "maintenance",
        createdAt: "2026-07-10T07:00:00.000Z",
        updatedAt: "2026-07-10T07:00:00.000Z",
      },
    ];

    renderPage();

    expect(await screen.findByText("ICU Ventilator")).toBeTruthy();
    expect(screen.queryByText(VENTILATOR_ID)).toBeNull();
    expect(screen.queryByText(t.appointmentsPage.linkedDevice)).toBeNull();
  });
});
