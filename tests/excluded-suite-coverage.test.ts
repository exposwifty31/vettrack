/**
 * Every suite `pnpm test` excludes must be run by something, and that something
 * must be invoked by a workflow.
 *
 * WHY THIS EXISTS
 * `vite.config.ts` excludes DB-backed suites from the default run — correct, they
 * need a database. The failure is what happens next: a suite leaves the default
 * run and no runner picks it up, so it is not skipped loudly, it is simply never
 * executed again. Measured 2026-09-01: of the 33 excluded entries, **21 were run
 * by nothing at all** — including `docking-route`, `room-readiness`,
 * `equipment-anchor.service` and the whole `shift-handover` family. Two of them
 * had been dead since migrations 065 and 125 and nobody could know, because
 * nothing ran them.
 *
 * TWO ASSERTIONS, and the second is the one with teeth:
 *
 *  1. Every excluded entry is named by some runner (a vitest config's `include`,
 *     the live-server floors file, or the tsx-script runner's list).
 *  2. Every runner naming those files is invoked by `.github/workflows/ci.yml`.
 *
 * Assertion 1 alone is the bug this file was written about. `pnpm
 * test:db-integration` and its config existed the whole time — the config's
 * `include` just never grew, and no workflow called the script. A runner nothing
 * invokes is indistinguishable from no runner.
 *
 * COMMENTS ARE NOT INVOCATIONS. `ci.yml` mentions `pnpm test:db-integration`
 * inside a comment explaining why two suites are invoked by filename instead.
 * Counting that would have made assertion 2 pass while the job did not exist —
 * the same "a registration inside a comment counts as reached" defect the route
 * manifest generator was fixed for. Comments are stripped before matching.
 *
 * WAIVERS state a reason and are asserted to be live: a waiver whose file is no
 * longer excluded fails, so it cannot outlive what it excuses.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readSuites } from "../scripts/ci/db-script-tests.mjs";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** Deliberate non-coverage. Each entry must name a reason a reader can audit. */
const WAIVERS: Record<string, string> = {
  "tests/tenant-pooling-isolation.integration.test.ts":
    "Runs real DDL (CREATE TABLE + FORCE ROW LEVEL SECURITY + CREATE POLICY) against " +
    "whatever DATABASE_URL is exported. Deliberately invoked by hand via " +
    "`pnpm test:rls-pooling`, never by CI, so a shared runner cannot point it at a " +
    "database it should not reshape.",
};

/**
 * Only quoted strings that look like test paths. A bare regex over the block
 * also matches prose inside the comments that explain it — the first draft of
 * this file collected `unset the env` as a filename.
 */
function stringLiterals(block: string): string[] {
  return [...block.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith("tests/") || s.startsWith("**/"));
}

function arrayBlock(source: string, key: string): string {
  const at = source.indexOf(`${key}:`);
  if (at === -1) throw new Error(`no \`${key}:\` in source`);
  const open = source.indexOf("[", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unterminated \`${key}\` array`);
}

function expandGlob(entry: string): string[] {
  if (!entry.includes("*")) return [entry];
  const dir = entry.replace(/\/\*+$/, "");
  if (!existsSync(path.join(ROOT, dir))) return [];
  const walk = (rel: string): string[] =>
    readdirSync(path.join(ROOT, rel)).flatMap((name) => {
      const child = `${rel}/${name}`;
      return statSync(path.join(ROOT, child)).isDirectory() ? walk(child) : [child];
    });
  return walk(dir).filter((f) => /\.(test|integration\.test)\.(ts|tsx|js)$/.test(f));
}

/**
 * `suites` from a keyed manifest, shape-checked. Unchecked, a missing key gives
 * `Object.keys(undefined)` — a TypeError naming no file, from a test whose whole
 * job is to say precisely which runner is wrong (review finding on #281).
 */
function suitesObject(relPath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(read(relPath));
  } catch (cause) {
    throw new Error(`${relPath}: not valid JSON — ${(cause as Error).message}`);
  }
  // Narrowed before the property read: `JSON.parse("null")` succeeds, and
  // `null.suites` is a native TypeError naming no file — the exact failure this
  // helper exists to replace (review finding on #281).
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${relPath}: expected a JSON object at the root`);
  }
  const suites = (parsed as { suites?: unknown }).suites;
  if (typeof suites !== "object" || suites === null || Array.isArray(suites)) {
    throw new Error(`${relPath}: "suites" must be an object keyed by suite name`);
  }
  return suites as Record<string, unknown>;
}

/** name → the files it runs. */
function runners(): Record<string, string[]> {
  const out: Record<string, string[]> = {
    "test:db-integration": stringLiterals(
      arrayBlock(read("vitest.db-integration.config.ts"), "include"),
    ),
    "test:integration:ops": stringLiterals(
      arrayBlock(read("vitest.integration.ops.config.ts"), "include"),
    ),
    "test:rls-pooling": stringLiterals(
      arrayBlock(read("vitest.rls-pooling.config.ts"), "include"),
    ),
    "test:live-server": Object.keys(
      suitesObject("scripts/ci/live-server-assertion-floors.json"),
    ).map((n) => `tests/${n}.test.js`),
  };
  const dbScripts = path.join(ROOT, "scripts/ci/db-script-suites.json");
  if (existsSync(dbScripts)) {
    // The runner's own reader, not a second unchecked JSON.parse here — it
    // already validates the shape and names the file (review finding on #281).
    // Two readers of one manifest that disagree about what is valid is the
    // drift this file exists to prevent.
    out["test:db-scripts"] = readSuites(dbScripts);
  }
  return out;
}

/** ci.yml with comments removed, so a mention inside one is not an invocation. */
function ciWorkflowCode(): string {
  return read(".github/workflows/ci.yml")
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

const excluded = stringLiterals(arrayBlock(read("vite.config.ts"), "exclude")).flatMap(expandGlob);
const RUNNERS = runners();
const covered = new Set(Object.values(RUNNERS).flat());

describe("every excluded suite is run by something", () => {
  it("finds the exclude block at all (guards a silently-empty scan)", () => {
    expect(excluded.length).toBeGreaterThan(20);
  });

  it("names a runner for every suite `pnpm test` excludes", () => {
    const orphans = excluded.filter((f) => !covered.has(f) && !(f in WAIVERS));
    expect(orphans).toEqual([]);
  });

  it("keeps every waived file actually excluded, so a waiver cannot outlive its reason", () => {
    const stale = Object.keys(WAIVERS).filter((f) => !excluded.includes(f));
    expect(stale).toEqual([]);
  });
});

describe("every runner is invoked by a workflow", () => {
  const code = ciWorkflowCode();

  it.each(Object.keys(RUNNERS))("`pnpm %s` appears in ci.yml outside a comment", (name) => {
    const used = Object.values(RUNNERS)
      .flat()
      .filter((f) => RUNNERS[name].includes(f));
    if (used.every((f) => f in WAIVERS)) return; // runs only waived files
    expect(code).toContain(`pnpm ${name}`);
  });
});
