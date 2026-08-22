/**
 * `observe: false` — the discovery path must not speak.
 *
 * WHY THIS EXISTS. Every non-`off` path through `evaluateCodeBlueManagerAuthority`
 * emits: a counter always, and an audit row on every would-deny. That is correct for
 * the two MUTATION call sites, where "a real initiation would have been blocked" is
 * exactly what the shadow signal is supposed to mean.
 *
 * A discovery endpoint (`GET /api/code-blue/eligible-managers`) runs the same evaluator
 * once per candidate, on a GET, repeatedly, DURING an emergency. Left observing, a
 * clinic with 12 vets/admins of whom 8 are off-shift writes 8 `shadow_would_have_denied`
 * audit rows and counters per list fetch. That does not merely add noise — it destroys
 * the meaning of the number the `off | shadow | enforce` rollout decision is made on.
 *
 * So the flag suppresses EMISSION ONLY. The verdict must be bit-identical with and
 * without it: the entire point of routing discovery through the same evaluator is that
 * the list cannot drift from what the POST will accept. A flag that changed the answer
 * would reintroduce the drift it exists to prevent.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({ db: {}, users: {}, auditLogs: {}, eventOutbox: {} }));

const auditCalls: unknown[] = [];
vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return { ...actual, logAudit: (...args: unknown[]) => { auditCalls.push(args); } };
});

import { evaluateCodeBlueManagerAuthority } from "../server/lib/authority/enforcement/code-blue-manager.evaluator.js";
import type { CodeBlueManagerContext } from "../server/lib/authority/enforcement/code-blue-manager.types.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

/**
 * The audit half is behind `AUTHORITY_OBS_V1` (`server/lib/authority-audit.ts:28-30`),
 * which is unset in tests. Without turning it on, "no audit row" is true for the wrong
 * reason and this file would assert a suppression that was never exercised — the exact
 * silent-skip shape the repo refuses elsewhere. So it is enabled here deliberately.
 *
 * Worth carrying: in production TODAY the counters emit unconditionally while the audit
 * rows need obs-v1 on. The counters are the rollout signal, so the discovery-pollution
 * problem is live regardless of that flag.
 */
let obsBefore: string | undefined;

/** Distinct per test: the audit emitter dedupes per (clinic, user, route) for 60s. */
let seq = 0;

const ctx = (): CodeBlueManagerContext => ({
  clinicId: "clinic-a",
  now: new Date("2026-08-21T09:00:00.000Z"),
  endpoint: "initiation",
  managerUserId: `user-off-shift-${(seq += 1)}`,
  // A caller-hydrated failure: the shortest path that reaches BOTH a counter and
  // an audit row in shadow mode, which is the pair this flag has to silence.
  lookup: { kind: "user_missing" },
});

const shadow = { modeResolver: async () => "shadow" as const };

beforeEach(() => {
  obsBefore = process.env.AUTHORITY_OBS_V1;
  process.env.AUTHORITY_OBS_V1 = "true";
  resetMetrics();
  auditCalls.length = 0;
});
afterEach(() => {
  if (obsBefore === undefined) delete process.env.AUTHORITY_OBS_V1;
  else process.env.AUTHORITY_OBS_V1 = obsBefore;
  resetMetrics();
  auditCalls.length = 0;
});

describe("code-blue manager evaluator: observe flag", () => {
  it("emits by default — the mutation path's behaviour must be untouched", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(ctx(), shadow);
    expect(verdict).toEqual({ action: "allow", protected: "SHADOW_WOULD_HAVE_DENIED" });
    expect(getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.userMissing).toBe(1);
    expect(auditCalls.length).toBeGreaterThan(0);
  });

  it("REFUSES to emit when observe is false — no counter, no audit row", async () => {
    await evaluateCodeBlueManagerAuthority(ctx(), { ...shadow, observe: false });
    expect(getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.userMissing).toBe(0);
    expect(auditCalls).toEqual([]);
  });

  it("returns the IDENTICAL verdict either way — silence must not change the answer", async () => {
    const shared = ctx();
    const observed = await evaluateCodeBlueManagerAuthority(shared, shadow);
    resetMetrics();
    auditCalls.length = 0;
    const silent = await evaluateCodeBlueManagerAuthority(shared, { ...shadow, observe: false });
    expect(silent).toEqual(observed);
  });

  it("silences the plain allow counter too, not only the would-deny pair", async () => {
    // Otherwise a discovery sweep still inflates `manager.allow`, and the allow/deny
    // ratio the rollout is judged on is skewed by reads instead of writes.
    const allowCtx: CodeBlueManagerContext = { ...ctx(), lookup: { kind: "resolver_fault" } };
    await evaluateCodeBlueManagerAuthority(allowCtx, { ...shadow, observe: false });
    expect(getMetricsSnapshot().codeBlue.manager.faultOpen).toBe(0);
    expect(auditCalls).toEqual([]);
  });

  it("mode off stays a pure short-circuit — nothing to silence, nothing emitted", async () => {
    const verdict = await evaluateCodeBlueManagerAuthority(ctx(), {
      modeResolver: async () => "off" as const,
      observe: false,
    });
    expect(verdict).toEqual({ action: "allow", protected: "MODE_OFF" });
    expect(auditCalls).toEqual([]);
  });
});

