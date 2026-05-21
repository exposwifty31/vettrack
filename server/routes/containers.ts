import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  billingItems,
  billingLedger,
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
import { requireClinicalAuthority } from "../middleware/authority.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { seedDefaultContainersIfEmpty } from "../lib/ensure-clinic-phase2-defaults.js";
import { restockContainerInTx } from "../services/inventory.service.js";
import { resolveBlueprintEntryForContainerName } from "../config/inventoryBlueprint.js";
import { enqueueBillingWebhookJob } from "../lib/queue.js";
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
import { captureConsumableBillingForDispenseLine } from "../lib/container-consumable-billing.js";
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

function resolveRequestId(res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void }, incoming: unknown): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

// Phase 5 PR 5.7 post-merge fix (Cursor Bugbot Low) — the local
// `ClinicalInvariantDenyError` class and `isClinicalInvariantFailOpenActive`
// helper that lived here AND in `dispense.service.ts` have been
// consolidated into `server/lib/clinical-invariant-error.ts`. Both
// wired call sites now import the same definitions, removing the
// divergence risk Bugbot flagged.

router.post("/bootstrap-defaults", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const inserted = await seedDefaultContainersIfEmpty(clinicId);
    res.json({ inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONTAINERS_BOOTSTRAP_FAILED",
        message: "Failed to seed default containers",
        requestId,
      }),
    );
  }
});

router.get("/", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const nfcTagId = typeof req.query.nfcTagId === "string" ? req.query.nfcTagId.trim() : null;

    if (nfcTagId) {
      // Lookup by NFC tag — return single container with items or 404
      const [container] = await db
        .select()
        .from(containers)
        .where(and(eq(containers.clinicId, clinicId), eq(containers.nfcTagId, nfcTagId)))
        .limit(1);

      if (!container) {
        return res.status(404).json(
          apiError({ code: "NOT_FOUND", reason: "CONTAINER_NOT_FOUND", message: "No container found for this NFC tag", requestId }),
        );
      }

      const items = await db
        .select({
          id: containerItems.id,
          itemId: containerItems.itemId,
          quantity: containerItems.quantity,
          label: inventoryItems.label,
          code: inventoryItems.code,
        })
        .from(containerItems)
        .leftJoin(inventoryItems, eq(containerItems.itemId, inventoryItems.id))
        .where(and(eq(containerItems.clinicId, clinicId), eq(containerItems.containerId, container.id)));

      return res.json({ ...container, items });
    }

    const rows = await db
      .select()
      .from(containers)
      .where(eq(containers.clinicId, clinicId))
      .orderBy(asc(containers.name));
    const ids = rows.map((row) => row.id);
    const aggregateRows = ids.length
      ? await db
          .select({
            containerId: containerItems.containerId,
            quantity: sql<number>`COALESCE(SUM(${containerItems.quantity}), 0)`,
          })
          .from(containerItems)
          .where(and(eq(containerItems.clinicId, clinicId), inArray(containerItems.containerId, ids)))
          .groupBy(containerItems.containerId)
      : [];
    const qtyByContainerId = new Map(aggregateRows.map((row) => [row.containerId, Number(row.quantity)]));
    const withBlueprintTargets = rows.map((row) => {
      const entry = resolveBlueprintEntryForContainerName(row.name);
      const currentQuantity = qtyByContainerId.get(row.id) ?? row.currentQuantity;
      return {
        ...row,
        currentQuantity,
        supplyTargets: entry?.supplyTargets ?? [],
      };
    });
    res.json(withBlueprintTargets);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CONTAINERS_LIST_FAILED",
        message: "Failed to list containers",
        requestId,
      }),
    );
  }
});

router.post(
  "/",
  requireAuth,
  requireEffectiveRole("admin"),
  validateBody(createContainerSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const b = req.body as z.infer<typeof createContainerSchema>;
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
  },
);

router.post(
  "/:id/restock",
  requireAuth,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(restockSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    return res.status(409).json(
      apiError({
        code: "LEGACY_RESTOCK_DISABLED",
        reason: "LEGACY_RESTOCK_DISABLED",
        message: "Legacy restock endpoint is disabled. Use restock sessions.",
        requestId,
      }),
    );
  },
);

router.post(
  "/:id/blind-audit",
  requireAuth,
  requireEffectiveRole("technician"),
  validateUuid("id"),
  validateBody(blindAuditSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    return res.status(409).json(
      apiError({
        code: "LEGACY_RESTOCK_DISABLED",
        reason: "LEGACY_RESTOCK_DISABLED",
        message: "Legacy blind-audit endpoint is disabled. Use restock sessions.",
        requestId,
      }),
    );
  },
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
    /** Legacy field; prefer `patientId` for new clients. */
    animalId: z.string().nullable().optional(),
    patientId: z.string().uuid().optional(),
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
  animalId: z.string().nullable().optional(),
});

