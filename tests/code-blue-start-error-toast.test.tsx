/**
 * @vitest-environment happy-dom
 *
 * T3 (fail-loud audit, BLOCKING) — the Code Blue start mutation must never
 * swallow a rejected request: a denied emergency start has to surface the
 * server's reason via a toast, not just reset the spinner. Since R-CBF-1.3 the
 * pocket-emergency armed screen commits through the R-CBF-1.1 one-tap
 * orchestration (`api.codeBlue.sessions.oneTap`, CodeBluePage.handleStart in
 * src/pages/code-blue.tsx), driven by an exactly-800ms hold. This test drives
 * the real default-export page, mocks the API call to reject with an `ApiError`
 * (matching the shape `requireClinicalAuthority` returns — 403 `INSUFFICIENT_ROLE`
 * / reason `INSUFFICIENT_CLINICAL_AUTHORITY`), and asserts `toast.error` fires
 * with the localized, non-leaky message — never the raw server string.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";

const toastError = vi.fn();
const oneTapMock = vi.fn();
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

vi.mock("@/lib/haptics", () => ({
  haptics: { warning: vi.fn(), locked: vi.fn(), error: vi.fn(), tap: vi.fn(), scanSuccess: vi.fn() },
}));
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
          oneTap: (...args: unknown[]) => oneTapMock(...args),
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

/** Complete an exactly-800ms press-and-hold, then flush the async commit. */
async function holdToCommit() {
  const hold = screen.getByRole("button", { name: t.codeBlue.hold.instruction });
  fireEvent.pointerDown(hold);
  await act(async () => {
    vi.advanceTimersByTime(800);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CodeBluePage — start error toast (T3 fail-loud, one-tap path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("surfaces the localized clinical-authority message on a 403 INSUFFICIENT_ROLE denial", async () => {
    oneTapMock.mockRejectedValueOnce(
      new ApiError(403, "Clinical authority required", {
        code: "INSUFFICIENT_ROLE",
        error: "INSUFFICIENT_ROLE",
        reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
        message: "Clinical authority required",
        requestId: "req-1",
      }),
    );

    renderPage();
    expect((screen.getByTestId("code-blue-start") as HTMLButtonElement).disabled).toBe(false);
    await holdToCommit();

    expect(oneTapMock).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(t.codeBlue.clinicalAuthorityRequired, { duration: 8000 });
    // Fail-loud, never leaky: the raw server string / requestId must not be the shown message.
    expect(toastError).not.toHaveBeenCalledWith("Clinical authority required", expect.anything());
    // Server truth is never assumed on failure — no optimistic refetch of an active session.
    expect(refetchMock).not.toHaveBeenCalled();

    // Control returns to idle after the failure (not stuck armed / busy).
    expect((screen.getByTestId("code-blue-start") as HTMLButtonElement).disabled).toBe(false);
  });

  it("falls back to the generic start-failed message for an unmapped error code", async () => {
    oneTapMock.mockRejectedValueOnce(
      new ApiError(500, "Internal error", { code: "UNEXPECTED", error: "UNEXPECTED", message: "Internal error" }),
    );

    renderPage();
    await holdToCommit();

    expect(oneTapMock).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(t.codeBlue.startSessionFailed, { duration: 8000 });
  });
});
