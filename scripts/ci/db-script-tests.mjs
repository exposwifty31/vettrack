#!/usr/bin/env node
/**
 * Runs the DB-backed test files that are NOT vitest suites.
 *
 * Eight files under `tests/` are named `*.test.ts` but declare no `describe`/`it`.
 * They are standalone tsx programs — `async function main()`, `node:assert`, and
 * their own docblocks say `Run: pnpm exec tsx <file>`. vitest cannot run them
 * ("No test suite found in file"), which is why `vite.config.ts` excludes them,
 * and until this runner existed nothing else ran them either.
 *
 * WHY THE EXIT CODE IS NOT ENOUGH
 * Every one of them opens with:
 *
 *     if (!process.env.DATABASE_URL) {
 *       console.log("⚠️  ... skipped (DATABASE_URL not set)");
 *       process.exit(0);
 *     }
 *
 * Verified 2026-09-01 by falsification rather than by reading: with the variable
 * unset, `pnpm exec tsx tests/migrations/damage-events.test.ts` exits **0**
 * having asserted nothing. A runner that trusted exit codes would report a green
 * job for eight files that did not run — the same shape as the hole this runner
 * was written to close, one level up. So a skip is a REFUSAL here, and that
 * per-script check is deliberately preferred over a single upfront
 * DATABASE_URL probe: a probe can pass while an individual script still skips.
 *
 * Each script also ends with a `✅ … passed` line, and it must be the LAST
 * non-empty line of the output. Silence on exit 0 — a main() that returned
 * early, or an edited-away success line — is refused, on the same reasoning
 * `scripts/ci/live-server-tests.mjs` refuses a suite that printed no `Results:`
 * line; and a marker with chatter after it is refused too, so an incidental
 * success line cannot stand in for the script's own verdict.
 *
 * The marker is deliberately NOT bound to the manifest name (review finding on
 * #281). Measured across all eight: four print prose that names no file at all
 * ("✅ push-native-tokens migration test passed"), so a name-bound match would
 * refuse four passing suites. Last-line position is the invariant every one of
 * them actually satisfies.
 *
 * The file list is `scripts/ci/db-script-suites.json`, asserted against
 * `vite.config.ts`'s exclude block by `tests/excluded-suite-coverage.test.ts`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const SUITES_FILE = path.join(HERE, "db-script-suites.json");

/** The line every one of these scripts prints when it declines to run. */
const SKIP_MARKER = /skipped \(DATABASE_URL not set\)/i;
/** The line every one of them prints on success. */
const SUCCESS_MARKER = /✅[^\n]*passed/;

/**
 * @param {{ name: string, exitCode: number, stdout: string }} run
 * @returns {{ ok: boolean, message: string }}
 */
export function evaluateScript({ name, exitCode, stdout }) {
  if (exitCode !== 0) {
    return { ok: false, message: `${name}: failed (exit ${exitCode}).` };
  }
  // Before the missing-marker branch: both conditions hold for a skipped run,
  // and "no success marker" would send the reader hunting an edited script
  // instead of an unset environment variable.
  if (SKIP_MARKER.test(stdout)) {
    return {
      ok: false,
      message:
        `${name}: skipped for want of DATABASE_URL and exited 0. A skip here is a ` +
        `refusal — the script asserted nothing, so there is no result to trust.`,
    };
  }
  if (!SUCCESS_MARKER.test(stdout)) {
    return {
      ok: false,
      message:
        `${name}: exited 0 with no success marker. The script prints ` +
        `"✅ … passed" when it completes; silence means it returned early.`,
    };
  }
  const lines = stdout.split("\n").filter((l) => l.trim() !== "");
  if (!SUCCESS_MARKER.test(lines[lines.length - 1] ?? "")) {
    return {
      ok: false,
      message:
        `${name}: the success marker is not the last line. Something ran after ` +
        `the script reported completion, so the marker is not its final verdict.`,
    };
  }
  return { ok: true, message: `${name}: passed` };
}

/**
 * @param {Array<{ ok: boolean, message: string }>} results
 */
export function summarize(results) {
  const failures = results.filter((r) => !r.ok);
  return {
    // An empty run is a refusal: a suites file that parsed to nothing would
    // otherwise turn the whole job green having executed no script at all.
    ok: results.length > 0 && failures.length === 0,
    total: results.length,
    failed: failures.length,
    messages: failures.map((f) => f.message),
  };
}

export function readSuites(file = SUITES_FILE) {
  // Shape-checked rather than trusted (review finding on #281). A missing key
  // yields `undefined` and a non-array yields something whose `.map` either
  // throws deep inside main() or, worse, iterates characters — neither of which
  // names the file that is actually wrong. An empty array is left to
  // summarize(), which already refuses a run that executed nothing.
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    // JSON.parse throws before the shape check below can run, and its message
    // names no file — so a malformed manifest reads as a bare SyntaxError from
    // somewhere in CI. Rethrow with the path (review finding on #281).
    throw new Error(`${file}: not valid JSON — ${cause.message}`, { cause });
  }
  // `JSON.parse("null")` succeeds and returns null, so reading `.suites` off it
  // throws a native TypeError before the message below can name the file.
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${file}: expected a JSON object at the root`);
  }
  const suites = parsed.suites;
  if (!Array.isArray(suites) || suites.some((s) => typeof s !== "string")) {
    throw new Error(`${file}: "suites" must be an array of file paths`);
  }
  return suites;
}

function main() {
  const suites = readSuites();
  const results = suites.map((name) => {
    const proc = spawnSync("pnpm", ["exec", "tsx", name], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: process.env,
    });
    const stdout = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
    const verdict = evaluateScript({ name, exitCode: proc.status ?? 1, stdout });
    console.log(verdict.ok ? `  PASS  ${name}` : `  FAIL  ${verdict.message}`);
    if (!verdict.ok && stdout.trim()) {
      console.log(
        stdout
          .trim()
          .split("\n")
          .slice(-12)
          .map((l) => `        ${l}`)
          .join("\n"),
      );
    }
    return verdict;
  });

  const summary = summarize(results);
  console.log(
    `\n-- db-script suites -- ${summary.total - summary.failed}/${summary.total} passed`,
  );
  if (!summary.ok) {
    if (summary.total === 0) console.log("no suites ran — nothing to report is not success");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
