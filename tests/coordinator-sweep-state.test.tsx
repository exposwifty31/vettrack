/**
 * @vitest-environment happy-dom
 *
 * Docking P3 T3.4-i-b (Parts C + D) — `CoordinatorSweepState`, the
 * room-radar compact status line rendered near the Room Sweep entry:
 *  - Coordinator: derived from `shiftCoordinator()` — shows the name for
 *    auto/confirmed/fallback_senior; a senior-tech/admin confirm picker for
 *    needs_confirmation; a read-only "to be confirmed" line for anyone else.
 *  - Sweep state: "last swept ⟨relative time⟩ by ⟨name⟩" vs "not swept this
 *    shift", from the room's lastSweptAt/lastSweptByName (T3.4-i-b Part A).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { t } from "@/lib/i18n";
import type { ShiftCoordinatorResult } from "@/types";

const shiftCoordinatorMock = vi.fn();
const confirmCoordinatorMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

let mockAuth = { userId: "u-tech", isAdmin: false };

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      docking: {
        ...actual.api.docking,
        shiftCoordinator: (...args: unknown[]) => shiftCoordinatorMock(...args),
        confirmCoordinator: (...args: unknown[]) => confirmCoordinatorMock(...args),
      },
    },
  };
});

// Radix Select needs pointer-capture/portal machinery this suite does not
// exercise (same rationale as tests/users-secondary-role-pending.test.tsx) —
// stand in with a native <select> driven by the same value/onValueChange
// contract so the confirm-picker logic under test is exercised directly.
vi.mock("@/components/ui/select", () => {
  function SelectTrigger() {
    return null;
  }
  function SelectContent() {
    return null;
  }
  function SelectItem() {
    return null;
  }
  function SelectValue() {
    return null;
  }
  function Select({
    onValueChange,
    children,
  }: {
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) {
    const kids = React.Children.toArray(children) as React.ReactElement<any>[];
    const trigger = kids.find((k) => k.type === SelectTrigger);
    const content = kids.find((k) => k.type === SelectContent);
    const testId = trigger?.props?.["data-testid"];
    const items = content
      ? (React.Children.toArray(content.props.children) as React.ReactElement<any>[])
      : [];
    return (
      <select data-testid={testId} defaultValue="" onChange={(e) => onValueChange(e.target.value)}>
        <option value="" disabled />
        {items.map((item) => (
          <option key={item.props.value} value={item.props.value}>
            {item.props.children}
          </option>
        ))}
      </select>
    );
  }
  return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

import { CoordinatorSweepState } from "@/features/equipment/sweep/CoordinatorSweepState";

afterEach(() => cleanup());

function coordinatorResult(overrides: Partial<ShiftCoordinatorResult> = {}): ShiftCoordinatorResult {
  return {
    shiftDate: "2026-07-15",
    status: "auto",
    coordinatorUserId: "u-tech",
    coordinatorName: "Dana Sweeper",
    candidates: [{ userId: "u-tech", name: "Dana Sweeper" }],
    seniorTechUserId: "u-senior",
    ...overrides,
  };
}

function renderState(props: Partial<React.ComponentProps<typeof CoordinatorSweepState>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CoordinatorSweepState lastSweptAt={null} lastSweptByName={null} {...props} />
    </QueryClientProvider>,
  );
  return client;
}

describe("CoordinatorSweepState — coordinator + sweep-state line (T3.4-i-b Parts C/D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth = { userId: "u-tech", isAdmin: false };
  });

  it("shows the derived coordinator's name for status auto", async () => {
    shiftCoordinatorMock.mockResolvedValue(coordinatorResult({ status: "auto" }));
    renderState();

    const line = await screen.findByTestId("coordinator-line");
    expect(line.textContent).toContain("Dana Sweeper");
  });

  it('shows "not swept this shift" when lastSweptAt is null', async () => {
    shiftCoordinatorMock.mockResolvedValue(coordinatorResult());
    renderState({ lastSweptAt: null, lastSweptByName: null });

    const sweepLine = await screen.findByTestId("sweep-state-line");
    expect(sweepLine.textContent).toBe(t.coordinator.notSweptThisShift);
  });

  it('shows "last swept … by NAME" when lastSweptAt/lastSweptByName are present', async () => {
    shiftCoordinatorMock.mockResolvedValue(coordinatorResult());
    renderState({ lastSweptAt: new Date().toISOString(), lastSweptByName: "Dana Sweeper" });

    const sweepLine = await screen.findByTestId("sweep-state-line");
    expect(sweepLine.textContent).toContain(t.coordinator.sweptPrefix);
    expect(sweepLine.textContent).toContain("Dana Sweeper");
  });

  it("needs_confirmation + current user IS the shift's senior tech: shows a picker that confirms on select", async () => {
    mockAuth = { userId: "u-senior", isAdmin: false };
    shiftCoordinatorMock.mockResolvedValue(
      coordinatorResult({
        status: "needs_confirmation",
        coordinatorUserId: null,
        coordinatorName: null,
        candidates: [
          { userId: "u-a", name: "Alex Tech" },
          { userId: "u-b", name: "Beni Tech" },
        ],
        seniorTechUserId: "u-senior",
      }),
    );
    confirmCoordinatorMock.mockResolvedValue({
      id: "row-1",
      clinicId: "c1",
      shiftDate: "2026-07-15",
      coordinatorUserId: "u-b",
      source: "confirmed",
      assignedByUserId: "u-senior",
      createdAt: "2026-07-15T10:00:00.000Z",
    });
    renderState();

    const select = (await screen.findByTestId("coordinator-confirm-select")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "u-b" } });

    await waitFor(() => expect(confirmCoordinatorMock).toHaveBeenCalledTimes(1));
    expect(confirmCoordinatorMock).toHaveBeenCalledWith({ shiftDate: "2026-07-15", coordinatorUserId: "u-b" });
  });

  it("needs_confirmation + current user is an admin (not the senior tech): also shows the picker", async () => {
    mockAuth = { userId: "u-admin", isAdmin: true };
    shiftCoordinatorMock.mockResolvedValue(
      coordinatorResult({
        status: "needs_confirmation",
        coordinatorUserId: null,
        coordinatorName: null,
        candidates: [{ userId: "u-a", name: "Alex Tech" }],
        seniorTechUserId: "u-senior",
      }),
    );
    renderState();

    expect(await screen.findByTestId("coordinator-confirm-select")).toBeTruthy();
  });

  it("needs_confirmation + current user is neither senior tech nor admin: read-only \"to be confirmed\", no picker", async () => {
    mockAuth = { userId: "u-plain", isAdmin: false };
    shiftCoordinatorMock.mockResolvedValue(
      coordinatorResult({
        status: "needs_confirmation",
        coordinatorUserId: null,
        coordinatorName: null,
        candidates: [{ userId: "u-a", name: "Alex Tech" }],
        seniorTechUserId: "u-senior",
      }),
    );
    renderState();

    const line = await screen.findByTestId("coordinator-line");
    expect(line.textContent).toBe(t.coordinator.toBeConfirmed);
    expect(screen.queryByTestId("coordinator-confirm-select")).toBeNull();
  });
});
