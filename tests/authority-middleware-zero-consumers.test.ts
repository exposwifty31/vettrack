/**
 * Guard: requireClinicalAuthority consumers are tightly bounded (server-side).
 *
 * History: the middleware was originally wired into the three dispense endpoints
 * (dispense.ts) and POST /api/containers/:id/dispense (containers.ts). T26
 * reclassified inventory dispense as NON-clinical consumables work, so BOTH of
 * those inventory route files shed the clinical gate — they now use the
 * student-floor role gate `requireEffectiveRole("student")`. The middleware is
 * unchanged and STILL gates the Code Blue clinical surfaces in code-blue.ts.
 *
 * The invariant this guard now protects:
 *   - `requireClinicalAuthority` is imported/called by exactly ONE route file:
 *     server/routes/code-blue.ts (plus its definition in middleware/authority.ts).
 *   - dispense.ts and containers.ts contain NO clinical-authority call (T26 regression).
 *   - No src/ file imports the middleware.
 *   - The transitional legacy-dispense fallback flag is gone from server/routes/.
 *   - The middleware never reads req.authUser.secondaryRole.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const MIDDLEWARE_FILE = "server/middleware/authority.ts";
const DISPENSE_ROUTE_FILE = "server/routes/dispense.ts";
const CONTAINERS_ROUTE_FILE = "server/routes/containers.ts";
const CODE_BLUE_ROUTE_FILE = "server/routes/code-blue.ts";

// After T26, the only route file that imports/uses requireClinicalAuthority is
// code-blue.ts. dispense.ts and containers.ts are non-clinical consumables paths.
const ALLOWED_ROUTE_FILES: ReadonlySet<string> = new Set([CODE_BLUE_ROUTE_FILE]);

/**
 * Collect all regular files under `root` (recursively), filtering to those
 * whose path (relative to repoRoot) starts with one of the given `targets`
 * (each target may be a file path or a directory prefix).
 */
function collectFiles(root: string, targets: string[]): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // skip node_modules and hidden dirs
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(abs);
      } else if (entry.isFile()) {
        const rel = path.relative(root, abs);
        const matches = targets.some((t) => {
          // t ends with "/" → directory prefix; otherwise exact file match
          if (t.endsWith("/")) return rel.startsWith(t) || rel.startsWith(t.slice(0, -1) + path.sep);
          return rel === t || rel.replace(/\\/g, "/") === t;
        });
        if (matches) results.push(rel);
      }
    }
  }
  walk(root);
  return results;
}

/**
 * Drop-in replacement for `git grep` using native Node.js filesystem access.
 * Supports a strict subset of git-grep flags used in this file:
 *   -l  → list matching files only (one path per line)
 *   -n  → include line numbers (output: "rel/path:linenum:content")
 *   -E  → pattern is an extended regex (always treated as RegExp here)
 *   --  → separator before path specs
 *
 * Path specs after `--` may be files or directory prefixes (ending with `/`).
 */
function gitGrepLines(args: string): string[] {
  // Parse flags
  const listOnly = /(?:^|\s)-[a-zA-Z]*l/.test(args);
  const withLineNums = /(?:^|\s)-[a-zA-Z]*n/.test(args);

  // Extract pattern — first quoted token or the first unquoted word after flags
  const patternMatch = args.match(/["']([^"']+)["']/);
  if (!patternMatch) return [];
  const patternStr = patternMatch[1]!;
  const pattern = new RegExp(patternStr);

  // Extract paths after `--`
  const afterDash = args.slice(args.indexOf("--") + 2).trim();
  const targets = afterDash.split(/\s+/).filter(Boolean).map((t) => {
    // Normalise: remove leading ./ and ensure dirs end with /
    const s = t.replace(/^\.\//, "");
    if (!s.includes(".") || s.endsWith("/")) {
      return s.endsWith("/") ? s : s + "/";
    }
    return s;
  });

  const files = collectFiles(repoRoot, targets);
  const matchingFiles = new Set<string>();
  const lineHits: string[] = [];

  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    let fileMatched = false;
    lines.forEach((line, idx) => {
      if (pattern.test(line)) {
        fileMatched = true;
        if (withLineNums) {
          lineHits.push(`${rel.replace(/\\/g, "/")}:${idx + 1}:${line}`);
        }
      }
    });
    if (fileMatched) matchingFiles.add(rel.replace(/\\/g, "/"));
  }

  if (listOnly) return [...matchingFiles];
  if (withLineNums) return lineHits;
  return [...matchingFiles];
}

/**
 * Filter a list of "path:lineno:content" grep hits to drop matches that occur
 * inside a single-line `//` comment. This lets us assert "no real consumer in
 * server/routes/" without flagging legitimate forward-reference comments.
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

describe("requireClinicalAuthority is consumed only by code-blue.ts (T26)", () => {
  it("middleware file exists at the expected path", () => {
    const lines = gitGrepLines(`-l "Phase 2B" -- ${MIDDLEWARE_FILE}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("exactly code-blue.ts imports ../middleware/authority.js under server/routes/", () => {
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

  it("requireClinicalAuthority( call-site (non-comment) under server/ appears only in authority.ts and code-blue.ts", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- server/`),
    );
    const files = new Set(hits.map((h) => h.split(":")[0]!));
    expect(files).toEqual(new Set([MIDDLEWARE_FILE, CODE_BLUE_ROUTE_FILE]));
  });

  it("code-blue.ts still uses requireClinicalAuthority( (Code Blue clinical gate intact)", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- ${CODE_BLUE_ROUTE_FILE}`),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("dispense.ts contains NO requireClinicalAuthority( (reclassified non-clinical, T26)", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(`-nE "requireClinicalAuthority\\(" -- ${DISPENSE_ROUTE_FILE}`),
    );
    expect(hits.length).toBe(0);
  });

  it("containers.ts contains NO requireClinicalAuthority( (reclassified non-clinical, T26)", () => {
    const hits = withoutCommentMatches(
      gitGrepLines(
        `-nE "requireClinicalAuthority\\(" -- ${CONTAINERS_ROUTE_FILE}`,
      ),
    );
    expect(hits.length).toBe(0);
  });

  it("the legacy dispense fallback flag no longer appears under server/routes/", () => {
    const lines = gitGrepLines(
      `-lE "allowPermanentClinicalRoleFallbackForLegacyDispense" -- server/routes/`,
    );
    expect(lines, lines.join("\n")).toEqual([]);
  });

  it("server/middleware/authority.ts never reads req.authUser.secondaryRole", () => {
    // Phase 2B contract: middleware MUST NOT read req.authUser.secondaryRole.
    const lines = gitGrepLines(
      `-nE "authUser\\.secondaryRole" -- ${MIDDLEWARE_FILE}`,
    );
    expect(lines, lines.join("\n")).toEqual([]);
  });
});
