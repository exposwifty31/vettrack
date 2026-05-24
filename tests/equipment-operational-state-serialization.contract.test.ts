/**
 * Contract: equipment list/detail read handlers must project V1 operational state fields.
 * Runs in default `pnpm test` (no DATABASE_URL). Complements integration tests in
 * equipment-operational-state.integration.test.ts (pnpm test:integration:ops).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const equipmentRoutesPath = path.join(__dirname, "..", "server", "routes", "equipment.ts");
const source = fs.readFileSync(equipmentRoutesPath, "utf8");

const V1_FIELDS = [
  "custodyState",
  "readinessState",
  "usageState",
  "assetTypeId",
  "dockId",
] as const;

function sliceBetweenMarkers(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, `missing end marker after ${startMarker}: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("equipment operational state API serialization contract", () => {
  it("defines equipmentOperationalStateSelect with all V1 fields before /my handler", () => {
    const myHandlerIndex = source.indexOf('router.get("/my"');
    expect(myHandlerIndex).toBeGreaterThanOrEqual(0);

    const constantBlock = source.slice(0, myHandlerIndex);
    expect(constantBlock).toContain("const equipmentOperationalStateSelect");
    for (const field of V1_FIELDS) {
      expect(constantBlock).toContain(`${field}: equipment.${field}`);
    }
  });

  it("spreads equipmentOperationalStateSelect on GET /api/equipment/my", () => {
    const block = sliceBetweenMarkers(
      '// GET /api/equipment/my',
      'const EQUIPMENT_DEFAULT_PAGE_SIZE',
    );
    expect(block).toContain("...equipmentOperationalStateSelect");
  });

  it("spreads equipmentOperationalStateSelect on GET /api/equipment (list)", () => {
    const block = sliceBetweenMarkers(
      'router.get("/", requireAuth',
      '// GET /api/equipment/deleted',
    );
    expect(block).toContain("...equipmentOperationalStateSelect");
  });

  it("spreads equipmentOperationalStateSelect on GET /api/equipment/:id", () => {
    const block = sliceBetweenMarkers(
      'router.get("/:id", requireAuth',
      'router.post("/", requireAuth',
    );
    expect(block).toContain("...equipmentOperationalStateSelect");
  });

  it("uses exactly three spreads (my, list, detail)", () => {
    const matches = source.match(/\.\.\.equipmentOperationalStateSelect/g);
    expect(matches?.length).toBe(3);
  });
});
