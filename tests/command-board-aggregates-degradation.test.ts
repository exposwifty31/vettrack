/**
 * Phase 5 (C2) — enrichment aggregate degradation contract (DB-free).
 *
 * The load-bearing guarantee: a failing enrichment block degrades to `undefined`
 * without ever throwing, so Promise.all in buildCommandBoardSnapshot can only
 * reject on the load-bearing main query — the board never collapses to the
 * legacy list because a cosmetic aggregate failed. SQL correctness + clinicId
 * scoping of the four aggregates is covered by the DB-integration suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  safeBlock,
  defaultBoardAggregates,
} from "../server/services/equipment-command-board.service.js";
import { withTimeout } from "../server/lib/with-timeout.js";

// safeBlock now logs the caught error before degrading; silence the expected
// warnings from the failure/slowness cases so the suite output stays clean.
beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("safeBlock — enrichment degradation primitive", () => {
  it("resolves the query value on success", async () => {
    await expect(safeBlock(async () => ({ depth: 7 }))).resolves.toEqual({ depth: 7 });
  });

  it("degrades to undefined on rejection — never throws", async () => {
    await expect(
      safeBlock(async () => {
        throw new Error("aggregate boom");
      }),
    ).resolves.toBeUndefined();
  });

  it("degrades to undefined on a synchronous throw inside the query", async () => {
    await expect(
      safeBlock(() => {
        throw new Error("sync boom");
      }),
    ).resolves.toBeUndefined();
  });

  it("degrades a SLOW (hanging) query to undefined via withTimeout — not just throws", async () => {
    // The defaultBoardAggregates cap latency with withTimeout so a slow-but-not-
    // failing aggregate can't eat the shared 2500ms snapshot budget.
    const hangs = new Promise<number>(() => {});
    await expect(safeBlock(() => withTimeout(hangs, 10))).resolves.toBeUndefined();
  });
});

describe("defaultBoardAggregates", () => {
  it("exposes all four enrichment blocks as functions", () => {
    for (const key of ["power", "docks", "waitlist", "staging"] as const) {
      expect(typeof defaultBoardAggregates[key]).toBe("function");
    }
  });
});
