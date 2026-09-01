#!/usr/bin/env node
/**
 * knip's UNUSED-FILES verdict, as a gate that can actually fail.
 *
 * WHY THIS EXISTS
 * `ci.yml` runs `pnpm knip --no-exit-code` with `continue-on-error: true`. Two
 * independent reasons that step could never fail, and the second is the worse one:
 *
 *   1. It is wired not to. The TODO beside it has waited on "a baseline", and
 *      without one the only options were "block on 125 findings" or "block on
 *      none" — so it reported into a log nobody reads.
 *   2. **`continue-on-error: true` swallows a broken CONFIG.** Measured, not
 *      assumed: an unrecognized key in knip.json prints `ERROR: Invalid input`
 *      and exits **2** — `--no-exit-code` suppresses the issues-found exit, not
 *      this one — and the step passes anyway because it is allowed to fail. A
 *      config that analysed nothing then reads exactly like a clean run: the
 *      gate-that-disarmed-itself shape. So this script runs WITHOUT
 *      continue-on-error, and treats both a non-zero exit and unparsable JSON as
 *      failures rather than as an empty report.
 *
 * WHAT IT ASSERTS, and only this: no NEW unused file. Unused exports (241 today)
 * are deliberately out of scope — a type exported for a consumer that has not
 * landed is a different judgement from a file nothing reaches at all, and mixing
 * them is how the report got ignored in the first place.
 *
 * The baseline is frozen exactly as `tenant:lint` and the endpoint-drift
 * uncalled-route list are: today's findings stay silent, tomorrow's fail. And an
 * entry that stops being unused FAILS too, so the freeze cannot quietly excuse a
 * file that is now wired.
 *
 * Run: pnpm knip:files
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "scripts", "ci", "knip-unused-files.baseline.json");

/** The baseline, shape-checked — a malformed file must name itself, not throw a bare TypeError. */
export function readBaseline(file = BASELINE) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new Error(`${file}: not valid JSON — ${cause.message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${file}: expected a JSON object at the root`);
  }
  const { files } = parsed;
  if (!Array.isArray(files) || files.some((f) => typeof f !== "string")) {
    throw new Error(`${file}: "files" must be an array of repo-relative paths`);
  }
  return files;
}

/**
 * Unused files from a FULL knip run.
 *
 * `--include files` is NOT equivalent and must not be substituted: it suppresses
 * the plugin-derived entry points, so vitest/playwright config files show up as
 * unused and the list reads 11 instead of 7. A baseline frozen under one and
 * checked under the other would drift on the next `pnpm knip` anyone runs.
 */
export function unusedFiles(cwd = ROOT) {
  let raw;
  try {
    raw = execFileSync("pnpm", ["exec", "knip", "--no-exit-code", "--reporter", "json"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (cause) {
    // A config error exits 2 even under --no-exit-code. Report it as what it is —
    // knip analysed nothing — rather than letting a raw ENOENT/stack surface.
    const stderr = String(cause.stderr ?? "").trim();
    const stdout = String(cause.stdout ?? "").trim();
    throw new Error(
      `knip exited ${cause.status ?? "abnormally"} — it analysed nothing, which is NOT ` +
        `an empty report:\n${(stderr || stdout || cause.message).slice(0, 2000)}`,
    );
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error(
      `knip produced no parsable JSON. With --no-exit-code a CONFIG error exits 0, so this ` +
        `is treated as a failure rather than an empty report. Its output was:\n${raw.slice(0, 2000)}`,
    );
  }
  if (!Array.isArray(report.issues)) {
    throw new Error('knip JSON has no "issues" array — the reporter shape changed.');
  }
  return report.issues
    .filter((issue) => Array.isArray(issue.files) && issue.files.length > 0)
    .map((issue) => issue.file)
    .sort();
}

function main() {
  const baseline = new Set(readBaseline());
  const current = unusedFiles();
  const fresh = current.filter((f) => !baseline.has(f));
  const wired = [...baseline].filter((f) => !current.includes(f)).sort();

  if (fresh.length === 0 && wired.length === 0) {
    console.log(`knip unused files: ${current.length}, all frozen. No new dead file.`);
    return;
  }
  if (fresh.length > 0) {
    console.error(`\nNEW unused file(s) — nothing in this repo reaches them:\n`);
    for (const f of fresh) console.error(`  ${f}`);
    console.error(`\nWire it to its caller, delete it, or — if it is an entry point invoked by`);
    console.error(`config rather than imported — declare it in knip.json "entry".\n`);
  }
  if (wired.length > 0) {
    console.error(`\nBaseline entr(ies) that are no longer unused — delete them from`);
    console.error(`scripts/ci/knip-unused-files.baseline.json:\n`);
    for (const f of wired) console.error(`  ${f}`);
    console.error("");
  }
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
