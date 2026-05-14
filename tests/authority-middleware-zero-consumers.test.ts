/**
 * Phase 2B.1 guard: requireClinicalAuthority has ZERO route consumers.
 *
 * The Phase 2B.1 PR introduces server/middleware/authority.ts but is
 * intentionally infrastructure-only — no route may import, reference, or
 * register requireClinicalAuthority. This test enforces that scope via
 * grep-style assertions on the working tree.
 */

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const MIDDLEWARE_FILE = "server/middleware/authority.ts";
const MIDDLEWARE_TEST_FILE = "tests/require-clinical-authority.test.ts";
const GUARD_TEST_FILE = "tests/authority-middleware-zero-consumers.test.ts";

const ALLOWED_FILES: ReadonlySet<string> = new Set([
  MIDDLEWARE_FILE,
  MIDDLEWARE_TEST_FILE,
  GUARD_TEST_FILE,
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

describe("Phase 2B.1: requireClinicalAuthority has zero route consumers", () => {
  it("middleware file exists at the expected path", () => {
    const lines = gitGrepLines(`-l "Phase 2B" -- ${MIDDLEWARE_FILE}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("no file outside server/middleware/authority.ts imports the middleware module", () => {
    const lines = gitGrepLines(
      `-nE "from .*middleware/authority" -- server/ src/`,
    );
    expect(lines, lines.join("\n")).toEqual([]);
  });

  it("requireClinicalAuthority( call-site token appears as real code in exactly the allowed files", () => {
    // Use -nE to get line-level hits so we can filter out comment-only
    // references (forward TODOs in legacy routes are not consumers).
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/ tests/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(ALLOWED_FILES);
  });

  it("no real (non-comment) requireClinicalAuthority( call-site under server/routes/", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/routes/`),
    );
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("no real (non-comment) requireClinicalAuthority( call-site under server/ except authority.ts", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(new Set([MIDDLEWARE_FILE]));
  });

  it("allowPermanentClinicalRoleFallbackForLegacyDispense appears only in allowed files", () => {
    const lines = gitGrepLines(
      `-lE "allowPermanentClinicalRoleFallbackForLegacyDispense" -- server/ tests/`,
    );
    const files = new Set(lines);
    expect(files).toEqual(ALLOWED_FILES);
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
