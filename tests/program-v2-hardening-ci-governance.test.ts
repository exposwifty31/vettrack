/**
 * Program v2 hardening close-out — default CI must include critical offline/ops gates.
 *
 * CD-05 (BUG_REGISTER): vitest excludes live-server/DB suites; this test documents which
 * static gates always run under `pnpm test` (same as `.github/workflows/ci.yml`).
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const V2_DEFAULT_CI_GATES = [
  "tests/phase-9-metrics-cardinality.test.ts",
  "tests/offline-phase-7-emergency-surface-parity.test.ts",
  "tests/multi-tenancy-hardening.test.js",
] as const;

function readViteExcludePatterns(): string[] {
  const viteConfig = fs.readFileSync(path.join(repoRoot, "vite.config.ts"), "utf8");
  const excludeBlock = viteConfig.match(/exclude:\s*\[([\s\S]*?)\],/);
  expect(excludeBlock, "vite.config.ts test.exclude block").toBeTruthy();
  const patterns: string[] = [];
  for (const match of excludeBlock![1].matchAll(/"([^"]+)"/g)) {
    patterns.push(match[1]);
  }
  return patterns;
}

describe("Program v2 — default CI gate coverage (static)", () => {
  it("critical v2 gate test files exist on disk", () => {
    for (const rel of V2_DEFAULT_CI_GATES) {
      expect(fs.existsSync(path.join(repoRoot, rel)), rel).toBe(true);
    }
  });

  it("critical v2 gate tests are not excluded from default vitest run", () => {
    const patterns = readViteExcludePatterns();
    for (const rel of V2_DEFAULT_CI_GATES) {
      const excluded = patterns.some((p) => rel.includes(p.replace(/\*\*/g, "")) || p.includes(rel));
      expect(excluded, `${rel} must run under pnpm test`).toBe(false);
    }
  });

  it("pnpm test uses vitest (wired in CI test job)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: { test?: string };
    };
    expect(pkg.scripts?.test).toContain("vitest");
  });
});