/**
 * The guard the flag's own doc comment promises.
 *
 * The behavioural half is covered above: omitting the flag emits. That protects the
 * mutation sites that exist TODAY. It cannot protect the site added tomorrow — a new
 * mutation path that copies the discovery service's call, `observe: false` and all,
 * fails no type check and breaks no assertion. It just quietly stops counting real
 * blocked initiations, and the `off | shadow | enforce` rollout is then decided on a
 * number that is missing exactly the events it is supposed to measure. Silence is the
 * symptom AND the bug, so nothing else would surface it.
 *
 * Hence a static guard, in the same shape the repo already uses for surfaces whose
 * violation is invisible at runtime (`tests/offline-phase-7-emergency-surface-parity.test.ts`,
 * `tests/i18n-no-hebrew-in-source.test.ts`).
 */
const REPO_ROOT = process.cwd();
const EVALUATOR = "evaluateCodeBlueManagerAuthority";

/** The one path entitled to silence: a GET that must not vote in the rollout signal. */
const DISCOVERY = "server/lib/authority/code-blue-eligible-managers.ts";
/** Where all three route call sites funnel through, and where they get their emission. */
const MUTATION_WIRING = "server/lib/authority/code-blue-manager.wiring.ts";
/** Declaration site, not a call site. */
const DEFINITION = "server/lib/authority/enforcement/code-blue-manager.evaluator.ts";

function listServerSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return listServerSources(abs);
    return abs.endsWith(".ts") ? [relative(REPO_ROOT, abs)] : [];
  });
}

/** Files that CALL the evaluator, excluding the module that declares it. */
function evaluatorCallers(): Array<{ file: string; source: string }> {
  return listServerSources(join(REPO_ROOT, "server"))
    .filter((file) => file !== DEFINITION)
    .map((file) => ({ file, source: readFileSync(join(REPO_ROOT, file), "utf8") }))
    .filter(({ source }) => source.includes(`${EVALUATOR}(`));
}

/** An `observe:` option actually being passed, not the word appearing in prose. */
function passesObserve(source: string): boolean {
  return /^\s*observe\s*:/m.test(source);
}

describe("code-blue manager evaluator: no mutation call site may silence it", () => {
  it("the discovery path is the ONLY caller that passes `observe`", () => {
    const silencing = evaluatorCallers()
      .filter(({ source }) => passesObserve(source))
      .map(({ file }) => file);

    expect(
      silencing,
      silencing.length > 1
        ? `Only the discovery read may suppress emission. Also passing \`observe\`:\n${silencing
            .filter((f) => f !== DISCOVERY)
            .join("\n")}\nIf this is a mutation path, remove the flag — a real would-deny must be counted.`
        : undefined,
    ).toEqual([DISCOVERY]);
  });

  it("finds the callers at all — a broken scan must fail, not pass empty", () => {
    // Without this, deleting the discovery service (or renaming the evaluator) would
    // turn the assertion above into `[] === []` and the guard would evaporate.
    const callers = evaluatorCallers().map(({ file }) => file);
    expect(callers).toContain(DISCOVERY);
    expect(callers).toContain(MUTATION_WIRING);
  });

  it("the mutation wiring passes NO options — routes cannot reach the flag", () => {
    const source = readFileSync(join(REPO_ROOT, MUTATION_WIRING), "utf8");
    // The single-argument form is the structural guarantee: with no options object
    // threaded from the route, no route CAN silence the evaluator. Widening this call
    // is the moment to re-read the doc comment, so the test pins the shape.
    expect(source).toContain(`await ${EVALUATOR}(ctx);`);
    expect(passesObserve(source)).toBe(false);
  });

  it("`evaluateCodeBlueManagerForRoute` does not expose `observe` to its callers", () => {
    const source = readFileSync(join(REPO_ROOT, MUTATION_WIRING), "utf8");
    const input = source.match(
      /export interface EvaluateCodeBlueManagerForRouteInput \{([\s\S]*?)\n\}/,
    );
    expect(input, "EvaluateCodeBlueManagerForRouteInput not found").toBeTruthy();
    expect(input![1]).not.toMatch(/\bobserve\b/);
  });
});
