/**
 * @vitest-environment happy-dom
 *
 * T-48 (CLICK-PATH-030) — the Add Room dialog's `onOpenChange` clears the form
 * fields on close (Escape / overlay / X), but the footer "Cancel" button called
 * `setCreateOpen(false)` directly, bypassing that reset. So cancelling and
 * reopening left the previously typed values behind. Cancel must route through
 * the same reset.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAdmin: true, userId: "u1" }) }));
vi.mock("@/components/layout/AppShell", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AppShell: ({ children }: any) => <>{children}</>,
}));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("wouter", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children }: any) => <a>{children}</a>,
  useLocation: () => ["/rooms", vi.fn()],
}));
vi.mock("@/lib/api", () => ({
  api: { rooms: { list: vi.fn().mockResolvedValue([]), create: vi.fn() } },
}));

import RoomsListPage from "@/pages/rooms-list";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoomsListPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RoomsListPage — Add Room Cancel resets the form (T-48)", () => {
  it("clears the typed room name after Cancel + reopen", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(t.roomsListPage.addRoom)).toBeTruthy());

    // Open → type a name.
    fireEvent.click(screen.getByText(t.roomsListPage.addRoom));
    const nameInput = () => screen.getByLabelText(t.roomsListPage.roomName) as HTMLInputElement;
    fireEvent.change(nameInput(), { target: { value: "Test Room" } });
    expect(nameInput().value).toBe("Test Room");

    // Cancel closes the dialog.
    fireEvent.click(screen.getByText("Cancel"));

    // Reopen — the field must be reset, not carrying the stale value.
    fireEvent.click(screen.getByText(t.roomsListPage.addRoom));
    expect(nameInput().value).toBe("");
  });
});
