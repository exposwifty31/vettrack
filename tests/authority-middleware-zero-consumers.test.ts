/**
 * Phase 2C PR 1 guard: requireClinicalAuthority consumers are tightly bounded.
 *
 * After Phase 2B.2 wired the middleware into the three dispense endpoints,
 * Phase 2C PR 1 extended consumption to one additional endpoint:
 * POST /api/containers/:id/dispense in server/routes/containers.ts.
 *
 * Phase 4 PR 4.2 extends consumption to POST /api/code-blue/sessions in
 * server/routes/code-blue.ts (initiator clinical gate per master plan §15).
 * Future Phase 4 PRs (4.3, 4.4a, 4.6) will add more endpoints in the same
 * route file. No other route file is permitted to import or call
 * requireClinicalAuthority. This test enforces that scope via grep-style
 * assertions on the working tree.
 */

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const MIDDLEWARE_FILE = "server/middleware/authority.ts";
const DISPENSE_ROUTE_FILE = "server/routes/dispense.ts";
const CONTAINERS_ROUTE_FILE = "server/routes/containers.ts";
const CODE_BLUE_ROUTE_FILE = "server/routes/code-blue.ts";
const MIDDLEWARE_TEST_FILE = "tests/require-clinical-authority.test.ts";
const GUARD_TEST_FILE = "tests/authority-middleware-zero-consumers.test.ts";
const ENFORCEMENT_TEST_FILE = "tests/dispense-authority-enforcement.test.ts";
const CONTAINERS_AUTHORITY_TEST_FILE =
  "tests/containers-dispense-authority.test.ts";
const OBSERVABILITY_TEST_FILE =
  "tests/authority-middleware-observability.test.ts";
const CODE_BLUE_PR_4_2_ROUTE_WIRING_TEST_FILE =
  "tests/code-blue-pr-4-2-route-wiring.test.ts";
const CODE_BLUE_PR_4_3_END_WIRING_TEST_FILE =
  "tests/code-blue-pr-4-3-end-wiring.test.ts";
const CODE_BLUE_PR_4_4A_LOGS_TEST_FILE =
  "tests/code-blue-pr-4-4a-logs-clinical-gate.test.ts";

// Files that may contain the literal `requireClinicalAuthority(` call-site
// token. Test files appear here when they contain the literal substring
// `requireClinicalAuthority(` (e.g., a `.not.toContain(...)` assertion);
// test files that only mention the bare identifier `requireClinicalAuthority`
// (no paren) are NOT included.
const ALLOWED_FILES: ReadonlySet<string> = new Set([
  MIDDLEWARE_FILE,
  DISPENSE_ROUTE_FILE,
  CONTAINERS_ROUTE_FILE,
  CODE_BLUE_ROUTE_FILE,
  MIDDLEWARE_TEST_FILE,
  GUARD_TEST_FILE,
  ENFORCEMENT_TEST_FILE,
  CONTAINERS_AUTHORITY_TEST_FILE,
  OBSERVABILITY_TEST_FILE,
  CODE_BLUE_PR_4_3_END_WIRING_TEST_FILE,
  // CODE_BLUE_PR_4_4A_LOGS_TEST_FILE: only mentions bare identifier (no
  // paren), so the grep token `requireClinicalAuthority(` does not match it.
  // Kept allowlisted for the legacy-fallback string check below.
]);

// Files allowed to mention the transitional dispense-only flag. Code Blue
// route source files intentionally do NOT use this flag (master plan forbids
// it for Code Blue); they use `allowSystemAdmin: false` instead. The PR 4.2
// route-wiring test mentions the string in a NEGATIVE assertion (asserting
// the Code Blue route does NOT contain it) and is allowlisted for that.
const ALLOWED_LEGACY_FALLBACK_FILES: ReadonlySet<string> = new Set([
  MIDDLEWARE_FILE,
  DISPENSE_ROUTE_FILE,
  CONTAINERS_ROUTE_FILE,
  MIDDLEWARE_TEST_FILE,
  GUARD_TEST_FILE,
  ENFORCEMENT_TEST_FILE,
  CONTAINERS_AUTHORITY_TEST_FILE,
  OBSERVABILITY_TEST_FILE,
  CODE_BLUE_PR_4_2_ROUTE_WIRING_TEST_FILE,
  CODE_BLUE_PR_4_3_END_WIRING_TEST_FILE,
  CODE_BLUE_PR_4_4A_LOGS_TEST_FILE,
]);

const ALLOWED_ROUTE_FILES: ReadonlySet<string> = new Set([
  DISPENSE_ROUTE_FILE,
  CONTAINERS_ROUTE_FILE,
  CODE_BLUE_ROUTE_FILE,
]);

