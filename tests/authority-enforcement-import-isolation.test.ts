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
  it("stale.evaluator.ts does NOT import oprole, task-assignment, or stale-task-ownership evaluators", () => {
    const specs = importedSpecifiers(read("stale.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected oprole import: ${spec}`).not.toMatch(/oprole/i);
      expect(spec, `unexpected task-assignment import: ${spec}`).not.toMatch(/task-assignment/i);
      expect(spec, `unexpected stale-task-ownership import: ${spec}`).not.toMatch(/stale-task-ownership/i);
    }
  });

  it("oprole.evaluator.ts does NOT import stale, task-assignment, or stale-task-ownership evaluators", () => {
    const specs = importedSpecifiers(read("oprole.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale import: ${spec}`).not.toMatch(/^.\/stale\.evaluator/);
      expect(spec, `unexpected task-assignment import: ${spec}`).not.toMatch(/task-assignment/i);
      expect(spec, `unexpected stale-task-ownership import: ${spec}`).not.toMatch(/stale-task-ownership/i);
    }
  });

  it("task-assignment.evaluator.ts does NOT import stale, oprole, or stale-task-ownership evaluators", () => {
    const specs = importedSpecifiers(read("task-assignment.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale import: ${spec}`).not.toMatch(/stale\.evaluator/);
      expect(spec, `unexpected oprole import: ${spec}`).not.toMatch(/oprole\.evaluator/);
      expect(spec, `unexpected stale-task-ownership import: ${spec}`).not.toMatch(/stale-task-ownership/i);
    }
  });

  it("stale-task-ownership.evaluator.ts does NOT import stale, oprole, or task-assignment evaluators", () => {
    const specs = importedSpecifiers(read("stale-task-ownership.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale import: ${spec}`).not.toMatch(/^.\/stale\.evaluator/);
      expect(spec, `unexpected oprole import: ${spec}`).not.toMatch(/^.\/oprole\.evaluator/);
      expect(spec, `unexpected task-assignment import: ${spec}`).not.toMatch(/task-assignment\.evaluator/);
    }
  });

  it("evaluators only share approved sibling files", () => {
    // Sibling imports allowed for each evaluator. Stale/oprole share result.ts,
    // config.ts, metrics.ts, audit.ts. Task-assignment and stale-task-ownership
    // each have their OWN dedicated metrics and audit helpers (so their
    // observability cannot starve or be starved by other families).
    const allowedForLegacyEvaluators = [
      "./result.js",
      "./config.js",
      "./metrics.js",
      "./audit.js",
    ];
    const allowedForTaskAssignment = [
      "./result.js",
      "./config.js",
      "./task-assignment.metrics.js",
      "./task-assignment.audit.js",
    ];
    const allowedForStaleTaskOwnership = [
      "./config.js",
      "./stale-task-ownership.types.js",
      "./stale-task-ownership.metrics.js",
      "./stale-task-ownership.audit.js",
    ];

    for (const file of ["stale.evaluator.ts", "oprole.evaluator.ts"] as const) {
      const specs = importedSpecifiers(read(file));
      const siblingSpecs = specs.filter((s) => s.startsWith("./"));
      for (const spec of siblingSpecs) {
        expect(
          allowedForLegacyEvaluators,
          `${file} imports unexpected sibling ${spec}`,
        ).toContain(spec);
      }
    }

    const taSpecs = importedSpecifiers(read("task-assignment.evaluator.ts"));
    const taSiblings = taSpecs.filter((s) => s.startsWith("./"));
    for (const spec of taSiblings) {
      expect(
        allowedForTaskAssignment,
        `task-assignment.evaluator.ts imports unexpected sibling ${spec}`,
      ).toContain(spec);
    }

    const stoSpecs = importedSpecifiers(read("stale-task-ownership.evaluator.ts"));
    const stoSiblings = stoSpecs.filter((s) => s.startsWith("./"));
    for (const spec of stoSiblings) {
      expect(
        allowedForStaleTaskOwnership,
        `stale-task-ownership.evaluator.ts imports unexpected sibling ${spec}`,
      ).toContain(spec);
    }
  });
});
