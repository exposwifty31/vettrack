/**
 * @vitest-environment happy-dom
 *
 * 7e Audit Log console — read-only, server-paginated view over GET /api/audit-logs.
 * Covers the management.webWrite gating branch, that rows render with real action
 * labels (no invented kinds — labels come from t.auditLog.actionLabel), and that
 * the Next/Previous pager advances the page and consumes the server hasMore flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
vi.mock("@/lib/api", () => ({
  api: { auditLogs: { list: (...a: unknown[]) => listMock(...a) } },
}));

import AuditConsolePage from "@/pages/console/AuditConsolePage";

const ROW = {
  id: "a1",
  actionType: "user_login",
  performedBy: "u1",
  performedByEmail: "amir@clinic.test",
  performedByName: "Dr. Amir",
  targetId: "u1-target-id",
  targetType: "user",
  metadata: null,
  timestamp: "2026-07-01T10:00:00.000Z",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/audit-log" });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <AuditConsolePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockCan.mockReset();
  listMock.mockReset();
});
afterEach(() => cleanup());

describe("AuditConsolePage — capability gating", () => {
  it("shows the pending-server state and does not fetch without management.webWrite", () => {
    mockCan.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(t.console.accessPendingServer)).toBeTruthy();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders audit rows with the real action label and actor", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue({ items: [ROW], hasMore: false, page: 1, pageSize: 25 });
    renderPage();
    // Action column uses the real localized label, never an invented kind.
    expect(await screen.findByText(t.auditLog.actionLabel("user_login"))).toBeTruthy();
    expect(screen.getByText("Dr. Amir")).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith({ page: 1 });
  });
});

describe("AuditConsolePage — pagination", () => {
  it("advances the page and re-queries when Next is clicked (hasMore true)", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue({ items: [ROW], hasMore: true, page: 1, pageSize: 25 });
    renderPage();
    await screen.findByText(t.auditLog.actionLabel("user_login"));
    fireEvent.click(screen.getByRole("button", { name: t.console.pagination.next }));
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ page: 2 }));
  });

  it("disables Next when the server reports no more pages", async () => {
    mockCan.mockImplementation((cap) => cap === "management.webWrite");
    listMock.mockResolvedValue({ items: [ROW], hasMore: false, page: 1, pageSize: 25 });
    renderPage();
    await screen.findByText(t.auditLog.actionLabel("user_login"));
    const next = screen.getByRole("button", { name: t.console.pagination.next }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });
});
