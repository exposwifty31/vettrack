/**
 * PR18: release smoke — canonical routes and API mounts exist in source.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("equipment readiness wedge smoke", () => {
  it("registers canonical frontend aliases", () => {
    const routes = fs.readFileSync("src/app/routes.tsx", "utf8");
    expect(routes).toContain('path="/equipment-board"');
    expect(routes).toContain('path="/equipment-tasks"');
    expect(routes).toContain('path="/locations"');
    expect(routes).toContain('path="/critical-kit-check"');
    expect(routes).toContain('path="/display"');
    expect(routes).toContain('path="/equipment/board"');
    // Phase 10: /equipment/board is now a redirect to the canonical /board kiosk
    // (was a WardDisplayPage render route).
    expect(routes).toMatch(/path="\/equipment\/board"><RedirectPreserveSearch to="\/board"/);
  });

  it("mounts the display API via router factory", () => {
    const appRoutes = fs.readFileSync("server/app/routes.ts", "utf8");
    expect(appRoutes).toContain('app.use("/api/display", createDisplayRouter())');
    // The /api/equipment-board alias was removed: it re-mounted the same
    // createDisplayRouter() under a second prefix that no client ever called,
    // and its /snapshot twin sat outside the emergency cache denylist, which
    // keys on the /api/display name only.
    expect(appRoutes).not.toContain('/api/equipment-board');
  });

  it("snapshot includes commandBoard field", () => {
    const display = fs.readFileSync("server/routes/display.ts", "utf8");
    expect(display).toContain("commandBoard");
  });
});
