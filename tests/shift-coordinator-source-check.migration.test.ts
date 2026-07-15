import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const sql = readFileSync(resolve(__dirname, "../migrations/169_shift_coordinator_source_check.sql"), "utf8");

describe("169_shift_coordinator_source_check migration", () => {
  it("adds a closed-domain CHECK on vt_shift_equipment_coordinator.source", () => {
    expect(sql).toMatch(/ALTER TABLE vt_shift_equipment_coordinator/i);
    expect(sql).toMatch(/CONSTRAINT vt_shift_equipment_coordinator_source_check/i);
    expect(sql).toMatch(/CHECK \(source IN \('auto', ?'confirmed', ?'fallback_senior'\)\)/i);
  });

  it("is idempotent — a pg_constraint-guarded ADD CONSTRAINT", () => {
    expect(sql).toMatch(/pg_constraint/i);
    expect(sql).toMatch(/IF NOT EXISTS/i);
    expect(sql).toMatch(/ADD CONSTRAINT/i);
  });

  it("does not mutate the already-applied migration 166", () => {
    // Guard against accidentally re-authoring the CHECK inside 166 (its runner
    // record is immutable). The domain lives in this additive follow-up only.
    const mig166 = readFileSync(resolve(__dirname, "../migrations/166_equipment_coordinator.sql"), "utf8");
    expect(mig166).not.toMatch(/source_check/i);
  });
});
