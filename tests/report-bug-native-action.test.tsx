/**
 * @vitest-environment happy-dom
 *
 * Behavioral contract for the native "Report a Bug" nav action.
 *
 * The fix repointed the native report-bug row from navigating to the static
 * `/support` page to opening `ReportIssueDialog` in-app. The phase-6 consistency
 * test only greps the source for that wiring — and a passing grep stayed green
 * through the original regression, where `ReportIssueDialog` was mounted
 * unconditionally and ran `useMutation`/`useAuth` with no `QueryClientProvider`,
 * crashing at runtime. These tests mount each native renderer, activate the
 * report-issue row, and assert the dialog actually opens: the runtime behavior a
 * source grep cannot observe.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import { NativeTabSidebar } from "@/native/NativeTabSidebar";
import { MoreSheet } from "@/features/settings/MoreSheet";

// The report-bug row lives in the non-admin "account" section; isAdmin only
// gates admin-only sections. email feeds the dialog's "reported as" line.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAdmin: true, email: "tech@clinic.test" }),
}));
// The nav reads useActiveShift for M9 end-shift gating; a resolved shift keeps
// the query out of the loading branch without a live server.
vi.mock("@/hooks/use-active-shift", () => ({
  useActiveShift: () => ({ hasActiveShift: true, isLoading: false, nextShift: null }),
}));

afterEach(() => cleanup());

function renderWithProviders(path: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>{ui}</Router>
    </QueryClientProvider>,
  );
}

describe("native Report-a-Bug action opens the report dialog (not /support)", () => {
  it("NativeTabSidebar: activating the report-bug row opens ReportIssueDialog", async () => {
    renderWithProviders("/home", <NativeTabSidebar />);

    // The dialog is unmounted until the row is activated.
    expect(screen.queryByText(t.reportIssueDialog.title)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t.nav.reportBug }));

    expect(await screen.findByText(t.reportIssueDialog.title)).toBeTruthy();
  });

  it("MoreSheet: selecting the report-bug row opens ReportIssueDialog", async () => {
    renderWithProviders("/home", <MoreSheet open onClose={() => {}} />);

    expect(screen.queryByText(t.reportIssueDialog.title)).toBeNull();

    fireEvent.click(screen.getByText(t.nav.reportBug));

    expect(await screen.findByText(t.reportIssueDialog.title)).toBeTruthy();
  });
});
