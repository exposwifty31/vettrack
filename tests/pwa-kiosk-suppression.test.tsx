/**
 * @vitest-environment happy-dom
 *
 * T5 audit fix — PWA install banner dismissal persistence + kiosk/wall
 * suppression (banner + shift-chat floating launcher).
 *
 * Bugs fixed:
 *  1. The Android/Chrome install banner's dismissal used a plain useState,
 *     so it reappeared on every remount (App.tsx mounts PwaInstallPrompt
 *     once, but the same class of bug applies to any remount). Now backed
 *     by sessionStorage via usePwaInstall's androidDismissed/dismissAndroidBanner.
 *  2. The promo rendered on /emergency-equipment-wall (kiosk wall display),
 *     not covered by the old PROMO_SUPPRESSED_PREFIXES list.
 *  3. The shift-chat floating launcher (ShiftChatFab / ShiftChatLauncher)
 *     rendered over the same kiosk/wall routes.
 *
 * Both (2) and (3) now share one predicate — isKioskSuppressedPathname in
 * src/app/platform — so the two suppression lists cannot drift apart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import { isKioskSuppressedPathname } from "@/app/platform";

import { PwaInstallPrompt } from "@/components/pwa-install-prompt";

interface FakeBeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function dispatchBeforeInstallPrompt() {
  const event = new Event("beforeinstallprompt") as unknown as FakeBeforeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
  act(() => {
    window.dispatchEvent(event);
  });
}

function renderPrompt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <PwaInstallPrompt />
    </Router>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => cleanup());

describe("PwaInstallPrompt — Android dismissal persistence (BUG 1)", () => {
  it("keeps the banner hidden after an in-app remount once dismissed", () => {
    const { unmount } = renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();
    expect(screen.queryByTestId("pwa-install-banner")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t.pwa.notNow }));
    expect(screen.queryByTestId("pwa-install-banner")).toBeNull();

    // Simulate the component remounting (e.g. a route/shell swap) — a fresh
    // usePwaInstall instance must still read the persisted dismissal.
    unmount();
    renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();

    expect(screen.queryByTestId("pwa-install-banner")).toBeNull();
  });

  it("the X close button also persists the dismissal across remount", () => {
    const { unmount } = renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();
    fireEvent.click(screen.getByRole("button", { name: t.common.close }));
    expect(screen.queryByTestId("pwa-install-banner")).toBeNull();

    unmount();
    renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();
    expect(screen.queryByTestId("pwa-install-banner")).toBeNull();
  });

  it("a fresh session (cleared sessionStorage) shows the banner again", () => {
    const { unmount } = renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();
    fireEvent.click(screen.getByRole("button", { name: t.pwa.notNow }));
    unmount();

    sessionStorage.clear();
    renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();
    expect(screen.queryByTestId("pwa-install-banner")).toBeTruthy();
  });
});

describe("PwaInstallPrompt — kiosk/wall/emergency suppression (BUG 2)", () => {
  it.each([
    "/emergency-equipment-wall",
    "/code-blue/display",
    "/board",
    "/board/pair",
    "/crash-cart/session-1",
  ])("never renders the Android banner on %s", (path) => {
    renderPrompt(path);
    dispatchBeforeInstallPrompt();
    expect(screen.queryByTestId("pwa-install-banner")).toBeNull();
  });

  it("still renders the Android banner on a non-kiosk route", () => {
    renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();
    expect(screen.queryByTestId("pwa-install-banner")).toBeTruthy();
  });
});

describe("isKioskSuppressedPathname — shared predicate", () => {
  it("matches kiosk/wall/emergency prefixes and their sub-paths", () => {
    for (const p of [
      "/board",
      "/board/pair",
      "/code-blue",
      "/code-blue/display",
      "/crash-cart",
      "/crash-cart/session-1",
      "/emergency-equipment-wall",
    ]) {
      expect(isKioskSuppressedPathname(p)).toBe(true);
    }
  });

  it("does not match near-miss paths (segment-safe)", () => {
    for (const p of ["/boardroom", "/code-blueprint", "/equipment", "/emergency-equipment-wall-2"]) {
      expect(isKioskSuppressedPathname(p)).toBe(false);
    }
  });
});
