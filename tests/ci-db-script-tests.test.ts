/**
 * The DB-script runner's pure half, fed the outputs that actually occur.
 *
 * Mirrors tests/ci-live-server-tests.test.ts: every branch is proved by a
 * refusal, because the failure this runner exists to catch is a green that means
 * nothing.
 *
 * The eight files it runs are not vitest suites — they are standalone tsx
 * programs (`async function main()`, `node:assert`) that open with:
 *
 *     if (!process.env.DATABASE_URL) {
 *       console.log("⚠️  ... skipped (DATABASE_URL not set)");
 *       process.exit(0);
 *     }
 *
 * Verified 2026-09-01 by falsification, not by reading: with DATABASE_URL unset,
 * `pnpm exec tsx tests/migrations/damage-events.test.ts` exits **0** having
 * asserted nothing. Eight files are pre-armed to report success for doing
 * nothing, so exit code alone is not admissible evidence and the runner reads
 * what the script said as well.
 */
import { describe, expect, it } from "vitest";

import { evaluateScript, summarize } from "../scripts/ci/db-script-tests.mjs";

const NAME = "tests/migrations/damage-events.test.ts";

describe("evaluateScript", () => {
  it("accepts an exit 0 that carries the script's own success marker", () => {
    expect(
      evaluateScript({
        name: NAME,
        exitCode: 0,
        stdout: "some progress\n✅ damage-events.test.ts passed\n",
      }),
    ).toEqual({ ok: true, message: `${NAME}: passed` });
  });

  it("refuses an exit 0 whose output says it skipped — the reason this runner exists", () => {
    const verdict = evaluateScript({
      exitCode: 0,
      name: NAME,
      stdout: "⚠️  migration test skipped (DATABASE_URL not set)\n",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/skipped/i);
  });

  it("refuses an exit 0 that printed no success marker at all", () => {
    // A script whose main() returns early, or whose success line is edited away,
    // exits 0 with nothing to show for it. Silence is not a pass.
    const verdict = evaluateScript({ exitCode: 0, name: NAME, stdout: "" });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/no success marker/i);
  });

  it("refuses a non-zero exit even when a success marker appears earlier", () => {
    // A script can print its marker and then throw in a later section.
    const verdict = evaluateScript({
      exitCode: 1,
      name: NAME,
      stdout: "✅ damage-events.test.ts passed\nthen something threw\n",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/exit 1/);
  });

  it("reads the skip marker anywhere in the output, not only on the first line", () => {
    const verdict = evaluateScript({
      exitCode: 0,
      name: NAME,
      stdout: "banner\nnoise\n⚠️  restock.service tests skipped (DATABASE_URL not set)\n",
    });
    expect(verdict.ok).toBe(false);
  });

  it("prefers the skip refusal over the missing-marker one, so the message names the real cause", () => {
    // Both conditions hold for a skipped run: it skipped AND printed no success
    // marker. Reporting "no success marker" would send a reader looking for an
    // edited script instead of an unset environment variable.
    const verdict = evaluateScript({
      exitCode: 0,
      name: NAME,
      stdout: "⚠️  migration test skipped (DATABASE_URL not set)\n",
    });
    expect(verdict.message).not.toMatch(/no success marker/i);
  });
});

describe("summarize", () => {
  it("is ok only when every script is ok", () => {
    expect(
      summarize([
        { ok: true, message: "a: passed" },
        { ok: true, message: "b: passed" },
      ]),
    ).toMatchObject({ ok: true, failed: 0, total: 2 });
  });

  it("refuses an empty run — nothing to report is not success", () => {
    // A suites file that parses to [] would otherwise make the whole job green
    // while running zero scripts, which is this runner's own failure mode
    // reproduced one level up.
    expect(summarize([])).toMatchObject({ ok: false, total: 0 });
  });

  it("counts and surfaces the failures", () => {
    const out = summarize([
      { ok: true, message: "a: passed" },
      { ok: false, message: "b: skipped" },
    ]);
    expect(out).toMatchObject({ ok: false, failed: 1, total: 2 });
    expect(out.messages).toContain("b: skipped");
  });
});
