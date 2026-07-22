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
import { purchaseOrders, poLines } from "../../db.js";
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

export function buildRestockPoApproveSideEffect(
  staged: ActionProposalRow,
  approvingUserId: string,
): ((tx: ActionProposalTransactionExecutor) => Promise<void>) | undefined {
  if (staged.kind !== "restock_po_on_burn") return undefined;

  const draft = staged.draftContent;
  if (!isRestockPoDraftContent(draft)) {
    throw new Error(
      `restock_po_on_burn approve side effect: proposal ${staged.id}'s draftContent does not match the expected RestockPoDraftContent shape`,
    );
  }

  return async (tx: ActionProposalTransactionExecutor) => {
    const orderId = randomUUID();
    await tx.insert(purchaseOrders).values({
      id: orderId,
      clinicId: staged.clinicId,
      supplierName: draft.supplierName,
      status: "draft",
      createdBy: approvingUserId,
    });

    for (const line of draft.lines) {
      await tx.insert(poLines).values({
        id: randomUUID(),
        clinicId: staged.clinicId,
        purchaseOrderId: orderId,
        itemId: line.itemId,
        quantityOrdered: line.quantitySuggested,
        // unitPriceCents stays at its schema default (0) — Task 1.4's job.
      });
    }
  };
}
