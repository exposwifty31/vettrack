import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  containerItems,
  containers,
  db,
  idempotencyKeys,
  inventoryItems,
  inventoryLogs,
  operationalTasks,
  users,
} from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { seedDefaultContainersIfEmpty } from "../lib/ensure-clinic-phase2-defaults.js";
import { restockContainerInTx } from "../services/inventory.service.js";
import { resolveBlueprintEntryForContainerName } from "../config/inventoryBlueprint.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import {
  evaluateDispenseAgainstOrders,
  loadInventoryItemLabelCode,
  type DispenseLineForValidation,
} from "../lib/dispense-order-validation.js";
import { resolveClinicalInvariantEnforcementMode } from "../lib/authority/enforcement/clinical-invariant.config.js";
import { evaluateClinicalInvariant } from "../lib/authority/enforcement/clinical-invariant.evaluator.js";
import {
  emitClinicalInvariantShadowWouldHaveBlockedAudit,
  emitClinicalInvariantOrphanDispenseDeniedAuditInTx,
  emitClinicalInvariantEmergencyBypassAudit,
  emitClinicalInvariantFailOpenAudit,
} from "../lib/authority/enforcement/clinical-invariant.audit.js";
import { clinicalInvariantMetrics } from "../lib/authority/enforcement/clinical-invariant.metrics.js";
import type { ClinicalInvariantEnforcementMode } from "../lib/authority/enforcement/clinical-invariant.types.js";
import { incrementMetric } from "../lib/metrics.js";
import type {
  OrphanLineDetail,
  OrphanReasonCode,
} from "../lib/dispense-order-validation.js";
import {
  buildClinicalInvariantError,
  ClinicalInvariantDenyError,
  isClinicalInvariantFailOpenActive,
} from "../lib/clinical-invariant-error.js";
import {
  DISPENSE_IDEMPOTENCY_ENDPOINT,
  dispenseIdempotencyMiddleware,
} from "../middleware/container-dispense-idempotency.js";
import { hashDispenseRequestBody } from "../lib/dispense-idempotency-hash.js";
import {
  handleCheckViolation,
  isCheckViolation,
  isInventoryConstraintError,
  toInventoryConstraintError,
} from "../lib/db-constraint-errors.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { postContainerBootstrapDefaultsHandler } from "./containers/handlers/post-container-bootstrap-defaults.js";
import { postContainerRestockHandler } from "./containers/handlers/post-container-restock.js";
import { postContainerBlindAuditHandler } from "./containers/handlers/post-container-blind-audit.js";
import { getContainerListHandler } from "./containers/handlers/get-container-list.js";
import { postContainerCreateHandler } from "./containers/handlers/post-container-create.js";
import { patchContainerEmergencyCompleteHandler } from "./containers/handlers/patch-container-emergency-complete.js";
import { postContainerDispenseHandler } from "./containers/handlers/post-container-dispense.js";

const router = Router();

const createContainerSchema = z.object({
  name: z.string().min(1).max(200),
  department: z.string().max(200).optional(),
  targetQuantity: z.number().int().min(0),
  currentQuantity: z.number().int().min(0).optional(),
  roomId: z.string().uuid().optional().nullable(),
  nfcTagId: z.string().max(200).optional().nullable(),
});

const restockSchema = z.object({
  addedQuantity: z.number().int().min(0),
});

const blindAuditSchema = z.object({
  physicalCount: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

// Phase 5 PR 5.7 post-merge fix (Cursor Bugbot Low) — the local
// `ClinicalInvariantDenyError` class and `isClinicalInvariantFailOpenActive`
// helper that lived here AND in `dispense.service.ts` have been
// consolidated into `server/lib/clinical-invariant-error.ts`. Both
// wired call sites now import the same definitions, removing the
// divergence risk Bugbot flagged.

router.post("/bootstrap-defaults", requireAuth, requireEffectiveRole("technician"), postContainerBootstrapDefaultsHandler);

// Inventory container list is NON-clinical consumables data — any authenticated
// staff member (student floor) may read it to dispense/restock. Not a clinical gate.
router.get("/", requireAuth, requireEffectiveRole("student"), getContainerListHandler);

router.post(
  "/",
  requireAuth,
  requireEffectiveRole("admin"),
  validateBody(createContainerSchema),
  postContainerCreateHandler,
);

router.post(
  "/:id/restock",
  requireAuth,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(restockSchema),
  postContainerRestockHandler,
);

router.post(
  "/:id/blind-audit",
  requireAuth,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(blindAuditSchema),
  postContainerBlindAuditHandler,
);

// ─── Dispense schemas ─────────────────────────────────────────────────────────

const dispenseSchema = z
  .object({
    items: z.array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
    ),
    isEmergency: z.boolean().default(false),
    bypassReason: z.enum(["EMERGENCY_CPR", "PROTOCOL_OVERRIDE", "TECH_ERROR"]).optional(),
  })
  .refine((d) => !d.isEmergency || !!d.bypassReason, {
    message: "bypassReason is required when isEmergency is true",
    path: ["bypassReason"],
  });

const completeEmergencySchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string().min(1),
      quantity: z.number().int().min(1),
    }),
  ),
});

// POST /api/containers/:id/dispense
// Consumables dispense is NON-clinical (drug formulary removed, migrations
// 142-143): any authenticated staff member — including a supervised student —
// may dispense. `requireEffectiveRole("student")` is the role floor. This is NOT
// a clinical-authority gate; STUDENT_NEVER_ELEVATED and the clinical-authority
// middleware stay in force for Code Blue + genuinely-clinical routes.
router.post(
  "/:id/dispense",
  requireAuth,
  requireEffectiveRole("student"),
  validateUuid("id"),
  dispenseIdempotencyMiddleware,
  validateBody(dispenseSchema),
  postContainerDispenseHandler,
);

// PATCH /api/containers/emergency/:eventId/complete
// Completes a consumables emergency dispense initiated via POST /:id/dispense —
// the second half of the same non-clinical dispense flow, so it shares the
// student floor (a student who taps emergency must be able to complete it).
router.patch(
  "/emergency/:eventId/complete",
  requireAuth,
  requireEffectiveRole("student"),
  validateBody(completeEmergencySchema),
  patchContainerEmergencyCompleteHandler,
);

export default router;
