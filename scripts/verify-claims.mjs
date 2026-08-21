#!/usr/bin/env node
/**
 * Claim verification — makes the repository's own prose self-checking.
 *
 * WHAT THIS EXISTS FOR
 * `CLAUDE.md` is the map every agent and contributor works from, and nothing
 * checks it. `docs/audit/PROOF_ALIGNMENT_LOG.md` is 8,700 lines of "verify the
 * claim before reporting done" — a rule kept entirely by whoever remembers it.
 * This makes both machine-checked. It is the same engine the VetTrack RN
 * migration repo runs, where the first run found a frozen-stack bullet naming a
 * dependency the project had never installed.
 *
 * WHAT IT CHECKS — four layers, and no fifth disposition
 *   L1 EXISTS   paths, line ranges, globs, dependency versions, npm scripts,
 *               the structure tree, and declared ABSENCE ("no SQLite package").
 *   L2 EXECUTED "MERGED"/"landed" claims must cite a PR or a commit, and that
 *               citation must exist and be an ancestor of the default branch.
 *   L3 WORKS    the gates the config declares must have RUN and passed, on THIS
 *               tree — recorded by `npm run verify:evidence`, read here.
 *   L4 ATTESTED what a repository cannot prove (a physical device, the EAS
 *               store) is a dated, checked-in attestation with a re-verify
 *               recipe and an expiry, not a sentence in a plan.
 *
 * Every scanned claim ends as verified / registered / attested / excluded /
 * FAIL. "Skipped" is not available: a silent skip and a passing check are
 * indistinguishable from the outside, and only one of them is honest.
 *
 * This file is I/O and formatting only. The verdict lives in
 * scripts/verify/run.cjs, which the vitest wrapper imports, so the gate that
 * blocks a PR and the command a human runs can never disagree. (The engine is
 * CommonJS with a .cjs extension because this package is "type": "module"; the
 * RN migration repo carries the same engine as plain .js.)
 *
 * MODES
 *   --json               machine-readable result, for triage.
 *   --enforce-evidence   bind layer 3 (VT_ENFORCE_EVIDENCE=1 does the same in CI).
 */

import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { verify } = require("./verify/run.cjs");

const asJson = process.argv.includes("--json");
const enforceEvidence =
  process.argv.includes("--enforce-evidence") || process.env.VT_ENFORCE_EVIDENCE === "1";

const say = (line) => process.stdout.write(`${line}\n`);

/** How many spans each extraction rule declined, as one line. */
function excludedByRule(result) {
  const byRule = new Map();
  for (const item of result.excluded) byRule.set(item.reason, (byRule.get(item.reason) ?? 0) + 1);
  return [...byRule]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason} x${n}`)
    .join(", ");
}

/** Failures, grouped by the document that carries them. */
function reportFailures(result) {
  if (result.failures.length === 0) return;
  say("\n-- failures --");
  const byFile = new Map();
  for (const failure of result.failures) {
    byFile.set(failure.file, [...(byFile.get(failure.file) ?? []), failure]);
  }
  for (const [file, items] of byFile) {
    say(`\n  ${file}  (${items.length})`);
    for (const item of items) {
      const where = item.line > 0 ? `:${item.line}` : "";
      say(`    ${where.padEnd(6)} [${item.kind}] ${item.detail}`);
      if (item.raw) say(`           claimed: ${item.raw}`);
    }
  }
}

function report(result) {
  say("\n-- claim verification --");
  // `unresolvable` is printed only when it is non-zero: it appears solely on a run
  // that has already failed because layer 2 could not run, and a permanent `0` in
  // the summary would read as a disposition claims routinely take.
  const unresolvable = result.counts.unresolvable
    ? `, ${result.counts.unresolvable} unresolvable (layer 2 unavailable)`
    : "";
  say(
    `  ${result.counts.claims} claims: ` +
      `${result.counts.verified} verified, ${result.counts.registered} registered, ` +
      `${result.counts.attested} attested, ${result.counts.excluded} excluded by rule, ` +
      `${result.counts.fail} FAILED${unresolvable}`,
  );

  const excluded = excludedByRule(result);
  if (excluded) say(`  excluded: ${excluded}`);
  if (result.ref) say(`  layer 2 measured against ${result.ref} -> ${result.refHead ?? "?"}`);
  for (const note of result.notes) say(`  note: ${note}`);

  reportFailures(result);

  say(result.ok ? "\nAll claims accounted for.\n" : `\n${result.failures.length} unaccounted claim(s).\n`);
}

// No `invokedDirectly` guard. This file is a bin script and nothing imports it,
// so the guard could only ever do one thing: on the day its own assumption about
// `process.argv[1]` stopped holding — a symlinked bin, a wrapper, a different
// working directory — it would exit 0 having verified nothing, and every caller
// would read that as a pass. A gate that can silently succeed is the failure
// this whole tool exists to prevent.
//
// `process.exitCode` RATHER THAN `process.exit()`, for the same family of reason:
// `process.exit()` abandons a pending stdout write, and on a PIPE the ~200 KB
// `--json` report came back cut at the 64 KB buffer — valid-looking output,
// silently short. Setting the code and returning lets node flush first.
function main() {
  let result;
  try {
    result = verify({ enforceEvidence });
  } catch (error) {
    // A configuration problem is not a claim verdict: it is reported as itself,
    // with exit 2, so a broken config is never mistaken for a clean run.
    say(`\nverify:claims cannot run: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (asJson) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else report(result);
  process.exitCode = result.ok ? 0 : 1;
}

main();
