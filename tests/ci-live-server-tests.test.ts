/**
 * The live-server runner's pure halves, fed the inputs that actually occur.
 *
 * Mirrors tests/ci-db-integration-preflight.test.ts: every branch is proved by a
 * refusal, because a guard that has only ever seen good input is untested — and
 * this particular guard exists to catch a green that means nothing, which is the
 * failure mode you cannot see by looking at a passing run.
 */
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  evaluateSuite,
  parseResultsLine,
  summarize,
} from "../scripts/ci/live-server-tests.mjs";

describe("parseResultsLine", () => {
  it("reads the `N passed, M failed` shape the worker/api suites print", () => {
    expect(parseResultsLine("noise\nResults: 10 passed, 0 failed\n")).toEqual({
      passed: 10,
      total: 10,
      failed: 0,
    });
    expect(parseResultsLine("Results: 7 passed, 2 failed")).toEqual({
      passed: 7,
      total: 9,
      failed: 2,
    });
  });

  it("reads both `N/T passed` shapes equipment-scan-e2e prints", () => {
    // The green form carries a trailing ✓ and no failure count at all.
    expect(parseResultsLine("Results: 31/31 passed ✓")).toEqual({
      passed: 31,
      total: 31,
      failed: 0,
    });
    // The red form is the one that exposed the missing seed fixture.
    expect(parseResultsLine("Results: 28/29 passed, 1 FAILED")).toEqual({
      passed: 28,
      total: 29,
      failed: 1,
    });
  });

  it("takes the LAST summary line, not the first", () => {
    // A suite may echo an earlier section's tally before its own final line.
    expect(parseResultsLine("Results: 1 passed, 0 failed\nResults: 9 passed, 0 failed")).toEqual({
      passed: 9,
      total: 9,
      failed: 0,
    });
  });

  it("refuses an impossible slash summary rather than deriving a negative failure count", () => {
    // "31/29 passed" yields failed: -2, which is under every floor and reads as a
    // pass. A suite that cannot count its own assertions is a suite that did not
    // report, so the parser declines it rather than interpreting it.
    expect(parseResultsLine("Results: 31/29 passed")).toBeNull();
    expect(parseResultsLine("Results: 5/4 passed, 1 FAILED")).toBeNull();
  });

  it("still accepts an all-passed summary at the boundary", () => {
    // The guard above must not reject the ordinary equal case.
    expect(parseResultsLine("Results: 4/4 passed ✓")).toEqual({
      passed: 4,
      total: 4,
      failed: 0,
    });
  });

  it("refuses a plain summary whose counts are not the numbers that were printed", () => {
    // The slash branch validated its counts and this one did not, which is the whole
    // defect: past 2^53 the parse stops matching stdout ("9007199254740993" comes back
    // as ...992), and the resulting total clears every floor. The gate would then pass
    // on a count no suite ever reported.
    expect(parseResultsLine("Results: 9007199254740992 passed, 0 failed")).toBeNull();
    expect(parseResultsLine("Results: 0 passed, 9007199254740993 failed")).toBeNull();
    // Two safe operands whose SUM is unsafe — the boundary a per-operand check misses.
    expect(parseResultsLine("Results: 9007199254740991 passed, 1 failed")).toBeNull();
  });

  it("still accepts the largest plain summary that is a real count", () => {
    // The guard above must not be off-by-one strict: MAX_SAFE_INTEGER is a real number
    // the parser should keep, absurd as it would be as an assertion count.
    expect(parseResultsLine("Results: 9007199254740991 passed, 0 failed")).toEqual({
      passed: 9007199254740991,
      total: 9007199254740991,
      failed: 0,
    });
  });

  it("returns null when the suite printed no summary at all", () => {
    expect(parseResultsLine("")).toBeNull();
    expect(parseResultsLine("Test process failed: ECONNREFUSED")).toBeNull();
    expect(parseResultsLine(undefined)).toBeNull();
  });
});

