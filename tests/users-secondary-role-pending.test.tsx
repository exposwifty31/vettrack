/**
 * @vitest-environment happy-dom
 *
 * T-44 (R-AD-05 · CLICK-PATH-025) — UsersSection secondary-role dropdowns
 * must key their pending/optimistic state by userId. A single shared pending
 * pair (no userId key) would make changing ONE user's secondary role show
 * the pending/optimistic value on EVERY row's dropdown while the mutation is
 * in flight. This test asserts the pending state is scoped to the row whose
 * mutation is actually in flight — sibling rows keep showing their own
 * persisted secondaryRole, unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

const listPaginatedMock = vi.fn();
const updateSecondaryRoleMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    users: {
      listPaginated: (...a: unknown[]) => listPaginatedMock(...a),
      updateSecondaryRole: (...a: unknown[]) => updateSecondaryRoleMock(...a),
    },
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "admin-1", isAdmin: true }),
}));

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/haptics", () => ({
  haptics: { tap: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix Select needs full pointer-capture/portal machinery this suite does
// not exercise. Stand in with a native <select> driven by the exact same
// value/onValueChange contract, so the state-gating logic under test (which
// row's pending value renders) is exercised directly instead of fighting
// Radix's popup internals in happy-dom.
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
    value,
    onValueChange,
    children,
  }: {
    value: string;
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
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
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

import { UsersSection } from "@/pages/admin/UsersSection";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsersSection />
    </QueryClientProvider>,
  );
}

function makeUser(id: string, secondaryRole: string | null) {
  return {
    id,
    clerkId: `clerk-${id}`,
    email: `${id}@clinic.example`,
    name: id,
    displayName: id,
    role: "technician",
    secondaryRole,
    status: "active",
    createdAt: "2026-07-10T10:00:00.000Z",
  };
}

beforeEach(() => {
  listPaginatedMock.mockReset();
  updateSecondaryRoleMock.mockReset();
});

afterEach(() => cleanup());

describe("UsersSection — secondary-role pending state keyed by userId (T-44)", () => {
  it("shows pending secondary role only on the changed row; sibling rows unaffected", async () => {
    listPaginatedMock.mockResolvedValue({
      items: [makeUser("u-1", null), makeUser("u-2", "senior_technician")],
      total: 2,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });

    // Keep the mutation pending (unresolved) so we can observe in-flight state.
    let resolveMutation: (v: unknown) => void = () => {};
    updateSecondaryRoleMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );

    renderSection();

    const selectU1 = (await screen.findByTestId(
      "select-secondary-role-u-1",
    )) as HTMLSelectElement;
    const selectU2 = (await screen.findByTestId(
      "select-secondary-role-u-2",
    )) as HTMLSelectElement;

    // Baseline, from server data.
    expect(selectU1.value).toBe("none");
    expect(selectU2.value).toBe("senior_technician");

    // Change u-1's secondary role — the mutation for u-1 stays pending.
    fireEvent.change(selectU1, { target: { value: "admin" } });

    await waitFor(() =>
      expect(updateSecondaryRoleMock).toHaveBeenCalledWith("u-1", "admin"),
    );

    // u-1 optimistically shows the pending value...
    expect(selectU1.value).toBe("admin");
    // ...but u-2 must still show ITS OWN persisted value, never u-1's pending one.
    expect(selectU2.value).toBe("senior_technician");

    resolveMutation({ user: makeUser("u-1", "admin") });
  });
});
