/**
 * Phase 2A PR 2 guard: no server route may consume the new authority resolver.
 *
 * resolveAuthority() is additive scaffolding only — Phase 2A must not wire it
 * into any route handler. Phase 2A PR 3 will relax this guard to allow exactly
 * server/routes/users.ts to import the resolver for the /api/users/me
 * passthrough exposure.
 *
 * Failure of this test indicates accidental production consumption. Do not
 * relax the guard outside of Phase 2A PR 3.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routesDir = path.join(repoRoot, "server", "routes");

function listRouteFiles(): string[] {
  return fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .map((f) => path.join(routesDir, f));
}

describe("Phase 2A PR 2: no route consumes resolveAuthority", () => {
  const routeFiles = listRouteFiles();

  it("at least one route file exists (sanity)", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)("%s does not import server/lib/authority", (file) => {
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

  it.each(routeFiles)("%s does not reference resolveAuthority symbol", (file) => {
    const src = fs.readFileSync(file, "utf8");
    expect(
      src.includes("resolveAuthority"),
      `Unexpected reference to resolveAuthority in ${file}`,
    ).toBe(false);
  });
});
