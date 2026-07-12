/**
 * @vitest-environment happy-dom
 *
 * Regression (audit T11): the profile "shift activity" date row hand-rolled
 * `toLocaleDateString(undefined, …)`, which ignores the app locale entirely
 * and reorders under RTL — rendering "May 2026 13" for a Hebrew user instead
 * of the correct "13 במאי 2026". The task/appointment modal already formats
 * dates correctly via the shared `formatDateByLocale` helper (src/lib/i18n.ts);
 * this locks that the profile shift-activity row now reuses it too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { setStoredLocale, t } from "@/lib/i18n";

const shiftActivityMock = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "u1" }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    users: {
      shiftActivity: (...a: unknown[]) => shiftActivityMock(...a),
    },
  },
}));

import { ShiftActivityList } from "@/features/profile/ShiftActivityList";

// Noon UTC — stays on the same calendar day across any reasonable local TZ.
const SESSION = {
  id: "s1",
  startedAt: "2026-05-13T09:00:00.000Z",
  endedAt: "2026-05-13T14:00:00.000Z",
  note: null,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ShiftActivityList />
    </QueryClientProvider>,
  );
}

describe("ShiftActivityList — locale-aware date formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shiftActivityMock.mockResolvedValue([SESSION]);
  });
  afterEach(() => {
    cleanup();
    setStoredLocale("he");
  });

  it("renders the Hebrew day-month-year order with a real Hebrew month name (not 'May 2026 13')", async () => {
    setStoredLocale("he");
    renderList();

    const dateText = await screen.findByText("13 במאי 2026");
    expect(dateText.textContent).toBe("13 במאי 2026");
    expect(dateText.textContent).not.toMatch(/May/);
  });

  it("renders the English month-day-year order under the en locale", async () => {
    setStoredLocale("en");
    renderList();

    const dateText = await screen.findByText("May 13, 2026");
    expect(dateText.textContent).toBe("May 13, 2026");
  });
});

describe("ShiftActivityList — failure path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    setStoredLocale("he");
  });

  it("shows the error state (not a date-formatted row) when the fetch fails, and retry re-issues it", async () => {
    shiftActivityMock.mockRejectedValueOnce(new Error("network down"));
    shiftActivityMock.mockResolvedValueOnce([SESSION]);

    renderList();

    const errorText = await screen.findByText(t.profile.shiftActivityError);
    expect(errorText).toBeTruthy();
    expect(screen.queryByText("13 במאי 2026")).toBeNull();

    fireEvent.click(screen.getByText(t.common.tryAgain));

    await waitFor(() => expect(shiftActivityMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("13 במאי 2026")).toBeTruthy();
  });
});
