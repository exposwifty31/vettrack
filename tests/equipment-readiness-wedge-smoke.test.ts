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

  it("mounts equipment-board API alias via router factory", () => {
    const appRoutes = fs.readFileSync("server/app/routes.ts", "utf8");
    expect(appRoutes).toContain('app.use("/api/equipment-board", createDisplayRouter())');
    expect(appRoutes).toContain('app.use("/api/display", createDisplayRouter())');
  });

  it("snapshot includes commandBoard field", () => {
    const display = fs.readFileSync("server/routes/display.ts", "utf8");
    expect(display).toContain("commandBoard");
  });
});
