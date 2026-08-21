/**
 * The preflight is a merge-blocking gate, so its own branches need tests —
 * a guard that has only ever seen good input is untested.
 *
 * Only the pure predicates are exercised here. The I/O half (pg connect) is
 * covered by the CI step itself: if the database were unreachable there, the
 * preflight fails the job, which is the behavior under test.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateDatabaseUrl,
  evaluateSchema,
} from "../scripts/ci/db-integration-preflight.mjs";

describe("evaluateDatabaseUrl", () => {
  it("refuses an unset DATABASE_URL", () => {
    const verdict = evaluateDatabaseUrl(undefined);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/unset/i);
  });

  it("refuses an empty DATABASE_URL", () => {
    expect(evaluateDatabaseUrl("").ok).toBe(false);
  });

  // A whitespace-only value is the shape a misconfigured CI secret takes —
  // present to `if (process.env.X)` but useless to pg.
  it("refuses a whitespace-only DATABASE_URL", () => {
    expect(evaluateDatabaseUrl("   ").ok).toBe(false);
  });

  it("accepts a real connection string", () => {
    const verdict = evaluateDatabaseUrl("postgresql://vettrack:vettrack@localhost:5432/vettrack_test");
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toBe("");
  });
});

describe("evaluateSchema", () => {
  // The drift case: database up, migrations 181-184 not applied. Without this
  // branch the doctor-gate suite runs and fails deep inside itself instead.
  it("refuses when vt_clinical_check_ins is absent", () => {
    const verdict = evaluateSchema(0);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/181-184/);
  });

  it("accepts exactly one matching row", () => {
    expect(evaluateSchema(1).ok).toBe(true);
  });

  // Defensive: anything other than exactly one row is not a state we understand,
  // so it must refuse rather than round up to ok.
  it("refuses an unexpected row count", () => {
    expect(evaluateSchema(2).ok).toBe(false);
  });
});

/**
 * The gate has to RUN, and the pure-predicate tests above cannot see whether it does.
 *
 * The header of this file used to say the I/O half was "covered by the CI step itself".
 * It was not: the module defined `main()` and never called it, so
 * `node scripts/ci/db-integration-preflight.mjs` parsed cleanly, printed nothing and
 * exited 0 — against an unset URL, an unreachable one, and a fully migrated database
 * alike. Seven green tests over a gate that could not fail.
 *
 * CI invokes the SCRIPT, so only a script-level test covers the layer that was broken.
 * This is the same shape as tests/tenant-lint-baseline.test.ts's CLI block.
 */
describe("the preflight actually runs", () => {
  const SCRIPT = "scripts/ci/db-integration-preflight.mjs";
  const run = (env: Record<string, string | undefined>, script: string = SCRIPT) => {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const base = { ...process.env, ...env };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete base[k];
    const r = spawnSync("node", [script], {
      encoding: "utf8",
      timeout: 60_000,
      env: base,
    });
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  it("REFUSES an unset DATABASE_URL instead of exiting 0 in silence", () => {
    const r = run({ DATABASE_URL: undefined });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/unset/i);
  });

  it("REFUSES an unreachable DATABASE_URL — the case the CI step was assumed to cover", () => {
    const r = run({ DATABASE_URL: "postgres://nobody@127.0.0.1:59999/nope" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/unreachable/i);
  });

  it("REFUSES through a SYMLINKED path — the guard's own silent-no-op mode", () => {
    // How this was found, and why it is not hypothetical. `import.meta.url` is
    // realpath-resolved; `process.argv[1]` is not. Any symlink on the invocation path
    // made the two disagree, the guard evaluate false, and the script parse, print
    // nothing and exit 0 — a pass, from the gate whose entire job is refusing passes
    // that did not run. On macOS `/tmp` is a symlink to `/private/tmp`, so a copy run
    // from there no-opped while the same bytes at their real path refused correctly.
    // A symlinked checkout or a container bind-mount is the same shape in CI.
    const { mkdtempSync, symlinkSync, rmSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "vt-preflight-"));
    const link = join(dir, "linked-preflight.mjs");
    symlinkSync(join(process.cwd(), SCRIPT), link);
    try {
      const r = run({ DATABASE_URL: undefined }, link);
      // Asserting the MESSAGE, not just the status: a SyntaxError also exits 1, so an
      // exit-code-only assertion cannot tell a refusal from a crash.
      expect(r.out).toMatch(/unset/i);
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says so out loud when it passes — a silent success is indistinguishable from not running", () => {
    // The defect's signature: the healthy path printed nothing either. Asserting the
    // success LINE, not just the exit code, is what makes "it ran" observable.
    const r = run({ DATABASE_URL: process.env.VT_PREFLIGHT_PROBE_URL });
    if (!process.env.VT_PREFLIGHT_PROBE_URL) return; // no probe DB wired: the two refusals above still bind
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/will execute, not skip/i);
  });
});
