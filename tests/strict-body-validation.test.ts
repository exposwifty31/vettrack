/**
 * Negative-body validation matrix (PR-16).
 *
 * Locks the `.strict()` request-body contract added in PR-15: every
 * hardened schema must (a) accept a known-good body, (b) reject an
 * unknown field, and (c) reject a missing required field / wrong type.
 * Schemas are exercised directly via `safeParse` — no DB or network.
 */
import { describe, it, expect } from "vitest";

import { draftSchema, confirmSchema, emergencySchema } from "../server/routes/dispense.js";
import { createTaskSchema, completeTaskSchema, cancelTaskSchema } from "../server/routes/medication-tasks.js";
import {
  startSchema,
  endSchema,
  startSessionSchema,
  logEntrySchema,
  endSessionSchema,
  reconcileSchema,
  manualBillingSchema,
} from "../server/routes/code-blue.js";
import {
  createChargeSchema,
  reverseChargeSchema,
  leakageOnePagerSchema,
  bulkSyncSchema,
} from "../server/routes/billing.js";
import { createItemSchema, updateItemSchema, addPriceSchema } from "../server/routes/inventory-items.js";
import { createPoSchema, receivePoSchema } from "../server/routes/procurement.js";
import { checkoutSchema, scanSchema } from "../server/routes/equipment.js";

const UUID = "00000000-0000-4000-8000-000000000000";

type Case = {
  name: string;
  schema: { safeParse: (v: unknown) => { success: boolean } };
  valid: Record<string, unknown>;
  /** A required key to delete (omit for schemas with no required keys). */
  requiredKey?: string;
};

const cases: Case[] = [
  { name: "dispense draftSchema", schema: draftSchema, requiredKey: "containerId",
    valid: { containerId: UUID, items: [{ itemId: "i1", quantity: 1 }] } },
  { name: "dispense confirmSchema", schema: confirmSchema, valid: {} },
  { name: "dispense emergencySchema", schema: emergencySchema, requiredKey: "bypassReason",
    valid: { containerId: UUID, items: [], bypassReason: "EMERGENCY_CPR" } },
  { name: "medication createTaskSchema", schema: createTaskSchema, requiredKey: "animalId",
    valid: { animalId: "a1", drugId: "d1", route: "IV",
      calculationInput: { weightKg: 5, prescribedDosePerKg: 2, doseUnit: "mg_per_kg" } } },
  { name: "medication completeTaskSchema", schema: completeTaskSchema, requiredKey: "actualVolume",
    valid: { actualVolume: 1.5 } },
  { name: "medication cancelTaskSchema", schema: cancelTaskSchema, valid: { reason: "done" } },
  { name: "code-blue startSchema", schema: startSchema, valid: {} },
  { name: "code-blue endSchema", schema: endSchema, valid: { outcome: "rosc" } },
  { name: "code-blue startSessionSchema", schema: startSessionSchema, requiredKey: "managerUserId",
    valid: { managerUserId: "u1", managerUserName: "Tech One" } },
  { name: "code-blue logEntrySchema", schema: logEntrySchema, requiredKey: "label",
    valid: { idempotencyKey: UUID, elapsedMs: 0, label: "epi", category: "drug" } },
  { name: "code-blue endSessionSchema", schema: endSessionSchema, requiredKey: "outcome",
    valid: { outcome: "rosc" } },
  { name: "code-blue reconcileSchema", schema: reconcileSchema, valid: {} },
  { name: "code-blue manualBillingSchema", schema: manualBillingSchema, requiredKey: "itemId",
    valid: { inventoryLogId: "l1", itemId: "i1", quantity: 1, unitPriceCents: 100 } },
  { name: "billing createChargeSchema", schema: createChargeSchema, requiredKey: "itemId",
    valid: { itemType: "EQUIPMENT", itemId: "i1", quantity: 1, unitPriceCents: 100 } },
  { name: "billing reverseChargeSchema", schema: reverseChargeSchema, requiredKey: "reversalReason",
    valid: { reversalReason: "billed twice" } },
  { name: "billing leakageOnePagerSchema", schema: leakageOnePagerSchema, requiredKey: "summary",
    valid: { summary: { totalGapValueCents: 0, totalGapQty: 0 } } },
  { name: "billing bulkSyncSchema", schema: bulkSyncSchema, requiredKey: "ids",
    valid: { ids: ["a"] } },
  { name: "inventory createItemSchema", schema: createItemSchema, requiredKey: "code",
    valid: { code: "ITEM_1", label: "Item One" } },
  { name: "inventory updateItemSchema", schema: updateItemSchema, valid: { label: "Renamed" } },
  { name: "inventory addPriceSchema", schema: addPriceSchema, requiredKey: "priceCents",
    valid: { contextType: "GLOBAL", priceCents: 500 } },
  { name: "procurement createPoSchema", schema: createPoSchema, requiredKey: "supplierName",
    valid: { supplierName: "Acme", lines: [{ itemId: "i1", quantityOrdered: 2 }] } },
  { name: "procurement receivePoSchema", schema: receivePoSchema, requiredKey: "lines",
    valid: { lines: [{ lineId: "l1", quantityReceived: 1, containerId: "c1" }] } },
  { name: "equipment checkoutSchema", schema: checkoutSchema, valid: { location: "ICU" } },
  { name: "equipment scanSchema", schema: scanSchema, requiredKey: "status",
    valid: { status: "ok", note: "fine" } },
];

/** Production payloads from H4 strict-schema audit (VA-01 remediation). */
describe("H4 audit remediation — production client payloads", () => {
  it("startSessionSchema accepts idempotencyKey sent by code-blue.tsx", () => {
    const body = {
      idempotencyKey: UUID,
      managerUserId: "u1",
      managerUserName: "Tech One",
      preCheckPassed: true,
      hospitalizationId: "h1",
      patientId: "p1",
    };
    expect(startSessionSchema.safeParse(body).success).toBe(true);
  });

  it("scanSchema accepts api.equipment.scan wire body (status, note, photoUrl only)", () => {
    expect(
      scanSchema.safeParse({ status: "ok", note: "fine", photoUrl: "https://x/y.jpg" }).success,
    ).toBe(true);
  });

  it("scanSchema rejects redundant userId/userEmail in body", () => {
    expect(
      scanSchema.safeParse({
        status: "ok",
        userId: "spoofed-user",
        userEmail: "spoofed@example.com",
      }).success,
    ).toBe(false);
  });
});

describe("PR-15 strict body schemas — negative validation matrix", () => {
  for (const c of cases) {
    describe(c.name, () => {
      it("accepts a known-good body", () => {
        expect(c.schema.safeParse(c.valid).success).toBe(true);
      });

      it("rejects an unknown field (.strict())", () => {
        expect(
          c.schema.safeParse({ ...c.valid, __unexpected__: "x" }).success,
        ).toBe(false);
      });

      if (c.requiredKey) {
        it(`rejects a body missing the required '${c.requiredKey}'`, () => {
          const body = { ...c.valid };
          delete (body as Record<string, unknown>)[c.requiredKey as string];
          expect(c.schema.safeParse(body).success).toBe(false);
        });

        it(`rejects a wrong-typed '${c.requiredKey}'`, () => {
          expect(
            c.schema.safeParse({ ...c.valid, [c.requiredKey as string]: Symbol("bad") as unknown }).success,
          ).toBe(false);
        });
      }
    });
  }
});
