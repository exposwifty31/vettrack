/**
 * Phase 2B.2 guard: requireClinicalAuthority is consumed only by
 * server/routes/dispense.ts.
 *
 * After Phase 2B.2 wires the middleware into the three dispense endpoints,
 * dispense.ts is the only route file allowed to import or call
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
const MIDDLEWARE_TEST_FILE = "tests/require-clinical-authority.test.ts";
const GUARD_TEST_FILE = "tests/authority-middleware-zero-consumers.test.ts";
const ENFORCEMENT_TEST_FILE = "tests/dispense-authority-enforcement.test.ts";

const ALLOWED_FILES: ReadonlySet<string> = new Set([
  MIDDLEWARE_FILE,
  DISPENSE_ROUTE_FILE,
  MIDDLEWARE_TEST_FILE,
  GUARD_TEST_FILE,
  ENFORCEMENT_TEST_FILE,
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

describe("Phase 2B.2: requireClinicalAuthority is consumed only by dispense.ts", () => {
  it("middleware file exists at the expected path", () => {
    const lines = gitGrepLines(`-l "Phase 2B" -- ${MIDDLEWARE_FILE}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("exactly one route imports ../middleware/authority.js and it is server/routes/dispense.ts", () => {
    const lines = gitGrepLines(
      `-lE "from .*middleware/authority" -- server/routes/`,
    );
    expect(lines).toEqual([DISPENSE_ROUTE_FILE]);
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

  it("no other route file under server/routes/ contains requireClinicalAuthority(", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/routes/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(new Set([DISPENSE_ROUTE_FILE]));
  });

  it("no real (non-comment) requireClinicalAuthority( call-site under server/ except authority.ts and dispense.ts", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(new Set([MIDDLEWARE_FILE, DISPENSE_ROUTE_FILE]));
  });

  it("allowPermanentClinicalRoleFallbackForLegacyDispense appears only in allowed files", () => {
    const lines = gitGrepLines(
      `-lE "allowPermanentClinicalRoleFallbackForLegacyDispense" -- server/ tests/`,
    );
    const files = new Set(lines);
    expect(files).toEqual(ALLOWED_FILES);
  });

  it("allowPermanentClinicalRoleFallbackForLegacyDispense appears exactly 3 times in server/routes/dispense.ts", () => {
    const hits = gitGrepLines(
      `-nE "allowPermanentClinicalRoleFallbackForLegacyDispense" -- ${DISPENSE_ROUTE_FILE}`,
    );
    expect(hits.length).toBe(3);
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
