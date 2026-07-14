/**
 * @vitest-environment happy-dom
 *
 * T12 (LOW audit sweep) — the Android/Chrome PWA install banner showed
 * mobile-phrased copy ("Add to your home screen…" / he: "הוסיפו למסך
 * הבית…") even on desktop web, where `beforeinstallprompt` also fires
 * (Chrome/Edge desktop installable-PWA support) but there is no "home
 * screen" concept. T5 already handled banner suppression on kiosk routes
 * and dismissal persistence — this only covers the desktop COPY wording,
 * via the shared platform seam (`usePlatformTarget()`), same seam
 * tests/platform-target.test.ts and tests/platform-router.test.tsx exercise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ isNative: false }));
vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => mocks.isNative,
  capacitorPlatform: () => (mocks.isNative ? "ios" : "web"),
}));

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

/**
 * Force isTouchNarrow()'s matchMedia probe to a known result WITHOUT
 * affecting usePwaInstall's separate `(display-mode: ...)` probes — a
 * blanket `matches: true` stub would make getDisplayMode() see a false
 * "standalone" match and short-circuit the whole component to null.
 */
function stubMatchMedia(touchNarrow: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: coarse") ? touchNarrow : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
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
  mocks.isNative = false;
});
afterEach(() => cleanup());

describe("PwaInstallPrompt — desktop-appropriate install copy (T12)", () => {
  it("shows the desktop install subtitle (not the mobile 'home screen' wording) on a wide, non-touch viewport", () => {
    stubMatchMedia(false); // wide pointer device → platform target "desktop"
    renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();

    expect(screen.getByText(t.pwa.installSubtitleDesktop)).toBeTruthy();
    expect(screen.queryByText(t.pwa.installSubtitle)).toBeNull();
  });

  it("still shows the mobile 'home screen' subtitle on a narrow coarse-pointer (touch) viewport", () => {
    stubMatchMedia(true); // narrow coarse-pointer → platform target "mobile"
    renderPrompt("/equipment");
    dispatchBeforeInstallPrompt();

    expect(screen.getByText(t.pwa.installSubtitle)).toBeTruthy();
    expect(screen.queryByText(t.pwa.installSubtitleDesktop)).toBeNull();
  });

  it("the two subtitle strings are distinct copy (guards against a no-op branch)", () => {
    expect(t.pwa.installSubtitleDesktop).not.toBe(t.pwa.installSubtitle);
  });
});
