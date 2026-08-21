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
 * A gate that re-enters this tooling (`pnpm test`, `pnpm test:ci`, a bare
 * `vitest`, any `verify:*` script) is rejected outright rather than executed.
 * That is a configuration error with a clear message, not a hang. The predicate
 * lives in scripts/verify/claims.cjs so it can be handed a bad command in a test.
 */

import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "verify.config.json"), "utf8"));
const require = createRequire(import.meta.url);
const { resolveGitBinary } = require("./verify/git-facts.cjs");
// The two refusal predicates live in the pure-decisions module so a test can
// hand them a bad command and assert that they refuse. Inside this CLI they were
// unreachable from any test, which is the same as untested.
const { isReentrantGate, GATE_TOKEN } = require("./verify/claims.cjs");

const say = (line) => process.stdout.write(`${line}\n`);

// Resolved from a fixed list of absolute paths, not searched on PATH — same
// reasoning as scripts/verify/git-facts.js, and the same resolver so the two
// cannot disagree about which git they ran. The gate commands below are a
// different case: npm and pnpm legitimately live wherever nvm or corepack put
// them, and pinning those to absolute paths would break more than it protects.
// `resolveGitBinary` reports a bad `VT_GIT_BINARY` as a cause object rather than
// as a missing install; this runner only needs the path, and a null here already
// makes `git()` return null, which the tree-hash guard below turns into a refusal.
const RESOLVED_GIT = resolveGitBinary();
const GIT_BINARY = typeof RESOLVED_GIT === "string" ? RESOLVED_GIT : null;

function git(args) {
  if (!GIT_BINARY) return null;
  const result = spawnSync(GIT_BINARY, args, { cwd: ROOT, encoding: "utf8", shell: false });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

const gates = config.evidenceGates ?? [];
const reentrant = gates.filter((gate) => isReentrantGate(gate.command));
if (reentrant.length > 0) {
  say(`\nverify:evidence refuses to run a gate that re-enters the verifier:`);
  for (const gate of reentrant) say(`  ${gate.id}: ${gate.command}`);
  say(
    "\nThe test suite's own result is proven by CI running it, not by this report.\n" +
      "Remove these entries from verify.config.json -> evidenceGates.\n",
  );
  process.exit(2);
}

// EVIDENCE MUST NAME THE TREE IT COVERS. When git is unavailable or a command
// fails, `treeHash` is null and `dirty` becomes true because `null !== ""` — and
// the run went on to write a report saying "tree null, DIRTY". Downstream that
// reads as two claim failures (dirty tree, tree mismatch) and the real cause,
// that git never answered, appears nowhere. No tree, no report.
const treeHash = git(["rev-parse", "HEAD^{tree}"]);
const status = git(["status", "--porcelain"]);
if (treeHash === null || status === null) {
  say("\nverify:evidence cannot bind a report to a tree: git is unavailable or a git command failed.");
  say("Evidence has to name the tree it covers, so no report was written.\n");
  process.exit(2);
}
const dirty = status !== "";
const startedAt = new Date().toISOString();

say(`\n-- evidence run --\n  tree ${String(treeHash).slice(0, 12)}${dirty ? " (DIRTY working copy)" : ""}`);

/**
 * A gate that hangs must become a recorded FAIL, not a job that dies on the CI
 * timeout with no report at all — which means the budget has to sit INSIDE the
 * job budget. At 15 minutes against `timeout-minutes: 15` in
 * `.github/workflows/ci.yml`, and with checkout and install ahead of it, the job
 * always died first and the recorded FAIL was unreachable in the one place it
 * matters. Ten leaves room for the steps before it and is still generous for a
 * real build.
 */
const GATE_TIMEOUT_MS = 10 * 60 * 1000;

/** Per-gate ceiling on buffered stdout+stderr. See `runGate`. */
const MAX_OUTPUT_BYTES = 1_000_000;

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
    const [rawCommand, ...args] = tokens;
    // On Windows `npm` and `pnpm` are `.cmd` shims, which `spawn` cannot execute
    // with `shell: false` — and turning the shell on to fix that would hand the
    // whole command line to `cmd.exe`. The token has already passed `GATE_TOKEN`,
    // so appending the extension is the narrow fix; the shell stays off.
    const command =
      process.platform === "win32" && /^(?:npm|pnpm|yarn|npx)$/.test(rawCommand)
        ? `${rawCommand}.cmd`
        : rawCommand;
    const started = Date.now();
    // POSIX: its own process GROUP, so the timeout below can signal the whole
    // tree. A gate is an `npm`/`pnpm` script, which spawns descendants; killing
    // only the direct child leaves those holding the output pipes open, `close`
    // never fires, and `Promise.all` waits forever — the hang the timeout exists
    // to convert into a recorded FAIL.
    const ownGroup = process.platform !== "win32";
    const child = spawn(command, args, { cwd: ROOT, shell: false, detached: ownGroup });
    let output = "";

    // SETTLE EXACTLY ONCE, and on timeout settle IMMEDIATELY rather than waiting
    // for a `close` that a surviving descendant can withhold. The kill is
    // best-effort; the report is not.
    let settled = false;
    const settle = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        id: gate.id,
        command: gate.command,
        // A signal or a spawn failure is not a pass. Treating a null status as
        // 0 is exactly how a gate reports green for a job that never ran.
        exitCode: code === null ? 1 : code,
        durationMs: Date.now() - started,
        output,
      });
    };

    const timer = setTimeout(() => {
      output += `\nrefused: gate exceeded ${GATE_TIMEOUT_MS}ms and was killed`;
      try {
        if (ownGroup && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // Already gone, or the group cannot be signalled. The FAIL is recorded
        // either way — a gate this tool could not stop is still a failed gate.
      }
      settle(1);
    }, GATE_TIMEOUT_MS);

    // BOUNDED. Gates run concurrently through `Promise.all`, so an unbounded
    // buffer means every verbose gate on a large tree holds its whole log in
    // memory at once. The cap is marked in the recorded output rather than
    // applied silently: a truncated log that does not say so is a log that
    // lies about being complete.
    // Counted in BYTES, which is what the constant says. `output.length` counts
    // UTF-16 code units, so a megabyte of multibyte output measured about a
    // third of its real size and the cap never fired — a limit that is only a
    // limit for ASCII is the kind of half-true guard this tool exists to refuse.
    let bytes = 0;
    let truncated = false;
    const collect = (chunk) => {
      if (truncated) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      const room = MAX_OUTPUT_BYTES - bytes;
      if (buf.length <= room) {
        bytes += buf.length;
        output += buf.toString("utf8");
        return;
      }
      truncated = true;
      // A byte-boundary slice can split a multibyte character; the decoder marks
      // that as U+FFFD, and dropping a trailing one keeps the tail valid UTF-8
      // instead of ending the log in a replacement character.
      output += buf.subarray(0, Math.max(room, 0)).toString("utf8").replace(/\uFFFD$/, "");
      output += `\n[output truncated at ${MAX_OUTPUT_BYTES} bytes]`;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => {
      output += String(err?.message ?? err);
      settle(1);
    });
    child.on("close", settle);
  });
}

/**
 * Gates run CONCURRENTLY and their output is buffered, then printed per gate.
 * These replace CI steps that already ran typecheck and lint in parallel;
 * serialising them here would have made the evidence report cost wall-clock
 * that the pipeline was not paying before, which is how a good gate gets
 * deleted. Output is buffered rather than inherited so two concurrent
 * compilers do not interleave into an unreadable log.
 */
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
