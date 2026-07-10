/**
 * @vitest-environment happy-dom
 *
 * T3 (fail-loud audit, BLOCKING) — the Code Blue "open session" mutation
 * (`api.codeBlue.sessions.start`, CodeBluePage.handleStart in
 * src/pages/code-blue.tsx) must never swallow a rejected request: a denied
 * emergency start has to surface the server's reason via a toast, not just
 * reset the spinner. This test drives the real default-export page, mocks
 * the API call to reject with an `ApiError` (matching the shape
 * `requireClinicalAuthority` actually returns — 403 `INSUFFICIENT_ROLE` /
 * reason `INSUFFICIENT_CLINICAL_AUTHORITY`), and asserts `toast.error` fires
 * with the localized, non-leaky message — never the raw server string.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const toastError = vi.fn();
const startMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

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
    isError: false,
    logEntry: vi.fn(),
  }),
  clearCodeBlueSessionCache: vi.fn(),
}));

vi.mock("@/lib/haptics", () => ({ haptics: { error: vi.fn(), tap: vi.fn() } }));
vi.mock("@/lib/sounds", () => ({ playCriticalAlertTone: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      codeBlue: {
        ...actual.api.codeBlue,
        sessions: {
          ...actual.api.codeBlue.sessions,
          start: (...args: unknown[]) => startMock(...args),
        },
      },
    },
  };
});

import CodeBluePage from "@/pages/code-blue";
import { ApiError } from "@/lib/api";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeBluePage />
    </QueryClientProvider>,
  );
}

describe("CodeBluePage — start-session error toast (T3 fail-loud)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("surfaces the localized clinical-authority message on a 403 INSUFFICIENT_ROLE denial", async () => {
    startMock.mockRejectedValueOnce(
      new ApiError(403, "Clinical authority required", {
        code: "INSUFFICIENT_ROLE",
        error: "INSUFFICIENT_ROLE",
        reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
        message: "Clinical authority required",
        requestId: "req-1",
      }),
    );

    renderPage();
    const button = screen.getByTestId("code-blue-start") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(t.codeBlue.clinicalAuthorityRequired, { duration: 8000 }),
    );
    // Fail-loud, never leaky: the raw server string / requestId must not be the shown message.
    expect(toastError).not.toHaveBeenCalledWith("Clinical authority required", expect.anything());
    // Server truth is never assumed on failure — no optimistic refetch of an active session.
    expect(refetchMock).not.toHaveBeenCalled();

    // Spinner returns to idle after the failure (not stuck armed).
    await waitFor(() => expect((screen.getByTestId("code-blue-start") as HTMLButtonElement).disabled).toBe(false));
  });

  it("falls back to the generic start-failed message for an unmapped error code", async () => {
    startMock.mockRejectedValueOnce(
      new ApiError(500, "Internal error", { code: "UNEXPECTED", error: "UNEXPECTED", message: "Internal error" }),
    );

    renderPage();
    fireEvent.click(screen.getByTestId("code-blue-start"));

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(t.codeBlue.startSessionFailed, { duration: 8000 }),
    );
  });
});
