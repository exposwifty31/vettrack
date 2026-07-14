/**
 * @vitest-environment happy-dom
 *
 * T-52 (CLICK-PATH-034) — the filter inputs fed the live react-query queryKey,
 * so every keystroke in the staff-name filter fired a server request; "Apply"
 * only reset pagination. Fix: commit-on-apply — the query keys off a separate
 * committed filter state; typing updates only the pending inputs, and Apply
 * commits them (one request per Apply, not per keystroke).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ userId: "u1" }) }));
const listMock = vi.fn().mockResolvedValue({ items: [] });
vi.mock("@/lib/api", () => ({ api: { auditLogs: { list: (...a: unknown[]) => listMock(...a) } } }));

import { SharedAuditLogsPanel } from "@/pages/audit-log";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SharedAuditLogsPanel />
    </QueryClientProvider>,
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SharedAuditLogsPanel — commit-on-apply filters (T-52)", () => {
  it("does not request per keystroke; only Apply commits the filter", async () => {
    renderPanel();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    const staff = () => screen.getByPlaceholderText(t.adminPage.logFilterStaffPlaceholder);
    fireEvent.change(staff(), { target: { value: "alice" } });
    fireEvent.change(staff(), { target: { value: "alice2" } });
    await flush();

    // Typing alone must not have triggered any new request.
    expect(listMock).toHaveBeenCalledTimes(1);

    // Apply commits the pending filter → exactly one new request with it.
    fireEvent.click(screen.getByText(t.adminPage.logFilterApply));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ performedBy: "alice2" }));
  });
});
