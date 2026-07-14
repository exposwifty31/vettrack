import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const sql = readFileSync(resolve(__dirname, "../migrations/164_docking_ownership.sql"), "utf8");

describe("164_docking_ownership migration", () => {
  it("adds docks.asset_type_id and capacity additively", () => {
    expect(sql).toMatch(/ALTER TABLE vt_docks ADD COLUMN IF NOT EXISTS asset_type_id TEXT/i);
    expect(sql).toMatch(/ALTER TABLE vt_docks ADD COLUMN IF NOT EXISTS capacity INTEGER/i);
  });
  it("adds equipment.home_room_id additively", () => {
    expect(sql).toMatch(/ALTER TABLE vt_equipment ADD COLUMN IF NOT EXISTS home_room_id TEXT/i);
  });
  it("enforces one station per (clinic, room, category) as a partial unique index", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS vt_docks_clinic_room_assettype_uq/i);
    expect(sql).toMatch(/\(clinic_id, room_id, asset_type_id\)/i);
    expect(sql).toMatch(/WHERE asset_type_id IS NOT NULL/i);
  });
});
