/**
 * @vitest-environment happy-dom
 *
 * Phase 10 audit fix: legacy board aliases (`/equipment/board`, `/display`,
 * `/equipment-board`) redirect to canonical `/board` via the shared
 * `RedirectPreserveSearch` helper in src/app/routes.tsx. wouter 3.x's
 * `useSearch()` returns the query string WITHOUT a leading `?`, so naively
 * concatenating `${to}${search}` produced `/boardkiosk=1` instead of
 * `/board?kiosk=1` — a 404 for wall-mounted kiosks bookmarked with
 * `?kiosk=1`. This test pins the fixed concatenation for all three callers
 * (they all route through this one helper).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { RedirectPreserveSearch } from "@/app/routes";

afterEach(() => cleanup());

function renderRedirectAt(path: string) {
  const { hook, history } = memoryLocation({ path, record: true });
  render(
    <Router hook={hook}>
      <RedirectPreserveSearch to="/board" />
    </Router>,
  );
  return history;
}

describe("RedirectPreserveSearch — legacy board alias kiosk query preservation", () => {
  it("preserves ?kiosk=1 from /display onto /board (not /boardkiosk=1)", () => {
    const history = renderRedirectAt("/display?kiosk=1");
    expect(history[history.length - 1]).toBe("/board?kiosk=1");
  });

  it("preserves ?kiosk=1 from /equipment/board onto /board", () => {
    const history = renderRedirectAt("/equipment/board?kiosk=1");
    expect(history[history.length - 1]).toBe("/board?kiosk=1");
  });

  it("preserves ?kiosk=1 from /equipment-board onto /board", () => {
    const history = renderRedirectAt("/equipment-board?kiosk=1");
    expect(history[history.length - 1]).toBe("/board?kiosk=1");
  });

  it("preserves multi-param queries with the leading ? normalized once", () => {
    const history = renderRedirectAt("/display?kiosk=1&theme=dark");
    expect(history[history.length - 1]).toBe("/board?kiosk=1&theme=dark");
  });

  it("lands on plain /board with no trailing ? when there is no query", () => {
    const history = renderRedirectAt("/equipment-board");
    expect(history[history.length - 1]).toBe("/board");
  });
});
