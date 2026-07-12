/**
 * @vitest-environment happy-dom
 *
 * CodeRabbit PR #83 finding (code-blue.tsx ~553) — a FAILED active-session
 * query must never be treated the same as a confirmed "no active session".
 * Before this fix, `session` fell back to `null` on query error and the page
 * fell through past the loading guard straight to the launch form
 * (PreCheckGate), which could let staff open a duplicate Code Blue while an
 * existing session was merely unreachable. This asserts the page renders a
 * blocking, retryable error state instead, and that retrying re-invokes the
 * query's refetch.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const refetchMock = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "u-vet-1", role: "vet", name: "Dr. Vet" }),
}));

vi.mock("@/hooks/useCodeBlueSession", () => ({
  useCodeBlueSession: () => ({
    session: null,
    refetch: refetchMock,
    logEntries: [],
    presence: [],
    cartStatus: null,
    linkedEquipment: [],
    isLoading: false,
    isError: true,
    logEntry: vi.fn(),
  }),
  clearCodeBlueSessionCache: vi.fn(),
}));

vi.mock("@/lib/haptics", () => ({ haptics: { error: vi.fn(), tap: vi.fn() } }));
vi.mock("@/lib/sounds", () => ({ playCriticalAlertTone: vi.fn().mockResolvedValue(undefined) }));

import CodeBluePage from "@/pages/code-blue";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeBluePage />
    </QueryClientProvider>,
  );
}

describe("CodeBluePage — failed active-session query guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("renders a blocking error state instead of the launch form when the session check fails", () => {
    renderPage();

    expect(screen.getByTestId("code-blue-session-error")).toBeTruthy();
    expect(screen.getByText(t.codeBlue.sessionCheckFailed)).toBeTruthy();
    expect(screen.queryByTestId("code-blue-start")).toBeNull();
  });

  it("retrying the error state calls refetch instead of assuming no active session", () => {
    renderPage();

    fireEvent.click(screen.getByText(t.errorCard.retry));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
