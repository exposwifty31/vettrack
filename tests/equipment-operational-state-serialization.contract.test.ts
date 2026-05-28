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
const handlersDir = path.join(__dirname, "..", "server", "routes", "equipment", "handlers");
const myHandlerPath = path.join(handlersDir, "get-my-equipment.ts");
const detailHandlerPath = path.join(handlersDir, "get-equipment-by-id.ts");
const operationalSelectPath = path.join(
  __dirname,
  "..",
  "server",
  "routes",
  "equipment",
  "equipment-operational-select.ts",
);
const source = fs.readFileSync(equipmentRoutesPath, "utf8");
const myHandlerSource = fs.readFileSync(myHandlerPath, "utf8");
const detailHandlerSource = fs.readFileSync(detailHandlerPath, "utf8");
const operationalSelectSource = fs.readFileSync(operationalSelectPath, "utf8");

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
  it("defines equipmentOperationalStateSelect with all V1 fields (Slice 4a module)", () => {
    expect(operationalSelectSource).toContain("export const equipmentOperationalStateSelect");
    for (const field of V1_FIELDS) {
      expect(operationalSelectSource).toContain(`${field}: equipment.${field}`);
    }
    expect(source).toContain('router.get("/my", requireAuth, getMyEquipmentHandler)');
  });

  it("spreads equipmentOperationalStateSelect on GET /api/equipment/my", () => {
    expect(myHandlerSource).toContain("/** GET /api/equipment/my */");
    expect(myHandlerSource).toContain("...equipmentOperationalStateSelect");
  });

  it("spreads equipmentOperationalStateSelect on GET /api/equipment (list)", () => {
    const block = sliceBetweenMarkers(
      'router.get("/", requireAuth',
      '// GET /api/equipment/deleted',
    );
    expect(block).toContain("...equipmentOperationalStateSelect");
  });

  it("spreads equipmentOperationalStateSelect on GET /api/equipment/:id", () => {
    expect(detailHandlerSource).toContain("/** GET /api/equipment/:id */");
    expect(detailHandlerSource).toContain("...equipmentOperationalStateSelect");
    expect(source).toContain('router.get("/:id", requireAuth, getEquipmentByIdHandler)');
  });

  it("uses exactly three spreads (my handler module, list, detail)", () => {
    const routeSpreads = source.match(/\.\.\.equipmentOperationalStateSelect/g) ?? [];
    const mySpreads = myHandlerSource.match(/\.\.\.equipmentOperationalStateSelect/g) ?? [];
    const detailSpreads = detailHandlerSource.match(/\.\.\.equipmentOperationalStateSelect/g) ?? [];
    expect(routeSpreads.length + mySpreads.length + detailSpreads.length).toBe(3);
  });
});
