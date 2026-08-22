#!/usr/bin/env node
/**
 * Runs the six live-server suites and refuses a run that asserted less than last time.
 *
 * These six files sit in `vite.config.ts`'s exclude list because they need a real
 * server on :3001 rather than vitest, and — verified 2026-08-22 — no workflow named
 * any of them, so `charge-alert-worker`, `code-blue-mode-equipment`,
 * `equipment-scan-e2e`, `expiry-api`, `expiry-check-worker` and `returns-api` ran
 * nowhere. Two of them cover Code Blue and equipment scan.
 *
 * Wiring them into CI as-is would have reproduced the defect
 * `db-integration-preflight.mjs` was written to close, in a new costume. Each suite
 * ends with `if (failed > 0) process.exit(1)`, so `passed === 0 && failed === 0`
 * exits 0. A suite whose setup silently stopped working reports success having
 * asserted nothing.
 *
 * That is not hypothetical here. `equipment-scan-e2e` reports `28/29 passed,
 * 1 FAILED` without the `pnpm seed:dev:e2e` fixture and `31/31 passed` with it:
 * the missing fixture does not merely fail one case, it stops two others from
 * running at all. Had that case been written to skip rather than fail, the suite
 * would have gone green two assertions short and nothing would have said so.
 *
 * So the gate is a count, not just an exit code. `db-integration-preflight.mjs`
 * names this exact follow-up in its SCOPE note — "assert the reported count after
 * the run rather than hand-copying probe conditions". This is that follow-up, for
 * the suites it can cover.
 *
 * Deliberately NOT a general solution: it reads each suite's own summary line, so
 * it inherits whatever that line reports. A suite that miscounts its own
 * assertions would fool this too. What it does buy is that the count cannot
 * silently shrink.
 *
 * Sequential by design. The suites share one database and several create
 * clinic-scoped fixtures with fixed ids (`code-blue-clinic-alpha`, and
 * `equipment-scan-e2e` reuses the seeded `eq1`), so running them concurrently
 * would trade a real signal for a faster red.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FLOORS_FILE = path.join(HERE, "live-server-assertion-floors.json");

/**
 * Pure: pull the assertion counts out of a suite's stdout.
 *
 * Two shapes are in use across the six files and both must parse, because the
 * difference is invisible until one of them stops matching and returns null:
 *   "Results: 10 passed, 0 failed"       — the five worker/api suites
 *   "Results: 31/31 passed ✓"            — equipment-scan-e2e, all green
 *   "Results: 28/29 passed, 1 FAILED"    — equipment-scan-e2e, with a failure
 *
 * Returns null when no summary line is present at all, which is its own failure:
 * a suite that crashed before printing one has not reported anything to trust.
 */
