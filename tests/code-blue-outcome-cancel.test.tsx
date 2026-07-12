/**
 * @vitest-environment happy-dom
 *
 * T-01 (R-CB-01 · CLICK-PATH-001 · HIGH · FROZEN Code Blue surface) — the
 * outcome-sheet "Cancel" button funneled into `onClose("")` ->
 * `handleEndSession("")`, which returned early at the empty-outcome guard
 * (`if (!outcome || !session) return;`) *before* `setShowOutcomeModal(false)`
 * ran. Net effect: Cancel neither ended the session nor closed the sheet,
 * trapping the manager over a live emergency with no browser-back available
 * in WKWebView.
 *
 * This drives the real ActiveSession view (via the default CodeBluePage
 * export) with an ACTIVE session where the current user is the manager,
 * opens the outcome sheet, and asserts Cancel (a) removes the sheet from the
 * DOM, (b) never calls the end-session mutation, and (c) returns focus to
 * the triggering button — never ends the session, never traps the manager.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const endMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ userId: "u-vet-1", role: "vet", name: "Dr. Vet" }),
}));

vi.mock("@/hooks/useCodeBlueSession", () => ({
  useCodeBlueSession: () => ({
    session: {
      id: "s1",
      status: "active",
      startedAt: new Date().toISOString(),
      managerUserId: "u-vet-1",
      managerUserName: "Dr. Vet",
    },
    refetch: vi.fn(),
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

vi.mock("@/lib/haptics", () => ({ haptics: { error: vi.fn(), tap: vi.fn(), scanSuccess: vi.fn() } }));
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
          end: (...args: unknown[]) => endMock(...args),
        },
      },
    },
  };
});

import CodeBluePage from "@/pages/code-blue";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/code-blue" });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <CodeBluePage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("ActiveSession — outcome sheet Cancel (T-01 · R-CB-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("closes the sheet without ending the session and returns focus to the trigger", () => {
    renderPage();

    const trigger = screen.getByText(t.codeBlue.endEventChooseOutcome).closest("button") as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    trigger.focus();
    fireEvent.click(trigger);

    // Sheet is open.
    expect(screen.getByText(t.codeBlue.selectOutcome)).toBeTruthy();

    const cancelButton = screen.getByText(t.common.cancel).closest("button") as HTMLButtonElement;
    fireEvent.click(cancelButton);

    // (a) The sheet is gone from the DOM.
    expect(screen.queryByText(t.codeBlue.selectOutcome)).toBeNull();
    // (b) Cancel never triggers the end-session mutation.
    expect(endMock).not.toHaveBeenCalled();
    // (c) Focus returns to the button that opened the sheet — the manager is
    // never left with focus lost in a removed subtree.
    expect(document.activeElement).toBe(trigger);
  });
});
