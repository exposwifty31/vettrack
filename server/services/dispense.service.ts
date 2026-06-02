import { randomUUID } from "crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  containerItems,
  containers,
  db,
  dispenseEvents,
  inventoryItems,
  inventoryLogs,
  operationalTasks,
  type DispenseEvent,
} from "../db.js";
import { logAudit, type AuditDbExecutor } from "../lib/audit.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import {
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
import {
  isCheckViolation,
  toInventoryConstraintError,
} from "../lib/db-constraint-errors.js";
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

// Re-export for the route layer's `sendError` catch which checks
// `err instanceof ClinicalInvariantDenyError`. Keeps the existing
// `import { ClinicalInvariantDenyError } from "...dispense.service.js"`
// at the route call site working without an additional cross-module
// import in the routes layer.
export { ClinicalInvariantDenyError };

export class DispenseError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DispenseError";
  }
}

export interface DispenseItem {
  itemId: string;
  quantity: number;
}

export interface CreateDraftInput {
  clinicId: string;
  containerId: string;
  items: DispenseItem[];
  createdBy: string;
  idempotencyKey: string;
}

export interface ConfirmDispenseInput {
  clinicId: string;
  dispenseEventId: string;
  confirmedBy: string;
  confirmedByEmail: string;
  actorRole?: string | null;
  authoritySource?: string | null;
  authorityReason?: string | null;
  authorityOperationalRole?: string | null;
  /**
   * Phase 5 PR 5.3 — threaded from the route layer; consumed by the
   * clinical-invariant evaluator wiring inside the confirm tx. Required
   * so the evaluator context can carry a stable correlation id for
   * future audit emission (PR 5.7).
   */
  requestId: string;
}

/**
 * Phase 5 PR 5.3 — private helper for the clinical-invariant wiring.
 *
 * Hydrates a `DispenseLineForValidation[]` array by joining the
 * `DispenseItem[]` from the persisted dispense event with the
 * `inventoryItems.label` / `inventoryItems.code` columns. Runs INSIDE
 * the caller-provided `tx` — no new transaction is opened (CI-28).
 *
 * Missing inventory rows degrade gracefully to empty label/code
 * rather than throwing — the wired confirm path already tolerates
 * missing inventory rows by setting `inventoryMismatch=true` and
 * proceeding. The evaluator's matching logic will simply skip the
 * line if the label/code are empty (no orphan reason fired beyond
 * what the animal/hospitalization checks already produce).
 */
async function loadDispenseValidationLines(
  tx: AuditDbExecutor,
  clinicId: string,
  items: DispenseItem[],
): Promise<DispenseLineForValidation[]> {
  const lines: DispenseLineForValidation[] = [];
  for (const item of items) {
    const inv = await loadInventoryItemLabelCode(tx, clinicId, item.itemId);
    lines.push({
      itemId: item.itemId,
      quantity: item.quantity,
      label: inv?.label ?? "",
      code: inv?.code ?? "",
    });
  }
  return lines;
}

export interface CreateEmergencyDispenseInput {
  clinicId: string;
  containerId: string;
  items: DispenseItem[];
  bypassReason: string;
  createdBy: string;
  idempotencyKey: string;
}

