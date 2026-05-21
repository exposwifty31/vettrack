// tests/inventory-negative-quantity-guard.test.ts
import { describe, it, expect } from "vitest";
import type { Response } from "express";
import {
  InventoryConstraintError,
  handleCheckViolation,
  isCheckViolation,
  isInventoryConstraintError,
  toInventoryConstraintError,
} from "../server/lib/db-constraint-errors.js";

function makeRes(): { res: Response; captured: { status: number; body: unknown } } {
  const captured = { status: 200, body: null as unknown };
  const res = {
    status(c: number) {
      captured.status = c;
      return this;
    },
    json(b: unknown) {
      captured.body = b;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

describe("db-constraint-errors", () => {
  describe("isCheckViolation", () => {
    it("returns true for code 23514", () => {
      expect(isCheckViolation({ code: "23514" })).toBe(true);
    });

    it("returns false for other Postgres codes", () => {
      expect(isCheckViolation({ code: "23505" })).toBe(false);
      expect(isCheckViolation({ code: "23503" })).toBe(false);
    });

    it("returns false for non-objects", () => {
      expect(isCheckViolation(null)).toBe(false);
      expect(isCheckViolation(undefined)).toBe(false);
      expect(isCheckViolation("error")).toBe(false);
      expect(isCheckViolation(42)).toBe(false);
    });
  });

  describe("handleCheckViolation", () => {
    it("maps vt_container_items_quantity_non_negative to 409", () => {
      const { res, captured } = makeRes();
      const handled = handleCheckViolation(
        { code: "23514", constraint: "vt_container_items_quantity_non_negative" },
        res,
      );
      expect(handled).toBe(true);
      expect(captured.status).toBe(409);
      expect(captured.body).toMatchObject({
        code: "INVENTORY_NEGATIVE_QUANTITY",
        constraint: "vt_container_items_quantity_non_negative",
      });
    });

    it("maps vt_containers_current_quantity_non_negative to 409", () => {
      const { res, captured } = makeRes();
      const handled = handleCheckViolation(
        { code: "23514", constraint: "vt_containers_current_quantity_non_negative" },
        res,
      );
      expect(handled).toBe(true);
      expect((captured.body as { code: string }).code).toBe("INVENTORY_NEGATIVE_QUANTITY");
    });

    it("returns false (does not respond) for unmapped constraints", () => {
      const { res, captured } = makeRes();
      const handled = handleCheckViolation(
        { code: "23514", constraint: "some_other_constraint" },
        res,
      );
      expect(handled).toBe(false);
      expect(captured.status).toBe(200);
    });

    it("falls back to constraint_name when constraint is absent", () => {
      const { res, captured } = makeRes();
      const handled = handleCheckViolation(
        { code: "23514", constraint_name: "vt_container_items_quantity_non_negative" },
        res,
      );
      expect(handled).toBe(true);
      expect(captured.status).toBe(409);
    });
  });

  describe("toInventoryConstraintError", () => {
    it("produces an InventoryConstraintError for known constraints", () => {
      const e = toInventoryConstraintError({
        code: "23514",
        constraint: "vt_container_items_quantity_non_negative",
      });
      expect(isInventoryConstraintError(e)).toBe(true);
      expect(e.code).toBe("INVENTORY_NEGATIVE_QUANTITY");
      expect(e.status).toBe(409);
      expect(e.constraint).toBe("vt_container_items_quantity_non_negative");
    });
  });
});
