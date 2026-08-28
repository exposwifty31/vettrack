/**
 * scanItem's container lookup must enforce the tenant boundary DIRECTLY.
 *
 * The blueprint/target-PAR lookup resolves `containers` by `session.containerId`.
 * The session row is clinic-scoped, so the id is clinic-derived — but the house
 * rule (and the tenant lint's own blind spot) demand the predicate on the query
 * itself: the lint's enclosing-scope heuristic sees `clinicId` elsewhere in
 * scanItem and would never flag this site, so THIS pin is the only guard.
 *
 * It also pins that no `tenant-lint:scoped` waiver sits on the site: a waiver
 * here once silenced exactly this gap (caught in review on #260), and a waiver
 * above a query that lacks the predicate is the disarmed-gate defect class.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("server/services/restock.service.ts", "utf8");

function fnSlice(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("scanItem container lookup — tenant scope (structural)", () => {
  const scanItem = fnSlice("scanItem");
  const fromAt = scanItem.indexOf(".from(containers)");

  it("queries containers somewhere (anchor sanity)", () => {
    expect(fromAt).toBeGreaterThan(-1);
  });

  it("filters containers by clinicId in the same where() as the id", () => {
    const whereAt = scanItem.indexOf(".where(", fromAt);
    expect(whereAt).toBeGreaterThan(-1);
    const limitAt = scanItem.indexOf(".limit(", whereAt);
    expect(limitAt).toBeGreaterThan(whereAt);
    const whereClause = scanItem.slice(whereAt, limitAt);
    expect(whereClause).toContain("eq(containers.clinicId, params.clinicId)");
    expect(whereClause).toContain("eq(containers.id, session.containerId)");
  });

  it("carries no tenant-lint waiver — the predicate, not a waiver, is the answer here", () => {
    const windowBefore = scanItem.slice(Math.max(0, fromAt - 300), fromAt);
    expect(windowBefore).not.toContain("tenant-lint:scoped");
  });
});
