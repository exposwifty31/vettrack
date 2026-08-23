/**
 * Static-analysis tests for Code Blue session gate hardening (PR 1.5).
 *
 * Verifies:
 *  1. Session creation always uses server-authoritative timestamp (not localStartedAt)
 *  2. Whitespace-only earlyStopReason is rejected at the end-session handler
 *  3. Manager active status is checked at session-end (not just role)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const routes = read("server/routes/code-blue.ts");

/**
 * Several code-blue.ts handler bodies were extracted into their own modules
 * (mechanical file split, TODO(arch) in code-blue.ts). Read one back and
 * return only its BODY (from `export const` onward, excluding its own
 * import block — an import can repeat a symbol name that also appears at
 * its real call site, which would corrupt an order-sensitive `indexOf`).
 */
function readHandlerBody(name: string): string {
  const src = read(path.join("server", "routes", "code-blue", "handlers", name));
  return src.slice(src.indexOf("export const"));
}

// Extract only the POST /sessions handler body to scope assertions.
// Phase 4 PR 4.2 expanded this route declaration onto multiple lines to add
// the requireClinicalAuthority middleware chain; the regex tolerates the
// extra whitespace between `router.post(` and `"/sessions"`.
const sessionsPostStart = routes.search(
  /router\.post\(\s*["']\/sessions["']/,
);
const sessionsPostEnd = routes.indexOf("\nrouter.", sessionsPostStart + 1);
const sessionsPostBlock =
  routes.slice(
    sessionsPostStart,
    sessionsPostEnd > sessionsPostStart ? sessionsPostEnd : sessionsPostStart + 4000,
  ) +
  "\n" +
  readHandlerBody("post-sessions.ts");

// Extract only the POST /events handler body
const eventsPostStart = routes.indexOf("router.post(\"/events\"");
const eventsPostEnd = routes.indexOf("\nrouter.", eventsPostStart + 1);
const eventsPostBlock = routes.slice(
  eventsPostStart,
  eventsPostEnd > eventsPostStart ? eventsPostEnd : eventsPostStart + 1000,
);

// Extract only the PATCH /sessions/:id/end handler body.
// Phase 4 PR 4.3 expanded this route declaration onto multiple lines to add
// the requireClinicalAuthority middleware chain; the regex tolerates the
// extra whitespace between `router.patch(` and `"/sessions/:id/end"`.
const endHandlerStart = routes.search(
  /router\.patch\(\s*["']\/sessions\/:id\/end["']/,
);
const endHandlerEnd = routes.indexOf("\nrouter.", endHandlerStart + 1);
const endBlock =
  routes.slice(
    endHandlerStart,
    endHandlerEnd > endHandlerStart ? endHandlerEnd : endHandlerStart + 6000,
  ) +
  "\n" +
  readHandlerBody("patch-sessions-id-end.ts");

// ─────────────────────────────────────────────────────────────────────────────
// Server-authoritative timestamp
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue session creation — server timestamp", () => {
  it("session creation uses new Date() (server-authoritative)", () => {
    expect(sessionsPostBlock).toContain("const startedAt = new Date()");
  });

  it("session creation does NOT use localStartedAt as the timestamp", () => {
    // localStartedAt may still appear in the schema or unused, but it must
    // NOT be the basis for startedAt
    const startedAtAssignment = sessionsPostBlock.match(/const startedAt\s*=\s*[^;]+;/)?.[0] ?? "";
    expect(startedAtAssignment).not.toContain("localStartedAt");
  });

  it("events POST handler has no dead localStartedAt destructuring", () => {
    // After removing localStartedAt usage, no variable destructuring of it should remain
    expect(eventsPostBlock).not.toMatch(/const\s*\{[^}]*localStartedAt[^}]*\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Whitespace earlyStopReason rejection
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue session end — earlyStopReason validation", () => {
  it("earlyStopReason is trimmed before use", () => {
    expect(endBlock).toContain(".trim()");
  });

  it("short/whitespace earlyStopReason is rejected with 400", () => {
    expect(endBlock).toContain("EARLY_STOP_REASON_REQUIRED");
    const errorIdx = endBlock.indexOf("EARLY_STOP_REASON_REQUIRED");
    const surrounding = endBlock.slice(Math.max(0, errorIdx - 200), errorIdx + 50);
    expect(surrounding).toContain("400");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manager active status check
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue session end — manager active status check", () => {
  it("end handler fetches manager status field", () => {
    expect(endBlock).toContain("users.status");
  });

  it("end handler rejects inactive manager with 403 MANAGER_INACTIVE", () => {
    expect(endBlock).toContain("MANAGER_INACTIVE");
    const inactiveIdx = endBlock.indexOf("MANAGER_INACTIVE");
    const surrounding = endBlock.slice(Math.max(0, inactiveIdx - 200), inactiveIdx + 50);
    expect(surrounding).toContain("403");
  });

  it("active status check comes after manager-id ownership check", () => {
    const managerOnlyIdx = endBlock.indexOf("MANAGER_ONLY");
    const managerInactiveIdx = endBlock.indexOf("MANAGER_INACTIVE");
    expect(managerOnlyIdx).toBeGreaterThan(-1);
    expect(managerInactiveIdx).toBeGreaterThan(-1);
    expect(managerOnlyIdx).toBeLessThan(managerInactiveIdx);
  });
});
