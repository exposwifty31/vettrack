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

  it("code-blue-manager.evaluator.ts does NOT import stale, oprole, task-assignment, or stale-task-ownership evaluators", () => {
    const specs = importedSpecifiers(read("code-blue-manager.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale import: ${spec}`).not.toMatch(/^.\/stale\.evaluator/);
      expect(spec, `unexpected oprole import: ${spec}`).not.toMatch(/^.\/oprole\.evaluator/);
      expect(spec, `unexpected task-assignment import: ${spec}`).not.toMatch(/task-assignment\.evaluator/);
      expect(spec, `unexpected stale-task-ownership import: ${spec}`).not.toMatch(/stale-task-ownership\.evaluator/);
    }
  });

  // Phase 5 PR 5.1 — clinical-invariant family foundation files. The
  // evaluator lands in PR 5.2; these checks lock the types + config
  // files now so a future PR cannot silently cross the family boundary.
  it("clinical-invariant.types.ts does NOT import any other evaluator family", () => {
    const specs = importedSpecifiers(read("clinical-invariant.types.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale evaluator import: ${spec}`).not.toMatch(/^.\/stale\.evaluator/);
      expect(spec, `unexpected oprole evaluator import: ${spec}`).not.toMatch(/^.\/oprole\.evaluator/);
      expect(spec, `unexpected task-assignment evaluator import: ${spec}`).not.toMatch(/task-assignment\.evaluator/);
      expect(spec, `unexpected stale-task-ownership evaluator import: ${spec}`).not.toMatch(/stale-task-ownership\.evaluator/);
      expect(spec, `unexpected code-blue-manager evaluator import: ${spec}`).not.toMatch(/code-blue-manager\.evaluator/);
      // Phase 5 plan §19.16 — must NOT import the shared `config.ts` either.
      expect(spec, `unexpected shared config import: ${spec}`).not.toMatch(/^.\/config(\.js)?$/);
      // The shared `result.ts` is owned by stale / oprole / task-assignment.
      // Phase 5 family declares its own result-equivalent shape inline.
      expect(spec, `unexpected shared result import: ${spec}`).not.toMatch(/^.\/result(\.js)?$/);
    }
  });

  it("clinical-invariant.config.ts does NOT import any evaluator file or shared config.ts", () => {
    const specs = importedSpecifiers(read("clinical-invariant.config.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale evaluator import: ${spec}`).not.toMatch(/^.\/stale\.evaluator/);
      expect(spec, `unexpected oprole evaluator import: ${spec}`).not.toMatch(/^.\/oprole\.evaluator/);
      expect(spec, `unexpected task-assignment evaluator import: ${spec}`).not.toMatch(/task-assignment\.evaluator/);
      expect(spec, `unexpected stale-task-ownership evaluator import: ${spec}`).not.toMatch(/stale-task-ownership\.evaluator/);
      expect(spec, `unexpected code-blue-manager evaluator import: ${spec}`).not.toMatch(/code-blue-manager\.evaluator/);
      // Phase 5 plan §19.16 — resolver must live in its own file, not
      // bleed into the shared `config.ts` resolver list.
      expect(spec, `unexpected shared config import: ${spec}`).not.toMatch(/^.\/config(\.js)?$/);
      expect(spec, `unexpected shared result import: ${spec}`).not.toMatch(/^.\/result(\.js)?$/);
    }
  });

  // Phase 5 PR 5.2 — evaluator file. Mirrors the per-family lock-down
  // applied to every other evaluator at its introduction PR.
  it("clinical-invariant.evaluator.ts does NOT import any other evaluator family", () => {
    const specs = importedSpecifiers(read("clinical-invariant.evaluator.ts"));
    for (const spec of specs) {
      expect(spec, `unexpected stale evaluator import: ${spec}`).not.toMatch(/^.\/stale\.evaluator/);
      expect(spec, `unexpected oprole evaluator import: ${spec}`).not.toMatch(/^.\/oprole\.evaluator/);
      expect(spec, `unexpected task-assignment evaluator import: ${spec}`).not.toMatch(/task-assignment\.evaluator/);
      expect(spec, `unexpected stale-task-ownership evaluator import: ${spec}`).not.toMatch(/stale-task-ownership\.evaluator/);
      expect(spec, `unexpected code-blue-manager evaluator import: ${spec}`).not.toMatch(/code-blue-manager\.evaluator/);
      // Phase 5 plan §19.16 — clinical-invariant family does NOT use
      // the shared enforcement `config.ts` or `result.ts` siblings.
      expect(spec, `unexpected shared config import: ${spec}`).not.toMatch(/^.\/config(\.js)?$/);
      expect(spec, `unexpected shared result import: ${spec}`).not.toMatch(/^.\/result(\.js)?$/);
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
    const allowedForCodeBlueManager = [
      "./config.js",
      "./code-blue-manager.types.js",
      "./code-blue-manager.metrics.js",
      "./code-blue-manager.audit.js",
    ];
    // Phase 5 PR 5.1 — clinical-invariant family. The evaluator lands
    // in PR 5.2; PR 5.1 ships types + config only. The config file may
    // only import its own types sibling (no shared `config.js` /
    // `result.js`, no other family's siblings). The types file ships
    // with zero local-sibling imports.
    const allowedSiblingsForClinicalInvariantConfig = ["./clinical-invariant.types.js"];
    const allowedSiblingsForClinicalInvariantTypes: string[] = [];
    // Phase 5 PR 5.2 + PR 5.5 — clinical-invariant evaluator sibling
    // allowlist. The evaluator imports ONLY its own config + types +
    // metrics siblings. The audit sibling
    // (`clinical-invariant.audit.ts`) lives at the family but is
    // imported by the WIRING LAYER (dispense.service.ts +
    // containers.ts), NOT the evaluator: PR 5.5 moved emission to
    // post-commit at the wiring layer so a tx rollback can never
    // persist a false-positive observability row (Codex P2 review).
    //
    // KEEPING the audit sibling out of this allowlist is intentional
    // — it acts as a mechanical guard against a future PR
    // re-introducing audit emission inside the evaluator (where
    // it would run inside the tx and re-create the false-positive
    // class of bugs PR 5.5 fixed).
    const allowedSiblingsForClinicalInvariantEvaluator = [
      "./clinical-invariant.config.js",
      "./clinical-invariant.types.js",
      "./clinical-invariant.metrics.js",
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

    const cbmSpecs = importedSpecifiers(read("code-blue-manager.evaluator.ts"));
    const cbmSiblings = cbmSpecs.filter((s) => s.startsWith("./"));
    for (const spec of cbmSiblings) {
      expect(
        allowedForCodeBlueManager,
        `code-blue-manager.evaluator.ts imports unexpected sibling ${spec}`,
      ).toContain(spec);
    }

    // Phase 5 PR 5.1 — clinical-invariant family sibling allowlist.
    const ciCfgSpecs = importedSpecifiers(read("clinical-invariant.config.ts"));
    const ciCfgSiblings = ciCfgSpecs.filter((s) => s.startsWith("./"));
    for (const spec of ciCfgSiblings) {
      expect(
        allowedSiblingsForClinicalInvariantConfig,
        `clinical-invariant.config.ts imports unexpected sibling ${spec}`,
      ).toContain(spec);
    }

    const ciTypesSpecs = importedSpecifiers(read("clinical-invariant.types.ts"));
    const ciTypesSiblings = ciTypesSpecs.filter((s) => s.startsWith("./"));
    for (const spec of ciTypesSiblings) {
      expect(
        allowedSiblingsForClinicalInvariantTypes,
        `clinical-invariant.types.ts imports unexpected sibling ${spec}`,
      ).toContain(spec);
    }

    const ciEvalSpecs = importedSpecifiers(read("clinical-invariant.evaluator.ts"));
    const ciEvalSiblings = ciEvalSpecs.filter((s) => s.startsWith("./"));
    for (const spec of ciEvalSiblings) {
      expect(
        allowedSiblingsForClinicalInvariantEvaluator,
        `clinical-invariant.evaluator.ts imports unexpected sibling ${spec}`,
      ).toContain(spec);
    }
  });
});