/** Create a DRAFT dispense event — validates structure only, no stock mutation. */
export async function createDraftDispense(input: CreateDraftInput): Promise<DispenseEvent> {
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.clinicId, input.clinicId), eq(containers.id, input.containerId)))
    .limit(1);
  if (!container) {
    throw new DispenseError("CONTAINER_NOT_FOUND", 404, "Container not found.");
  }

  if (input.items.length === 0) {
    throw new DispenseError("ITEMS_REQUIRED", 400, "At least one item is required for a draft dispense.");
  }

  for (const item of input.items) {
    const [inv] = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.clinicId, input.clinicId), eq(inventoryItems.id, item.itemId)))
      .limit(1);
    if (!inv) {
      throw new DispenseError("ITEM_NOT_FOUND", 404, `Inventory item ${item.itemId} not found.`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new DispenseError("INVALID_QUANTITY", 400, `Quantity for item ${item.itemId} must be a positive integer.`);
    }
  }

  const [event] = await db
    .insert(dispenseEvents)
    .values({
      id: randomUUID(),
      clinicId: input.clinicId,
      containerId: input.containerId,
      status: "DRAFT",
      items: input.items,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      requiresCompletion: false,
    })
    .onConflictDoNothing()
    .returning();

  if (!event) {
    // Idempotency replay: return existing
    const [existing] = await db
      .select()
      .from(dispenseEvents)
      .where(
        and(
          eq(dispenseEvents.clinicId, input.clinicId),
          eq(dispenseEvents.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return existing;
    throw new DispenseError("CREATE_FAILED", 500, "Failed to create dispense draft.");
  }

  return event;
}

/**
 * Confirm a DRAFT dispense event.
 *
 * Fix B (approved): billing inside TX, mark CONFIRMED in same TX.
 * Post-TX: enqueue async inventory deduction job.
 * Fix G (approved): billing inside TX; if billing fails → TX rolls back; event stays DRAFT.
 * Fix F (insufficientStock): soft pass — mark inventoryMismatch=true, do not block.
 */
/**
 * Phase 5 PR 5.7 — confirmDispense result.
 *
 * `event` is the persisted dispense event (unchanged shape).
 *
 * `copDegraded` is `true` when the clinical-invariant evaluator
 * threw inside the tx AND `SMART_COP_VALIDATION_FAIL_OPEN=true` —
 * the wiring degraded to allow, the mutation proceeded, and the
 * route MUST set the `X-COP-Validation-Status: degraded` response
 * header (§6.2 binding table).
 */
export interface ConfirmDispenseResult {
  event: DispenseEvent;
  copDegraded: boolean;
}

export async function confirmDispense(input: ConfirmDispenseInput): Promise<ConfirmDispenseResult> {
  const {
    clinicId,
    dispenseEventId,
    confirmedBy,
    confirmedByEmail,
    actorRole,
    authoritySource,
    authorityReason,
    authorityOperationalRole,
    requestId,
  } = input;

  type PendingShadowAudit = {
    animalId: string | null;
    containerId: string;
    requestId: string;
    orphanLines: ReadonlyArray<OrphanLineDetail>;
  };

  // PR 5.7 — additional post-commit emission slots.
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

  // The tx callback returns the persisted event AND any pending
  // post-commit audit payloads. Returning via the callback (rather
  // than closure-mutating outer `let`s) keeps TypeScript's flow
  // narrowing intact across the async transaction boundary —
  // otherwise the variables narrow to `never` at the post-commit
  // emission sites under the server-check tsconfig.
  const {
    confirmed,
    pendingShadowAudit,
    pendingEmergencyBypassAudit,
    pendingFailOpenAudit,
    copDegraded,
  } = await db.transaction(async (tx) => {
    let pendingShadowAudit: PendingShadowAudit | null = null;
    let pendingEmergencyBypassAudit: PendingEmergencyBypassAudit | null = null;
    let pendingFailOpenAudit: PendingFailOpenAudit | null = null;
    let copDegraded = false;
    const [event] = await tx
      .select()
      .from(dispenseEvents)
      .where(and(eq(dispenseEvents.clinicId, clinicId), eq(dispenseEvents.id, dispenseEventId)))
      .limit(1);

    if (!event) throw new DispenseError("NOT_FOUND", 404, "Dispense event not found.");
    if (event.status === "CONFIRMED" || event.status === "COMPLETED") {
      // Idempotent — return early with no pending audit payloads.
      // The wiring block below would have populated them; the early
      // return skips that path because no clinical-invariant
      // evaluation is needed for an already-confirmed event.
      return {
        confirmed: event,
        pendingShadowAudit,
        pendingEmergencyBypassAudit,
        pendingFailOpenAudit,
        copDegraded,
      };
    }
    if (event.status !== "DRAFT" && event.status !== "EMERGENCY_PENDING") {
      throw new DispenseError("INVALID_STATE", 409, `Cannot confirm event with status '${event.status}'.`);
    }

    const [container] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.clinicId, clinicId), eq(containers.id, event.containerId)))
      .limit(1);
    if (!container) throw new DispenseError("CONTAINER_NOT_FOUND", 404, "Container not found.");

    const items = event.items as DispenseItem[];

    // ── Phase 5 PR 5.3 — clinical-invariant evaluator wiring ───────────
    // Wiring layer per Phase 5 plan §15 PR 5.3 + CI-21 + CI-22 + CI-23
    // + CI-27 + CI-28. Mode is resolved exactly once per request and
    // held request-local for the duration of this tx. The call site
    // is the SOLE invocation point for the dispense-confirm path
    // (no route-layer + service-layer double invocation).
    //
    // Off-mode does NOT invoke the evaluator on the request path
    // (CI-22 + CI-27): it ticks the resolved counter and proceeds. The
    // evaluator's own off-mode short-circuit is the unit-test path,
    // not the request path.
    //
    // Shadow / enforce: the wiring layer invokes the evaluator
    // exactly once (CI-21, CI-16). PR 5.3 does NOT act on the verdict
    // (no 422 deny path yet — that lands in PR 5.7). Shadow counters
    // tick from inside the evaluator.
    //
    // The wiring layer owns runtime control flow for evaluator
    // failures (CI-20): any throw is caught here exactly once. No
    // retry. No recursion. PR 5.7 will dispatch fail-open /
    // fail-closed semantics here keyed on
    // SMART_COP_VALIDATION_FAIL_OPEN.
    //
    // Mutation-order invariant (CI-23): this block runs BEFORE the
    // billing loop, the inventory mismatch flag, the dispenseEvents
    // UPDATE, the outbox enqueue (post-commit), and any event
    // emission.
    //
    // Transaction-boundary invariant (CI-28): runs inside the
    // existing `db.transaction` callback owned by `confirmDispense`.
    // No nested tx, no savepoint, no tx orchestration change.
    let clinicalInvariantMode: ClinicalInvariantEnforcementMode;
    try {
      clinicalInvariantMode = await resolveClinicalInvariantEnforcementMode(clinicId);
    } catch {
      // Strategy A safety net at the wiring layer: resolver throw
      // degrades to off. Evaluator is not invoked.
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
        const isEmergency = event.status === "EMERGENCY_PENDING";
        const bypassReason = event.bypassReason ?? null;
        // Skip the per-item label/code lookup when the evaluator's
        // emergency carve-out will fire (CI-7) — it short-circuits
        // before consuming `lines`.
        const validationLines: DispenseLineForValidation[] =
          isEmergency && typeof bypassReason === "string" && bypassReason.length > 0
            ? []
            : await loadDispenseValidationLines(tx, clinicId, items);
        // CI-22 — mode is resolved EXACTLY ONCE per request at the
        // wiring layer. Pin the already-resolved mode here so the
        // evaluator does not re-resolve it via the cached config
        // probe. This keeps the request-local mode value single-
        // source — the evaluator and the `clinical_invariant_resolved_*`
        // counters always agree.
        const ciVerdict = await evaluateClinicalInvariant(
          {
            tx,
            clinicId,
        animalId: null,
        containerId: event.containerId,
            lines: validationLines,
            isEmergency,
            bypassReason,
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
          // Best-effort in-tx audit attempt — must precede the
          // throw so the ordering contract holds even though the
          // row will be rolled back with the tx. The emitter is
          // async (it awaits the `logAudit({tx,…})` Promise
          // internally so async rejections can't escape its
          // try/catch); we await here so the INSERT attempt is
          // complete before the deny throw triggers tx rollback
          // (§9.4 ordering contract).
          await emitClinicalInvariantOrphanDispenseDeniedAuditInTx(tx, {
            clinicId,
        animalId: null,
        containerId: event.containerId,
            requestId,
            orphanLines: ciVerdict.orphanLines,
          });
          const body = buildClinicalInvariantError({
            requestId,
            orphanLines: ciVerdict.orphanLines,
          });
          throw new ClinicalInvariantDenyError(body);
        }

        // PR 5.7 — emergency carve-out captured (the evaluator
        // returns allow + disposition `EMERGENCY_BYPASS` per
        // CI-7). Tick the counter and capture the audit payload
        // for post-commit emission.
        if (
          ciVerdict.action === "allow" &&
          ciVerdict.disposition === "EMERGENCY_BYPASS"
        ) {
          clinicalInvariantMetrics.emergencyBypassTotal();
          // bypassReason is guaranteed non-empty here because the
          // evaluator's carve-out predicate requires it.
          pendingEmergencyBypassAudit = {
            userId: confirmedBy,
            containerId: event.containerId,
            requestId,
            bypassReason: bypassReason ?? "",
          };
        }

        // PR 5.5 — shadow detection capture (unchanged).
        if (
          ciVerdict.action === "allow" &&
          ciVerdict.disposition === "WOULD_HAVE_BLOCKED_SHADOW" &&
          ciVerdict.orphanLines
        ) {
          pendingShadowAudit = {
        animalId: null,
        containerId: event.containerId,
            requestId,
            orphanLines: ciVerdict.orphanLines,
          };
        }
      } catch (err) {
        // Wiring-layer Strategy A safety net (CI-16, CI-20). Caught
        // EXACTLY ONCE. No retry. No recursion.
        //
        // The enforce-mode deny verdict surfaces here as a
        // `ClinicalInvariantDenyError` — re-throw so the route's
        // sendError renders the §6.3 422 envelope. The tx
        // rolls back with the throw.
        if (err instanceof ClinicalInvariantDenyError) {
          throw err;
        }
        // Everything else is an evaluator-side throw (resolver /
        // label-code lookup / `evaluateDispenseAgainstOrders`
        // failure). PR 5.7 dispatches per plan §8.2:
        //   - shadow: always allow + `evaluator_failure_total++`.
        //     `SMART_COP_VALIDATION_FAIL_OPEN` is irrelevant in
        //     shadow mode (no client-visible enforcement to
        //     degrade); request proceeds byte-identical to
        //     off-mode at the response layer.
        //   - enforce + fail-open env true: allow + degraded header
        //     + fail-open audit.
        //   - enforce + fail-open env false (default): throw 503
        //     `COP_VALIDATION_UNAVAILABLE`; tx rolls back. No retry.
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
              route: "dispense.confirm",
              requestId,
              errorType,
            };
          } else {
            clinicalInvariantMetrics.failClosedTotal();
            throw new DispenseError(
              "COP_VALIDATION_UNAVAILABLE",
              503,
              "Clinical-invariant validation is unavailable; please retry.",
              { requestId },
            );
          }
        }
        // Shadow mode: tick the failure counter (above) and proceed.
        // No header, no audit, no retry — the mutation commits.
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    let anyInventoryMismatch = false;

    for (const lineItem of items) {
      // Check stock — soft pass on insufficient stock (Fix F / dispense point 7)
      const [ci] = await tx
        .select({ quantity: containerItems.quantity })
        .from(containerItems)
        .where(
          and(
            eq(containerItems.clinicId, clinicId),
            eq(containerItems.containerId, event.containerId),
            eq(containerItems.itemId, lineItem.itemId),
          ),
        )
        .limit(1);

      if (!ci || ci.quantity < lineItem.quantity) {
        anyInventoryMismatch = true;
        // Continue — will be flagged; deduction job handles the shortage
      }

    }

    const now = new Date();
    const [updated] = await tx
      .update(dispenseEvents)
      .set({
        status: "CONFIRMED",
        confirmedBy,
        confirmedAt: now,
        inventoryStatus: "PENDING",
        inventoryMismatch: anyInventoryMismatch,
      })
      .where(and(eq(dispenseEvents.clinicId, clinicId), eq(dispenseEvents.id, dispenseEventId)))
      .returning();

    return {
      confirmed: updated,
      pendingShadowAudit,
      pendingEmergencyBypassAudit,
      pendingFailOpenAudit,
      copDegraded,
    };
  });

  // Phase 5 PR 5.5 — POST-COMMIT shadow audit emission. Fires only if
  // the evaluator returned `WOULD_HAVE_BLOCKED_SHADOW` AND the tx
  // above committed successfully (`db.transaction` would have thrown
  // and skipped this block on rollback). Best-effort per CI-25 — the
  // emitter swallows internal errors; nothing affects request flow.
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

  logAudit({
    clinicId,
    actionType: "dispense_confirmed",
    performedBy: confirmedBy,
    performedByEmail: confirmedByEmail,
    actorRole,
    targetId: dispenseEventId,
    targetType: "dispense_event",
    metadata: {
      status: confirmed.status,
      inventoryMismatch: confirmed.inventoryMismatch,
      authoritySource: authoritySource ?? null,
      authorityReason: authorityReason ?? null,
      authorityOperationalRole: authorityOperationalRole ?? null,
    },
  });

  // Enqueue async inventory deduction (post-TX, non-blocking)
  // The deduction worker will decrement containerItems and mark inventoryStatus=SUCCESS/FAILED.
  // For now we insert a DB-trackable job flag via inventoryLogs; the event recovery
  // scanner will surface CONFIRMED events with inventoryStatus=PENDING that age out.
  try {
    await enqueueDispenseInventoryDeduction(clinicId, confirmed);
  } catch (err) {
    // NOTE: deduction failures (including InventoryConstraintError from
    // migration-125 CHECK) are recorded as inventoryStatus: "FAILED" and
    // do NOT propagate to sendError. The sendError inventory branch
    // exists for safety if this swallow is ever removed.
    console.error("[confirmDispense] inventory deduction enqueue failed", {
      dispenseEventId,
      err: err instanceof Error ? err.message : String(err),
    });
    await db
      .update(dispenseEvents)
      .set({ inventoryStatus: "FAILED" })
      .where(and(eq(dispenseEvents.clinicId, clinicId), eq(dispenseEvents.id, dispenseEventId)));
  }

  return { event: confirmed, copDegraded };
}

