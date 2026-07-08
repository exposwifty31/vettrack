/**
 * @vitest-environment happy-dom
 *
 * PlatformRouter dispatch for the "board" target (Phase 4 C1): /board renders the
 * BoardShell kiosk host wrapping the children; a desktop route (e.g. the legacy
 * /equipment/board web board) passes through untouched with no board chrome.
 *
 * BoardShell's internal kiosk behaviors (wake-lock, fullscreen-on-interaction,
 * error reset) are exercised live in the Playwright board smoke; here we pin the
 * one thing the unit layer owns — that the new router branch wires BoardShell.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => false,
  capacitorPlatform: () => "web",
}));

import { PlatformRouter } from "@/app/platform/PlatformRouter";

// Desktop-shaped viewport: isTouchNarrow() must be false so /board resolves to
// "board" (not touch-narrow "mobile"), and /equipment/board resolves "desktop".
function stubDesktopMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => stubDesktopMatchMedia());
afterEach(() => cleanup());

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <PlatformRouter>
        <div data-testid="child">page</div>
      </PlatformRouter>
    </Router>,
  );
}

describe("PlatformRouter — board dispatch", () => {
  it("wraps /board children in the BoardShell kiosk host", () => {
    renderAt("/board");
    expect(document.querySelector("[data-board-shell]")).toBeTruthy();
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("passes the desktop /equipment/board web board through without the board shell", () => {
    renderAt("/equipment/board");
    expect(document.querySelector("[data-board-shell]")).toBeNull();
    expect(screen.getByTestId("child")).toBeTruthy();
  });
});
