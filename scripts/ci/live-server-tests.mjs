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

  const slash = line.match(/Results:\s*(\d+)\s*\/\s*(\d+)\s+passed/);
  if (slash) {
    const passed = Number(slash[1]);
    const total = Number(slash[2]);
    return { passed, total, failed: total - passed };
  }

  const plain = line.match(/Results:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
  if (plain) {
    const passed = Number(plain[1]);
    const failed = Number(plain[2]);
    return { passed, total: passed + failed, failed };
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
    const stdout = `${run.stdout ?? ""}${run.stderr ?? ""}`;
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

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
