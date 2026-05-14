/**
 * Phase 2A PR 2/3 guard: only the allowlisted route may consume resolveAuthority.
 *
 * resolveAuthority() is additive scaffolding. Phase 2A PR 3 relaxes this guard
 * to allow exactly server/routes/users.ts to import the resolver for the
 * /api/users/me passthrough exposure. No other route may import or reference
 * the resolver in Phase 2A. Phase 2B will introduce broader enforcement.
 *
 * Failure of this test indicates accidental production consumption outside the
 * allowlist. Do not extend the allowlist outside an approved phase plan.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routesDir = path.join(repoRoot, "server", "routes");

/** Routes explicitly approved to consume resolveAuthority in Phase 2A. */
const ALLOWED_ROUTE_FILES: ReadonlySet<string> = new Set([
  path.join(routesDir, "users.ts"),
]);

function listRouteFiles(): string[] {
  return fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .map((f) => path.join(routesDir, f));
}

const allRouteFiles = listRouteFiles();
const guardedRouteFiles = allRouteFiles.filter((f) => !ALLOWED_ROUTE_FILES.has(f));

describe("Phase 2A PR 2/3: only allowlisted routes consume resolveAuthority", () => {
  it("at least one route file exists (sanity)", () => {
    expect(allRouteFiles.length).toBeGreaterThan(0);
  });

  it("every allowlisted route exists on disk", () => {
    for (const f of ALLOWED_ROUTE_FILES) {
      expect(fs.existsSync(f), `allowlisted route missing: ${f}`).toBe(true);
    }
  });

  it.each(guardedRouteFiles)("%s does not import server/lib/authority", (file) => {
    const src = fs.readFileSync(file, "utf8");
    // Match either ESM import or CommonJS-style require referencing the
    // authority module path (but not the existing authority-roles module).
    const importRegex = /from\s+['"][^'"]*lib\/authority(?:\.js|\.ts)?['"]/g;
    const requireRegex =
      /require\(\s*['"][^'"]*lib\/authority(?:\.js|\.ts)?['"]\s*\)/g;
    const matches = [
      ...(src.match(importRegex) ?? []),
      ...(src.match(requireRegex) ?? []),
    ];
    expect(matches, `Unexpected import of lib/authority in ${file}`).toEqual(
      [],
    );
  });

  it.each(guardedRouteFiles)("%s does not reference resolveAuthority symbol", (file) => {
    const src = fs.readFileSync(file, "utf8");
    expect(
      src.includes("resolveAuthority"),
      `Unexpected reference to resolveAuthority in ${file}`,
    ).toBe(false);
  });
});
