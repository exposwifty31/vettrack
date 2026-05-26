import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isPostgresUniqueViolation, pgUpdateMatchedZeroRows } from "../server/lib/pg-result.js";

describe("pg-result helpers", () => {
  it("pgUpdateMatchedZeroRows is true only for rowCount 0", () => {
    expect(pgUpdateMatchedZeroRows({ rowCount: 0 })).toBe(true);
    expect(pgUpdateMatchedZeroRows({ rowCount: 1 })).toBe(false);
    expect(pgUpdateMatchedZeroRows({ rowCount: undefined })).toBe(false);
    expect(pgUpdateMatchedZeroRows(undefined)).toBe(false);
  });

  it("isPostgresUniqueViolation detects Drizzle-wrapped pg errors", () => {
    const err = { message: "Failed query", cause: { code: "23505" } };
    expect(isPostgresUniqueViolation(err)).toBe(true);
    expect(isPostgresUniqueViolation({ code: "23505" })).toBe(true);
    expect(isPostgresUniqueViolation(new Error("other"))).toBe(false);
  });
});

describe("version guard source contracts", () => {
  it("staleness worker UPDATE filters by snapshot version", () => {
    const src = readFileSync("server/workers/equipmentConditionStalenessWorker.ts", "utf8");
    expect(src).toMatch(/eq\(equipment\.version, eq_row\.version\)/);
    expect(src).toMatch(/pgUpdateMatchedZeroRows\(updateResult\)/);
  });

  it("procedure-bound release UPDATE filters by snapshot version", () => {
    const src = readFileSync("server/services/equipment-operational-state.service.ts", "utf8");
    expect(src).toMatch(/eq\(equipment\.version, row\.version\)/);
    expect(src).toMatch(/pgUpdateMatchedZeroRows\(result\)/);
  });

  it("dock-return UPDATE filters by capturedVersion", () => {
    const src = readFileSync("server/routes/equipment-operational-state.ts", "utf8");
    const start = src.indexOf('router.post("/equipment/:equipmentId/dock-return"');
    const end = src.indexOf("// ─── Equipment: Staging", start);
    const block = src.slice(start, end > start ? end : undefined);
    expect(block).toMatch(/eq\(equipment\.version, capturedVersion\)/);
    expect(block).toMatch(/pgUpdateMatchedZeroRows\(updated\)/);
  });

  it("stage cancel revert UPDATE filters by capturedVersion", () => {
    const src = readFileSync("server/routes/equipment-operational-state.ts", "utf8");
    const start = src.indexOf('router.delete("/equipment/:equipmentId/stage/:claimId"');
    const end = src.indexOf("void promoteStagingQueueNext", start);
    const block = src.slice(start, end > start ? end : undefined);
    expect(block).toMatch(/eq\(equipment\.version, capturedVersion\)/);
    expect(block).toMatch(/pgUpdateMatchedZeroRows\(revertResult\)/);
  });
});
