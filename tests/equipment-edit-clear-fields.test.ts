/**
 * Web defect #1 (2026-08-28 register): clearing serialNumber / model /
 * manufacturer / location on the equipment EDIT form 400s the whole PATCH —
 * buildUpdatePayload sent `?? null` while patchEquipmentSchema
 * (server/routes/equipment.ts:105-128, .strict()) declares those four
 * `optional()` and NOT `.nullable()`. The wire contract for clearing them is
 * the EMPTY STRING — the semantics the RN form already ships.
 */
import { describe, expect, it } from "vitest";

import {
  buildEquipmentUpdatePayload,
  type EquipmentUpdateFormInput,
} from "../src/lib/equipment-update-payload";

const CLEARED_FORM: EquipmentUpdateFormInput = {
  name: "Infusion pump",
  nameHe: "",
  serialNumber: "",
  model: "   ",
  manufacturer: "",
  purchaseDate: "",
  expiryDate: "",
  location: "",
  folderId: "none",
  imageUrl: "",
  usuallyFoundHere: "",
  searchAlias: "",
  staffNote: "",
  rfidTagEpc: "",
};

describe("equipment edit — clearing fields survives the strict PATCH schema", () => {
  it("the four non-nullable keys clear as EMPTY STRINGS, never null", () => {
    const payload = buildEquipmentUpdatePayload(CLEARED_FORM, {
      includeExpectedReturn: false,
      version: 7,
    });
    expect(payload.serialNumber).toBe("");
    expect(payload.model).toBe("");
    expect(payload.manufacturer).toBe("");
    expect(payload.location).toBe("");
  });

  it("nullable keys keep null as their cleared value", () => {
    const payload = buildEquipmentUpdatePayload(CLEARED_FORM, {
      includeExpectedReturn: false,
      version: undefined,
    });
    expect(payload.nameHe).toBeNull();
    expect(payload.imageUrl).toBeNull();
    expect(payload.usuallyFoundHere).toBeNull();
    expect(payload.searchAlias).toBeNull();
    expect(payload.staffNote).toBeNull();
    expect(payload.rfidTagEpc).toBeNull();
    expect(payload.purchaseDate).toBeNull();
    expect(payload.expiryDate).toBeNull();
    expect(payload.folderId).toBeNull();
  });

  it("populated values pass through trimmed, and the version echo is presence-gated", () => {
    const populated = buildEquipmentUpdatePayload(
      { ...CLEARED_FORM, serialNumber: " SN-9 ", location: " ICU shelf " },
      { includeExpectedReturn: false, version: 3 },
    );
    expect(populated.serialNumber).toBe("SN-9");
    expect(populated.location).toBe("ICU shelf");
    expect(populated).toHaveProperty("version", 3);

    const noVersion = buildEquipmentUpdatePayload(CLEARED_FORM, {
      includeExpectedReturn: false,
      version: undefined,
    });
    expect(noVersion).not.toHaveProperty("version");
    expect(noVersion).not.toHaveProperty("expectedReturnMinutes");
  });
});
