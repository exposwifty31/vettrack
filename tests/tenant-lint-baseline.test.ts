/**
 * The tenant gate could not fail, and removing one flag would not have fixed it.
 *
 * `.github/workflows/ci.yml` ran the lint with `--warn-only`, whose own --help says
 * "exit 0 (default, G3)", AND wrapped the step in `continue-on-error: true`. Two
 * independent disarms on one gate. Meanwhile `scripts/architecture/run-architecture-gates.mjs`
 * did not invoke it at all. A real `clinicId` leak was therefore indistinguishable
 * from 203 standing findings nobody was ever blocked on.
 *
 * A baseline is what makes enforcement possible without a 203-finding cleanup first:
 * the known set is frozen, and only what is NEW fails.
 *
 * Keyed by `file::table` and a COUNT — deliberately not `file:line`. A line number
 * shifts on any unrelated edit above it, so a line-keyed baseline turns every
 * refactor into a false regression, and trains people to regenerate the baseline on
 * red, which is the same as having no baseline at all.
 */
import { describe, it, expect } from "vitest";
import { diffAgainstBaseline } from "../scripts/architecture/tenant-query-lint.mjs";

const finding = (file: string, table: string, line: number) => ({
  file,
  line,
  column: 5,
  table,
  reason: "missing clinicId in enclosing function scope",
  waived: false,
});

describe("tenant-lint baseline", () => {
  it("REFUSES a violation the baseline does not know about", () => {
    const { regressions } = diffAgainstBaseline(
      [finding("server/routes/new-thing.ts", "equipment", 12)],
      { violations: {} },
    );
    expect(regressions).toHaveLength(1);
    expect(regressions[0].key).toBe("server/routes/new-thing.ts::equipment");
    expect(regressions[0].allowed).toBe(0);
    expect(regressions[0].found).toBe(1);
  });

  it("REFUSES a SECOND violation of a table already known once in that file", () => {
    // The failure a naive "is this file/table known?" check would wave through.
    const { regressions } = diffAgainstBaseline(
      [
        finding("server/domain/equipment/evidence/graph.loader.ts", "equipment", 110),
        finding("server/domain/equipment/evidence/graph.loader.ts", "equipment", 400),
      ],
      { violations: { "server/domain/equipment/evidence/graph.loader.ts::equipment": 1 } },
    );
    expect(regressions).toHaveLength(1);
    expect(regressions[0].allowed).toBe(1);
    expect(regressions[0].found).toBe(2);
  });

  it("does NOT regress on a line shift — the whole point of not keying on line", () => {
    const { regressions } = diffAgainstBaseline(
      [finding("server/domain/equipment/evidence/graph.loader.ts", "equipment", 999)],
      { violations: { "server/domain/equipment/evidence/graph.loader.ts::equipment": 1 } },
    );
    expect(regressions).toEqual([]);
  });

  it("reports a baseline entry that no longer reproduces, without failing on it", () => {
    // Surfaced so the baseline can be tightened; NOT a failure, because failing a
    // PR for having fixed a violation is how a gate teaches people to route around it.
    const { regressions, resolved } = diffAgainstBaseline([], {
      violations: { "server/routes/fixed.ts::equipment": 1 },
    });
    expect(regressions).toEqual([]);
    expect(resolved).toEqual(["server/routes/fixed.ts::equipment"]);
  });

  it("treats a missing or malformed baseline as zero-tolerance, never as a pass", () => {
    // `bad as never` is deliberate. Three of these four values are OUTSIDE the
    // declared input type, which is the point: the baseline arrives from
    // JSON.parse of a hand-maintained file, so the type is a claim about what
    // should be there, not a guarantee. The cast is how a type-checked test
    // reaches the runtime boundary the type cannot describe. Widening the
    // parameter to `unknown` instead would move the same check into the helper
    // and weaken every honest caller's type — the wrong trade for one test.
    for (const bad of [null, undefined, {}, { violations: null }]) {
      const { regressions } = diffAgainstBaseline(
        [finding("server/routes/x.ts", "equipment", 1)],
        bad as never,
      );
      expect(regressions).toHaveLength(1);
    }
  });

  it("ignores waived findings — a waiver is already a reviewed decision", () => {
    const waived = { ...finding("server/routes/y.ts", "equipment", 1), waived: true };
    expect(diffAgainstBaseline([waived], { violations: {} }).regressions).toEqual([]);
  });
});

/**
 * Argument parsing, proved through the real CLI.
 *
 * The pure-rule tests above cannot see this class of defect: `--baseline` with no
 * value parsed to `null`, which fell through to the DEFAULT warn-only mode and exited
 * 0 with findings present. That is the exact disarmed-gate shape this whole mechanism
 * replaces, reintroduced one layer up — and CI invokes the CLI, not the function, so
 * only a CLI-level test can refuse it.
 */
describe("tenant-lint CLI argument refusal", () => {
  const run = (args: string[]) => {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const r = spawnSync("node", ["scripts/architecture/tenant-query-lint.mjs", ...args], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return { status: r.status, stderr: String(r.stderr ?? "") };
  };

  it("REFUSES --baseline with no value instead of silently falling back to warn-only", () => {
    const r = run(["--all", "--baseline"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--baseline");
  });

  it("REFUSES --baseline followed by another flag, which is the same defect wearing a value", () => {
    const r = run(["--baseline", "--all"]);
    expect(r.status).toBe(2);
  });

  it("REFUSES --write-baseline without --baseline, which would otherwise write nothing and exit 0", () => {
    const r = run(["--all", "--write-baseline"]);
    expect(r.status).toBe(2);
  });
});
