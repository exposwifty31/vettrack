import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const sql = readFileSync(resolve(__dirname, "../migrations/168_sweep_anchor_index.sql"), "utf8");

describe("168_sweep_anchor_index migration", () => {
  it("adds a partial sweep-anchor index idempotently for the last-swept read path", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_vt_equipment_anchors_clinic_sweep_asserted/i);
    expect(sql).toMatch(/ON vt_equipment_anchors \(clinic_id, asserted_at DESC\)/i);
    expect(sql).toMatch(/WHERE source = 'sweep'/i);
  });
});
