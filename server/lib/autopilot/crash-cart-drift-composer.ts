/**
 * VetTrack 2.0, Task 1.1 §5 — `crash_cart_drift` composer.
 *
 * Pure, no I/O: given a `CrashCartDriftReader`'s output (already confirmed
 * `missingItemsFlagged` or `staleFlagged` by the caller) plus an
 * already-resolved `locale`, composes a `NewActionProposalInput`. Mirrors
 * `restock-po-composer.ts`'s pattern — all user-facing copy goes through the
 * typed `translate()` / locale-dictionary pattern, no hardcoded strings.
 *
 * Two draft shapes under the ONE kind `crash_cart_drift`, distinguished by
 * `draftContent.driftType`:
 *   - `"missing_items"` — the most recent check has `checked: false`
 *     entries. Cites the check row itself PLUS each failed item's active
 *     `vt_crash_cart_items` row.
 *   - `"stale_check"` — no check within the resolved threshold. Cites the
 *     last check row's `performedAt` when one exists, or — when
 *     `hasNeverBeenChecked` — the clinic's active `vt_crash_cart_items` rows
 *     (there is no check row to cite for an absence; see the reader's
 *     docstring for this citation choice).
 *
 * Priority when a reader result somehow flags both signals at once (e.g. a
 * very tight per-clinic staleness override combined with a just-submitted
 * failed check): `missing_items` wins — a check that JUST failed is more
 * actionable right now than "also overdue," and only one proposal is staged
 * per clinic per day (`sourceSessionId = scanDate`, per the worker).
 */
import { getLocaleDictionaries } from "../../../lib/i18n/loader.js";
import { translate, type Locale, type TranslationParams } from "../../../lib/i18n/index.js";
import type { CrashCartDriftReadResult, CrashCartFailedItem } from "./crash-cart-drift-reader.port.js";
import type { ActionProposalCitedFact, NewActionProposalInput } from "./action-proposal-types.js";

export interface CrashCartMissingItemsDraftContent {
  driftType: "missing_items";
  scanDate: string;
  lastCheckId: string;
  lastCheckPerformedAt: string;
  failedItems: CrashCartFailedItem[];
  title: string;
}

export interface CrashCartStaleCheckDraftContent {
  driftType: "stale_check";
  scanDate: string;
  hasNeverBeenChecked: boolean;
  lastCheckPerformedAt: string | null;
  hoursSinceLastCheck: number | null;
  thresholdHours: number;
  title: string;
}

export type CrashCartDriftDraftContent = CrashCartMissingItemsDraftContent | CrashCartStaleCheckDraftContent;

export interface ComposeCrashCartDriftProposalInput {
  clinicId: string;
  scanDate: string;
  reader: CrashCartDriftReadResult;
  locale: Locale;
}

type Translator = (key: string, params?: TranslationParams) => string;

function composeMissingItems(
  clinicId: string,
  scanDate: string,
  reader: CrashCartDriftReadResult,
  t: Translator,
): NewActionProposalInput {
  const lastCheck = reader.lastCheck;
  if (!lastCheck) {
    throw new Error("composeCrashCartDriftProposal: missingItemsFlagged is true but reader.lastCheck is null");
  }
  const performedAt = lastCheck.performedAt.toISOString();

  const citedFacts: ActionProposalCitedFact[] = [
    { sourceId: lastCheck.id, sourceTable: "vt_crash_cart_checks", kind: "check_missing_items", at: performedAt },
    ...reader.failedItems.map((item) => ({
      sourceId: item.itemRowId,
      sourceTable: "vt_crash_cart_items" as const,
      kind: "missing_item",
      at: performedAt,
    })),
  ];

  const draftContent: CrashCartMissingItemsDraftContent = {
    driftType: "missing_items",
    scanDate,
    lastCheckId: lastCheck.id,
    lastCheckPerformedAt: performedAt,
    failedItems: reader.failedItems,
    title: t("autopilotQueue.kinds.crashCartDrift.title"),
  };

  return {
    clinicId,
    kind: "crash_cart_drift",
    sourceSessionId: scanDate,
    summary: t("autopilotQueue.kinds.crashCartDrift.missingItemSummaryTemplate", {
      itemCount: reader.failedItems.length,
      scanDate,
    }),
    citedFacts,
    draftContent,
    sourceRef: { clinicId, scanDate, lastCheckId: lastCheck.id, failedItemKeys: reader.failedItems.map((i) => i.key) },
  };
}

function composeStaleCheck(
  clinicId: string,
  scanDate: string,
  reader: CrashCartDriftReadResult,
  t: Translator,
): NewActionProposalInput {
  const citedFacts: ActionProposalCitedFact[] = reader.lastCheck
    ? [
        {
          sourceId: reader.lastCheck.id,
          sourceTable: "vt_crash_cart_checks",
          kind: "stale_check_last_performed",
          at: reader.lastCheck.performedAt.toISOString(),
        },
      ]
    : reader.activeItems.map((item) => ({
        sourceId: item.id,
        sourceTable: "vt_crash_cart_items" as const,
        kind: "never_checked_item",
        at: `${scanDate}T00:00:00.000Z`,
      }));

  const roundedHours = reader.hoursSinceLastCheck != null ? Math.round(reader.hoursSinceLastCheck) : null;

  const draftContent: CrashCartStaleCheckDraftContent = {
    driftType: "stale_check",
    scanDate,
    hasNeverBeenChecked: reader.hasNeverBeenChecked,
    lastCheckPerformedAt: reader.lastCheck ? reader.lastCheck.performedAt.toISOString() : null,
    hoursSinceLastCheck: roundedHours,
    thresholdHours: reader.thresholdHours,
    title: t("autopilotQueue.kinds.crashCartDrift.title"),
  };

  return {
    clinicId,
    kind: "crash_cart_drift",
    sourceSessionId: scanDate,
    summary: t("autopilotQueue.kinds.crashCartDrift.staleSummaryTemplate", {
      neverChecked: reader.hasNeverBeenChecked ? "yes" : "no",
      hours: roundedHours ?? 0,
      thresholdHours: reader.thresholdHours,
    }),
    citedFacts,
    draftContent,
    sourceRef: { clinicId, scanDate, hasNeverBeenChecked: reader.hasNeverBeenChecked },
  };
}

export function composeCrashCartDriftProposal(input: ComposeCrashCartDriftProposalInput): NewActionProposalInput {
  const { clinicId, scanDate, reader, locale } = input;
  if (!reader.missingItemsFlagged && !reader.staleFlagged) {
    throw new Error("composeCrashCartDriftProposal: reader detected no drift signal for this clinic");
  }

  const { primary, fallback, locale: resolvedLocale } = getLocaleDictionaries(locale);
  const t: Translator = (key, params) => translate(primary, key, params, { fallbackDict: fallback, locale: resolvedLocale });

  if (reader.missingItemsFlagged) return composeMissingItems(clinicId, scanDate, reader, t);
  return composeStaleCheck(clinicId, scanDate, reader, t);
}
