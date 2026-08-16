/**
 * Provenance of the deployed commit — the verifier half.
 *
 * scripts/verify-prod-deploy.ts polls /api/version until `gitCommit` matches the
 * target. Four server states have to be told apart, and each needs its own verdict:
 *
 *   1. a non-empty gitCommit that differs from the target  → genuinely mid-deploy,
 *      keep polling for the full timeout. Legitimate.
 *   2. no gitCommit on an otherwise valid JSON object      → the server cannot
 *      report its revision. Waiting cannot change a null, so this must fail with
 *      its own message — but only after a short grace window, because during a
 *      Railway cutover the OLD container answers briefly and it reports null.
 *   3. unreachable                                         → transient, never a
 *      verdict on its own.
 *   4. a response that is not a readable JSON version payload — wrong status,
 *      wrong content-type, OR a body that contradicts its content-type → a ROUTING
 *      fault, and emphatically not state 2. (An earlier version of this header
 *      lumped "non-JSON" in with state 3 as merely transient; it is not, and the
 *      "misrouted /api/version" and "unreadable body" describes below pin that.)
 *
 * Before this suite, state 2 was indistinguishable from state 1: the script
 * polled a structurally unreachable predicate 22 times and then reported
 * "did not match within 600s", which reads as a slow deploy and sends the reader
 * to look at build times rather than build provenance. States 4 and 2 then took
 * three further rounds to separate — see the round-4 describes further down.
 *
 * Round 5 covers the OTHER consumer of the same body seam, the /api/health hint in
 * main(), which had no test whatsoever — which is exactly why round 4 could break it
 * invisibly while hardening the poll path above it. Round 6 covers what round 5
 * missed there: it gated on body SHAPE without gating on TRANSPORT, so a JSON 404 or
 * 502 still reached the worker verdict. See the last two describes.
 */
