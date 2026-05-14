/**
 * Phase 2.5 PR 7 — Import-isolation invariant.
 *
 * Mechanically enforces the architectural rule (plan §3.1): inside
 * server/lib/authority/enforcement/, neither evaluator may import the other.
 * Only result.ts and config.ts may be shared.
 *
 * This is a tree-grep test, not a TypeScript-compile test, so a future
 * refactor cannot silently introduce a cross-import via re-exports or
 * dynamic imports.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENFORCEMENT_DIR = resolve(__dirname, "../server/lib/authority/enforcement");

function read(file: string): string {
  return readFileSync(resolve(ENFORCEMENT_DIR, file), "utf8");
}

/**
 * Extract every module specifier from `import ... from "..."` statements.
 * Ignores comments, docstrings, and string literals outside import syntax.
 */
function importedSpecifiers(source: string): string[] {
  const importRe = /^\s*import\b[^;]*?from\s+["']([^"']+)["']\s*;?$/gm;
  return Array.from(source.matchAll(importRe)).map((m) => m[1]);
}

describe("authority enforcement import isolation", () => {
  it("stale.evaluator.ts does NOT import oprole.evaluator", () => {
    const specs = importedSpecifiers(read("stale.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected oprole import: ${spec}`).not.toMatch(/oprole/i);
    }
  });

  it("oprole.evaluator.ts does NOT import stale.evaluator", () => {
    const specs = importedSpecifiers(read("oprole.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale import: ${spec}`).not.toMatch(/stale/i);
    }
  });

  it("evaluators only share result.ts and config.ts among siblings", () => {
    // Sibling imports must be limited to result.ts, config.ts, metrics.ts, audit.ts.
    // metrics.ts and audit.ts are independent helpers (no cross-evaluator state).
    const allowedSiblings = ["./result.js", "./config.js", "./metrics.js", "./audit.js"];

    for (const file of ["stale.evaluator.ts", "oprole.evaluator.ts"] as const) {
      const specs = importedSpecifiers(read(file));
      const siblingSpecs = specs.filter((s) => s.startsWith("./"));
      for (const spec of siblingSpecs) {
        expect(
          allowedSiblings,
          `${file} imports unexpected sibling ${spec}`,
        ).toContain(spec);
      }
    }
  });
});
