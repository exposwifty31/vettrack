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

/**
 * T-16 device regression (2026-07-13, real iPhone 16 Plus): the Code Blue page
 * renders inside NativeShell's `flex-1` scroll container; NativeTabBar is a flex
 * SIBLING below it carrying `backdrop-filter: blur(12px)`. On WebKit a
 * backdrop-filter element composites ABOVE a fixed-position sibling regardless
 * of z-index, so the tab bar painted over the bottom of the `items-end` outcome
 * sheet and swallowed the Cancel button — the manager saw the four outcome
 * options but no Cancel, making the T-01 fix physically unreachable on device.
 * You cannot out-z-index a backdrop-filter compositing layer; the deterministic
 * fix is to pad the sheet's bottom so its last child (Cancel) clears the tab bar
 * height. jsdom has no tab bar, so the logic test above stays green.
 *
 * Guard the property that keeps Cancel reachable: the sheet reserves bottom
 * padding that clears the native tab bar (the codebase's 68px + safe-area
 * clearance constant), not merely the home-indicator inset.
 */
describe("outcome sheet reachability over the native tab bar (T-16)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("pads the outcome sheet to clear the native tab bar so Cancel is reachable", () => {
    renderPage();
    fireEvent.click(screen.getByText(t.codeBlue.endEventChooseOutcome).closest("button") as HTMLButtonElement);

    const heading = screen.getByText(t.codeBlue.selectOutcome);
    const sheet = heading.closest("div") as HTMLElement;

    // The sheet's bottom padding must clear the tab bar height (68px) PLUS the
    // safe-area inset — safe-area alone (~34px) leaves Cancel behind the ~56px
    // tab bar. This is the property that was missing when Cancel was swallowed.
    expect(sheet.className).toMatch(/pb-\[calc\(68px\+env\(safe-area-inset-bottom\)/);
  });
});
