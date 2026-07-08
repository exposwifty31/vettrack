/**
 * @vitest-environment happy-dom
 *
 * 7f People & Roles console — behavioral coverage: the 7→5 role collapse, the
 * management.webWrite gating branch (roster vs pending-server), and the role-edit
 * drawer opening with Save disabled until the role changes. The Save→updateRole
 * path is driven through a Radix Select (pointer-capture / portal positioning),
 * which happy-dom does not reliably simulate — that path is covered at e2e, per
 * the repo's react-testing guidance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const mockCan = vi.fn<(cap: string) => boolean>();
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: new Set(), can: mockCan }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const listMock = vi.fn();
const updateRoleMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { users: { list: (...a: unknown[]) => listMock(...a), updateRole: (...a: unknown[]) => updateRoleMock(...a) } },
}));

import PeopleRolesConsolePage, { toServerRole } from "@/pages/console/PeopleRolesConsolePage";
import type { User } from "@/types";

const USERS: User[] = [
  { id: "u1", email: "amir@clinic.test", name: "Amir", displayName: "Dr. Amir", role: "vet", secondaryRole: null, status: "active", createdAt: "2026-01-01" } as User,
  { id: "u2", email: "noa@clinic.test", name: "Noa", displayName: "Noa", role: "technician", secondaryRole: null, status: "pending", createdAt: "2026-01-01" } as User,
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/people" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <PeopleRolesConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  listMock.mockReset();
  updateRoleMock.mockReset();
});
afterEach(() => cleanup());

describe("toServerRole — 7→5 role collapse (server parity)", () => {
  it("collapses the client-only roles onto the server-accepted set", () => {
    expect(toServerRole("lead_technician")).toBe("senior_technician");
    expect(toServerRole("vet_tech")).toBe("technician");
  });
  it("passes the 5 server roles through unchanged", () => {
    for (const r of ["admin", "vet", "senior_technician", "technician", "student"] as const) {
      expect(toServerRole(r)).toBe(r);
    }
  });
});

describe("PeopleRolesConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders the roster (and fetches) when management.webWrite is granted", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue(USERS);
    renderPage();
    expect(await screen.findByText("Dr. Amir")).toBeTruthy();
    expect(screen.getByText("noa@clinic.test")).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

describe("PeopleRolesConsolePage — role-edit drawer", () => {
  beforeEach(() => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue(USERS);
  });

  it("opens the drawer on row click with Save disabled (role unchanged)", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Dr. Amir"));
    expect(await screen.findByText(t.console.people.editTitle)).toBeTruthy();
    const save = screen.getByRole("button", { name: t.console.people.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // Nothing saved yet.
    expect(updateRoleMock).not.toHaveBeenCalled();
  });
});
