import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldSendPilotEnglishEquipmentPush } from "../server/lib/push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const equipmentRouteSource = fs.readFileSync(
  path.join(__dirname, "..", "server", "routes", "equipment.ts"),
  "utf8",
);
const patchEquipmentSource = fs.readFileSync(
  path.join(__dirname, "..", "server", "routes", "equipment", "handlers", "patch-equipment.ts"),
  "utf8",
);
const bulkMoveSource = fs.readFileSync(
  path.join(__dirname, "..", "server", "routes", "equipment", "handlers", "post-equipment-bulk-move.ts"),
  "utf8",
);

function sliceAround(source: string, needle: string, before = 120, after = 80): string {
  const idx = source.indexOf(needle);
  expect(idx).toBeGreaterThan(-1);
  return source.slice(Math.max(0, idx - before), idx + after);
}

describe("F8: PILOT_DISABLE_EN_PUSH", () => {
  const prior = process.env.PILOT_DISABLE_EN_PUSH;

  afterEach(() => {
    if (prior === undefined) delete process.env.PILOT_DISABLE_EN_PUSH;
    else process.env.PILOT_DISABLE_EN_PUSH = prior;
  });

  it("F8: sends English equipment pushes when env is unset", () => {
    delete process.env.PILOT_DISABLE_EN_PUSH;
    expect(shouldSendPilotEnglishEquipmentPush()).toBe(true);
  });

  it("F8: suppresses pushes when PILOT_DISABLE_EN_PUSH=true", () => {
    process.env.PILOT_DISABLE_EN_PUSH = "true";
    expect(shouldSendPilotEnglishEquipmentPush()).toBe(false);
  });
});

describe("F8: English equipment push call sites honor PILOT_DISABLE_EN_PUSH", () => {
  it("gates checkout broadcast", () => {
    const slice = sliceAround(equipmentRouteSource, 'title: "Equipment Checked Out"');
    expect(slice).toContain("shouldSendPilotEnglishEquipmentPush()");
    expect(slice).toContain('!checkDedupe(u.id, "checkout")');
  });

  it("gates return broadcast", () => {
    const slice = sliceAround(equipmentRouteSource, 'title: "Equipment Returned"');
    expect(slice).toContain("shouldSendPilotEnglishEquipmentPush()");
  });

  it("gates transfer broadcast", () => {
    expect(patchEquipmentSource).toContain("shouldSendPilotEnglishEquipmentPush()");
    expect(patchEquipmentSource).toContain('checkDedupe(req.params.id, "transfer")');
  });

  it("gates bulk-move broadcast", () => {
    expect(bulkMoveSource).toContain("shouldSendPilotEnglishEquipmentPush()");
  });

  it("gates scan-derived issue alert", () => {
    const slice = sliceAround(equipmentRouteSource, 'title: "Equipment Issue Reported"', 280);
    expect(slice).toContain("shouldSendPilotEnglishEquipmentPush()");
    expect(slice).toContain('status === "issue"');
  });

  it("gates scan-derived maintenance overdue alert", () => {
    const slice = sliceAround(equipmentRouteSource, 'title: "Maintenance Overdue"', 280);
    expect(slice).toContain("shouldSendPilotEnglishEquipmentPush()");
  });

  it("gates scan-derived sterilization due alert", () => {
    const slice = sliceAround(equipmentRouteSource, 'title: "Sterilization Due"', 280);
    expect(slice).toContain("shouldSendPilotEnglishEquipmentPush()");
  });

  it("covers all five English equipment push workflows", () => {
    const gatedTitles = [
      "Equipment Checked Out",
      "Equipment Returned",
      "Equipment Transferred",
      "Bulk Transfer",
      "Equipment Issue Reported",
      "Maintenance Overdue",
      "Sterilization Due",
    ];
    const combined = equipmentRouteSource + patchEquipmentSource + bulkMoveSource;
    for (const title of gatedTitles) {
      const idx = combined.indexOf(`title: "${title}"`);
      expect(idx, `expected English push title: ${title}`).toBeGreaterThan(-1);
      const slice = combined.slice(Math.max(0, idx - 200), idx);
      expect(slice, `expected gate before: ${title}`).toContain("shouldSendPilotEnglishEquipmentPush()");
    }
  });
});
