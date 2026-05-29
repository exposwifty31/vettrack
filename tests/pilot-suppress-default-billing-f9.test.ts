import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandPackage } from "../server/config/billingPackages.js";
import {
  isPilotDefaultBillingSuppressed,
  resolveBillingItemForEquipment,
  shouldInsertDefaultEquipmentLedger,
} from "../server/lib/equipment-seen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const equipmentSeenSource = fs.readFileSync(
  path.join(__dirname, "..", "server", "lib", "equipment-seen.ts"),
  "utf8",
);

function sliceAround(needle: string, before = 200, after = 120): string {
  const idx = equipmentSeenSource.indexOf(needle);
  expect(idx).toBeGreaterThan(-1);
  return equipmentSeenSource.slice(Math.max(0, idx - before), idx + after);
}

describe("F9: PILOT_SUPPRESS_DEFAULT_BILLING", () => {
  const prior = process.env.PILOT_SUPPRESS_DEFAULT_BILLING;

  afterEach(() => {
    if (prior === undefined) delete process.env.PILOT_SUPPRESS_DEFAULT_BILLING;
    else process.env.PILOT_SUPPRESS_DEFAULT_BILLING = prior;
  });

  it("F9: allows default billing item creation when env is unset", () => {
    delete process.env.PILOT_SUPPRESS_DEFAULT_BILLING;
    expect(isPilotDefaultBillingSuppressed()).toBe(false);
    expect(shouldInsertDefaultEquipmentLedger()).toBe(true);
  });

  it("F9: suppresses default billing when PILOT_SUPPRESS_DEFAULT_BILLING=true", () => {
    process.env.PILOT_SUPPRESS_DEFAULT_BILLING = "true";
    expect(isPilotDefaultBillingSuppressed()).toBe(true);
    expect(shouldInsertDefaultEquipmentLedger()).toBe(false);
  });

  it("F9: resolveBillingItemForEquipment does not apply suppress at resolve time (narrow gate)", async () => {
    process.env.PILOT_SUPPRESS_DEFAULT_BILLING = "true";
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
    const row = {
      billingItemId: null,
      clinicId: "clinic-1",
      id: "eq-1",
    } as Parameters<typeof resolveBillingItemForEquipment>[2];
    const resolved = await resolveBillingItemForEquipment(tx, "clinic-1", row);
    expect(resolved).toBeNull();
    expect(equipmentSeenSource).not.toMatch(
      /resolveBillingItemForEquipment[\s\S]*?isPilotDefaultBillingSuppressed\(\) return null/,
    );
  });

  it("F9: PILOT_SUPPRESS_DEFAULT_BILLING=true + no billingItemId + no packageCode → billingSkipped only (source contract)", () => {
    const skipIdx = equipmentSeenSource.indexOf("if (!billing && !hasPackage)");
    const skippedIdx = equipmentSeenSource.indexOf("billingSkipped: true");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(skippedIdx).toBeGreaterThan(skipIdx);
    expect(equipmentSeenSource.slice(skipIdx, skippedIdx)).not.toContain(
      "getOrCreateDefaultEquipmentBillingItem",
    );

    const defaultGate = sliceAround("if (!billing && shouldInsertDefaultEquipmentLedger())");
    expect(defaultGate).toContain("getOrCreateDefaultEquipmentBillingItem");
  });

  it('F9: PILOT_SUPPRESS_DEFAULT_BILLING=true + no billingItemId + packageCode="fluid_protocol" → 4 consumable rows, zero DEFAULT_EQUIPMENT (source + package expansion)', () => {
    process.env.PILOT_SUPPRESS_DEFAULT_BILLING = "true";
    expect(shouldInsertDefaultEquipmentLedger()).toBe(false);

    const earlyReturnIdx = equipmentSeenSource.indexOf("if (!billing && !hasPackage)");
    const packageIdx = equipmentSeenSource.indexOf("if (packageCode)");
    expect(packageIdx).toBeGreaterThan(earlyReturnIdx);

    const equipmentGuard = sliceAround("let ledgerId: string | undefined", 0, 360);
    expect(equipmentGuard).toContain("if (billing)");
    expect(equipmentGuard).toContain('itemType: "EQUIPMENT"');

    expect(expandPackage("fluid_protocol", 10)).toHaveLength(4);

    expect(equipmentSeenSource).toContain('itemType: "CONSUMABLE"');
  });

  it('F9: PILOT_SUPPRESS_DEFAULT_BILLING unset + no billingItemId + packageCode="fluid_protocol" → 1 DEFAULT + 4 consumable (baseline contract)', () => {
    delete process.env.PILOT_SUPPRESS_DEFAULT_BILLING;
    expect(shouldInsertDefaultEquipmentLedger()).toBe(true);

    const defaultGate = sliceAround("if (!billing && shouldInsertDefaultEquipmentLedger())");
    expect(defaultGate).toContain("getOrCreateDefaultEquipmentBillingItem");

    expect(expandPackage("fluid_protocol", 10)).toHaveLength(4);
    expect(equipmentSeenSource).toContain('itemType: "EQUIPMENT"');
    expect(equipmentSeenSource).toContain('itemType: "CONSUMABLE"');
  });
});
