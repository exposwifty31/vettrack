/**
 * @vitest-environment happy-dom
 *
 * R-CBF-1.3b — the armed screen wires the hold-to-confirm control to the
 * R-CBF-1.1 one-tap orchestration endpoint. A completed 800ms hold (no
 * pre-selected equipment) generates the per-gesture idempotency token and
 * fires `api.codeBlue.sessions.oneTap` with it, then follows the
 * server-confirmed transition (refetch) — never optimistic local state. A
 * single tap must NOT start.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const oneTapMock = vi.fn();
const refetchMock = vi.fn();

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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
import { t } from "@/lib/i18n";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeBluePage />
    </QueryClientProvider>,
  );
}

describe("CodeBluePage — hold-to-confirm fires the one-tap orchestration (R-CBF-1.3b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    oneTapMock.mockResolvedValue({ outcome: "created", sessionId: "s-1", pagingState: "queued" });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("a completed hold fires oneTap once with the per-gesture token + manager", () => {
    renderPage();
    const hold = screen.getByRole("button", { name: t.codeBlue.hold.action });
    fireEvent.pointerDown(hold);
    act(() => vi.advanceTimersByTime(800));

    expect(oneTapMock).toHaveBeenCalledTimes(1);
    const body = oneTapMock.mock.calls[0][0] as {
      idempotencyToken: string;
      managerUserId: string;
      managerUserName: string;
      preCheckPassed?: boolean;
    };
    expect(typeof body.idempotencyToken).toBe("string");
    expect(body.idempotencyToken.length).toBeGreaterThan(0);
    expect(body.managerUserId).toBe("u-vet-1");
    expect(body.managerUserName).toBe("Dr. Vet");
  });

  it("a single tap does NOT fire oneTap", () => {
    renderPage();
    const hold = screen.getByRole("button", { name: t.codeBlue.hold.action });
    fireEvent.pointerDown(hold);
    fireEvent.pointerUp(hold);
    act(() => vi.advanceTimersByTime(1500));
    expect(oneTapMock).not.toHaveBeenCalled();
  });

  it("follows the server-confirmed transition (refetch) after a successful start", async () => {
    renderPage();
    const hold = screen.getByRole("button", { name: t.codeBlue.hold.action });
    fireEvent.pointerDown(hold);
    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(refetchMock).toHaveBeenCalled();
  });
});
