import { describe, it, expect } from "vitest";
import {
  isUniqueViolation,
  ITEM_CODE_UNIQUE_CONSTRAINT,
  ITEM_NFC_TAG_UNIQUE_CONSTRAINT,
  EQUIPMENT_NFC_TAG_UNIQUE_CONSTRAINT,
} from "../server/lib/pg-errors.js";

describe("isUniqueViolation", () => {
  it("matches when code and constraint both match", () => {
    const err = { code: "23505", constraint: ITEM_CODE_UNIQUE_CONSTRAINT };
    expect(isUniqueViolation(err, ITEM_CODE_UNIQUE_CONSTRAINT)).toBe(true);
  });

  it("does not match a different unique constraint on the same table", () => {
    // A duplicate nfc_tag_id must not be mistaken for a duplicate code.
    const err = { code: "23505", constraint: ITEM_NFC_TAG_UNIQUE_CONSTRAINT };
    expect(isUniqueViolation(err, ITEM_CODE_UNIQUE_CONSTRAINT)).toBe(false);
  });

  it("does not match a unique violation from an unrelated table", () => {
    const err = { code: "23505", constraint: EQUIPMENT_NFC_TAG_UNIQUE_CONSTRAINT };
    expect(isUniqueViolation(err, ITEM_CODE_UNIQUE_CONSTRAINT)).toBe(false);
  });

  it("does not match a non-unique-violation error code", () => {
    const err = { code: "23514", constraint: ITEM_CODE_UNIQUE_CONSTRAINT };
    expect(isUniqueViolation(err, ITEM_CODE_UNIQUE_CONSTRAINT)).toBe(false);
  });

  it("does not match a non-object error", () => {
    expect(isUniqueViolation(new Error("boom"), ITEM_CODE_UNIQUE_CONSTRAINT)).toBe(false);
    expect(isUniqueViolation(null, ITEM_CODE_UNIQUE_CONSTRAINT)).toBe(false);
  });
});