// POST /api/containers/:id/dispense
router.post(
  "/:id/dispense",
  requireAuth,
  requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowPermanentClinicalRoleFallbackForLegacyDispense: true,
  }),
  validateUuid("id"),
  dispenseIdempotencyMiddleware,
  validateBody(dispenseSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const actorUserId = req.authUser!.id;
      const actorDisplayName = req.authUser!.name || req.authUser!.email;
      const containerId = req.params.id;
      const body = req.body as z.infer<typeof dispenseSchema>;
      const { isEmergency } = body;
      const animalId = body.animalId ?? body.patientId ?? null;
      const requestIdempotencyKey = res.locals.dispenseIdempotencyKey;
      const takenAt = new Date();
      const allowTestBillingFail =
        process.env.VETTRACK_TEST_FORCE_BILLING_FAIL === "1" &&
        typeof req.headers["x-test-force-billing-fail"] === "string" &&
        req.headers["x-test-force-billing-fail"].trim() === "1";

      const dispenseRequestHash = hashDispenseRequestBody(req.body);

      if (isEmergency && body.items.length === 0) {
        // Standalone emergency tap: log event only, no stock changes (complete later)
        const emergencyEventId = randomUUID();
        const bypassReason = body.bypassReason;
        await db.transaction(async (tx) => {
          const [container] = await tx
            .select()
            .from(containers)
            .where(and(eq(containers.clinicId, clinicId), eq(containers.id, containerId)))
            .limit(1);
          if (!container) throw Object.assign(new Error("CONTAINER_NOT_FOUND"), { statusCode: 404 });

          await tx.insert(inventoryLogs).values({
            id: emergencyEventId,
            clinicId,
            containerId,
            taskId: null,
            logType: "adjustment",
            quantityBefore: 0,
            quantityAdded: 0,
            quantityAfter: 0,
            animalId: null,
            roomId: container.roomId,
            note: "emergency",
            metadata: {
              isEmergency: true,
              containerId,
              pendingCompletion: true,
              ...(bypassReason ? { bypassReason } : {}),
            },
            createdByUserId: actorUserId,
          });
        });

        return res.json({
          success: true,
          emergencyEventId,
          takenBy: { userId: actorUserId, displayName: actorDisplayName },
          takenAt: takenAt.toISOString(),
        });
      }

      // Normal dispense — stock, logs, billing, idempotency replay row (single transaction).
      const dispensedItems: Array<{ itemId: string; label: string; quantity: number; newStock: number }> = [];
      const billingIds: string[] = [];
      let autoBilledCents = 0;

      type PendingShadowAudit = {
        animalId: string | null;
        containerId: string;
        requestId: string;
        orphanLines: ReadonlyArray<OrphanLineDetail>;
      };
      // PR 5.7 — post-commit emission slots (mirror dispense.service.ts).
      type PendingEmergencyBypassAudit = {
        userId: string;
        containerId: string;
        requestId: string;
        bypassReason: string;
      };
      type PendingFailOpenAudit = {
        route: string;
        requestId: string;
        errorType?: string;
      };

      // Returning the audit payload via the callback's return value
      // (rather than closure-mutating an outer `let`) keeps
      // TypeScript's flow narrowing intact across the async tx
      // boundary — otherwise the variable narrows to `never` at the
      // post-commit emission site under the server-check tsconfig.
      const {
        responsePayload,
        pendingShadowAudit,
        pendingEmergencyBypassAudit,
        pendingFailOpenAudit,
        copDegraded,
      } = await db.transaction(async (tx) => {
        let pendingShadowAudit: PendingShadowAudit | null = null;
        let pendingEmergencyBypassAudit: PendingEmergencyBypassAudit | null = null;
        let pendingFailOpenAudit: PendingFailOpenAudit | null = null;
        let copDegraded = false;
        const [container] = await tx
          .select()
          .from(containers)
          .where(and(eq(containers.clinicId, clinicId), eq(containers.id, containerId)))
          .limit(1);
        if (!container) throw Object.assign(new Error("CONTAINER_NOT_FOUND"), { statusCode: 404 });

        // ── Phase 5 PR 5.4 — clinical-invariant evaluator wiring ───────────
        // Wiring layer per Phase 5 plan §15 PR 5.4 + CI-21 + CI-22 + CI-23
        // + CI-27 + CI-28. Mirror of the PR 5.3 wiring at the dispense-
        // confirm boundary. Mode is resolved EXACTLY ONCE per request and
        // held request-local. This is the SOLE clinical-invariant
        // evaluator invocation point on the container-dispense path
        // (CI-21).
        //
        // Off-mode does NOT invoke the evaluator (CI-22 + CI-27): it
        // ticks the resolved counter and proceeds. Shadow / enforce
        // invoke the evaluator exactly once with the wiring-layer's
        // resolved mode pinned via `options.modeResolver`.
        //
        // PR 5.4 does NOT act on the deny verdict — the 422 path lands
        // in PR 5.7. The pre-existing legacy `evaluateDispenseAgainstOrders`
        // call below (lines ~395+) continues to provide the production
        // hard-block at HTTP 400 with reason `ORPHAN_DISPENSE_BLOCKED`;
        // PR 5.7 will consolidate the two paths.
        //
        // Mutation-order invariant (CI-23): this block runs BEFORE the
        // legacy validation, BEFORE the billing loop, BEFORE the
        // dispenseEvents UPDATE / inventory mutation.
        //
        // Transaction-boundary invariant (CI-28): runs inside the
        // existing `db.transaction` callback owned by the route handler.
        // No nested tx, no savepoint, no orchestration change.
        //
        // Wiring-layer Strategy A safety net (CI-16, CI-20): any throw
        // inside the mode resolver, the evaluator, or its DB reads is
        // caught here EXACTLY ONCE. No retry. Mutation proceeds. PR 5.7
        // will dispatch fail-open / fail-closed semantics here.
        let clinicalInvariantMode: ClinicalInvariantEnforcementMode;
        try {
          clinicalInvariantMode = await resolveClinicalInvariantEnforcementMode(clinicId);
        } catch {
          clinicalInvariantMode = "off";
        }

        if (clinicalInvariantMode === "off") {
          incrementMetric("clinical_invariant_resolved_off");
        } else {
          incrementMetric(
            clinicalInvariantMode === "shadow"
              ? "clinical_invariant_resolved_shadow"
              : "clinical_invariant_resolved_enforce",
          );
          try {
            // Emergency carve-out (CI-7): the wired evaluator skips the
            // per-item label/code lookup when `isEmergency && bypassReason`
            // — its own carve-out short-circuits before reading `lines`.
            // For DRAFT-equivalent (non-emergency) dispenses we hydrate
            // validation lines via the same `loadInventoryItemLabelCode`
            // helper the legacy block uses below.
            const carveOut =
              body.isEmergency &&
              typeof body.bypassReason === "string" &&
              body.bypassReason.length > 0;
            const validationLines: DispenseLineForValidation[] = [];
            if (!carveOut) {
              for (const lineItem of body.items) {
                const inv = await loadInventoryItemLabelCode(tx, clinicId, lineItem.itemId);
                validationLines.push({
                  itemId: lineItem.itemId,
                  quantity: lineItem.quantity,
                  label: inv?.label ?? "",
                  code: inv?.code ?? "",
                });
              }
            }
            // CI-22 — pin the wiring-layer's resolved mode so the
            // evaluator never re-resolves. Single-source request-local
            // mode; the `clinical_invariant_resolved_*` counters and
            // the evaluator's mode dispatch cannot desync.
            const ciVerdict = await evaluateClinicalInvariant(
              {
                tx,
                clinicId,
                animalId: animalId ?? null,
                containerId,
                lines: validationLines,
                isEmergency: body.isEmergency,
                bypassReason: body.bypassReason ?? null,
                requestId,
              },
              { modeResolver: async () => clinicalInvariantMode },
            );
            // PR 5.7 — handle the enforce-mode deny verdict. The
            // denial audit is attempted inside the tx via
            // `AuditDbExecutor` so the audit-ordering contract
            // (audit attempted BEFORE the 422 response is sent —
            // §9.4 + the PR 5.7.1 regression test) is honored. Per
            // CI-26 the row is best-effort and NOT durable: the
            // throw rolls the tx back and the audit row goes with
            // it. Durable observability for the denial is the
            // metric counters + 422 response + server logs.
            if (ciVerdict.action === "deny") {
              clinicalInvariantMetrics.blockedTotal();
              const seenReasons = new Set<OrphanReasonCode>();
              for (const line of ciVerdict.orphanLines) {
                for (const reason of line.reasons) {
                  seenReasons.add(reason);
                }
              }
              for (const reason of seenReasons) {
                clinicalInvariantMetrics.blockedReason(reason);
              }
              // PR 5.7 post-merge review fix (Codex P1 + Cursor):
              // emitter awaits its `logAudit({tx,…})` Promise so
              // async rejections can't escape, and we await here so
              // the INSERT attempt completes before the deny throw
              // (§9.4 ordering contract).
              await emitClinicalInvariantOrphanDispenseDeniedAuditInTx(tx, {
                clinicId,
                animalId: animalId ?? null,
                containerId,
                requestId,
                orphanLines: ciVerdict.orphanLines,
              });
              const denyBody = buildClinicalInvariantError({
                requestId,
                orphanLines: ciVerdict.orphanLines,
              });
              throw new ClinicalInvariantDenyError(denyBody);
            }

            // PR 5.7 — emergency carve-out (CI-7). Tick the counter
            // and capture the audit payload for post-commit emission.
            if (
              ciVerdict.action === "allow" &&
              ciVerdict.disposition === "EMERGENCY_BYPASS"
            ) {
              clinicalInvariantMetrics.emergencyBypassTotal();
              pendingEmergencyBypassAudit = {
                userId: actorUserId,
                containerId,
                requestId,
                bypassReason: body.bypassReason ?? "",
              };
            }

            // PR 5.5 — shadow detection capture (unchanged). Sampled
            // shadow audit fires AFTER the tx commits (post-commit;
            // never inside the tx — Codex P2 review on PR 5.5).
            if (
              ciVerdict.action === "allow" &&
              ciVerdict.disposition === "WOULD_HAVE_BLOCKED_SHADOW" &&
              ciVerdict.orphanLines
            ) {
              pendingShadowAudit = {
                animalId: animalId ?? null,
                containerId,
                requestId,
                orphanLines: ciVerdict.orphanLines,
              };
            }
          } catch (err) {
            // Wiring-layer Strategy A safety net (CI-16, CI-20).
            // Caught EXACTLY ONCE. No retry. No recursion.
            //
            // Enforce-mode deny surfaces here as
            // `ClinicalInvariantDenyError` — re-throw so the route's
            // catch renders the §6.3 422 envelope. The tx rolls back
            // with the throw.
            if (err instanceof ClinicalInvariantDenyError) {
              throw err;
            }
            // Everything else is an evaluator-side throw. PR 5.7
            // dispatches per plan §8.2:
            //   - shadow: always allow + `evaluator_failure_total++`.
            //     `SMART_COP_VALIDATION_FAIL_OPEN` is irrelevant in
            //     shadow mode.
            //   - enforce + fail-open env true: allow + degraded
            //     header + fail-open audit.
            //   - enforce + fail-open env false (default): throw
            //     503 so the tx rolls back. No retry.
            clinicalInvariantMetrics.evaluatorFailureTotal();
            if (clinicalInvariantMode === "enforce") {
              if (isClinicalInvariantFailOpenActive()) {
                clinicalInvariantMetrics.failOpenTotal();
                copDegraded = true;
                const errorType =
                  err instanceof Error && typeof err.name === "string" && err.name.length > 0
                    ? err.name
                    : undefined;
                pendingFailOpenAudit = {
                  route: "containers.dispense",
                  requestId,
                  errorType,
                };
              } else {
                clinicalInvariantMetrics.failClosedTotal();
                throw Object.assign(new Error("COP_VALIDATION_UNAVAILABLE"), {
                  statusCode: 503,
                  reason: "COP_VALIDATION_UNAVAILABLE",
                  requestId,
                });
              }
            }
            // Shadow mode: tick the failure counter (above) and
            // proceed. No header, no audit, no retry.
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        if (!body.isEmergency) {
          const validationLines: DispenseLineForValidation[] = [];
          for (const lineItem of body.items) {
            const inv = await loadInventoryItemLabelCode(tx, clinicId, lineItem.itemId);
            if (!inv) {
              throw Object.assign(new Error("INVENTORY_ITEM_NOT_FOUND"), { statusCode: 404, itemId: lineItem.itemId });
            }
            validationLines.push({
              itemId: lineItem.itemId,
              quantity: lineItem.quantity,
              label: inv.label,
              code: inv.code,
            });
          }

          const { orphanLines } = await evaluateDispenseAgainstOrders(tx, {
            clinicId,
            animalId: animalId ?? null,
            containerId,
            lines: validationLines,
          });

          if (orphanLines.length > 0 && !body.bypassReason) {
            throw Object.assign(new Error("ORPHAN_DISPENSE_BLOCKED"), {
              statusCode: 400,
              reason: "ORPHAN_DISPENSE_BLOCKED",
              orphanLines,
            });
          }
        }

        for (const lineItem of body.items) {
          let ci: (typeof containerItems.$inferSelect) | undefined;
          let item: { label: string } | undefined;
          let newQty = 0;
          try {
          // Verify container item exists and has sufficient quantity
          const [ciRow] = await tx
            .select()
            .from(containerItems)
            .where(
              and(
                eq(containerItems.clinicId, clinicId),
                eq(containerItems.containerId, containerId),
                eq(containerItems.itemId, lineItem.itemId),
              ),
            )
            .limit(1);
          ci = ciRow;

          if (!ci) {
            throw Object.assign(new Error("ITEM_NOT_IN_CONTAINER"), {
              statusCode: 409,
              code: "INSUFFICIENT_STOCK",
              itemId: lineItem.itemId,
              available: 0,
              requested: lineItem.quantity,
            });
          }

          if (ci.quantity < lineItem.quantity) {
            throw Object.assign(new Error("INSUFFICIENT_STOCK"), {
              statusCode: 409,
              code: "INSUFFICIENT_STOCK",
              itemId: lineItem.itemId,
              available: ci.quantity,
              requested: lineItem.quantity,
            });
          }

          // Get item label
          const [itemRow] = await tx
            .select({ label: inventoryItems.label })
            .from(inventoryItems)
            .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, lineItem.itemId)))
            .limit(1);
          item = itemRow;

          newQty = ci.quantity - lineItem.quantity;

          // Decrement container item quantity
          await tx
            .update(containerItems)
            .set({ quantity: newQty, updatedAt: new Date() })
            .where(
              and(
                eq(containerItems.clinicId, clinicId),
                eq(containerItems.containerId, containerId),
                eq(containerItems.itemId, lineItem.itemId),
              ),
            );
          } catch (lineErr) {
            if (isCheckViolation(lineErr)) {
              throw toInventoryConstraintError(lineErr);
            }
            throw lineErr;
          }

          // Insert inventory log
          const inventoryLogId = randomUUID();
          await tx.insert(inventoryLogs).values({
            id: inventoryLogId,
            clinicId,
            containerId,
            taskId: null,
            logType: "adjustment",
            quantityBefore: ci.quantity,
            quantityAdded: -lineItem.quantity,
            quantityAfter: newQty,
            animalId: animalId ?? null,
            roomId: container.roomId,
            note: null,
            metadata: {
              isEmergency: Boolean(body.bypassReason) || Boolean(body.isEmergency),
              itemId: lineItem.itemId,
              ...(body.bypassReason ? { bypassReason: body.bypassReason } : {}),
            },
            createdByUserId: actorUserId,
          });

          dispensedItems.push({
            itemId: lineItem.itemId,
            label: item?.label ?? lineItem.itemId,
            quantity: lineItem.quantity,
            newStock: newQty,
          });

          const ledgerIdempotencyKey =
            requestIdempotencyKey && requestIdempotencyKey.length > 0
              ? `${requestIdempotencyKey}:adj:${inventoryLogId}`
              : `adjustment_${inventoryLogId}`;

          const capture = await captureConsumableBillingForDispenseLine(tx, {
            clinicId,
            containerId,
            inventoryLogId,
            itemId: lineItem.itemId,
            patientId: animalId ?? null,
            qty: lineItem.quantity,
            idempotencyKey: ledgerIdempotencyKey,
            testForceBillingFail: allowTestBillingFail,
          });
          if (capture.billingEventId) {
            billingIds.push(capture.billingEventId);
            await tx
              .update(inventoryLogs)
              .set({ billingEventId: capture.billingEventId })
              .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, inventoryLogId)));
          }
          autoBilledCents += capture.rowTotalCents;
        }

        if (body.isEmergency && body.bypassReason) {
          await tx.insert(operationalTasks).values({
            id: randomUUID(),
            clinicId,
            patientId: animalId ?? null,
            type: "SYSTEM",
            tag: "BILLING_RECONCILIATION_REQUIRED",
            title: "Emergency dispense — billing reconciliation required",
          });
        }

        const payload: Record<string, unknown> = {
          success: true,
          dispensed: dispensedItems,
          takenBy: { userId: actorUserId, displayName: actorDisplayName },
          takenAt: takenAt.toISOString(),
          billingIds,
          autoBilledCents,
        };
        // Phase 5 PR 5.7 post-merge fix (Codex P2): persist the
        // degraded flag inside the idempotency-cached body so the
        // `X-COP-Validation-Status: degraded` header can be re-emitted
        // on idempotent replay (§6.2). The body field is additive
        // and backend-operational only (CI-13 — no client consumer).
        // The companion change lives in
        // `server/middleware/container-dispense-idempotency.ts`
        // (replay path re-emits the header when this flag is true).
        if (copDegraded) payload.copValidationDegraded = true;

        await tx
          .insert(idempotencyKeys)
          .values({
            clinicId,
            key: requestIdempotencyKey!,
            endpoint: DISPENSE_IDEMPOTENCY_ENDPOINT,
            requestHash: dispenseRequestHash,
            statusCode: 200,
            responseBody: payload,
          })
          .onConflictDoUpdate({
            target: [idempotencyKeys.clinicId, idempotencyKeys.key],
            set: {
              endpoint: DISPENSE_IDEMPOTENCY_ENDPOINT,
              requestHash: dispenseRequestHash,
              statusCode: 200,
              responseBody: payload,
            },
          });

        return {
          responsePayload: payload,
          pendingShadowAudit,
          pendingEmergencyBypassAudit,
          pendingFailOpenAudit,
          copDegraded,
        };
      });

      // Phase 5 PR 5.5 — POST-COMMIT shadow audit emission. Fires
      // only when (a) the tx above committed (a throw would have
      // bypassed this), and (b) the evaluator returned
      // `WOULD_HAVE_BLOCKED_SHADOW`. Best-effort per CI-25.
      if (pendingShadowAudit) {
        emitClinicalInvariantShadowWouldHaveBlockedAudit({
          clinicId,
          animalId: pendingShadowAudit.animalId,
          containerId: pendingShadowAudit.containerId,
          requestId: pendingShadowAudit.requestId,
          orphanLines: pendingShadowAudit.orphanLines,
        });
      }
      // Phase 5 PR 5.7 — emergency-bypass audit (post-commit; the
      // emergency mutation has committed at this point).
      if (pendingEmergencyBypassAudit) {
        emitClinicalInvariantEmergencyBypassAudit({
          clinicId,
          userId: pendingEmergencyBypassAudit.userId,
          containerId: pendingEmergencyBypassAudit.containerId,
          requestId: pendingEmergencyBypassAudit.requestId,
          bypassReason: pendingEmergencyBypassAudit.bypassReason,
        });
      }
      // Phase 5 PR 5.7 — fail-open audit (post-commit; the degraded
      // allow path committed the mutation).
      if (pendingFailOpenAudit) {
        emitClinicalInvariantFailOpenAudit({
          clinicId,
          route: pendingFailOpenAudit.route,
          requestId: pendingFailOpenAudit.requestId,
          errorType: pendingFailOpenAudit.errorType,
        });
      }
      // Phase 5 PR 5.7 — emit `X-COP-Validation-Status: degraded`
      // ONLY on the enforce + fail-open allow path (§6.2 binding
      // table). All other paths (off / shadow / enforce-pass /
      // enforce-deny / fail-closed) MUST NOT set this header.
      if (copDegraded) res.setHeader("X-COP-Validation-Status", "degraded");

      res.locals.dispenseIdempotencyPersistedInTransaction = true;

      // Fire billing webhooks for all billed entries (config lookup handled inside)
      try {
        for (const billingId of billingIds) {
          const [entry] = await db.select().from(billingLedger).where(eq(billingLedger.id, billingId)).limit(1);
          if (entry) {
            await enqueueBillingWebhookJob({
              clinicId,
              entry: {
                id: entry.id,
                animalId: entry.animalId,
                itemType: entry.itemType,
                itemId: entry.itemId,
                quantity: entry.quantity,
                unitPriceCents: entry.unitPriceCents,
                totalAmountCents: entry.totalAmountCents,
                status: entry.status,
                createdAt: entry.createdAt,
              },
            });
          }
        }
      } catch (webhookErr) {
        console.error("[billing-webhook] Failed to enqueue webhook for dispense, continuing:", webhookErr);
      }

      logAudit({
        clinicId,
        actionType: "inventory_dispensed",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email ?? "",
        targetId: containerId,
        targetType: "container",
        actorRole: resolveAuditActorRole(req),
        metadata: {
          dispensedItemCount: dispensedItems.length,
          autoBilledCents,
          animalId: animalId ?? null,
          isEmergency: Boolean(body.bypassReason) || Boolean(body.isEmergency),
          ...(body.bypassReason ? { bypassReason: body.bypassReason } : {}),
        },
      });

      return res.json(responsePayload);
    } catch (err: unknown) {
      // Phase 5 PR 5.7 — render the clinical-invariant §6.3 422
      // envelope as-is. The body was built inside the tx; here we
      // just serialize it. The throw rolled the tx back so no
      // inventory / billing artefact persists.
      if (err instanceof ClinicalInvariantDenyError) {
        return res.status(err.status).json(err.body);
      }
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
      const e = err as Record<string, unknown> & { statusCode?: number; reason?: string; orphanLines?: unknown; itemId?: string };
      // Phase 5 PR 5.7 — fail-closed evaluator failure → 503
      // (`COP_VALIDATION_UNAVAILABLE`). No mutation persisted.
      if (e.reason === "COP_VALIDATION_UNAVAILABLE" || (err as Error).message === "COP_VALIDATION_UNAVAILABLE") {
        return res.status(503).json(
          apiError({
            code: "COP_VALIDATION_UNAVAILABLE",
            reason: "COP_VALIDATION_UNAVAILABLE",
            message: "Clinical-invariant validation is unavailable; please retry.",
            requestId,
          }),
        );
      }
      if (e.code === "INSUFFICIENT_STOCK") {
        return res.status(409).json({
          code: "INSUFFICIENT_STOCK",
          error: "INSUFFICIENT_STOCK",
          reason: "Insufficient stock",
          message: "Insufficient stock for requested item",
          itemId: e.itemId,
          available: e.available,
          requested: e.requested,
          requestId,
        });
      }
      if (e.reason === "ORPHAN_DISPENSE_BLOCKED" || (err as Error).message === "ORPHAN_DISPENSE_BLOCKED") {
        return res.status(400).json({
          code: "ORPHAN_DISPENSE_BLOCKED",
          error: "ORPHAN_DISPENSE_BLOCKED",
          reason: "ORPHAN_DISPENSE_BLOCKED",
          message: "Dispense blocked: lines do not align with active orders or patient context.",
          orphanLines: e.orphanLines ?? [],
          requestId,
        });
      }
      if ((err as Error).message === "INVENTORY_ITEM_NOT_FOUND") {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "INVENTORY_ITEM_NOT_FOUND",
            message: "Inventory item not found for dispense line",
            requestId,
          }),
        );
      }
      if (e.statusCode === 404 || (err as Error).message === "CONTAINER_NOT_FOUND") {
        return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "CONTAINER_NOT_FOUND", message: "Container not found", requestId }));
      }
      console.error(err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "DISPENSE_FAILED", message: "Failed to process dispense", requestId }));
    }
  },
);

