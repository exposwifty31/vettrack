/**
 * Contract and regression tests for the Code Blue History endpoint alignment (PR 1.1).
 *
 * Verifies:
 * - Backend route is defined at the expected path
 * - Frontend history page uses the typed api.codeBlue.history() wrapper
 * - No stale hardcoded authFetch path remains in the history page
 * - api.ts registers history() pointing to the correct endpoint
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

const backendRoutes = read("server/routes/code-blue.ts");
const apiTs = read("src/lib/api.ts");
const historyPage = read("src/pages/code-blue-history.tsx");

// ─── Backend contract ─────────────────────────────────────────────────────────

describe("Code Blue History — backend route contract", () => {
  it("GET /history route is registered in the code-blue router", () => {
    expect(backendRoutes).toMatch(/router\.get\(["']\/history["']/);
  });

  it("history route is admin-only (requireAdmin middleware present)", () => {
    const historyRouteBlock = backendRoutes.slice(
      backendRoutes.indexOf('"/history"'),
    );
    expect(historyRouteBlock.slice(0, 200)).toContain("requireAdmin");
  });

  it("history route filters by status='ended'", () => {
    expect(backendRoutes).toContain('"ended"');
  });

  it("history route returns sessions ordered by startedAt DESC", () => {
    expect(backendRoutes).toContain("startedAt");
    expect(backendRoutes).toContain("desc");
  });
});

// ─── API contract layer ───────────────────────────────────────────────────────

describe("Code Blue History — api.ts typed wrapper", () => {
  it("api.codeBlue.history() is defined in api.ts", () => {
    expect(apiTs).toContain("history:");
    expect(apiTs).toContain("/api/code-blue/history");
  });

  it("history() wrapper targets the correct endpoint path", () => {
    // Must reference the exact backend path
    expect(apiTs).toMatch(/["']\/api\/code-blue\/history["']/);
  });
});

// ─── Frontend contract ────────────────────────────────────────────────────────

describe("Code Blue History — frontend page alignment", () => {
  it("history page uses api.codeBlue.history() typed wrapper", () => {
    expect(historyPage).toContain("api.codeBlue.history()");
  });

  it("history page does NOT hardcode authFetch for the history endpoint", () => {
    // authFetch may still be imported by other pages but must not be used
    // here with the history URL
    expect(historyPage).not.toContain('authFetch("/api/code-blue/history")');
  });

  it("history page query key matches the backend endpoint path", () => {
    expect(historyPage).toContain('"/api/code-blue/history"');
  });

  it("history page is admin-gated", () => {
    expect(historyPage).toContain('resolvedRole === "admin"');
  });
});

// ─── Regression: old raw-fetch pattern removed ────────────────────────────────

describe("Code Blue History — regression: stale path check", () => {
  it("no raw fetch to /api/code-blue/history remains in history page", () => {
    // The stale pattern was: authFetch("/api/code-blue/history") directly in queryFn
    expect(historyPage).not.toMatch(/authFetch\s*\(\s*["']\/api\/code-blue\/history["']/);
  });
});
