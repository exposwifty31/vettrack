/**
 * VetTrack 2.0, Task 1.1 §4 — `restock_po_on_burn` composer.
 *
 * Pure, no I/O: given a `RestockBurnReader`'s flagged items (already
 * confirmed `flagged === true` by the caller) plus an already-resolved
 * `locale`, composes a `NewActionProposalInput`. Mirrors
 * `coordinator-reassign-composer.ts`'s pattern — all user-facing copy goes
 * through the typed `translate()` / locale-dictionary pattern, no
 * hardcoded strings.
 *
 * Suggested quantity per item (`computeSuggestedQuantity`, the "top-up to
 * par" rule): `parLevel != null ? max(1, parLevel - onHand) : reorderPoint`.
 * Named/documented per CLAUDE.md's magic-number rule — not an inline
 * literal at each call site.
 *
 * `supplierName` wrinkle: `vt_purchase_orders.supplierName` is `NOT NULL`
 * and `vt_items` has no supplier column. `AUTOPILOT_PO_SUPPLIER_PLACEHOLDER`
 * is a documented, sanctioned placeholder — stored domain data an admin can
 * edit via the edit endpoint before approval, NOT an i18n string (it is not
 * user-facing copy, it is the literal value written into
 * `vt_purchase_orders.supplier_name`).
 *
 * Citations: only OBSERVED rows are ever cited — the flagged item's own
 * `vt_items` row plus every `vt_container_items` row that contributed to
 * its on-hand sum. The computed `onHand` total and the computed suggested
 * quantity are never cited (they are derived, not observed).
 */
import { getLocaleDictionaries } from "../../../lib/i18n/loader.js";
import { translate, type Locale, type TranslationParams } from "../../../lib/i18n/index.js";
import type { RestockItemReadResult } from "./restock-burn-reader.port.js";
import type { ActionProposalCitedFact, NewActionProposalInput } from "./action-proposal-types.js";

/**
 * Sanctioned placeholder for `vt_purchase_orders.supplier_name` (`NOT NULL`,
 * no supplier concept exists on `vt_items` yet). Admins can edit this via
 * the edit endpoint before approving. Not i18n copy — it is stored data.
 */
export const AUTOPILOT_PO_SUPPLIER_PLACEHOLDER = "Autopilot";

export interface RestockPoLineDraft {
  itemId: string;
  quantitySuggested: number;
}

export interface RestockPoDraftContent {
  supplierName: string;
  scanDate: string;
  lines: RestockPoLineDraft[];
  title: string;
  suggestedQuantityLabel: string;
}

export interface ComposeRestockPoProposalInput {
  clinicId: string;
  scanDate: string;
  flaggedItems: readonly RestockItemReadResult[];
  locale: Locale;
}

/** Top-up-to-par rule: propose enough to reach `parLevel`, floored at 1 unit; falls back to `reorderPoint` when `parLevel` is untracked (null). */
export function computeSuggestedQuantity(item: RestockItemReadResult): number {
  if (item.parLevel != null) return Math.max(1, item.parLevel - item.onHand);
  return item.reorderPoint;
}

export function composeRestockPoProposal(input: ComposeRestockPoProposalInput): NewActionProposalInput {
  const { clinicId, scanDate, flaggedItems, locale } = input;
  if (flaggedItems.length === 0) {
    throw new Error("composeRestockPoProposal: no flagged items to propose");
  }

  const { primary, fallback, locale: resolvedLocale } = getLocaleDictionaries(locale);
  const t = (key: string, params?: TranslationParams): string =>
    translate(primary, key, params, { fallbackDict: fallback, locale: resolvedLocale });

  const scanDateAt = `${scanDate}T00:00:00.000Z`;
  const citedFacts: ActionProposalCitedFact[] = [];
  for (const item of flaggedItems) {
    citedFacts.push({
      sourceId: item.inventoryItemRowId,
      sourceTable: "vt_inventory_items",
      kind: "reorder_point_threshold",
      at: scanDateAt,
    });
    for (const row of item.containerRows) {
      citedFacts.push({
        sourceId: row.id,
        sourceTable: "vt_container_items",
        kind: "on_hand_quantity",
        at: row.updatedAt.toISOString(),
      });
    }
  }

  const lines: RestockPoLineDraft[] = flaggedItems.map((item) => ({
    itemId: item.itemId,
    quantitySuggested: computeSuggestedQuantity(item),
  }));

  const draftContent: RestockPoDraftContent = {
    supplierName: AUTOPILOT_PO_SUPPLIER_PLACEHOLDER,
    scanDate,
    lines,
    title: t("autopilotQueue.kinds.restockPoOnBurn.title"),
    suggestedQuantityLabel: t("autopilotQueue.kinds.restockPoOnBurn.suggestedQuantityLabel"),
  };

  return {
    clinicId,
    kind: "restock_po_on_burn",
    sourceSessionId: scanDate,
    summary: t("autopilotQueue.kinds.restockPoOnBurn.summaryTemplate", {
      itemCount: flaggedItems.length,
      scanDate,
    }),
    citedFacts,
    draftContent,
    sourceRef: { clinicId, scanDate, itemIds: flaggedItems.map((item) => item.itemId) },
  };
}
