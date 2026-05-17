import type { Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireClinicalUser } from "../middleware/auth.js";
import { requireClinicalAuthority } from "../middleware/authority.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  ClinicalInvariantDenyError,
  confirmDispense,
  createDraftDispense,
  createEmergencyDispense,
  DispenseError,
} from "../services/dispense.service.js";
import { apiError as i18nApiError } from "../lib/apiError.js";

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

function sendError(req: Request, res: Response, err: unknown, requestId: string): void {
  // Phase 5 PR 5.7 — render the clinical-invariant §6.3 422
  // envelope as-is. The body was built by `buildClinicalInvariantError`
  // inside the service; the route just serializes it.
  if (err instanceof ClinicalInvariantDenyError) {
    res.status(err.status).json(err.body);
    return;
  }
  if (err instanceof DispenseError) {
    res.status(err.status).json({
      ...apiError({ code: err.code, reason: err.code, message: err.message, requestId }),
      details: err.details ?? null,
    });
    return;
  }
  console.error("[dispense] unexpected error", err);
  // Phase 6 PR 6.10 CORRECTION 2: 500 catch-all migrated to the
  // i18n-aware apiError helper. The `sendError` signature now accepts
  // `req` so `req.locale` can flow through. The Phase 5 clinical-
  // invariant + DispenseError envelopes above keep their existing
  // structured shapes (unchanged contract).
  i18nApiError(req, res, "errors.dispense.internalError", undefined, 500);
}

/** POST /api/dispense/draft — create a DRAFT (structure validation only, no stock mutation) */
router.post(
  "/draft",
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowPermanentClinicalRoleFallbackForLegacyDispense: true,
  }),
  validateBody(draftSchema),
  async (req, res) => {
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
    sendError(req, res, err, requestId);
    return;
  }
  },
);

/** POST /api/dispense/:id/confirm — confirm a DRAFT; billing in TX; async inventory deduction after commit */
router.post(
  "/:id/confirm",
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowPermanentClinicalRoleFallbackForLegacyDispense: true,
  }),
  validateUuid("id"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const { event, copDegraded } = await confirmDispense({
      clinicId: req.clinicId!,
      dispenseEventId: req.params.id,
      confirmedBy: req.authUser!.id,
      confirmedByEmail: req.authUser!.email,
      actorRole:
        req.authoritySnapshot?.effectiveClinicalRole ??
        resolveAuditActorRole(req),
      authoritySource: req.authoritySnapshot?.source ?? null,
      authorityReason: req.authoritySnapshot?.reason ?? null,
      authorityOperationalRole: req.authoritySnapshot?.operationalRole ?? null,
      // Phase 5 PR 5.3 — threaded for the clinical-invariant evaluator
      // wiring inside the confirm tx.
      requestId,
    });
    // Phase 5 PR 5.7 — emit `X-COP-Validation-Status: degraded` ONLY on
    // the enforce + fail-open allow path (§6.2 binding table). The
    // service signals this via `copDegraded`; off / shadow / enforce-pass
    // / enforce-deny / fail-closed must NOT set this header.
    if (copDegraded) res.setHeader("X-COP-Validation-Status", "degraded");
    return res.json(event);
  } catch (err) {
    sendError(req, res, err, requestId);
    return;
  }
  },
);

/** POST /api/dispense/emergency — EMERGENCY_PENDING (no stock mutation, minimal validation) */
router.post(
  "/emergency",
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowPermanentClinicalRoleFallbackForLegacyDispense: true,
  }),
  validateBody(emergencySchema),
  async (req, res) => {
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
    sendError(req, res, err, requestId);
    return;
  }
  },
);

export default router;