/**
 * Inline async deduction for dispense events.
 * Applies stock decrements and writes inventory_logs; marks event COMPLETED on success.
 * On insufficient stock: marks inventoryMismatch=true and still marks COMPLETED
 * (the shortage is visible in the mismatch flag, but the clinical action is not blocked).
 */
async function enqueueDispenseInventoryDeduction(clinicId: string, event: DispenseEvent): Promise<void> {
  const items = event.items as DispenseItem[];

  await db.transaction(async (tx) => {
    let anyMismatch = false;

    for (const lineItem of items) {
      const [ci] = await tx
        .select({ quantity: containerItems.quantity })
        .from(containerItems)
        .where(
          and(
            eq(containerItems.clinicId, clinicId),
            eq(containerItems.containerId, event.containerId),
            eq(containerItems.itemId, lineItem.itemId),
          ),
        )
        .limit(1);

      const currentQty = ci?.quantity ?? 0;
      const requestedQty = lineItem.quantity;
      const actualDeduct = Math.min(currentQty, requestedQty);
      // actualDeduct <= currentQty, so this is already >= 0; the explicit
      // clamp documents and guarantees the non-negative invariant now
      // enforced by the DB CHECK constraint (migration 125).
      const newQty = Math.max(0, currentQty - actualDeduct);

      if (actualDeduct < requestedQty) {
        anyMismatch = true;
      }

      if (ci) {
        try {
          await tx
            .update(containerItems)
            .set({ quantity: newQty, updatedAt: new Date() })
            .where(
              and(
                eq(containerItems.clinicId, clinicId),
                eq(containerItems.containerId, event.containerId),
                eq(containerItems.itemId, lineItem.itemId),
              ),
            );
        } catch (err) {
          if (isCheckViolation(err)) {
            throw toInventoryConstraintError(err);
          }
          throw err;
        }
      }

      await tx.insert(inventoryLogs).values({
        id: randomUUID(),
        clinicId,
        containerId: event.containerId,
        taskId: null,
        logType: "adjustment",
        quantityBefore: currentQty,
        quantityAdded: -actualDeduct,
        quantityAfter: newQty,
        note: anyMismatch ? "Partial deduction — insufficient stock" : null,
        metadata: {
          dispenseEventId: event.id,
          requestedQty,
          actualDeduct,
          inventoryMismatch: actualDeduct < requestedQty,
        },
        createdByUserId: event.confirmedBy ?? event.createdBy,
      });
    }

    await tx
      .update(dispenseEvents)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        inventoryStatus: "SUCCESS",
        inventoryMismatch: anyMismatch,
      })
      .where(and(eq(dispenseEvents.clinicId, clinicId), eq(dispenseEvents.id, event.id)));
  });
}

