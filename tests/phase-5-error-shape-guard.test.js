import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const routesDir = path.join(repoRoot, "server", "routes");
const routeFiles = fs
  .readdirSync(routesDir)
  .filter((name) => name.endsWith(".ts"))
  .sort();

// server/routes/code-blue.ts was split into a thin router plus per-handler
// modules under code-blue/handlers/ (mechanical file split, TODO(arch)
// formerly in code-blue.ts). The scan above is intentionally non-recursive
// and would otherwise silently drop coverage: the actual res.status(...)
// .json(...) response calls this guard is checking now live one directory
// deeper, invisible to a flat readdirSync. Add them explicitly (as
// repo-root-relative paths, matching how `file` is used below) so the
// legacy-error-shape ban keeps applying to the code that actually responds.
const codeBlueHandlersDir = path.join(routesDir, "code-blue", "handlers");
if (fs.existsSync(codeBlueHandlersDir)) {
  for (const f of fs.readdirSync(codeBlueHandlersDir)) {
    if (f.endsWith(".ts")) routeFiles.push(path.join("code-blue", "handlers", f));
  }
}

// Disallow legacy shape like: res.status(...).json({ error: "..." })
// New contract should provide code+reason+message+requestId (plus error for compatibility).
const legacyErrorShape = /res\.status\([^)]+\)\.json\(\{\s*error\s*:/m;

describe("Phase 5 error shape guard", () => {
  for (const file of routeFiles) {
    it(`No legacy error shape in ${file}`, () => {
      const fullPath = path.join(routesDir, file);
      const source = fs.readFileSync(fullPath, "utf8");
      expect(legacyErrorShape.test(source)).toBe(false);
    });
  }

  it("All route files use standardized error contract", () => {
    let offenders = 0;
    for (const file of routeFiles) {
      const fullPath = path.join(routesDir, file);
      const source = fs.readFileSync(fullPath, "utf8");
      if (legacyErrorShape.test(source)) offenders++;
    }
    expect(offenders).toBe(0);
  });
});
