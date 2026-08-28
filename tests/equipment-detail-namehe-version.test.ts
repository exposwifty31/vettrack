/**
 * GET /api/equipment/:id — nameHe + version join the projection.
 *
 * Both columns exist on vt_equipment (schema: name_he at equipment.ts:115,
 * version at :150) and both are ACCEPTED by patchEquipmentSchema — yet the
 * by-id read returned neither. That asymmetry produced two real defects:
 *   - the web edit form's optimistic-concurrency echo
 *     (`...(existingEquipment?.version !== undefined && { version })`) has
 *     never fired — the guard was always undefined, so a stale edit never
 *     409s — and the RN edit form (RN C1) must hide the Hebrew name rather
 *     than risk wiping it with a blank echo.
 *
 * Source-based projection contract, same convention as the sibling
 * equipment-readiness-field.test.ts (which also carries the mocked-db
 * passthrough proof for this handler — these two keys ride the same select
 * literal, so the passthrough layer is not duplicated here).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const handlerSource = fs.readFileSync(
  "server/routes/equipment/handlers/get-equipment-by-id.ts",
  "utf8",
);

describe("GET /api/equipment/:id — nameHe + version projection contract", () => {
  it("projects the Hebrew name", () => {
    expect(handlerSource).toContain("nameHe: equipment.nameHe");
  });

  it("projects the optimistic-concurrency version", () => {
    expect(handlerSource).toContain("version: equipment.version");
  });
});
