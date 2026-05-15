/**
 * Phase 4 PR 4.1 — Foundation invariants (post-PR-4.2 scope).
 *
 * PR 4.1 introduced the Code Blue manager evaluator + config resolver +
 * metrics + audit kinds as foundation only. PR 4.2 introduced exactly one
 * sanctioned consumer: `server/routes/code-blue.ts` (initiation). This test
 * locks the allowlist: no other route file may consume the evaluator until
 * its own designated wiring PR (PR 4.3 covers `code-blue.ts` for end —
 * already allowed by this file; PR 4.4a covers it for log mid-session —
 * already allowed).
 *
 * If this test fails for a route file OTHER than `code-blue.ts`, a wiring
 * PR has expanded its scope outside the master plan boundaries.
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
// evaluator has been wired into that route. After PR 4.2, exactly one route
// file is allowed to reference these symbols: `code-blue.ts`. Any other
// route file referencing them is a scope violation.
const FORBIDDEN_TOKENS_IN_ROUTES = [
  "evaluateCodeBlueManagerAuthority",
  "computeCodeBlueManagerSnapshotDeny",
  "resolveCodeBlueManagerEnforcementMode",
  "emitCodeBlueManagerShadowDenied",
  "emitCodeBlueManagerDenied",
  "emitCodeBlueManagerFaultOpen",
  "codeBlueManagerMetrics",
  "evaluateCodeBlueManagerForRoute",
  "loadCodeBlueManagerLookup",
  "code-blue-manager.evaluator",
  "code-blue-manager.audit",
  "code-blue-manager.metrics",
  "code-blue-manager.types",
  "code-blue-manager.wiring",
];

// PR 4.2 sanctions `code-blue.ts` as the sole route consumer. Future Phase 4
// PRs (4.3 end-wiring, 4.4a log-wiring) operate inside this same file.
const ALLOWED_ROUTE_FILES: ReadonlySet<string> = new Set([
  path.join(routesDir, "code-blue.ts"),
]);

const guardedRouteFiles = allRouteFiles.filter(
  (f) => !ALLOWED_ROUTE_FILES.has(f),
);

describe("PR 4.1 foundation invariant — only allowlisted routes reference the evaluator", () => {
  it.each(guardedRouteFiles)(
    "%s does not reference Code Blue manager evaluator symbols",
    (file) => {
      const src = fs.readFileSync(file, "utf8");
      for (const token of FORBIDDEN_TOKENS_IN_ROUTES) {
        expect(
          src.includes(token),
          `Unexpected reference to '${token}' in ${file} — only code-blue.ts is sanctioned`,
        ).toBe(false);
      }
    },
  );

  it("every allowlisted route exists on disk", () => {
    for (const f of ALLOWED_ROUTE_FILES) {
      expect(fs.existsSync(f), `allowlisted route missing: ${f}`).toBe(true);
    }
  });
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