// PATCH /api/containers/emergency/:eventId/complete
router.patch(
  "/emergency/:eventId/complete",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(completeEmergencySchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const actorUserId = req.authUser!.id;
      const actorDisplayName = req.authUser!.name || req.authUser!.email;
      const eventId = req.params.eventId;
      const body = req.body as z.infer<typeof completeEmergencySchema>;
      const { animalId } = body;
      const takenAt = new Date();

      const dispensedItems: Array<{ itemId: string; label: string; quantity: number; newStock: number }> = [];
      const billingIds: string[] = [];
      // Collect auto-billing candidates to insert after the transaction commits
      const autoBillingCandidates: Array<{ inventoryLogId: string; billingItemId: string; quantity: number; itemId: string }> = [];

      await db.transaction(async (tx) => {
        // Find the emergency event log
        const [origLog] = await tx
          .select()
          .from(inventoryLogs)
          .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, eventId)))
          .limit(1);

        if (!origLog) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });

        const meta = origLog.metadata as Record<string, unknown> | null;
        if (!meta?.isEmergency || !meta?.pendingCompletion) {
          throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });
        }

        const containerId = origLog.containerId;

        const [container] = await tx
          .select()
          .from(containers)
          .where(and(eq(containers.clinicId, clinicId), eq(containers.id, containerId)))
          .limit(1);
        if (!container) throw Object.assign(new Error("NOT_FOUND"), { statusCode: 404 });

        for (const lineItem of body.items) {
          let ci: (typeof containerItems.$inferSelect) | undefined;
          let item: { label: string } | undefined;
          let newQty = 0;
          try {
          const [ciRow] = await tx
            .select()
            .from(containerItems)
            .where(
              and(
                eq(containerItems.clinicId, clinicId),
                eq(containerItems.containerId, containerId),
                eq(containerItems.itemId, lineItem.itemId),
              ),
            )
            .limit(1);
          ci = ciRow;

          if (!ci || ci.quantity < lineItem.quantity) {
            throw Object.assign(new Error("INSUFFICIENT_STOCK"), {
              statusCode: 409,
              code: "INSUFFICIENT_STOCK",
              itemId: lineItem.itemId,
              available: ci?.quantity ?? 0,
              requested: lineItem.quantity,
            });
          }

          const [itemRow] = await tx
            .select({ label: inventoryItems.label })
            .from(inventoryItems)
            .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, lineItem.itemId)))
            .limit(1);
          item = itemRow;

          newQty = ci.quantity - lineItem.quantity;

          await tx
            .update(containerItems)
            .set({ quantity: newQty, updatedAt: new Date() })
            .where(
              and(
                eq(containerItems.clinicId, clinicId),
                eq(containerItems.containerId, containerId),
                eq(containerItems.itemId, lineItem.itemId),
              ),
            );
          } catch (lineErr) {
            if (isCheckViolation(lineErr)) {
              throw toInventoryConstraintError(lineErr);
            }
            throw lineErr;
          }

          const inventoryLogId = randomUUID();
          await tx.insert(inventoryLogs).values({
            id: inventoryLogId,
            clinicId,
            containerId,
            taskId: null,
            logType: "adjustment",
            quantityBefore: ci.quantity,
            quantityAdded: -lineItem.quantity,
            quantityAfter: newQty,
            animalId: animalId ?? null,
            roomId: container.roomId,
            note: null,
            metadata: { isEmergency: true, emergencyEventId: eventId, itemId: lineItem.itemId },
            createdByUserId: origLog.createdByUserId,
          });

          dispensedItems.push({
            itemId: lineItem.itemId,
            label: item?.label ?? lineItem.itemId,
            quantity: lineItem.quantity,
            newStock: newQty,
          });

          // Billing is handled by the auto-billing block below via billingItems.
          // containerItems has no unitPriceCents — direct billing here would produce ₪0 entries.

          // Queue auto-billing candidate for post-transaction insert
          if (container.billingItemId) {
            autoBillingCandidates.push({ inventoryLogId, billingItemId: container.billingItemId, quantity: lineItem.quantity, itemId: lineItem.itemId });
          }
        }

        // Mark original emergency log as completed
        await tx
          .update(inventoryLogs)
          .set({
            metadata: { ...meta, pendingCompletion: false },
          })
          .where(and(eq(inventoryLogs.clinicId, clinicId), eq(inventoryLogs.id, eventId)));
      });

      // Auto-billing: insert billing ledger rows after the transaction commits
      // Failures must NOT fail the dispense — log and continue
      for (const candidate of autoBillingCandidates) {
        try {
          const [item] = await db
            .select({ isBillable: inventoryItems.isBillable, minimumDispenseToCapture: inventoryItems.minimumDispenseToCapture })
            .from(inventoryItems)
            .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, candidate.itemId)))
            .limit(1);
          if (!item?.isBillable) continue;
          if (candidate.quantity < (item.minimumDispenseToCapture ?? 1)) continue;
          const [bi] = await db
            .select({ id: billingItems.id, unitPriceCents: billingItems.unitPriceCents })
            .from(billingItems)
            .where(and(eq(billingItems.id, candidate.billingItemId), eq(billingItems.clinicId, clinicId)))
            .limit(1);
          if (bi && bi.unitPriceCents > 0) {
            const autoBillingId = randomUUID();
            await db.insert(billingLedger).values({
              id: autoBillingId,
              clinicId,
              animalId: null, // emergencies are unregistered animals by definition
              itemType: "CONSUMABLE",
              itemId: bi.id,
              quantity: candidate.quantity,
              unitPriceCents: bi.unitPriceCents,
              totalAmountCents: bi.unitPriceCents * candidate.quantity,
              idempotencyKey: `adjustment_${candidate.inventoryLogId}`,
              status: "pending",
            }).onConflictDoNothing();
            billingIds.push(autoBillingId);
          }
        } catch (autoBillingErr) {
          console.error("[auto-billing] Failed to insert billing ledger row for emergency dispense, continuing:", autoBillingErr);
        }
      }

      // Fire billing webhooks for all billed entries (config lookup handled inside)
      try {
        for (const billingId of billingIds) {
          const [entry] = await db.select().from(billingLedger).where(eq(billingLedger.id, billingId)).limit(1);
          if (entry) {
            await enqueueBillingWebhookJob({
              clinicId,
              entry: {
                id: entry.id,
                animalId: entry.animalId,
                itemType: entry.itemType,
                itemId: entry.itemId,
                quantity: entry.quantity,
                unitPriceCents: entry.unitPriceCents,
                totalAmountCents: entry.totalAmountCents,
                status: entry.status,
                createdAt: entry.createdAt,
              },
            });
          }
        }
      } catch (webhookErr) {
        console.error("[billing-webhook] Failed to enqueue webhook for emergency dispense, continuing:", webhookErr);
      }

      logAudit({
        clinicId,
        actionType: "inventory_dispensed",
        performedBy: actorUserId,
        performedByEmail: req.authUser!.email ?? "",
        targetId: eventId,
        targetType: "emergency_event",
        actorRole: resolveAuditActorRole(req),
        metadata: {
          dispensedItemCount: dispensedItems.length,
          autoBilledCents: billingIds.length,
          animalId: animalId ?? null,
          isEmergency: true,
        },
      });

      return res.json({
        success: true,
        dispensed: dispensedItems,
        takenBy: { userId: actorUserId, displayName: actorDisplayName },
        takenAt: takenAt.toISOString(),
        billingIds,
      });
    } catch (err: unknown) {
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
      const e = err as Record<string, unknown>;
      if (e.code === "INSUFFICIENT_STOCK") {
        return res.status(409).json({
          code: "INSUFFICIENT_STOCK",
          error: "INSUFFICIENT_STOCK",
          reason: "Insufficient stock",
          message: "Insufficient stock for requested item",
          itemId: e.itemId,
          available: e.available,
          requested: e.requested,
          requestId,
        });
      }
      if ((e as { statusCode?: number }).statusCode === 404) {
        return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "EVENT_NOT_FOUND", message: "Emergency event not found", requestId }));
      }
      console.error(err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "COMPLETE_EMERGENCY_FAILED", message: "Failed to complete emergency", requestId }));
    }
  },
);

export default router;
