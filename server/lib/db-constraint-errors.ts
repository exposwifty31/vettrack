// server/lib/db-constraint-errors.ts
// Centralized handling for Postgres CHECK constraint violations (code 23514).
// Added in PR-20 follow-up to ensure migration 125's quantity >= 0
// guards surface as structured 409s instead of leaking 500s to clients.

import type { Response } from "express";

const PG_CHECK_VIOLATION = "23514";

interface ConstraintMapping {
  status: number;
  code: string;
  message: string;
}

const CHECK_CONSTRAINT_MAP: Record<string, ConstraintMapping> = {
  vt_container_items_quantity_non_negative: {
    status: 409,
    code: "INVENTORY_NEGATIVE_QUANTITY",
    message: "Container item quantity cannot go below zero.",
  },
  vt_containers_current_quantity_non_negative: {
    status: 409,
    code: "INVENTORY_NEGATIVE_QUANTITY",
    message: "Container current quantity cannot go below zero.",
  },
};

export interface PgConstraintError {
  code?: string;
  constraint?: string;
  constraint_name?: string;
  message?: string;
}

export class InventoryConstraintError extends Error {
  readonly code: string;
  readonly constraint?: string;
  readonly status: number;

  constructor(constraint: string | undefined, message: string) {
    super(message);
    this.name = "InventoryConstraintError";
    this.code = "INVENTORY_NEGATIVE_QUANTITY";
    this.constraint = constraint;
    this.status = 409;
  }
}

export function isCheckViolation(err: unknown): err is PgConstraintError {
  if (!err || typeof err !== "object") return false;
  return (err as PgConstraintError).code === PG_CHECK_VIOLATION;
}

export function isInventoryConstraintError(err: unknown): err is InventoryConstraintError {
  return err instanceof InventoryConstraintError;
}

export function handleCheckViolation(err: PgConstraintError, res: Response): boolean {
  const name = err.constraint ?? err.constraint_name ?? "";
  const mapped = CHECK_CONSTRAINT_MAP[name];
  if (!mapped) return false;
  res.status(mapped.status).json({
    code: mapped.code,
    message: mapped.message,
    constraint: name,
  });
  return true;
}

export function toInventoryConstraintError(err: PgConstraintError): InventoryConstraintError {
  const name = err.constraint ?? err.constraint_name;
  const mapped = name ? CHECK_CONSTRAINT_MAP[name] : undefined;
  return new InventoryConstraintError(name, mapped?.message ?? "Inventory constraint violation.");
}
