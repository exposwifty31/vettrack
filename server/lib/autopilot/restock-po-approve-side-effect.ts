/**
 * VetTrack 2.0, Task 1.1 §4 — `restock_po_on_burn` approve side effect.
 *
 * The ONE place among the 4 proposal kinds where "approve" does more than
 * flip a status (documented at the dispatch site in
 * `action-proposal-service.ts`, per the plan's explicit instruction): it
 * inserts real `vt_purchase_orders` + `vt_po_lines` rows, mirroring
 * `server/routes/procurement.ts`'s `POST /api/procurement` insert shape
 * (read-only reference — that route is never modified by this file).
 *
 * `unitPriceCents` stays at its schema default (0) — price resolution is
 * Task 1.4's job, out of scope here (disclosed, not silently rebuilt).
 *
 * `createdBy` is always the APPROVING actor's real `userId` — never a
 * system/service-account id — because `vt_purchase_orders.createdBy` is
 * `NOT NULL REFERENCES users(id)`.
 *
 * Pure kind-dispatch: `buildRestockPoApproveSideEffect` returns `undefined`
 * for every kind other than `restock_po_on_burn`, so `transitionAndRecord`
 * receives no side effect at all for those — a true no-op, not a
 * conditionally-skipped one.
 */
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { purchaseOrders, poLines, inventoryItems } from "../../db.js";
import type { ActionProposalRow } from "../../schema/ops.js";
import type { ActionProposalTransactionExecutor } from "./action-proposal-writer.port.js";
import type { RestockPoDraftContent } from "./restock-po-composer.js";

function isRestockPoDraftContent(value: unknown): value is RestockPoDraftContent {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<RestockPoDraftContent>;
  return (
    typeof draft.supplierName === "string" &&
    Array.isArray(draft.lines) &&
    draft.lines.every(
      (line) =>
        line &&
        typeof line.itemId === "string" &&
        typeof line.quantitySuggested === "number" &&
        Number.isInteger(line.quantitySuggested) &&
        line.quantitySuggested > 0,
    )
  );
}

/**
 * `effectiveContent` (owner decision 2026-07-22, edit = fix-then-execute):
 * the edit path passes the validated `editedContent` so the PO is built from
 * the human-corrected version; the approve path omits it and the staged
 * `draftContent` is used as before.
 */
export function buildRestockPoApproveSideEffect(
  staged: ActionProposalRow,
  approvingUserId: string,
  effectiveContent?: unknown,
): ((tx: ActionProposalTransactionExecutor) => Promise<void>) | undefined {
  if (staged.kind !== "restock_po_on_burn") return undefined;

  const draft = effectiveContent ?? staged.draftContent;
  if (!isRestockPoDraftContent(draft)) {
    throw new Error(
      `restock_po_on_burn approve side effect: proposal ${staged.id}'s ${effectiveContent ? "editedContent" : "draftContent"} does not match the expected RestockPoDraftContent shape`,
    );
  }

  return async (tx: ActionProposalTransactionExecutor) => {
    // Multi-tenancy guard (binding rule): every referenced itemId must belong to
    // this proposal's clinic. The edit path lets a human supply itemIds, so we
    // must never insert a poLine pointing at another clinic's vt_items row.
    // Validated inside the transaction so a bad reference rolls back the whole PO.
    const itemIds = draft.lines.map((line) => line.itemId);
    if (itemIds.length > 0) {
      const owned = await tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(inArray(inventoryItems.id, itemIds), eq(inventoryItems.clinicId, staged.clinicId)));
      const ownedIds = new Set(owned.map((row) => row.id));
      const foreign = [...new Set(itemIds)].filter((id) => !ownedIds.has(id));
      if (foreign.length > 0) {
        throw new Error(
          `restock_po_on_burn approve side effect: itemId(s) [${foreign.join(", ")}] do not exist in clinic ${staged.clinicId}`,
        );
      }
    }

    const orderId = randomUUID();
    await tx.insert(purchaseOrders).values({
      id: orderId,
      clinicId: staged.clinicId,
      supplierName: draft.supplierName,
      status: "draft",
      createdBy: approvingUserId,
    });

    if (draft.lines.length > 0) {
      // Single batched insert (one round-trip) instead of one insert per line.
      await tx.insert(poLines).values(
        draft.lines.map((line) => ({
          id: randomUUID(),
          clinicId: staged.clinicId,
          purchaseOrderId: orderId,
          itemId: line.itemId,
          quantityOrdered: line.quantitySuggested,
          // unitPriceCents stays at its schema default (0) — Task 1.4's job.
        })),
      );
    }
  };
}