describe("evaluateSuite", () => {
  const base = { name: "returns-api", exitCode: 0, floor: 9 };

  it("passes a suite that met its floor with a clean exit", () => {
    const v = evaluateSuite({ ...base, parsed: { passed: 9, total: 9, failed: 0 } });
    expect(v.ok).toBe(true);
  });

  it("refuses a suite that reported nothing, even on exit 0", () => {
    // The crash-before-printing case. Exit code alone would call this a pass.
    const v = evaluateSuite({ ...base, parsed: null });
    expect(v.ok).toBe(false);
    expect(v.message).toContain("did not report");
  });

  it("never overrides the suite's own red", () => {
    const v = evaluateSuite({
      ...base,
      exitCode: 1,
      parsed: { passed: 8, total: 9, failed: 1 },
    });
    expect(v.ok).toBe(false);
    expect(v.message).toContain("1 of 9");
  });

  it("refuses reported failures even when the suite exited 0", () => {
    // The hole this runner exists to close, in its own failure branch: a suite whose
    // exit path is broken says it failed and exits 0. The floor is met, so only
    // reading the reported failure count catches it.
    const v = evaluateSuite({
      ...base,
      exitCode: 0,
      parsed: { passed: 7, total: 9, failed: 2 },
    });
    expect(v.ok).toBe(false);
    expect(v.message).toContain("exited 0");
  });

  it("refuses a suite that shrank below its floor while exiting 0", () => {
    // THE case this file exists for: everything it ran passed, and it ran less.
    const v = evaluateSuite({ ...base, parsed: { passed: 4, total: 4, failed: 0 } });
    expect(v.ok).toBe(false);
    expect(v.message).toContain("floor is 9");
  });

  it("refuses an unfloored suite rather than waving it through", () => {
    const v = evaluateSuite({
      ...base,
      floor: undefined,
      parsed: { passed: 9, total: 9, failed: 0 },
    });
    expect(v.ok).toBe(false);
    expect(v.message).toContain("no recorded floor");
  });

  it("allows a suite that grew past its floor", () => {
    // Growth is fine and must not be a failure, or adding a test breaks CI.
    const v = evaluateSuite({ ...base, parsed: { passed: 12, total: 12, failed: 0 } });
    expect(v.ok).toBe(true);
  });
});

describe("summarize", () => {
  it("is green only when every suite is", () => {
    expect(summarize([{ ok: true, assertions: 10 }, { ok: true, assertions: 6 }])).toMatchObject({
      ok: true,
      totalAssertions: 16,
    });
  });

  it("collects every failure, not just the first", () => {
    const s = summarize([
      { ok: false, message: "a", assertions: 0 },
      { ok: true, message: "b", assertions: 5 },
      { ok: false, message: "c", assertions: 2 },
    ]);
    expect(s.ok).toBe(false);
    expect(s.failures).toHaveLength(2);
    expect(s.totalAssertions).toBe(7);
  });
});

describe("module self-execution guard", () => {
  it("skips main() instead of crashing when imported with no argv[1]", () => {
    // Regression. The guard called realpathSync(process.argv[1]) unconditionally, so an
    // import from a context without argv[1] threw on the way in:
    //   Error: ENOENT: no such file or directory, lstat '<cwd>/undefined'
    // vitest sets argv[1], so the suite above never touched this path — the module that
    // refuses a suite for not reporting was one import context away from not loading.
    const runner = new URL("../scripts/ci/live-server-tests.mjs", import.meta.url).href;
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(runner)}); console.log("LOADED");`],
      { encoding: "utf8", timeout: 30_000 },
    );

    expect(r.stderr).not.toContain("ENOENT");
    expect(r.stdout).toContain("LOADED");
    expect(r.status).toBe(0);
    // Loaded without side effects: main() would have printed its header.
    expect(r.stdout).not.toContain("live-server suites");
  });
});
