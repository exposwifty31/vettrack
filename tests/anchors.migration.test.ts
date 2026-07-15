import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const sql = readFileSync(resolve(__dirname, "../migrations/165_equipment_anchors.sql"), "utf8");

describe("165_equipment_anchors migration", () => {
  it("creates the append-only anchors table idempotently", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vt_equipment_anchors/i);
    expect(sql).toMatch(/clinic_id\s+TEXT NOT NULL REFERENCES vt_clinics/i);
    expect(sql).toMatch(/equipment_id\s+TEXT NOT NULL REFERENCES vt_equipment/i);
  });
  it("bounds source + invalidated_reason with CHECK constraints", () => {
    expect(sql).toMatch(/source\s+TEXT NOT NULL CHECK \(source IN \('return_toggle', ?'sweep', ?'citizen', ?'smart_charger'\)\)/i);
    expect(sql).toMatch(/invalidated_reason\s+TEXT CHECK \(invalidated_reason IN \('checkout', ?'rfid_elsewhere', ?'sweep_missing', ?'not_found_here'\)\)/i);
  });
  it("indexes by (clinic, equipment, asserted_at) and a partial current-anchor index", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_vt_equipment_anchors_clinic_equipment_asserted[\s\S]*\(clinic_id, equipment_id, asserted_at\)/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_vt_equipment_anchors_current[\s\S]*\(clinic_id, equipment_id\)[\s\S]*WHERE invalidated_at IS NULL/i);
  });
  it("#9 (P2 review) — current-anchor index is UNIQUE (DB-enforced one-open-anchor-per-item), with a safe drop-if-exists swap", () => {
    expect(sql).toMatch(/DROP INDEX IF EXISTS idx_vt_equipment_anchors_current/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_vt_equipment_anchors_current/i);
  });
});
