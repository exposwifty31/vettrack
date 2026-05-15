/**
 * Phase 4 PR 4.1 — Foundation-only invariants.
 *
 * Asserts that PR 4.1 introduces the Code Blue manager evaluator + config
 * resolver + metrics + audit kinds, but does NOT wire any route consumer.
 * Wiring lands in PR 4.2 (initiation), PR 4.3 (end), PR 4.4a (mid-session).
 *
 * If this test fails, either:
 *   (a) a route file has accidentally consumed the evaluator before its
 *       designated PR — revert the wiring, or
 *   (b) the test allowlist needs updating because a wiring PR is being
 *       merged (which should not happen in PR 4.1).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routesDir = path.join(repoRoot, "server", "routes");
const enforcementDir = path.join(
  repoRoot,
  "server",
  "lib",
  "authority",
  "enforcement",
);

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .map((f) => path.join(dir, f));
}

const allRouteFiles = listFiles(routesDir);

// Tokens that, if present in any route file, indicate the Code Blue manager
// evaluator has been wired. PR 4.1 must NOT include any of these in any
// server/routes/** file.
const FORBIDDEN_TOKENS_IN_ROUTES = [
  "evaluateCodeBlueManagerAuthority",
  "computeCodeBlueManagerSnapshotDeny",
  "resolveCodeBlueManagerEnforcementMode",
  "emitCodeBlueManagerShadowDenied",
  "emitCodeBlueManagerDenied",
  "emitCodeBlueManagerFaultOpen",
  "codeBlueManagerMetrics",
  "code-blue-manager.evaluator",
  "code-blue-manager.audit",
  "code-blue-manager.metrics",
  "code-blue-manager.types",
];

describe("PR 4.1 foundation invariant — no route consumer", () => {
  it.each(allRouteFiles)(
    "%s does not reference Code Blue manager evaluator symbols",
    (file) => {
      const src = fs.readFileSync(file, "utf8");
      for (const token of FORBIDDEN_TOKENS_IN_ROUTES) {
        expect(
          src.includes(token),
          `Unexpected reference to '${token}' in ${file} — PR 4.1 is foundation-only`,
        ).toBe(false);
      }
    },
  );
});

describe("PR 4.1 foundation invariant — required files exist", () => {
  const requiredFiles = [
    path.join(enforcementDir, "code-blue-manager.types.ts"),
    path.join(enforcementDir, "code-blue-manager.metrics.ts"),
    path.join(enforcementDir, "code-blue-manager.audit.ts"),
    path.join(enforcementDir, "code-blue-manager.evaluator.ts"),
    path.join(repoRoot, "shared", "code-blue-authority.ts"),
  ];

  it.each(requiredFiles)("%s exists on disk", (f) => {
    expect(fs.existsSync(f), `required PR 4.1 file missing: ${f}`).toBe(true);
  });
});

describe("PR 4.1 foundation invariant — Code Blue manager allowlist content (DECISION-1)", () => {
  // Read the shared constant file directly to avoid an import side-effect.
  const sharedFile = path.join(repoRoot, "shared", "code-blue-authority.ts");
  const src = fs.readFileSync(sharedFile, "utf8");

  it("contains the four locked operational roles", () => {
    expect(src).toContain('"senior_lead"');
    expect(src).toContain('"admission"');
    expect(src).toContain('"ward"');
    expect(src).toContain('"night_senior_no_admission"');
  });

  it("does NOT include night_admission_only (excluded by DECISION-1)", () => {
    // The string may appear in a doc comment explaining the exclusion;
    // it must NOT appear as a quoted constant value.
    const constantMatch = src.match(
      /CODE_BLUE_MANAGER_ALLOWED_OPERATIONAL_ROLES\s*=\s*\[([\s\S]*?)\]/,
    );
    expect(constantMatch, "constant array not found").not.toBeNull();
    const arrayBody = constantMatch?.[1] ?? "";
    expect(arrayBody).not.toContain("night_admission_only");
  });
});
