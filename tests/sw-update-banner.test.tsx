/**
 * @vitest-environment happy-dom
 *
 * T6 (REVISED) — SwUpdateBanner must be a no-op on /board (and other
 * board/kiosk paths). useBoardAutoReload (tests/board-auto-reload.test.ts)
 * is the sole Code-Blue-aware reload owner for the /board wall kiosk: an
 * un-gated click-to-refresh toast there is dead UI (nobody taps an
 * unattended wall display) and would be a second, Code-Blue-UNAWARE
 * listener on the same `sw-update-available` event useBoardAutoReload
 * already owns. Non-board surfaces (normal staff devices) must keep the
 * click banner unchanged.
 *
 * T6 follow-up (review fix) — the banner mounts ONCE at the app root
 * (src/main.tsx) and /board is reachable via same-tab SPA navigation
 * (including the /equipment/board, /display, /equipment-board
 * RedirectPreserveSearch redirects in src/app/routes.tsx). The board-path
 * check must therefore be reactive to wouter navigation, not just evaluated
 * once at initial mount — see the "reactive to same-tab navigation" describe
 * block below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const toastFn = vi.fn();
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastFn(...args) }));

import { SwUpdateBanner } from "@/components/sw-update-banner";

function setPath(path: string): void {
  window.history.pushState({}, "", path);
}

/** Simulates a same-tab wouter SPA navigation after the component has mounted. */
function navigate(path: string): void {
  act(() => {
    setPath(path);
  });
}

function dispatchSwUpdate(): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("sw-update-available", { detail: { worker: {} } }),
    );
  });
}

beforeEach(() => {
  toastFn.mockClear();
  setPath("/");
});

afterEach(() => cleanup());

describe("SwUpdateBanner — board/kiosk no-op", () => {
  it.each(["/board", "/board/pair"])("shows no toast on %s", (path) => {
    setPath(path);
    render(<SwUpdateBanner />);
    dispatchSwUpdate();
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("does not match near-miss paths as board (segment-safe) — still shows the toast", () => {
    setPath("/boardroom");
    render(<SwUpdateBanner />);
    dispatchSwUpdate();
    expect(toastFn).toHaveBeenCalledTimes(1);
  });
});

describe("SwUpdateBanner — click banner unchanged on non-board surfaces", () => {
  it("still shows the click-to-refresh toast on a normal (non-board) path", () => {
    setPath("/equipment");
    render(<SwUpdateBanner />);
    dispatchSwUpdate();
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it("only shows the toast once across repeated update events", () => {
    setPath("/equipment");
    render(<SwUpdateBanner />);
    dispatchSwUpdate();
    dispatchSwUpdate();
    expect(toastFn).toHaveBeenCalledTimes(1);
  });
});

describe("SwUpdateBanner — board-path suppression reacts to same-tab SPA navigation", () => {
  it("suppresses the toast after navigating from a non-board path INTO /board without remounting", () => {
    setPath("/equipment");
    render(<SwUpdateBanner />);

    // Mounted on a normal path — sanity check the listener is live before navigating.
    navigate("/board");
    dispatchSwUpdate();
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("re-enables the toast after navigating back to a normal path", () => {
    setPath("/equipment");
    render(<SwUpdateBanner />);

    navigate("/board");
    dispatchSwUpdate();
    expect(toastFn).not.toHaveBeenCalled();

    navigate("/equipment");
    dispatchSwUpdate();
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it("suppresses the toast when landing on /board via a client-side redirect target (e.g. /equipment/board, /display, /equipment-board)", () => {
    setPath("/equipment");
    render(<SwUpdateBanner />);

    // RedirectPreserveSearch performs a same-tab wouter <Redirect>, which lands
    // on /board without a full page reload — same reactivity path as any other
    // SPA navigation into /board.
    navigate("/board");
    dispatchSwUpdate();
    expect(toastFn).not.toHaveBeenCalled();
  });
});
