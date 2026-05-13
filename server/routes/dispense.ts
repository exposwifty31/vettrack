import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireClinicalUser } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  confirmDispense,
  createDraftDispense,
  createEmergencyDispense,
  DispenseError,
} from "../services/dispense.service.js";

const router = Router();

router.use(requireAuth, requireClinicalUser);

const itemSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1),
});

const draftSchema = z.object({
  containerId: z.string().uuid(),
  patientId: z.string().uuid().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

const confirmSchema = z.object({});

const emergencySchema = z.object({
  containerId: z.string().uuid(),
  patientId: z.string().uuid().optional().nullable(),
  items: z.array(itemSchema),
  bypassReason: z.enum(["EMERGENCY_CPR", "PROTOCOL_OVERRIDE", "TECH_ERROR"]),
});

function resolveRequestId(res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void }, incoming: unknown): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return { code: params.code, error: params.code, reason: params.reason, message: params.message, requestId: params.requestId };
}

function sendError(res: { status: (n: number) => { json: (b: unknown) => void } }, err: unknown, requestId: string): void {
  if (err instanceof DispenseError) {
    res.status(err.status).json({
      ...apiError({ code: err.code, reason: err.code, message: err.message, requestId }),
      details: err.details ?? null,
    });
    return;
  }
  console.error("[dispense] unexpected error", err);
  res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "INTERNAL_ERROR", message: "Internal error", requestId }));
}

/** POST /api/dispense/draft — create a DRAFT (structure validation only, no stock mutation) */
// TODO(Phase 2B): replace with requireClinicalAuthority(...)
router.post("/draft", validateBody(draftSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const body = req.body as z.infer<typeof draftSchema>;
  const idempotencyKey = (typeof req.headers["idempotency-key"] === "string"
    ? req.headers["idempotency-key"].trim()
    : null) ?? `draft:${randomUUID()}`;

  try {
    const event = await createDraftDispense({
      clinicId: req.clinicId!,
      containerId: body.containerId,
      patientId: body.patientId ?? null,
      items: body.items,
      createdBy: req.authUser!.id,
      idempotencyKey,
    });
    return res.status(201).json(event);
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

/** POST /api/dispense/:id/confirm — confirm a DRAFT; billing in TX; async inventory deduction after commit */
// TODO(Phase 2B): replace with requireClinicalAuthority(...)
router.post("/:id/confirm", validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const event = await confirmDispense({
      clinicId: req.clinicId!,
      dispenseEventId: req.params.id,
      confirmedBy: req.authUser!.id,
      confirmedByEmail: req.authUser!.email,
      // Phase 1: effectiveRole is not populated; no shift-aware role middleware in chain.
      // resolveAuditActorRole falls back to authUser.role (static DB role).
      // TODO(Phase 2B): restore shift-aware resolution once requireClinicalAuthority sets effectiveRole.
      actorRole: resolveAuditActorRole(req),
    });
    return res.json(event);
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

/** POST /api/dispense/emergency — EMERGENCY_PENDING (no stock mutation, minimal validation) */
// TODO(Phase 2B): replace with requireClinicalAuthority(...)
router.post("/emergency", validateBody(emergencySchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const body = req.body as z.infer<typeof emergencySchema>;
  const idempotencyKey = (typeof req.headers["idempotency-key"] === "string"
    ? req.headers["idempotency-key"].trim()
    : null) ?? `emergency:${randomUUID()}`;

  try {
    const event = await createEmergencyDispense({
      clinicId: req.clinicId!,
      containerId: body.containerId,
      patientId: body.patientId ?? null,
      items: body.items,
      bypassReason: body.bypassReason,
      createdBy: req.authUser!.id,
      idempotencyKey,
    });
    return res.status(201).json(event);
  } catch (err) {
    sendError(res, err, requestId);
    return;
  }
});

export default router;