function gitGrepLines(args: string): string[] {
  try {
    // --untracked so newly-added files in this PR are searched too.
    const out = execSync(`git grep --untracked ${args}`, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch (err: unknown) {
    // git grep exits 1 when no matches found
    const status = (err as { status?: number }).status;
    if (status === 1) return [];
    throw err;
  }
}

/**
 * Filter a list of "path:lineno:content" grep hits to drop matches that occur
 * inside a single-line `//` comment. This lets us assert "no real consumer in
 * server/routes/" without flagging legitimate forward-reference TODO comments
 * such as "TODO(Phase 2B): replace with requireClinicalAuthority(...)".
 */
function withoutCommentMatches(lines: string[]): string[] {
  return lines.filter((line) => {
    const firstColon = line.indexOf(":");
    const secondColon =
      firstColon === -1 ? -1 : line.indexOf(":", firstColon + 1);
    const content =
      secondColon === -1 ? line : line.slice(secondColon + 1).trimStart();
    return !content.startsWith("//") && !content.startsWith("*");
  });
}

describe("Phase 2C PR 1: requireClinicalAuthority is consumed only by dispense.ts and containers.ts", () => {
  it("middleware file exists at the expected path", () => {
    const lines = gitGrepLines(`-l "Phase 2B" -- ${MIDDLEWARE_FILE}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("exactly the allowed route files import ../middleware/authority.js (dispense.ts, containers.ts, code-blue.ts)", () => {
    const lines = gitGrepLines(
      `-lE "from .*middleware/authority" -- server/routes/`,
    );
    const files = new Set(lines);
    expect(files).toEqual(ALLOWED_ROUTE_FILES);
  });

  it("no non-route file outside server/middleware/authority.ts imports the middleware module", () => {
    const lines = gitGrepLines(
      `-nE "from .*middleware/authority" -- src/`,
    );
    expect(lines, lines.join("\n")).toEqual([]);
  });

  it("requireClinicalAuthority( call-site token appears as real code in exactly the allowed files", () => {
    // Use -nE to get line-level hits so we can filter out comment-only
    // references.
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/ tests/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(ALLOWED_FILES);
  });

  it("requireClinicalAuthority( appears exactly 3 times in server/routes/dispense.ts", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- ${DISPENSE_ROUTE_FILE}`),
    );
    expect(hits.length).toBe(3);
  });

  it("requireClinicalAuthority( appears exactly 1 time in server/routes/containers.ts", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(
        `-nE "requireClinicalAuthority\\(" -- ${CONTAINERS_ROUTE_FILE}`,
      ),
    );
    expect(hits.length).toBe(1);
  });

  it("no other route file under server/routes/ contains requireClinicalAuthority(", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/routes/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(ALLOWED_ROUTE_FILES);
  });

  it("no real (non-comment) requireClinicalAuthority( call-site under server/ except authority.ts, dispense.ts, containers.ts, and code-blue.ts", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(
      new Set([
        MIDDLEWARE_FILE,
        DISPENSE_ROUTE_FILE,
        CONTAINERS_ROUTE_FILE,
        CODE_BLUE_ROUTE_FILE,
      ]),
    );
  });

  it("allowPermanentClinicalRoleFallbackForLegacyDispense appears only in dispense-scoped files (Code Blue routes excluded)", () => {
    const lines = gitGrepLines(
      `-lE "allowPermanentClinicalRoleFallbackForLegacyDispense" -- server/ tests/`,
    );
    const files = new Set(lines);
    expect(files).toEqual(ALLOWED_LEGACY_FALLBACK_FILES);
  });

  it("allowPermanentClinicalRoleFallbackForLegacyDispense appears exactly 3 times in server/routes/dispense.ts", () => {
    const hits = gitGrepLines(
      `-nE "allowPermanentClinicalRoleFallbackForLegacyDispense" -- ${DISPENSE_ROUTE_FILE}`,
    );
    expect(hits.length).toBe(3);
  });

  it("allowPermanentClinicalRoleFallbackForLegacyDispense appears exactly 1 time in server/routes/containers.ts", () => {
    const hits = gitGrepLines(
      `-nE "allowPermanentClinicalRoleFallbackForLegacyDispense" -- ${CONTAINERS_ROUTE_FILE}`,
    );
    expect(hits.length).toBe(1);
  });

  it("server/middleware/authority.ts never reads req.authUser.secondaryRole", () => {
    // Phase 2B contract: middleware MUST NOT read req.authUser.secondaryRole.
    // The literal token "secondaryRole" is permitted in the mandated header
    // comment and in the `secondaryRole: null` payload passed to
    // resolveAuthority (where it explicitly nulls the field for redundancy).
    // What is forbidden is any access expression off req.authUser.
    const lines = gitGrepLines(
      `-nE "authUser\\.secondaryRole" -- ${MIDDLEWARE_FILE}`,
    );
    expect(lines, lines.join("\n")).toEqual([]);
  });
});
