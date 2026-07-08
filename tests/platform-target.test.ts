/**
 * @vitest-environment happy-dom
 *
 * Phase 4 (C1): the "board" fourth PlatformTarget and its resolver ORDER.
 *
 * The whole safety of the /board kiosk hinges on where the board check sits in
 * the resolver chain — native → marketing → board → touch-narrow → desktop:
 *
 *   - AFTER native  → a Capacitor build on /board still resolves "mobile"
 *                     (NativeShell), never the wall-kiosk chrome.
 *   - BEFORE touch  → a coarse-pointer tablet/TV browser at /board resolves
 *                     "board", instead of falling into touch-narrow → "mobile".
 *
 * Both the sync resolvePlatformTarget() (reads window.location) and the reactive
 * usePlatformTarget() (reads the wouter pathname) are covered, plus the segment
 * boundary that keeps /equipment/board on desktop and /boardroom off the kiosk.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Toggle isCapacitorNative per-test. vi.hoisted lets the (hoisted) mock factory
// read a mutable flag without the temporal-dead-zone error of a bare closure.
const mocks = vi.hoisted(() => ({ isNative: false }));
vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => mocks.isNative,
  capacitorPlatform: () => (mocks.isNative ? "ios" : "web"),
}));

import { resolvePlatformTarget, usePlatformTarget } from "@/app/platform";

/** Force isTouchNarrow()'s matchMedia probe to a known result. */
function stubMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Drive the sync resolver's window.location.pathname read. */
function setPath(path: string): void {
  window.history.pushState({}, "", path);
}

/** wouter memory Router wrapper so usePlatformTarget's useLocation resolves `path`. */
function wrapperAt(path: string) {
  const { hook } = memoryLocation({ path });
  return ({ children }: { children: ReactNode }) => createElement(Router, { hook }, children);
}

beforeEach(() => {
  mocks.isNative = false;
  stubMatchMedia(false); // wide pointer device by default
  setPath("/");
});

describe("resolvePlatformTarget — board ordering (sync)", () => {
  it("native build on /board resolves mobile (native wins, no kiosk chrome)", () => {
    mocks.isNative = true;
    setPath("/board");
    expect(resolvePlatformTarget()).toBe("mobile");
  });

  it("browser on /board resolves board", () => {
    setPath("/board");
    expect(resolvePlatformTarget()).toBe("board");
  });

  it("board wins over touch-narrow: coarse-pointer viewport at /board still resolves board", () => {
    setPath("/board");
    stubMatchMedia(true); // simulate (max-width: 767px) and (pointer: coarse)
    expect(resolvePlatformTarget()).toBe("board");
  });

  it("touch-narrow still fires off /board (proves the coarse-narrow stub is live)", () => {
    setPath("/");
    stubMatchMedia(true);
    expect(resolvePlatformTarget()).toBe("mobile");
  });

  it("a /board sub-path resolves board", () => {
    setPath("/board/wall");
    expect(resolvePlatformTarget()).toBe("board");
  });

  it("/equipment/board stays desktop (segment boundary — startsWith('/board/') must not match)", () => {
    setPath("/equipment/board");
    expect(resolvePlatformTarget()).toBe("desktop");
  });

  it("/boardroom stays desktop (segment-safety — exact '/board' or '/board/' only)", () => {
    setPath("/boardroom");
    expect(resolvePlatformTarget()).toBe("desktop");
  });
});

describe("usePlatformTarget — board ordering (reactive)", () => {
  it("browser at /board resolves board", () => {
    const { result } = renderHook(() => usePlatformTarget(), { wrapper: wrapperAt("/board") });
    expect(result.current).toBe("board");
  });

  it("native at /board resolves mobile", () => {
    mocks.isNative = true;
    const { result } = renderHook(() => usePlatformTarget(), { wrapper: wrapperAt("/board") });
    expect(result.current).toBe("mobile");
  });

  it("/equipment/board resolves desktop", () => {
    const { result } = renderHook(() => usePlatformTarget(), { wrapper: wrapperAt("/equipment/board") });
    expect(result.current).toBe("desktop");
  });
});
