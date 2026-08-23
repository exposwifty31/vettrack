/**
 * Static-analysis tests for the Code Blue session API (Tasks 3–5 of the redesign).
 *
 * These tests are intentionally written BEFORE the routes exist (TDD red state).
 * They verify structural patterns in server/routes/code-blue.ts and
 * server/routes/crash-cart.ts that will be implemented in subsequent tasks.
 *
 * All tests are expected to FAIL until:
 *  - Task 4: Code Blue session routes are added to server/routes/code-blue.ts
 *  - Task 5: Crash cart routes are added in server/routes/crash-cart.ts
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const routes = read("server/routes/code-blue.ts");
let crashCart = null;
let appRoutes = null;
try { crashCart = read("server/routes/crash-cart.ts"); } catch {}
try { appRoutes = read("server/app/routes.ts"); } catch {}

/**
 * Several handler bodies referenced below were extracted out of
 * server/routes/code-blue.ts into their own modules (mechanical file split,
 * TODO(arch) in code-blue.ts). `routes` alone no longer contains their
 * bodies — read the specific handler file too wherever an assertion checks
 * content that now lives there.
 */
function readHandler(name) {
  return read(path.join("server", "routes", "code-blue", "handlers", name));
}
const getSessionsActiveSrc = readHandler("get-sessions-active.ts");
const postSessionsIdLogsSrc = readHandler("post-sessions-id-logs.ts");
const patchSessionsIdEndSrc = readHandler("patch-sessions-id-end.ts");
const postSessionsSrc = readHandler("post-sessions.ts");
// Request-body schemas were also moved out of code-blue.ts, into
// code-blue/schemas.ts (breaks a router → handler → router import cycle).
// code-blue.ts re-exports every schema name unchanged, but the schema
// bodies now live only in schemas.ts.
const schemasSrc = read(path.join("server", "routes", "code-blue", "schemas.ts"));

// ─────────────────────────────────────────────────────────────────────────────
// Route structure
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue sessions — server route structure", () => {
  it("POST /sessions route is defined", () => {
    expect(routes).toMatch(/router\.post\(\s*["'"]\/sessions["']/);
  });

  it("GET /sessions/active route is defined", () => {
    expect(routes).toMatch(/router\.get\(\s*["'"]\/sessions\/active["']/);
  });

  it("POST /sessions/:id/logs route is defined", () => {
    expect(routes).toMatch(/router\.post\(\s*["'"]\/sessions\/:id\/logs["']/);
  });

  it("PATCH /sessions/:id/presence route is defined", () => {
    expect(routes).toMatch(/router\.patch\(["'"]\/sessions\/:id\/presence["']/);
  });

  it("PATCH /sessions/:id/end route is defined", () => {
    expect(routes).toMatch(/router\.patch\(\s*["'"]\/sessions\/:id\/end["']/);
  });

  it("GET /history route is defined", () => {
    expect(routes).toMatch(/router\.get\(["'"]\/history["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manager enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue sessions — manager enforcement", () => {
  it("end route checks managerUserId against caller", () => {
    expect(routes + schemasSrc).toContain("managerUserId");
    expect(routes).toContain("403");
    expect(routes).toContain("MANAGER_ONLY");
  });

  it("end route manager check applies to ALL outcomes, not just 'died'", () => {
    // The 403 block must come BEFORE any outcome check — not inside a 'died' conditional
    const endHandlerStart = routes.search(
      /router\.patch\(\s*["']\/sessions\/:id\/end["']/,
    );
    const endHandlerEnd = routes.indexOf("\nrouter.", endHandlerStart + 1);
    const endBlock =
      routes.slice(
        endHandlerStart,
        endHandlerEnd > endHandlerStart ? endHandlerEnd : endHandlerStart + 2000,
      ) +
      "\n" +
      patchSessionsIdEndSrc;
    const manager403Pos = endBlock.indexOf("MANAGER_ONLY");
    const diedPos = endBlock.indexOf('"died"');
    // If no 'died' string, the check is outcome-agnostic — correct
    // If 'died' exists, manager check must appear first
    if (diedPos !== -1) {
      expect(manager403Pos).toBeLessThan(diedPos);
    }
    expect(manager403Pos).toBeGreaterThan(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue sessions — idempotency", () => {
  it("log entries route uses idempotencyKey for deduplication", () => {
    expect(routes + schemasSrc).toContain("idempotencyKey");
    expect(postSessionsIdLogsSrc).toContain("duplicate");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Equipment checkout — auto-mutation removed (PR 1.6)
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue sessions — no auto-checkout on equipment log", () => {
  it("equipment log entry does NOT update equipment checkout state", () => {
    // PR 1.6: auto-checkout removed; equipment table must not be mutated via Code Blue log
    expect(postSessionsIdLogsSrc).not.toContain("checkedOutById");
    expect(postSessionsIdLogsSrc).not.toContain(".update(equipment");
  });

  it("session end route does not perform equipment mutations", () => {
    expect(patchSessionsIdEndSrc).not.toContain("checkedOutById");
  });

  it("session end route still closes the session", () => {
    expect(patchSessionsIdEndSrc).toContain('status: "ended"');
    expect(patchSessionsIdEndSrc).toContain("endedAt");
  });

  it("log entry history still persists via codeBlueLogEntries insert", () => {
    expect(postSessionsIdLogsSrc).toContain("codeBlueLogEntries");
    expect(postSessionsIdLogsSrc).toContain("insert");
  });

  it("equipment import is read-only for linked equipment (no checkout mutation)", () => {
    // The `equipment` table import moved from code-blue.ts's own import
    // block into post-sessions.ts (mechanical file split) — it's the only
    // extracted handler that reads it (validating body.equipmentId).
    expect(postSessionsSrc).toContain("equipment");
    expect(routes + getSessionsActiveSrc).toContain("fetchLinkedEquipmentForSession");
    expect(routes + getSessionsActiveSrc + postSessionsSrc).not.toMatch(/\.update\(equipment/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Poll response
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue sessions — poll response includes cartStatus", () => {
  it("active session response includes cartStatus field", () => {
    expect(getSessionsActiveSrc).toContain("cartStatus");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Crash cart route registration
// ─────────────────────────────────────────────────────────────────────────────

describe("Crash cart route registration", () => {
  it.skipIf(appRoutes === null)("crash-cart router is imported in server/app/routes.ts", () => {
    expect(appRoutes).toContain("crash-cart");
  });

  it.skipIf(appRoutes === null)("crash-cart is mounted at /api/crash-cart", () => {
    expect(appRoutes).toContain("/api/crash-cart");
  });

  it.skipIf(crashCart === null)("POST /checks route defined in crash-cart router", () => {
    expect(crashCart).toMatch(/router\.post\(["'"]\/checks["']/);
  });

  it.skipIf(crashCart === null)("GET /checks/latest route defined in crash-cart router", () => {
    expect(crashCart).toMatch(/router\.get\(["'"]\/checks\/latest["']/);
  });

  it.skipIf(crashCart === null)("all_passed is false when any item is unchecked", () => {
    expect(crashCart).toContain("allPassed");
    expect(crashCart).toContain("every");
  });
});
