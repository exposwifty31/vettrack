/**
 * PR18: release smoke — canonical routes and API mounts exist.
 *
 * The API half asserts against the REAL registration at runtime, not against the
 * source text of server/app/routes.ts. A `toContain` on that file passes when the
 * mount string sits in a comment, when router initialisation fails, or when some
 * other path still registers the prefix — none of which is what the test claims to
 * prove. `registerApiRoutes` is driven with a recording stub instead, the same
 * harness tests/routes-registration-contract-slice7.test.ts already uses, so the
 * assertions are about mounts that actually happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Express } from "express";
import fs from "node:fs";

async function recordMountPaths(): Promise<string[]> {
  const { registerApiRoutes } = await import("../server/app/routes.js");
  const paths: string[] = [];
  const app = {
    use(path: string, ..._routers: unknown[]) {
      paths.push(path);
      return app;
    },
    // Safe for a specific reason rather than by convenience: registerApiRoutes calls
    // `app.use(...)` and nothing else on the Express instance — no `get`, `listen`,
    // `set` or `locals`. If it ever grows another call, this one-method recorder throws
    // a TypeError on the missing method rather than passing quietly, so the assumption
    // fails loudly instead of rotting.
  } as unknown as Express;
  registerApiRoutes(app);
  return paths;
}

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

  describe("API mounts (runtime, not source text)", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.resetModules();
    });

    it("mounts the display API", async () => {
      const paths = await recordMountPaths();
      expect(paths).toContain("/api/display");
    }, 15_000);

    it("no longer mounts the /api/equipment-board alias, by any path", async () => {
      const paths = await recordMountPaths();
      // The alias re-mounted the SAME createDisplayRouter() under a second prefix
      // that no client called. It also put an /api/equipment-board/snapshot outside
      // the emergency cache denylist, which keys on the /api/display name only
      // (public/sw.js, packages/contracts/src/emergency.ts). Asserting on the real
      // mount list means a re-add through any registration path fails here.
      expect(paths).not.toContain("/api/equipment-board");
      expect(paths.filter((p) => p.startsWith("/api/equipment-board"))).toEqual([]);
    }, 15_000);

    it("no longer mounts the retired /api/stability family", async () => {
      const paths = await recordMountPaths();
      expect(paths.filter((p) => p.startsWith("/api/stability"))).toEqual([]);
    }, 15_000);
  });

  it("snapshot includes commandBoard field", () => {
    const display = fs.readFileSync("server/routes/display.ts", "utf8");
    expect(display).toContain("commandBoard");
  });
});