import { describe, it, expect, vi } from "vitest";
import { spawn, execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

// Every case here spawns a real `tsx` child that `spawnVerifier` lets run for up
// to 45s, but the root config sets no `testTimeout`, so Vitest's 5s default
// applied. Fifty-one cases carried their own `}, N)` and were fine; the seven
// worker-status cases did not, and were one slow spawn away from a timeout that
// looks like a verifier bug. Set once for the file rather than copied per case,
// so case 59 is covered by construction — a per-case argument still wins where
// one is given, which is why the existing tighter bounds keep their meaning.
vi.setConfig({ testTimeout: 90_000 });

const REPO_ROOT = process.cwd();
const SCRIPT = resolve(REPO_ROOT, "scripts/verify-prod-deploy.ts");
const TSX = resolve(REPO_ROOT, "node_modules/.bin/tsx");

const TARGET = "abcd1234";
const PROBE_PATHS = [
  "/api/appointments",
  "/api/billing",
  "/api/tasks/dashboard",
  "/api/shift-handover/summary",
  "/api/clinical-check-in/me/active",
];

/**
 * Stub production server. `commits` is consumed one entry per /api/version call;
 * the final entry repeats, so [null] means "always null".
 */
type RawResponse = { status: number; contentType: string; body: string };

async function startStub(
  commits: (string | null)[],
  opts: {
    destroyFirst?: number;
    /**
     * Serve /api/version as something other than a well-formed JSON 200 — the SPA
     * catch-all shell, a gateway error page, a JSON 404, or a body that contradicts
     * its own content-type. See the "misroutes" describe below.
     *
     * An ARRAY is consumed one entry per call with the last entry repeating (same
     * rule as `commits`), which is what lets a test pin the order in which two
     * different transport faults are reported.
     */
    versionRaw?: RawResponse | RawResponse[];
    /**
     * Serve /api/health as something other than the well-formed JSON 200 below.
     * Health is fetched exactly once, so unlike `versionRaw` this needs no
     * sequencing. See the round-5 describe at the bottom.
     */
    healthRaw?: RawResponse;
    /**
     * Kill the /api/health request instead of answering it. This CANNOT be
     * expressed as a `RawResponse` — the point is that no complete response is
     * ever produced — so it gets its own option rather than a contorted body.
     *
     *   "connect"  → the socket dies before any response: `fetch` itself rejects.
     *   "mid-body" → headers promise 4096 bytes, a fragment is written, then the
     *                socket dies: `fetch` RESOLVES and the body read rejects.
     *
     * Two cases, not one, because they throw from different awaits inside
     * fetchJson and only the second is reachable from a `JsonBody` tag.
     */
    healthDestroy?: "connect" | "mid-body";
    /**
     * Serve ONE probe path as the SPA shell (200 text/html) instead of the JSON 401
     * a mounted API route answers with, so `probeApi` fails and the run must exit 1.
     *
     * This exists so at least one case can exercise the /api/health block on a run
     * that is ALREADY FAILING. Every round-5 case is an exit-0 run, and a block that
     * is only ever observed on the happy path cannot be shown to be incapable of
     * masking a failure — the one property its own contract claims. It is also the
     * real drift main() documents: an unmatched /api path falling through to the SPA
     * catch-all.
     */
    probeShell?: string;
  } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const queue = [...commits];
  const rawQueue = opts.versionRaw
    ? Array.isArray(opts.versionRaw)
      ? [...opts.versionRaw]
      : [opts.versionRaw]
    : [];
  let destroyed = 0;
  const server: Server = createServer((req, res) => {
    // Simulates a container restarting mid-cutover: the socket dies, `fetch` throws.
    if (destroyed < (opts.destroyFirst ?? 0)) {
      destroyed += 1;
      req.socket.destroy();
      return;
    }
    const path = (req.url ?? "").split("?")[0];
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (path === "/api/version" && rawQueue.length > 0) {
      // `!` is safe under `length > 1`: the last entry is held and replayed
      // forever rather than shifted, so the queue can never drain to empty here.
      const raw = rawQueue.length > 1 ? rawQueue.shift()! : rawQueue[0];
      res.writeHead(raw.status, { "content-type": raw.contentType });
      return res.end(raw.body);
    }
    if (path === "/api/version") {
      // Same hold-the-last-entry contract as `rawQueue` above, so `!` cannot fire.
      const gitCommit = queue.length > 1 ? queue.shift()! : queue[0];
      return json(200, {
        version: "1.2.0",
        buildTag: "1.2.0-stub",
        gitCommit,
        builtAt: new Date().toISOString(),
        pilotMode: { backend: false, frontend: false, mismatch: false },
      });
    }
    if (path === "/api/health") {
      if (opts.healthDestroy === "connect") {
        req.socket.destroy();
        return;
      }
      if (opts.healthDestroy === "mid-body") {
        res.writeHead(200, { "content-type": "application/json", "content-length": "4096" });
        res.write('{"status":"o');
        setTimeout(() => res.socket?.destroy(), 50);
        return;
      }
      if (opts.healthRaw) {
        res.writeHead(opts.healthRaw.status, { "content-type": opts.healthRaw.contentType });
        return res.end(opts.healthRaw.body);
      }
      return json(200, { status: "ok", checks: { db: "ok", worker: "ok" } });
    }
    if (opts.probeShell && path === opts.probeShell) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html><div id=root>");
    }
    if (PROBE_PATHS.includes(path)) {
      return json(401, { error: "UNAUTHENTICATED" });
    }
    return json(404, { error: "NOT_FOUND", reason: "no_matching_api_route" });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  // `address()` is typed `string | AddressInfo | null` to cover pipe servers and
  // the pre-listen state; this one is TCP and the listen callback has already
  // resolved, so AddressInfo is the only reachable shape.
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/**
 * Runs the verifier against the stub.
 *
 * This used to warn that "the target SHA must come FIRST: the script builds its
 * positional list by filtering out `--`-prefixed args only, so a URL placed before
 * it would silently become the target." That stopped being true when parseArgs
 * started consuming flag values, and the case "accepts the target AFTER the flags"
 * in this very file asserts the opposite — a comment disproved by a test twenty
 * lines further down. Argument order is now free; flags own their values.
 */
// Must be async: the stub server lives in THIS process, so a synchronous
// execFileSync would block the event loop and the server could never answer —
// every run would look like a hang regardless of what the script does.
function runRaw(
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; out: string; elapsedMs: number }> {
  return spawnVerifier(args, {
    // Collapse the production cadence so the suite stays fast; the ratio
    // (grace << full timeout) is what the assertions actually care about.
    VT_VERIFY_POLL_SECS: "0.2",
    VT_VERIFY_NULL_GRACE_SECS: "1",
    ...extraEnv,
  });
}

/**
 * Runs the verifier at the SHIPPED cadence — the two tunables are removed from the
 * child's environment entirely, not set to "".
 *
 * Every other case here collapses the cadence to 0.2s/1s, which is precisely the
 * configuration in which the null-grace deadline cannot collide with the loop
 * deadline. A suite that only ever runs in that shape cannot observe the defect
 * where the shipped defaults put those two deadlines on top of each other, so at
 * least one case has to run without them. Blank is NOT good enough: `envSeconds`
 * maps blank and absent to the same fallback, so `VT_VERIFY_POLL_SECS: ""` would
 * exercise the blank-is-unset branch and pass for the wrong reason.
 */
function runRawDefaultCadence(
  args: string[],
): Promise<{ code: number; out: string; elapsedMs: number }> {
  return spawnVerifier(args, {}, ["VT_VERIFY_POLL_SECS", "VT_VERIFY_NULL_GRACE_SECS"]);
}

function spawnVerifier(
  args: string[],
  extraEnv: Record<string, string>,
  deleteEnv: string[] = [],
): Promise<{ code: number; out: string; elapsedMs: number }> {
  const started = Date.now();
  const env = { ...(process.env as Record<string, string>), ...extraEnv };
  for (const key of deleteEnv) delete env[key];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(TSX, [SCRIPT, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    // Hard cap so a polling regression fails the test instead of hanging the suite.
    //
    // It REJECTS rather than resolving, and that is the whole point. `code ?? 1`
    // turned a SIGKILLed child into exit 1, which every failure-path case accepts
    // via `expect(code).not.toBe(0)` — so a hung verifier passed AS the expected
    // failure, and the cases without an `elapsedMs` bound could not see it at all.
    // The cap exists to catch a hang; a hang is never an expected outcome, so it
    // must fail every case unconditionally rather than be graded by its assertions.
    let killed = false;
    const killer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, 45_000);
    child.on("close", (code) => {
      clearTimeout(killer);
      if (killed) {
        rejectPromise(
          new Error(
            `verifier did not exit within 45s and was SIGKILLed — a hang, not a verdict. ` +
              `args=${JSON.stringify(args)} output so far:\n${out}`,
          ),
        );
        return;
      }
      resolvePromise({ code: code ?? 1, out, elapsedMs: Date.now() - started });
    });
  });
}

function runVerifier(
  url: string,
  extraEnv: Record<string, string> = {},
  timeoutSecs = 600,
  target: string = TARGET,
): Promise<{ code: number; out: string; elapsedMs: number }> {
  return runRaw([target, "--prod", url, "--timeout", String(timeoutSecs)], extraEnv);
}

/**
 * Forces `git rev-parse HEAD` to fail regardless of the child's cwd, so a test can
 * exercise "no target given AND none resolvable". Pointing GIT_DIR at a path that
 * does not exist is deterministic; relying on cwd not being inside a repo is not.
 */
const NO_GIT = { GIT_DIR: "/nonexistent-vettrack-verifier-test" };

describe("verify-prod-deploy — a server that cannot report its revision fails fast", () => {
  it("exits non-zero far inside the timeout, naming the missing revision", async () => {
    const stub = await startStub([null]);
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      // The diagnosis, not the misdirection: this must not read as a slow deploy.
      expect(out).toMatch(/cannot report its revision/i);
      expect(out).not.toMatch(/did not match .* within 600s/);
      // Full timeout is 600s; the null verdict must land in a small fraction of it.
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("treats an absent gitCommit field the same as an explicit null", async () => {
    const stub = await startStub([undefined as unknown as null]);
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      expect(out).toMatch(/cannot report its revision/i);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("treats an empty-string gitCommit the same as null", async () => {
    const stub = await startStub([""]);
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      expect(out).toMatch(/cannot report its revision/i);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

describe("verify-prod-deploy — polling behaviour that must survive the fail-fast change", () => {
  it("keeps polling a real mismatch and passes once the target appears", async () => {
    // A script that fail-fasts on ANY non-matching gitCommit would satisfy the null
    // tests above and break every real deploy. This is the guard against that.
    const stub = await startStub(["99999999", "88888888", `${TARGET}ffff`]);
    try {
      const { code, out } = await runVerifier(stub.url);
      expect(out).toContain("gitCommit=99999999");
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("rides out a null during cutover when the new container arrives inside the grace window", async () => {
    // Railway serves the OLD container briefly during handoff, and the old container
    // reports null. Exiting on the first null would turn that race into a false failure
    // on the very deploy that ships this fix.
    const stub = await startStub([null, null, `${TARGET}ffff`]);
    try {
      const { code, out } = await runVerifier(stub.url);
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("treats an unreachable server as transient and recovers", async () => {
    // A container restarting mid-cutover refuses connections / hangs up. Before this,
    // the fetch throw escaped waitForDeploy and exited 1 with a raw stack trace —
    // which, once this is wired into the merge gate, is an intermittent red-line.
    const stub = await startStub([`${TARGET}ffff`], { destroyFirst: 1 });
    try {
      const { code, out } = await runVerifier(stub.url);
      expect(out).toContain("[poll] unreachable:");
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not accuse a server that never answered of failing to report its revision", async () => {
    // "cannot report its revision" is a claim about a build. A server that is simply
    // down has made no such claim, and must get the timeout instead.
    const stub = await startStub([`${TARGET}ffff`]);
    const deadUrl = stub.url;
    await stub.close(); // nothing is listening on that port any more
    const { code, out } = await runVerifier(deadUrl, {}, 3);
    expect(code).not.toBe(0);
    expect(out).toContain("[poll] unreachable:");
    expect(out).not.toMatch(/cannot report its revision/i);
    expect(out).toMatch(/Timeout/);
  }, 90_000);

  it("rejects a malformed cadence env var instead of silently reverting to the default", async () => {
    // The same "a typo silently changes the settings the verifier ran under" that
    // `--timout` is now a hard error for. `Number("abc")` is NaN and `-5` is below
    // the floor; both previously reverted in silence, so the run reported on a
    // cadence the caller did not ask for and had no way to notice. Distinct from
    // BLANK, which stays a deliberate fallback (an unset `${{ vars.X }}` expands to
    // "" and zero-delay polling would be worse) — see the test below.
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runVerifier(stub.url, { VT_VERIFY_POLL_SECS: "abc" });
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).not.toContain("[poll]");
      expect(out).toMatch(/VT_VERIFY_POLL_SECS/);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("rejects a negative grace env var rather than clamping it out of sight", async () => {
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runVerifier(stub.url, { VT_VERIFY_NULL_GRACE_SECS: "-5" });
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).toMatch(/VT_VERIFY_NULL_GRACE_SECS/);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("treats a blank cadence env var as unset rather than as zero", async () => {
    // `${{ vars.X }}` with X undefined expands to "", and Number("") is 0 — which as
    // a grace window means "fail on the first null", the exact fragility the window
    // exists to remove, and as a poll interval means a tight loop.
    const stub = await startStub([null, null, `${TARGET}ffff`]);
    try {
      const { code, out } = await runVerifier(stub.url, {
        VT_VERIFY_POLL_SECS: "",
        VT_VERIFY_NULL_GRACE_SECS: "",
      });
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("runs the existing probe suite unchanged once the revision matches on the first poll", async () => {
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runVerifier(stub.url);
      expect(code).toBe(0);
      for (const path of PROBE_PATHS) expect(out).toContain(`PASS ${path}`);
      // The JSON-404 guard added for the SPA-catch-all regression must still run.
      expect(out).toContain("PASS /api/__does_not_exist__");
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * The verdict itself must not be forgeable by an empty string.
 *
 * `TARGET` was resolved with `??`, which only falls through on null/undefined —
 * NOT on "". An empty first argument therefore set `TARGET = ""`, and a production
 * reporting `gitCommit: null` yields `commit = ""`, so `"" === ""` matched on the
 * FIRST poll and the script printed ALL PROBES PASS and exited 0.
 *
 * That is the worst failure this file can have: the verifier reports success
 * against exactly the condition it exists to detect. It is reachable from the
 * recommended CI line (`... verify-prod-deploy.ts "$GITHUB_SHA"` with the variable
 * unset) and from the runbook's `$(git rev-parse HEAD | head -c 8)` whenever that
 * substitution comes back empty.
 */
describe("verify-prod-deploy — an unverifiable target is never a match", () => {
  it("refuses to poll at all when no target is given and none can be resolved", async () => {
    // Genuinely ABSENT: no positional at all. With flags consuming their own
    // values, neither the URL nor "600" can drift into the target slot, so this
    // exercises the absent branch without relying on a whitespace argument to
    // stand in for it.
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out, elapsedMs } = await runRaw(
        ["--prod", stub.url, "--timeout", "600"],
        NO_GIT,
      );
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      // The point of the guard: it fails BEFORE any network work happens.
      expect(out).not.toContain("[poll]");
      expect(out).toMatch(/no target commit/i);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("rejects a target too short to identify a commit instead of matching everything", async () => {
    // A 2-3 char "target" is a stray token (a bare `--timeout` value, a branch
    // fragment), not a SHA. Prefix-matching on it would match a large share of all
    // commits — a verifier that an accident can satisfy is worse than none.
    const stub = await startStub(["8ad7ecc8d1f2a3b4"]);
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url, {}, 600, "8ad");
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).not.toContain("[poll]");
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("rejects a non-hex target rather than polling a predicate that can never match", async () => {
    // A branch name reaching the target slot (however it got there) can never
    // match a SHA. It must be rejected, not polled for the full timeout.
    const stub = await startStub(["8ad7ecc8d1f2a3b4"]);
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url, {}, 600, "origin/main");
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).not.toContain("[poll]");
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/** Local HEAD, or "" outside a checkout. The empty-target tests below need production to report it. */
const LOCAL_HEAD = (() => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
})();

/**
 * An argument that was SUPPLIED and evaporated is a broken command line, not a
 * request for the default.
 *
 * `TARGET` resolved as `positional[0]?.trim() || gitHeadOrEmpty()`. `||` cannot
 * tell "no argument given" (fall back to HEAD — legitimate) from "an argument was
 * given and it came back empty" (the caller's `$GITHUB_SHA` / `$(git rev-parse
 * HEAD | head -c 8)` produced nothing — must be loud). The second silently became
 * the first, so on a runner whose checkout is at the same commit production is
 * serving, the verifier matched on the first poll and exited 0 having verified
 * nothing the caller asked for.
 *
 * That is the same falsy-but-present class as the `??` this file already documents,
 * one layer up: the defect is no longer in how the value is TESTED but in the
 * parser handing "absent" and "present-but-empty" to the caller as one value.
 */
describe("verify-prod-deploy — a supplied-but-empty target is a broken command line, not a default", () => {
  it("refuses an empty first argument even when git HEAD would have matched production", async () => {
    // The trap this pins: production is serving exactly this checkout's HEAD, so
    // the HEAD fallback matches on poll #1 and every probe passes. Nothing about
    // the run looks wrong — and the target the caller actually passed was never
    // verified, because there wasn't one. Note NO `NO_GIT` here: the whole point
    // is that this must fail with git perfectly resolvable.
    expect(LOCAL_HEAD).not.toBe("");
    const stub = await startStub([LOCAL_HEAD]);
    try {
      const { code, out, elapsedMs } = await runRaw(["", "--prod", stub.url, "--timeout", "20"]);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(code).not.toBe(0);
      // Must fail before any network work — not poll, match, and then object.
      expect(out).not.toContain("[poll]");
      // The verdict has to name what actually happened. Reporting "no target
      // commit" here would describe the absent case and send the reader looking
      // for a missing argument rather than an empty one.
      expect(out).toMatch(/empty/i);
      expect(out).not.toMatch(/no target commit/i);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("refuses a whitespace-only first argument on the same grounds", async () => {
    expect(LOCAL_HEAD).not.toBe("");
    const stub = await startStub([LOCAL_HEAD]);
    try {
      const { code, out } = await runRaw(["   ", "--prod", stub.url, "--timeout", "20"]);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(code).not.toBe(0);
      expect(out).not.toContain("[poll]");
      expect(out).toMatch(/empty/i);
    } finally {
      await stub.close();
    }
  }, 90_000);

});

/**
 * Junk on the command line must stop the run.
 *
 * Once flags consume their own values, anything left over is unambiguous junk —
 * and every one of these silently reverted to a DEFAULT before, which is the same
 * "unverifiable input slipped past" failure in a new place. `--timout 5` (typo)
 * quietly restored the 600s timeout; a stray extra positional was dropped on the
 * floor. Under the script's stated invariant — AN UNVERIFIABLE INPUT IS NEVER A
 * MATCH — both are hard errors.
 */
describe("verify-prod-deploy — junk arguments stop the run instead of reverting to defaults", () => {
  it("rejects a misspelled flag instead of silently using the default it shadows", async () => {
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runRaw([TARGET, "--prod", stub.url, "--timout", "20"]);
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).not.toContain("[poll]");
      expect(out).toMatch(/--timout/);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("rejects a stray extra positional rather than ignoring it", async () => {
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runRaw([TARGET, "--prod", stub.url, "--timeout", "20", "stray"]);
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).not.toContain("[poll]");
      expect(out).toMatch(/stray/);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("rejects a flag whose value was swallowed by the next flag", async () => {
    // `--prod --timeout 20` used to make "--timeout" look like --prod's value and
    // "20" a positional, i.e. the TARGET. Neither may be guessed at.
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runRaw([TARGET, "--prod", "--timeout", "20"]);
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).not.toContain("[poll]");
      expect(out).toMatch(/--prod/);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("accepts the target AFTER the flags, because flags now consume their own values", async () => {
    // The old parser built positionals as "every arg not starting with --", so a
    // flag's value became the target and the header had to warn that the target
    // "must come FIRST". With values consumed, that footgun is gone.
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runRaw(["--prod", stub.url, "--timeout", "20", TARGET]);
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * The revision diagnosis has to survive the SHIPPED defaults, not just the
 * collapsed cadence every other case here runs at.
 *
 * `nullDeadline` was `started + min(NULL_GRACE_MS, TIMEOUT_MS)`, and the loop body
 * ran only while `now < deadline` while the null check asked `now >= nullDeadline`.
 * Whenever the timeout is at or below the grace window the two collapse onto the
 * same instant, and those conditions become mutually exclusive — so the whole
 * "cannot report its revision" feature was UNREACHABLE, not merely slow, for every
 * timeout <= 60s. That covers every invocation in
 * docs/evidence/demo-2026-05-28/railway-redeploy-runbook.md (`--timeout 5`,
 * `--timeout 30`) and the summary doc's `--timeout 10`.
 *
 * The suite could not see it because every case set VT_VERIFY_POLL_SECS=0.2 and
 * VT_VERIFY_NULL_GRACE_SECS=1 — a shape in which grace << timeout and the two
 * deadlines cannot coincide. Tuning the system into a configuration where the bug
 * cannot occur is not testing the system, so this case runs with those variables
 * absent from the child environment entirely.
 */
describe("verify-prod-deploy — the revision diagnosis fires at the shipped default cadence", () => {
  it("diagnoses a null-reporting production on the runbook's own `--timeout 5`", async () => {
    const stub = await startStub([null]);
    try {
      const { code, out, elapsedMs } = await runRawDefaultCadence([
        TARGET,
        "--prod",
        stub.url,
        "--timeout",
        "5",
      ]);
      expect(code).not.toBe(0);
      // The whole point of the feature: name the build, not the clock.
      expect(out).toMatch(/cannot report its revision/i);
      // The misdirection it replaces — "did not match within 5s" reads as a slow
      // deploy and sends the reader to look at build times.
      expect(out).not.toMatch(/did not match/i);
      // Unfixed this takes a full poll interval (~10.6s) to report a 5s timeout,
      // because the sleep is not bounded by either deadline. Fixed, it cannot
      // outrun its own timeout.
      expect(elapsedMs).toBeLessThan(8_000);
      // Proves this case really did run at the SHIPPED cadence rather than
      // silently inheriting the 0.2s one — which would make every assertion above
      // hold for the wrong reason. At the defaults, grace (60s) is beyond the 5s
      // deadline, so the clamped sleep goes straight there: one poll, occasionally
      // two. At the collapsed cadence it would be roughly 25, so a small bound
      // discriminates just as sharply as an exact one.
      //
      // NOT pinned to exactly 1: the sleep is aimed exactly AT `deadline` and the
      // loop then re-tests `Date.now() < deadline`, so a wake landing on the
      // boundary instant runs one extra poll before exiting. Seen once, on the
      // first run after an edit (cold tsx transform cache); a 48-sample harness ran
      // warm and so could not reproduce that profile. The arithmetic behind it is
      // untouched by this round. An exact-count assertion turns that boundary into
      // an intermittent red line in the merge gate, which is a worse failure than
      // the imprecision it buys — the claim being checked is "shipped cadence, not
      // collapsed cadence" (~25 polls), and <= 2 checks exactly that. A zero-poll
      // run cannot reach here: the revision verdict asserted above requires one.
      expect(out.match(/\[poll\]/g)?.length ?? 0).toBeLessThanOrEqual(2);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not blame the build SHA for a misroute at the shipped default cadence", async () => {
    // Same collapsed-deadline hole, other verdict: the more specific routing
    // diagnosis must also survive a short timeout.
    const stub = await startStub([null], {
      versionRaw: { status: 200, contentType: "text/html", body: "<!doctype html><div id=root>" },
    });
    try {
      const { code, out, elapsedMs } = await runRawDefaultCadence([
        TARGET,
        "--prod",
        stub.url,
        "--timeout",
        "5",
      ]);
      expect(code).not.toBe(0);
      expect(out).toMatch(/not answering as JSON/i);
      expect(out).not.toMatch(/cannot report its revision/i);
      expect(out).not.toMatch(/build-info\.json without a commit SHA/i);
      expect(elapsedMs).toBeLessThan(8_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("still gives a genuinely unreachable server the plain timeout at default cadence", async () => {
    // The ordering that must survive: "cannot report its revision" is a claim about
    // a BUILD. A server that never answered has made no such claim and must get the
    // generic timeout instead — otherwise the fix trades one confident wrong
    // diagnosis for another.
    const stub = await startStub([`${TARGET}ffff`]);
    const deadUrl = stub.url;
    await stub.close();
    const { code, out, elapsedMs } = await runRawDefaultCadence([
      TARGET,
      "--prod",
      deadUrl,
      "--timeout",
      "3",
    ]);
    expect(code).not.toBe(0);
    expect(out).toContain("[poll] unreachable:");
    expect(out).not.toMatch(/cannot report its revision/i);
    expect(out).toMatch(/Timeout/);
    expect(elapsedMs).toBeLessThan(8_000);
  }, 90_000);
});

/**
 * A 7-char target is git's `--short` default and exactly what GitHub's commit UI
 * offers for copy-paste, so it is the most likely thing a human pastes here.
 *
 * `TARGET` was `.slice(0, 8)`'d while `commit` was always `reported.slice(0, 8)`,
 * so a target shorter than 8 could never equal the reported slice: a CORRECT
 * deploy polled to the full timeout and reported failure.
 */
describe("verify-prod-deploy — abbreviated targets match on the common prefix", () => {
  it("matches a 7-char target against a full reported SHA", async () => {
    const stub = await startStub(["8ad7ecc8d1f2a3b4c5d6e7f8"]);
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20, "8ad7ecc");
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("still refuses a 7-char target whose prefix differs", async () => {
    // The prefix comparison must not degenerate into "short target matches anything".
    const stub = await startStub(["9999999000000000"]);
    try {
      const { code, out } = await runVerifier(stub.url, {}, 3, "8ad7ecc");
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).toMatch(/Timeout/);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("matches a full 40-char target against a shorter reported commit", async () => {
    // The reported side is abbreviated by whatever produced build-info.json; the
    // comparison length is the shorter of the two, not a hardcoded 8.
    const full = "8ad7ecc8d1f2a3b4c5d6e7f8091a2b3c4d5e6f70";
    const stub = await startStub(["8ad7ecc8"]);
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20, full);
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * `/api/version` answering with something other than JSON is a ROUTING fault, and
 * must not be reported as a build-provenance fault.
 *
 * `waitForDeploy` discarded the status and content-type that `fetchJson` already
 * computed, and `res.json().catch(() => ({}))` collapsed the SPA shell, a gateway
 * error page, and a JSON 404 all into `{}` — i.e. into `reported === ""`. The
 * grace window then expired and the script confidently declared that "the running
 * build produced build-info.json without a commit SHA", sending the reader to
 * inspect write-build-sha.sh for a fault that is actually in the route mounting.
 * This file already devotes a whole probe to "unmatched /api paths must be JSON
 * 404, not the SPA shell"; its own version poll has to hold the same line.
 */
describe("verify-prod-deploy — a misrouted /api/version is not blamed on the build SHA", () => {
  it("does not accuse the build when /api/version returns the SPA shell", async () => {
    const stub = await startStub([null], {
      versionRaw: { status: 200, contentType: "text/html", body: "<!doctype html><div id=root>" },
    });
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      // The misdiagnosis this test exists to prevent.
      expect(out).not.toMatch(/build-info\.json without a commit SHA/i);
      expect(out).not.toMatch(/cannot report its revision/i);
      // The real fault, named.
      expect(out).toMatch(/text\/html/);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not accuse the build when /api/version is a JSON 404", async () => {
    const stub = await startStub([null], {
      versionRaw: {
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "NOT_FOUND" }),
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      expect(out).not.toMatch(/build-info\.json without a commit SHA/i);
      expect(out).toMatch(/404/);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * The content-type gate is not the whole check — the BODY has to be readable too.
 *
 * Round 3 moved the routing/build-provenance discriminator up to status +
 * content-type, and the describe above pins it. But the body-level collapse
 * survived underneath: `fetchJson` mapped any `res.json()` rejection to `{}`, so a
 * response that DECLARES `application/json` and then serves HTML passed the gate,
 * produced `commit === ""`, and was reported as "the running build produced
 * build-info.json without a commit SHA — check that scripts/write-build-sha.sh ran".
 *
 * That sends an operator to inspect the SHA writer during a production incident
 * when the fault is in routing. A CDN error page, a proxy that stamps a default
 * content-type, and an SPA catch-all behind a JSON-forcing edge rule all produce
 * exactly this shape.
 *
 * These cases assert on the SNIPPET as well as the verdict: naming what was
 * actually observed is what separates "the body was unreadable" from "the body was
 * an empty object", which is the distinction `{}` destroyed.
 */
describe("verify-prod-deploy — a JSON content-type over an unreadable body is a routing fault", () => {
  it("does not blame the SHA writer when the body contradicts its own content-type", async () => {
    const stub = await startStub([null], {
      versionRaw: {
        status: 200,
        contentType: "application/json",
        body: "<!doctype html><div id=root>",
      },
    });
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      // The misdiagnosis: both the claim and the file it sends the reader to.
      expect(out).not.toMatch(/cannot report its revision/i);
      expect(out).not.toMatch(/build-info\.json/i);
      expect(out).not.toMatch(/write-build-sha/i);
      // The real fault, named — and the evidence for it, quoted.
      expect(out).toMatch(/could not be read as a JSON object/i);
      expect(out).toMatch(/<!doctype/i);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("reports a JSON `null` body as unreadable instead of crashing with a stack trace", async () => {
    // `JSON.parse("null")` SUCCEEDS, so this survives any parse-only guard and
    // reaches the field read as `null.gitCommit` — a TypeError thrown outside
    // classifyPoll's try, which escapes waitForDeploy entirely and lands in
    // main().catch() as a raw stack trace with no verdict at all.
    const stub = await startStub([null], {
      versionRaw: { status: 200, contentType: "application/json", body: "null" },
    });
    try {
      const { code, out, elapsedMs } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      // Not "a different crash" — no crash.
      expect(out).not.toMatch(/TypeError/);
      expect(out).not.toMatch(/at classifyPoll/);
      expect(out).toMatch(/could not be read as a JSON object/i);
      expect(out).not.toMatch(/cannot report its revision/i);
      expect(elapsedMs).toBeLessThan(15_000);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("reports a JSON array body as unreadable rather than as a build with no SHA", async () => {
    // Parses cleanly and has no `gitCommit`, so it reached `no-revision` as the
    // third producer of that verdict — a build-provenance claim about a response
    // that is not a version payload at all.
    const stub = await startStub([null], {
      versionRaw: { status: 200, contentType: "application/json", body: "[]" },
    });
    try {
      const { code, out } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      expect(out).toMatch(/could not be read as a JSON object/i);
      expect(out).not.toMatch(/cannot report its revision/i);
      expect(out).not.toMatch(/write-build-sha/i);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("reports the transport fault seen MOST RECENTLY when a poll sequence shows both", async () => {
    // Pins the rule rather than leaving it emergent: the two routing verdicts are
    // last-write-wins. Here an unreadable-body poll is followed by repeated
    // text/html, so the generic shape verdict must win — an implementation that
    // latched "unreadable" on first sight would report the wrong one, and an
    // implementation that let the first bogus poll count as a real JSON sighting
    // would fall through to the build-provenance verdict (which is what it did).
    const stub = await startStub([null], {
      versionRaw: [
        { status: 200, contentType: "application/json", body: "<!doctype html>" },
        { status: 200, contentType: "text/html", body: "<!doctype html><div id=root>" },
      ],
    });
    try {
      const { code, out } = await runVerifier(stub.url);
      expect(code).not.toBe(0);
      expect(out).toMatch(/not answering as JSON/i);
      expect(out).toMatch(/text\/html/);
      expect(out).not.toMatch(/cannot report its revision/i);
      expect(out).not.toMatch(/write-build-sha/i);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * A FALSE FAIL on a verifiable input — the failure direction this file's stated
 * invariant does not cover.
 *
 * "AN UNVERIFIABLE INPUT IS NEVER A MATCH" guards one direction only: it stops a
 * bad input forging a PASS. Nothing in it stops the script REJECTING an input that
 * is perfectly verifiable, and this file has now shipped that bug three rounds out
 * of four: `slice(0, 8)` made a correct 7-char target unmatchable; the collapsed
 * null-grace deadline made the specific verdicts unreachable below `--timeout 60`;
 * and here `resolveTarget` lowercases the target while the reported commit is
 * compared as-received, so an UPPERCASE SHA cannot match a byte-identical target.
 *
 * Uppercase SHAs are not hypothetical: they are what a hand-copied commit from a
 * ticket, a `tr a-z A-Z`-normalising CI variable, or a Windows-side toolchain hands
 * over. The verifier then polls a predicate that can never hold and reports a
 * timeout on a deploy that landed correctly.
 */
describe("verify-prod-deploy — commit comparison is case-insensitive in both directions", () => {
  it("matches an UPPERCASE reported SHA against a byte-identical target", async () => {
    // Byte-identical on both sides. Any failure here is one the script INVENTED:
    // there is no interpretation of these two inputs under which they differ.
    const SHA = "8AD7ECC8D1F2A3B4";
    const stub = await startStub([SHA]);
    try {
      const { code, out } = await runVerifier(stub.url, {}, 3, SHA);
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
      // The comparison is normalised, so the log is too — pinned so a later change
      // cannot quietly reintroduce a case-sensitive path via the printed value.
      expect(out).toContain("gitCommit=8ad7ecc8");
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("matches a lowercase target against a mixed-case reported SHA", async () => {
    const stub = await startStub(["8Ad7EcC8d1F2a3B4"]);
    try {
      const { code, out } = await runVerifier(stub.url, {}, 3, "8ad7ecc8d1f2a3b4");
      expect(out).toContain("ALL PROBES PASS");
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("still refuses a case-insensitively DIFFERENT commit", async () => {
    // Normalising case must absorb a spurious failure, never manufacture a match.
    const stub = await startStub(["9999999000000000"]);
    try {
      const { code, out } = await runVerifier(stub.url, {}, 3, "8AD7ECC8");
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).toMatch(/Timeout/);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * The same empty-string class on the remaining two inputs. Neither can forge a
 * PASS, but both turn a typo into a confidently-worded wrong diagnosis: an unset
 * `${{ vars.PROD_URL }}` expands to "" and `--prod ""` then makes every fetch throw
 * a URL parse error, which the poll loop reports as "unreachable" for the full
 * timeout — i.e. it blames production for a malformed command line.
 */
describe("verify-prod-deploy — malformed transport arguments fail fast and honestly", () => {
  it("rejects an empty --prod instead of reporting production unreachable", async () => {
    const { code, out, elapsedMs } = await runRaw([TARGET, "--prod", "", "--timeout", "600"]);
    expect(code).not.toBe(0);
    expect(out).not.toContain("ALL PROBES PASS");
    expect(out).not.toContain("[poll] unreachable");
    expect(out).toMatch(/--prod/);
    expect(elapsedMs).toBeLessThan(15_000);
  }, 90_000);

  it("rejects a --timeout with no value instead of timing out instantly", async () => {
    // `--timeout` as the last argument makes the value `undefined`; `Number(undefined) * 1000`
    // is NaN, `Date.now() < NaN` is false, so the poll loop never runs a single
    // iteration and the script reports "did not match ... within NaNs".
    const stub = await startStub([`${TARGET}ffff`]);
    try {
      const { code, out } = await runRaw([TARGET, "--prod", stub.url, "--timeout"]);
      expect(code).not.toBe(0);
      expect(out).not.toContain("ALL PROBES PASS");
      // The regression is NaN reaching a VERDICT, not the word appearing in the
      // error text that explains the mechanism.
      expect(out).not.toMatch(/within NaNs/);
      expect(out).not.toMatch(/TIMEOUT=NaN/);
      expect(out).not.toContain("[poll]");
      expect(out).toMatch(/--timeout/);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * The /api/health block is a HINT, and a hint must not be able to lie or to fail
 * the build. Round 5.
 *
 * This block had NO test at all, which is why round 4 could break it invisibly
 * while hardening the poll path immediately above it. Two defects shipped:
 *
 *   D1 — a loud crash was replaced by a SILENT WRONG VERDICT that exits 0. A JSON
 *        `null` body used to reach `null.checks` and die visibly; round 4's
 *        `health.body.value?.checks` turned that into `checks=undefined`, which
 *        fails `checks?.worker !== "ok"` and prints "WARN worker check is not ok
 *        (redeploy Worker after #508 merge)". The operator gets a GREEN run that
 *        simultaneously orders them to redeploy a Worker that is perfectly
 *        healthy. Measured against this file's own doctrine — a confident wrong
 *        diagnosis sends an operator to the wrong component — that is strictly
 *        worse than the crash it replaced, because the crash was at least honest.
 *        The optional chain silently converts "I could not read this" into "the
 *        worker is down".
 *
 *   D2 — `fetchJson` awaits `fetch()` and `res.text()` with no try/catch of its
 *        own. `classifyPoll` wraps its call; this call site did not, so either
 *        rejection propagated to `main().catch` and exited 1 with a raw stack
 *        trace and NO verdict — after the target matched, pilotMode passed, all
 *        five probes passed and the JSON-404 guard passed. That inverts the
 *        block's stated contract that it "has always been a WARN".
 *
 * The cases below therefore assert exit 0 throughout. That is deliberate and is
 * the whole point: a diagnostic hint that can fail the gate is not a hint. The
 * claim under test is never "health is fine", it is "the run's verdict and the
 * worker instruction both stay honest no matter what /api/health does".
 */
describe("verify-prod-deploy — the /api/health hint can neither lie nor fail the run", () => {
  const MATCHING = [`${TARGET}ffff`];

  it("does not blame the worker for a JSON `null` health body", async () => {
    // D1, the exact reported shape. `JSON.parse("null")` succeeds, so no
    // parse-level guard covers this; only a `typeof`/`null`/`Array` check does.
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: "null" },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      // The two halves of the wrong output, each pinned separately.
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/worker check is not ok/i);
      expect(out).not.toMatch(/checks=undefined/);
      // The honest replacement: name the shape, quote it, and disclaim the worker.
      expect(out).toMatch(/is null, not an object/i);
      expect(out).toMatch(/not a worker fault/i);
      // Non-fatal by construction — widening this block to a failure is exactly
      // what the block's own contract forbids.
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not blame the worker for a JSON array health body", async () => {
    // Same class as `null`: parses cleanly, is not a version/health object, and
    // `?.checks` yields undefined on it just as silently.
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: "[]" },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/checks=undefined/);
      expect(out).toMatch(/is an array, not an object/i);
      expect(out).toMatch(/not a worker fault/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not blame the worker for a bare JSON primitive health body", async () => {
    // The third arm of the shape ternary. `null` and `[]` above are both `typeof
    // "object"`, so neither reaches the `a ${typeof value}` branch — without this
    // case that arm is dead in test, and a branch no test executes is precisely how
    // the defect this round is fixing survived into a shipped file.
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: '"ok"' },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/checks=undefined/);
      expect(out).toMatch(/is a string, not an object/i);
      expect(out).toMatch(/not a worker fault/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not blame the worker when /api/health serves the SPA shell", async () => {
    // The branch round 4 DID add, which had no test either. Locked so a later
    // restructure cannot quietly fold it back into the worker verdict.
    //
    // Round 6 reclassified this case, and the headline below moved with it: a
    // `text/html` response now fails the TRANSPORT gate before any body-shape gate
    // sees it, so it is reported as "did not answer as a JSON health report" rather than as an
    // unparseable body. The same shared headline cannot serve both, because a JSON
    // 404 does return readable JSON and is still not a health payload. What this
    // case actually asserts — the worker is not blamed, the bytes are quoted, the
    // disclaimer is present — is unchanged.
    const stub = await startStub(MATCHING, {
      healthRaw: {
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><div id=root>",
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).toMatch(/did not answer as a JSON health report/i);
      expect(out).toMatch(/<!doctype/i);
      expect(out).toMatch(/not a worker fault/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("stays green with a verdict when the /api/health body dies mid-read", async () => {
    // D2 as reported: `fetch` RESOLVES, then `await res.text()` rejects with
    // `TypeError: terminated`. Unguarded, this exits 1 with a bare stack trace
    // after every probe has already passed.
    const stub = await startStub(MATCHING, { healthDestroy: "mid-body" });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(code).toBe(0);
      // A verdict was reached at all — the thing the unguarded throw destroyed.
      expect(out).toContain("ALL PROBES PASS");
      expect(out).not.toMatch(/TypeError/);
      expect(out).toMatch(/\/api\/health could not be read/i);
      expect(out).toMatch(/not a worker fault/i);
      expect(out).not.toMatch(/redeploy Worker/i);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("stays green with a verdict when /api/health cannot be reached at all", async () => {
    // The same defect one await EARLIER: `fetch` itself rejects, so no `JsonBody`
    // is ever produced. Found while choosing D2's seam, and it is what rules the
    // "third JsonBody tag" option out — a tag on the body cannot describe a
    // failure that happens before there is a body. Only a block-level guard covers
    // both, which is why the fix is placed where it is.
    const stub = await startStub(MATCHING, { healthDestroy: "connect" });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(code).toBe(0);
      expect(out).toContain("ALL PROBES PASS");
      expect(out).not.toMatch(/TypeError/);
      expect(out).toMatch(/\/api\/health could not be read/i);
      expect(out).not.toMatch(/redeploy Worker/i);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("still warns about a genuinely not-ok worker", async () => {
    // The counterweight: silencing the false warning must not silence the true
    // one. Without this, deleting the warning outright would pass every case above.
    const stub = await startStub(MATCHING, {
      healthRaw: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "degraded", checks: { db: "ok", worker: "down" } }),
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).toMatch(/redeploy Worker/i);
      expect(out).toContain('"worker":"down"');
      // Still only a warning, exactly as before.
      expect(code).toBe(0);
      expect(out).toContain("ALL PROBES PASS");
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("says nothing about the worker when the worker is ok", async () => {
    // The other counterweight: no false positive on the healthy path.
    const stub = await startStub(MATCHING);
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/not a worker fault/i);
      expect(out).toContain('"worker":"ok"');
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);
});

/**
 * Round 6. The health hint discriminated BODY SHAPE but not TRANSPORT, and did not
 * check that it had actually read a worker status before pronouncing on the worker.
 *
 * So a 404 or a 502 that happens to carry a JSON body — a gateway error page, an
 * unmatched route answering JSON — sailed past every shape gate round 5 added,
 * reached `checks?.worker`, found nothing, and printed "WARN worker check is not ok
 * (redeploy Worker after #508 merge)". Same wrong-component diagnosis that justified
 * round 5, from a third producer, and it sends an on-call engineer to redeploy a
 * healthy Worker because a route returned 502.
 *
 * The asymmetry was exact. classifyPoll gates in FIVE steps — status+content-type,
 * unparseable, parsed-non-object, object-that-named-a-commit, object-that-named-none.
 * The health block gated in THREE — unparseable, parsed-non-object, everything else —
 * and "everything else" was doing the work of the other two.
 *
 * The cases below are the transport half (a JSON 404, a JSON 502) and the field half
 * (`checks` present but not an object, `checks` present with no `worker` key), plus
 * the case round 5 never wrote: the block exercised on a run that is already FAILING,
 * which is the only shape that can show it does not mask a failure.
 */
describe("verify-prod-deploy — the /api/health hint only speaks about what it read", () => {
  const MATCHING = [`${TARGET}ffff`];

  it("does not blame the worker for a JSON 404 from /api/health", async () => {
    // A JSON body on a 404 satisfies every shape gate round 5 added, so it reached
    // the `checks` read and was reported as a worker fault.
    const stub = await startStub(MATCHING, {
      healthRaw: {
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "NOT_FOUND", reason: "no_matching_api_route" }),
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/worker check is not ok/i);
      // The transport fault, named — status AND content-type, which the block
      // previously printed nowhere and branched on nowhere.
      expect(out).toMatch(/status=404/);
      expect(out).toMatch(/content-type=application\/json/);
      expect(out).toMatch(/not a worker fault/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not blame the worker for a JSON 502 from /api/health", async () => {
    // The on-call scenario in full: an edge proxy answers 502 with a JSON error
    // envelope, and the verifier reports it as the Worker being down.
    const stub = await startStub(MATCHING, {
      healthRaw: {
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "bad_gateway" }),
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/worker check is not ok/i);
      expect(out).toMatch(/status=502/);
      expect(out).toMatch(/not a worker fault/i);
      // The evidence, quoted — "unreadable" without saying what was read is the
      // same dead end as reporting `{}`.
      expect(out).toMatch(/bad_gateway/);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not blame the worker when `checks` is present but not an object", async () => {
    // A JSON 200 object whose `checks` is a string: `checks.worker` is `undefined`
    // on it just as silently as on a missing `checks`, so it too was read as "down".
    const stub = await startStub(MATCHING, {
      healthRaw: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", checks: "ok" }),
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/worker check is not ok/i);
      expect(out).toMatch(/not a worker fault/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("does not report a worker it was never told about as not ok", async () => {
    // ABSENT IS NOT "NOT OK". An endpoint that reports on the db and says nothing
    // about the worker has made no claim about the worker; reporting that as a
    // worker fault invents a diagnosis out of a silence.
    const stub = await startStub(MATCHING, {
      healthRaw: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", checks: { db: "ok" } }),
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/worker check is not ok/i);
      // Says what it actually observed instead.
      expect(out).toMatch(/did not report on the worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  it("still warns about a genuinely not-ok worker after the transport and field gates", async () => {
    // The counterweight for THIS round, not round 5's. Four new gates in front of
    // the warning must not be satisfiable by never reaching it: the true signal
    // survives all four.
    const stub = await startStub(MATCHING, {
      healthRaw: {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "degraded", checks: { db: "ok", worker: "down" } }),
      },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).toMatch(/redeploy Worker/i);
      expect(out).toContain('"worker":"down"');
      expect(out).not.toMatch(/not a worker fault/i);
      expect(out).not.toMatch(/did not report on the worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  }, 90_000);

  // ROUND 7 — two defects the round-6 gates introduced or left. Both were
  // reproduced against the real script before these were written.

  it("reports a real failing worker on the 503 the health route actually returns", async () => {
    // `server/routes/health.ts:173` answers `allOk ? 200 : 503`, and `:163` sets
    // `allOk = false` whenever `checks.worker !== "ok"` — so a 503 carrying a JSON
    // body IS the shape a genuinely failing worker produces. Round 6 gated on
    // `status === 200` alone and inverted this block: the sole producer of the
    // redeploy instruction could not fire on the one production shape it exists
    // for, and printed "not a worker fault" over a body whose own snippet read
    // `"worker":"fail"`. Verified against the route, not inferred from the status.
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 503, contentType: "application/json", body: JSON.stringify({ status: "degraded", type: "readiness", checks: { db: "ok", worker: "fail" } }) },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).toMatch(/redeploy Worker/i);
      expect(out).not.toMatch(/not a worker fault/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("says nothing about a healthy worker reported as \"OK\"", async () => {
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", checks: { worker: 'OK' } }) },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("says nothing about a healthy worker reported as \"Ok\"", async () => {
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", checks: { worker: 'Ok' } }) },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("says nothing about a healthy worker reported as \"ok \"", async () => {
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", checks: { worker: 'ok ' } }) },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("says nothing about a healthy worker reported as \" ok\"", async () => {
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", checks: { worker: ' ok' } }) },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("treats an empty worker status as NOT REPORTED, never as not-ok", async () => {
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", checks: { worker: '' } }) },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).toMatch(/did not report on the worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("treats a whitespace worker status as NOT REPORTED, never as not-ok", async () => {
    const stub = await startStub(MATCHING, {
      healthRaw: { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", checks: { worker: '   ' } }) },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(out).not.toMatch(/redeploy Worker/i);
      expect(out).toMatch(/did not report on the worker/i);
      expect(code).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("cannot mask a failing probe: exercised on a run that must exit 1", async () => {
    // THE GAP ROUND 5 LEFT. All eight of its cases are exit-0 runs, so none of them
    // could discharge its own claim that this block "can neither lie nor fail the
    // run" in the masking direction — a suite that only ever walks the happy path
    // cannot see a masking bug. Here a probe genuinely fails (the SPA catch-all
    // swallows it) WHILE the health block runs and warns: the run must still exit 1
    // and must NOT print the green banner.
    const stub = await startStub(MATCHING, {
      probeShell: "/api/clinical-check-in/me/active",
      healthRaw: { status: 200, contentType: "application/json", body: "null" },
    });
    try {
      const { code, out } = await runVerifier(stub.url, {}, 20);
      expect(code).toBe(1);
      expect(out).not.toContain("ALL PROBES PASS");
      expect(out).toMatch(/FAIL \/api\/clinical-check-in\/me\/active/);
      // The block really did run — otherwise this would pass vacuously.
      expect(out).toMatch(/not a worker fault/i);
    } finally {
      await stub.close();
    }
  }, 90_000);
});
