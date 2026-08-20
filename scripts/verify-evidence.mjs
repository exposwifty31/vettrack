#!/usr/bin/env node
/**
 * Layer 3 — run what the documentation claims is green, and record what actually
 * happened.
 *
 * WHY THIS IS A SEPARATE COMMAND AND NOT PART OF THE JEST SUITE
 * The gate that blocks a PR is a jest suite. If that suite ran `npm test` to
 * prove the tests pass, it would run itself, forever. So the layers split by
 * WHO CAN OBSERVE WHAT: this command executes the declared gates and writes a
 * report; the suite reads the report and refuses to accept a claim of green that
 * the report does not support. Neither half can fake the other's evidence.
 *
 * THE REPORT IS BOUND TO A TREE
 * `treeHash` is the committed tree the run covers, and `dirty` says whether the
 * working copy had uncommitted changes at the time. Under enforcement a report
 * for a different tree, or one taken over a dirty tree, is not evidence — it is
 * a record of some other code passing.
 *
 * WHAT IT REFUSES TO RUN
 * A gate that re-enters this tooling (`npm test`, any `verify:*` script) is
 * rejected outright rather than executed. That is a configuration error with a
 * clear message, not a hang.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "verify.config.json"), "utf8"));

const say = (line) => process.stdout.write(`${line}\n`);

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

/** A gate must not re-enter the verifier; see the header. */
const REENTRANT = /(?:^|\s)(?:(?:npm run|pnpm)\s+)?(?:test|test:[\w:-]+|verify:[\w:-]+)(?:\s|$)/;

const gates = config.evidenceGates ?? [];
const reentrant = gates.filter((gate) => REENTRANT.test(gate.command));
if (reentrant.length > 0) {
  say(`\nverify:evidence refuses to run a gate that re-enters the verifier:`);
  for (const gate of reentrant) say(`  ${gate.id}: ${gate.command}`);
  say(
    "\nThe test suite's own result is proven by CI running it, not by this report.\n" +
      "Remove these entries from verify.config.json -> evidenceGates.\n",
  );
  process.exit(2);
}

const treeHash = git(["rev-parse", "HEAD^{tree}"]);
const dirty = git(["status", "--porcelain"]) !== "";
const startedAt = new Date().toISOString();

say(`\n-- evidence run --\n  tree ${String(treeHash).slice(0, 12)}${dirty ? " (DIRTY working copy)" : ""}`);

/**
 * Gates run CONCURRENTLY and their output is buffered, then printed per gate.
 * These replace CI steps that already ran typecheck and lint in parallel;
 * serialising them here would have made the evidence report cost wall-clock
 * that the pipeline was not paying before, which is how a good gate gets
 * deleted. Output is buffered rather than inherited so two concurrent
 * compilers do not interleave into an unreadable log.
 */
/**
 * Tokens a declared gate may contain. The command comes from
 * verify.config.json — a file — so it is validated at the boundary rather than
 * trusted. `shell: false` already means no shell parses it; this is about not
 * handing an unexamined file-sourced string to a process spawn at all, and it
 * fails LOUD instead of quietly running something unexpected.
 */
const GATE_TOKEN = /^[\w./:@=-]+$/;

function runGate(gate) {
  return new Promise((resolve) => {
    const tokens = gate.command.split(/\s+/).filter(Boolean);
    const bad = tokens.find((token) => !GATE_TOKEN.test(token));
    if (tokens.length === 0 || bad !== undefined) {
      resolve({
        id: gate.id,
        command: gate.command,
        exitCode: 1,
        durationMs: 0,
        output: `refused: gate command contains an unexpected token (${bad ?? "empty command"})`,
      });
      return;
    }
    const [command, ...args] = tokens;
    const started = Date.now();
    const child = spawn(command, args, { cwd: ROOT, shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const settle = (code) =>
      resolve({
        id: gate.id,
        command: gate.command,
        // A signal or a spawn failure is not a pass. Treating a null status as
        // 0 is exactly how a gate reports green for a job that never ran.
        exitCode: code === null ? 1 : code,
        durationMs: Date.now() - started,
        output,
      });
    child.on("error", (err) => {
      output += String(err?.message ?? err);
      settle(1);
    });
    child.on("close", settle);
  });
}

const results = (await Promise.all(gates.map(runGate))).map((result) => {
  const verdict = result.exitCode === 0 ? "PASS" : "FAIL";
  say(`\n  ${verdict}  ${result.id}  (${Math.round(result.durationMs / 1000)}s)  ${result.command}`);
  if (result.exitCode !== 0) say(result.output.trimEnd());
  return {
    id: result.id,
    command: result.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  };
});

const reportPath = path.join(ROOT, config.evidenceReport);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      $comment:
        "Written by `pnpm verify:evidence`. Read by the claim gate: a document that says a gate is green must be backed by a PASS here, on this tree. Do not hand-edit.",
      treeHash,
      dirty,
      startedAt,
      node: process.version,
      results,
    },
    null,
    2,
  )}\n`,
);

const failed = results.filter((r) => r.exitCode !== 0);
say(`\n  report: ${config.evidenceReport}`);
say(failed.length === 0 ? "  all declared gates passed\n" : `  ${failed.length} gate(s) failed\n`);
process.exit(failed.length === 0 ? 0 : 1);