/** Create an EMERGENCY_PENDING dispense event — minimal data, no stock mutation. */
export async function createEmergencyDispense(input: CreateEmergencyDispenseInput): Promise<DispenseEvent> {
  const [container] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.clinicId, input.clinicId), eq(containers.id, input.containerId)))
    .limit(1);
  if (!container) {
    throw new DispenseError("CONTAINER_NOT_FOUND", 404, "Container not found.");
  }

  const [event] = await db
    .insert(dispenseEvents)
    .values({
      id: randomUUID(),
      clinicId: input.clinicId,
      containerId: input.containerId,
      status: "EMERGENCY_PENDING",
      items: input.items,
      bypassReason: input.bypassReason,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      requiresCompletion: true,
    })
    .onConflictDoNothing()
    .returning();

  if (!event) {
    const [existing] = await db
      .select()
      .from(dispenseEvents)
      .where(
        and(
          eq(dispenseEvents.clinicId, input.clinicId),
          eq(dispenseEvents.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return existing;
    throw new DispenseError("CREATE_FAILED", 500, "Failed to create emergency dispense.");
  }

  logAudit({
    clinicId: input.clinicId,
    actionType: "dispense_emergency_created",
    performedBy: input.createdBy,
    performedByEmail: "",
    targetId: event.id,
    targetType: "dispense_event",
    metadata: { bypassReason: input.bypassReason, itemCount: input.items.length },
  });

  return event;
}

/**
 * Scan pending emergency dispense events and emit escalating operational alerts.
 *
 * Fix E (approved with enhancement):
 *  30 min  → standard alert
 *  60 min  → escalate priority
 *  120 min → administrative escalation
 */
export async function scanUnresolvedEmergencyDispenses(clinicId?: string): Promise<void> {
  const now = new Date();

  const tier30 = new Date(now.getTime() - 30 * 60 * 1000);
  const tier60 = new Date(now.getTime() - 60 * 60 * 1000);
  const tier120 = new Date(now.getTime() - 120 * 60 * 1000);

  const whereBase = clinicId
    ? and(eq(dispenseEvents.clinicId, clinicId), eq(dispenseEvents.status, "EMERGENCY_PENDING"), lt(dispenseEvents.createdAt, tier30))
    : and(eq(dispenseEvents.status, "EMERGENCY_PENDING"), lt(dispenseEvents.createdAt, tier30));

  const pendingEvents = await db
    .select()
    .from(dispenseEvents)
    .where(whereBase);

  for (const event of pendingEvents) {
    const ageMs = now.getTime() - event.createdAt.getTime();
    const tier = ageMs >= 120 * 60 * 1000 ? "ADMINISTRATIVE" : ageMs >= 60 * 60 * 1000 ? "HIGH" : "STANDARD";

    await db.insert(operationalTasks).values({
      id: randomUUID(),
      clinicId: event.clinicId,
      type: "SYSTEM",
      tag: `EMERGENCY_DISPENSE_UNRESOLVED_${tier}`,
      title: `Emergency dispense unresolved (${tier.toLowerCase()} priority) — ${Math.round(ageMs / 60000)} min ago`,
      createdAt: new Date(),
    }).onConflictDoNothing();

    postSystemMessage(event.clinicId, "emergency_dispense_unresolved", {
      dispenseEventId: event.id,
      ageMinutes: Math.round(ageMs / 60000),
      tier,
    }).catch(() => {});
  }
}

/** Update inventory status on a dispense event (called by worker on outcome). */
export async function updateDispenseInventoryStatus(
  dispenseEventId: string,
  clinicId: string,
  inventoryStatus: "SUCCESS" | "FAILED",
  inventoryMismatch?: boolean,
): Promise<void> {
  const newStatus = inventoryStatus === "SUCCESS" ? "COMPLETED" : undefined;
  await db
    .update(dispenseEvents)
    .set({
      inventoryStatus,
      inventoryMismatch: inventoryMismatch ?? false,
      ...(newStatus ? { status: newStatus, completedAt: new Date() } : {}),
    })
    .where(and(eq(dispenseEvents.clinicId, clinicId), eq(dispenseEvents.id, dispenseEventId)));
}