export function parseResultsLine(stdout) {
  const lines = String(stdout ?? "").split("\n");
  // Last match wins: a suite may print section headers containing the word.
  const line = lines.filter((l) => /^\s*Results:/.test(l)).pop();
  if (!line) return null;

  const slash = line.match(/Results:\s*(\d+)\s*\/\s*(\d+)\s+passed(?:,\s*(\d+)\s+FAILED)?/i);
  if (slash) {
    const passed = Number(slash[1]);
    const total = Number(slash[2]);
    // "31/29 passed" is not a number this runner should try to interpret: it yields
    // failed: -2, which is below every floor and reads as a pass. An impossible
    // summary is a suite that cannot be trusted to count, so refuse to parse it and
    // let the null branch call it what it is — a suite that did not report.
    if (!Number.isSafeInteger(passed) || !Number.isSafeInteger(total) || passed > total) {
      return null;
    }
    const failed = total - passed;
    // This format prints its failure count SEPARATELY from its totals, and this parser
    // used to read the totals and throw that number away. Cross-check it instead.
    //
    // Not reachable from the suite as written — equipment-scan-e2e computes
    // `const total = passed + failed` (tests/equipment-scan-e2e.test.js:249), so
    // `total - passed === failed` is an arithmetic identity there. Guarded for two
    // reasons that do not depend on reachability. The identity is one edit away from
    // dissolving: a `total` changed to an expected-count constant is a natural thing
    // to write and would break it silently. And while the reported number was
    // discarded, evaluateSuite's "reported failures are a refusal even on exit 0"
    // branch was DEAD for this format — a guard whose entire purpose is trusting the
    // report over the exit code, bypassed for the one format that reports failures
    // explicitly. An unsafe reportedFailed is caught by the same inequality, since
    // `failed` is bounded by two safe integers and can never equal it.
    const reportedFailed = slash[3] === undefined ? undefined : Number(slash[3]);
    if (reportedFailed !== undefined && reportedFailed !== failed) {
      return null;
    }
    return { passed, total, failed };
  }

  const plain = line.match(/Results:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
  if (plain) {
    const passed = Number(plain[1]);
    const failed = Number(plain[2]);
    const total = passed + failed;
    // The same refusal as the slash branch, for a sharper reason than "it clears the
    // floor": past 2^53 the parse is no longer the number the suite printed.
    // "9007199254740993" comes back as ...992, and "...995" rounds UP to ...996. The
    // value compared to the floor was never on stdout, so the comparison is meaningless
    // whichever way it lands. All three are checked because two safe operands still
    // overflow into an unsafe sum at the boundary (MAX_SAFE passed + 1 failed).
    //
    // This does NOT close the whole class and must not be read as if it does: a
    // timestamp-shaped "1755855019000 passed" is a perfectly safe integer and clears a
    // floor of 9. Nothing non-arbitrary fixes that — any ceiling picked here would also
    // refuse the growth the floor design deliberately allows.
    if (
      !Number.isSafeInteger(passed) ||
      !Number.isSafeInteger(failed) ||
      !Number.isSafeInteger(total)
    ) {
      return null;
    }
    return { passed, total, failed };
  }

  return null;
}

/**
 * Pure: decide a single suite's disposition.
 *
 * `exitCode` is the suite's own verdict and is authoritative for failures — this
 * never overrides a red into a green. The floor only adds a second way to be red.
 */
export function evaluateSuite({ name, exitCode, parsed, floor }) {
  if (parsed === null) {
    return {
      ok: false,
      message:
        `${name}: no "Results:" line in output. The suite did not report, so ` +
        `there is nothing to trust — treat this as a crash, not a pass.`,
    };
  }
  if (exitCode !== 0) {
    return {
      ok: false,
      message: `${name}: ${parsed.failed} of ${parsed.total} assertions failed (exit ${exitCode}).`,
    };
  }
  // Reported failures are a refusal even on exit 0. Today every suite ends with
  // `if (failed > 0) process.exit(1)`, so this cannot fire — which is exactly why it
  // is here. This runner exists because a suite's exit code is not a trustworthy
  // summary of what it did; taking that seriously means reading the count it
  // reported for FAILURES too, not only for shortfalls. A suite that says it failed
  // and exits 0 has a broken exit path, and that is worse than an ordinary red.
  if (parsed.failed > 0) {
    return {
      ok: false,
      message:
        `${name}: reported ${parsed.failed} of ${parsed.total} assertions failed but ` +
        `exited 0. Trust the report, not the exit code — and fix the suite's exit path.`,
    };
  }
  if (typeof floor !== "number") {
    return {
      ok: false,
      message:
        `${name}: no recorded floor in live-server-assertion-floors.json. An ` +
        `unfloored suite can shrink to zero assertions and still report green; ` +
        `record its count rather than exempting it.`,
    };
  }
  if (parsed.total < floor) {
    return {
      ok: false,
      message:
        `${name}: ran ${parsed.total} assertions, floor is ${floor}. The suite ` +
        `passed everything it ran and ran less than it used to — which is what a ` +
        `broken fixture looks like from outside. Fix the setup, or raise the ` +
        `floor deliberately if cases were removed on purpose.`,
    };
  }
  return {
    ok: true,
    message: `${name}: ${parsed.total} assertions (floor ${floor}) — ok`,
  };
}

/** Pure: fold per-suite dispositions into the process verdict. */
export function summarize(results) {
  const failures = results.filter((r) => !r.ok);
  const totalAssertions = results.reduce((n, r) => n + (r.assertions ?? 0), 0);
  return { ok: failures.length === 0, failures, totalAssertions };
}

/**
 * Run every floored suite in order and exit non-zero if any is refused. The floors
 * file is the list of suites: adding one there without a `tests/<name>.test.js`
 * fails at spawn, and adding the file without a floor is refused by `evaluateSuite`,
 * so neither half can be added alone and silently do nothing.
 */
function main() {
  const floors = JSON.parse(readFileSync(FLOORS_FILE, "utf8")).suites;
  const names = Object.keys(floors);

  console.log(`live-server suites (${names.length}) — sequential, shared database\n`);

  const results = [];
  for (const name of names) {
    const file = path.join(REPO_ROOT, "tests", `${name}.test.js`);
    const run = spawnSync(process.execPath, [file], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5 * 60_000,
    });
    // spawnSync reports spawn-level failure in run.error, NOT in stdout. Measured,
    // because the obvious guess is wrong: a renamed or deleted suite file gives
    // status=1, error=NONE, and "Cannot find module" on stderr — already captured
    // below. The case that is genuinely silent is the `timeout` above firing on a
    // hung suite: status=null, stdout="", and the ETIMEDOUT lives only in run.error.
    // Without this line that suite would refuse with the generic "no Results:"
    // message over an empty diagnostic block, which reads like a crash of unknown
    // origin rather than a hang.
    const spawnError = run.error ? `spawn failed for ${file}: ${run.error.message}\n` : "";
    const stdout = `${spawnError}${run.stdout ?? ""}${run.stderr ?? ""}`;
    const parsed = parseResultsLine(stdout);
    const verdict = evaluateSuite({
      name,
      exitCode: run.status ?? 1,
      parsed,
      floor: floors[name],
    });
    results.push({ ...verdict, assertions: parsed?.total ?? 0 });
    console.log(`  ${verdict.ok ? "ok  " : "FAIL"}  ${verdict.message}`);
    if (!verdict.ok) {
      // The suite's own output is the diagnosis; print it once, only when red.
      console.log(stdout.split("\n").map((l) => `        ${l}`).join("\n"));
    }
  }

  const { ok, failures, totalAssertions } = summarize(results);
  console.log(`\n${totalAssertions} assertions across ${results.length} suites`);
  if (!ok) {
    console.error(`\n${failures.length} suite(s) refused:`);
    for (const f of failures) console.error(`  - ${f.message}`);
    process.exit(1);
  }
  console.log("PASS");
}

// Mirrors db-integration-preflight.mjs's guard, including the two parts that look like
// belt-and-braces and are not. `process.argv[1]` is absent under `node -e` and merely
// unresolved under a symlink; realpathSync throws on the first and silently disagrees on
// the second. The bare comparison this replaced therefore CRASHED on import — measured:
// `ENOENT: no such file or directory, lstat '<cwd>/undefined'` — and would have no-op'd
// from a symlinked checkout, which is the shape of a CI bind-mount and of /tmp on macOS.
// A path that cannot be resolved is not a reason to skip the gate, so the catch falls
// back to comparing hrefs rather than returning false.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  }
})();

if (invokedDirectly) {
  main();
}
