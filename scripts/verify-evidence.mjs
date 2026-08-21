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
const { isReentrantGate, GATE_TOKEN, gateInvocation, createOutputCollector, terminationProblem } = require("./verify/claims.cjs");

const say = (line) => process.stdout.write(`${line}\n`);

// Resolved from a fixed list of absolute paths, not searched on PATH — same
// reasoning as scripts/verify/git-facts.js, and the same resolver so the two
// cannot disagree about which git they ran. The gate commands below are a
// different case: npm and pnpm legitimately live wherever nvm or corepack put
// them, and pinning those to absolute paths would break more than it protects.
// `resolveGitBinary` reports a bad `VT_GIT_BINARY` as a cause object rather than
// as a missing install — and THIS RUNNER USED TO THROW THAT CAUSE AWAY, keeping
// only the path. A wrong `VT_GIT_BINARY` then surfaced as the generic "git is
// unavailable", sending the reader to look for a missing install rather than at
// the variable they had set wrongly. Same wrong-cause defect already fixed
// inside `git-facts`, left standing in its caller.
const RESOLVED_GIT = resolveGitBinary();
const GIT_BINARY = typeof RESOLVED_GIT === "string" ? RESOLVED_GIT : null;
const GIT_PROBLEM =
  RESOLVED_GIT !== null && typeof RESOLVED_GIT === "object" ? RESOLVED_GIT.problem : null;

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
  say(
    GIT_PROBLEM
      ? `\nverify:evidence cannot bind a report to a tree: ${GIT_PROBLEM}`
      : "\nverify:evidence cannot bind a report to a tree: git is unavailable or a git command failed.",
  );
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

/**
 * Kills that failed AFTER their gate had already settled, so they could not
 * reach that gate's own record. Run-level, and surfaced the way `GIT_PROBLEM`
 * is — printed, never written into the evidence report. BEST EFFORT BY
 * CONSTRUCTION: `taskkill` answers asynchronously and this process exits when
 * the last gate settles, so a late answer can be lost. An empty list is
 * therefore not proof that nothing was left running, which is exactly why it
 * must not appear in the report as if it were.
 */
const TERMINATION_PROBLEMS = [];

/** Record a termination outcome at run level, if the decision says it matters. */
function noteTermination(outcome) {
  const problem = terminationProblem(outcome);
  if (problem) TERMINATION_PROBLEMS.push(problem);
}

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
    // On Windows `npm` and `pnpm` are `.cmd` shims. RENAMING THE TOKEN TO
    // `npm.cmd` WAS NOT A FIX: a `.cmd` is a script, not an executable image, so
    // `spawn` with `shell: false` cannot start it at all — the gates would have
    // failed to launch on the one platform that branch existed to support, and
    // the code claimed a portability it did not have. It has to reach the
    // command processor explicitly. Every token has already passed `GATE_TOKEN`,
    // so none carries a space or a metacharacter, and the shell stays off.
    const { command, args: spawnArgs } = gateInvocation(
      rawCommand,
      args,
      process.platform,
      process.env.COMSPEC,
    );
    const started = Date.now();
    // POSIX: its own process GROUP, so the timeout below can signal the whole
    // tree. A gate is an `npm`/`pnpm` script, which spawns descendants; killing
    // only the direct child leaves those holding the output pipes open, `close`
    // never fires, and `Promise.all` waits forever — the hang the timeout exists
    // to convert into a recorded FAIL.
    const ownGroup = process.platform !== "win32";
    const child = spawn(command, spawnArgs, { cwd: ROOT, shell: false, detached: ownGroup });
    const collected = createOutputCollector(MAX_OUTPUT_BYTES);

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
        output: collected.text,
      });
    };

    const timer = setTimeout(() => {
      collected.note(`\nrefused: gate exceeded ${GATE_TIMEOUT_MS}ms and was killed`);
      if (ownGroup && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (err) {
          // A BARE `catch {}` HERE READ TWO OPPOSITE EVENTS AS ONE: "the tree
          // already exited" (ESRCH — what the kill was for) and "the tree is
          // still running and I may not signal it" (EPERM). Only the first is
          // benign, and the second is the one whoever reads this log needs. The
          // gate has not settled yet, so this one lands in its own record.
          const problem = terminationProblem({ how: "signal", code: err?.code, message: err?.message });
          if (problem) collected.note(`\n${problem}`);
        }
      } else if (child.pid) {
        // Windows has no process group to signal, and `kill` reaches only the
        // direct child — here the `cmd.exe` shim — leaving the npm process and
        // its descendants running against the checkout after this gate has
        // already been recorded as failed. `taskkill /T` walks the tree.
        //
        // ABSOLUTE, not searched on PATH — the rule this file states at the
        // top for git and which my first version of this line broke. A
        // process-tree killer picked up from PATH is a worse thing to get
        // wrong than the hang it exists to clean up.
        const systemRoot = process.env.SystemRoot || String.raw`C:\Windows`;
        const killer = spawn(
          path.join(systemRoot, "System32", "taskkill.exe"),
          ["/T", "/F", "/PID", String(child.pid)],
          { stdio: "ignore", shell: false },
        );
        // AN `error` EVENT WITH NO LISTENER IS THROWN, NOT IGNORED. A
        // `taskkill.exe` that would not start therefore crashed this runner
        // instead of letting it write the FAIL it had just decided on — the
        // precise outcome the timeout exists to prevent. The `try`/`catch` this
        // replaced could never have caught it: the event is asynchronous.
        killer.on("error", (err) => noteTermination({ how: "taskkill", code: err?.code, message: err?.message }));
        // And a taskkill that RAN and reported failure left the tree alive while
        // the runner said nothing, because nobody read its status.
        killer.on("exit", (code) => noteTermination({ how: "taskkill", code }));
        killer.unref();
      }
      // There is deliberately no third branch. No `child.pid` means `spawn`
      // never produced a process, the `error` listener below has already
      // settled this gate, and the `child.kill()` that used to sit here was a
      // no-op standing in for one.
      settle(1);
    }, GATE_TIMEOUT_MS);

    // BOUNDED, and the bound lives in `createOutputCollector` rather than here:
    // gates run concurrently through `Promise.all`, so an unbounded buffer means
    // every verbose gate on a large tree holds its whole log in memory at once.
    // The collector reserves the truncation marker's own bytes, decodes each
    // stream with its own stateful decoder, and routes the runner's diagnostics
    // through the same budget — all of which a test can now drive directly.
    const fromStdout = collected.stream();
    const fromStderr = collected.stream();
    child.stdout.on("data", (chunk) => fromStdout.write(chunk));
    child.stderr.on("data", (chunk) => fromStderr.write(chunk));
    child.stdout.on("end", () => fromStdout.end());
    child.stderr.on("end", () => fromStderr.end());
    child.on("error", (err) => {
      collected.note(String(err?.message ?? err));
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
// A gate this tool could not stop is still a recorded FAIL — but the processes
// it left behind are the next run's problem, so they get said out loud.
for (const problem of TERMINATION_PROBLEMS) say(`  warning: ${problem}`);
process.exit(failed.length === 0 ? 0 : 1);
