import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { containers, db } from "../../../db.js";
import { apiError, resolveRequestId } from "../../../lib/route-utils.js";
import {
  handleCheckViolation,
  isCheckViolation,
  isInventoryConstraintError,
  toInventoryConstraintError,
} from "../../../lib/db-constraint-errors.js";

type CreateContainerBody = {
  name: string;
  department?: string;
  targetQuantity: number;
  currentQuantity?: number;
  roomId?: string | null;
  nfcTagId?: string | null;
};

/** POST /api/containers */
export const postContainerCreateHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const b = req.body as CreateContainerBody;
    const id = randomUUID();
    const current = b.currentQuantity ?? b.targetQuantity;
    try {
      await db.insert(containers).values({
        id,
        clinicId,
        name: b.name.trim(),
        department: b.department?.trim() ?? "",
        targetQuantity: b.targetQuantity,
        currentQuantity: current,
        roomId: b.roomId ?? null,
        nfcTagId: b.nfcTagId?.trim() || null,
      });
    } catch (insertErr) {
      if (isCheckViolation(insertErr)) {
        throw toInventoryConstraintError(insertErr);
      }
      throw insertErr;
    }
    const [row] = await db.select().from(containers).where(eq(containers.id, id)).limit(1);
    res.status(201).json(row);
  } catch (err) {
    if (isInventoryConstraintError(err)) {
      return res.status(err.status).json({
        code: err.code,
        message: err.message,
        constraint: err.constraint,
      });
    }
    if (isCheckViolation(err) && handleCheckViolation(err, res)) {
      return;
    }
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONTAINER_CREATE_FAILED",
        message: "Failed to create container",
        requestId,
      }),
    );
  }
};
