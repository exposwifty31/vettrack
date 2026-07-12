/**
 * @vitest-environment happy-dom
 *
 * CodeRabbit PR #83 findings (src/pages/Tasks.tsx):
 *  1. (~117-129) The task-create form's equipment query must distinguish a
 *     FAILED fetch from a genuinely empty equipment list — before this fix,
 *     `equipmentQuery.data ?? []` looked identical whether the clinic had no
 *     equipment or the request errored, with no retry affordance.
 *  2. (~176-184) The "no eligible technicians" guard checked
 *     `metaQuery.data.vets` alone, so a technician-only clinic (empty `vets`,
 *     non-empty `technicians`) incorrectly showed the empty-state error even
 *     though the merged `assignees` list had valid options.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "u-vet-1", role: "vet", effectiveRole: "vet", isLoaded: true }),
}));

vi.mock("@/hooks/useRealtime", () => ({ useRealtime: () => {} }));
vi.mock("@/hooks/useRealtimeReconciliation", () => ({ useRealtimeReconciliation: () => {} }));

const equipmentListMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      users: { ...actual.api.users, me: () => Promise.resolve({ id: "u-vet-1", role: "vet" }) },
      equipment: {
        ...actual.api.equipment,
        list: (...args: unknown[]) => equipmentListMock(...args),
      },
      appointments: {
        ...actual.api.appointments,
        meta: () =>
          Promise.resolve({
            day: "2026-07-10",
            vets: [],
            technicians: [{ id: "u-tech-1", name: "Tech Tal", displayName: "Tech Tal", role: "technician", shifts: [] }],
          }),
        list: () => Promise.resolve([]),
        create: vi.fn(),
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

describe("Tasks — equipment query failure vs. genuinely empty (CodeRabbit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("shows an explicit error/retry state (not the empty-list UI) when the equipment fetch fails", async () => {
    equipmentListMock.mockRejectedValue(new Error("network down"));

    renderPage();
    const dialog = await openBookingDialog();

    expect(await within(dialog).findByText(t.appointmentsPage.equipmentLoadFailed)).toBeTruthy();
    expect(within(dialog).getByText(t.errorCard.retry)).toBeTruthy();
  });

  it("retrying re-issues the equipment fetch", async () => {
    equipmentListMock.mockRejectedValue(new Error("network down"));

    renderPage();
    const dialog = await openBookingDialog();
    await within(dialog).findByText(t.appointmentsPage.equipmentLoadFailed);

    const callsBeforeRetry = equipmentListMock.mock.calls.length;
    fireEvent.click(within(dialog).getByText(t.errorCard.retry));

    await waitFor(() =>
      expect(equipmentListMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry),
    );
  });

  it("shows no error state and lists results normally when the equipment fetch succeeds", async () => {
    equipmentListMock.mockResolvedValue([
      { id: "3f1a2b4c-1111-4abc-8def-111111111111", name: "ICU Ventilator", nameHe: null, status: "ok", createdAt: "2026-01-01T00:00:00Z" },
    ]);

    renderPage();
    const dialog = await openBookingDialog();

    await within(dialog).findByPlaceholderText(t.appointmentsPage.placeholderDevice);
    expect(within(dialog).queryByText(t.appointmentsPage.equipmentLoadFailed)).toBeNull();
  });

  it("does not show 'no eligible technicians' for a technician-only clinic (merged assignees non-empty)", async () => {
    equipmentListMock.mockResolvedValue([]);

    renderPage();
    const dialog = await openBookingDialog();

    // The technician option from `technicians` (vets is empty) must be
    // selectable, and the empty-state error must NOT appear.
    await waitFor(() =>
      expect(within(dialog).getByText("Tech Tal")).toBeTruthy(),
    );
    expect(within(dialog).queryByText(t.appointmentsPage.noEligibleTechnicians)).toBeNull();
  });
});
