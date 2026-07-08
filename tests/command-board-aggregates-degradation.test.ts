/**
 * Phase 5 (C2) — enrichment aggregate degradation contract (DB-free).
 *
 * The load-bearing guarantee: a failing enrichment block degrades to `undefined`
 * without ever throwing, so Promise.all in buildCommandBoardSnapshot can only
 * reject on the load-bearing main query — the board never collapses to the
 * legacy list because a cosmetic aggregate failed. SQL correctness + clinicId
 * scoping of the four aggregates is covered by the DB-integration suite.
 */
import { describe, it, expect } from "vitest";
import {
  safeBlock,
  defaultBoardAggregates,
} from "../server/services/equipment-command-board.service.js";

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
});

describe("defaultBoardAggregates", () => {
  it("exposes all four enrichment blocks as functions", () => {
    for (const key of ["power", "docks", "waitlist", "staging"] as const) {
      expect(typeof defaultBoardAggregates[key]).toBe("function");
    }
  });
});
