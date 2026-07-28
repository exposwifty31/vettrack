/**
 * VetTrack 2.0, Task 1.1 §2 — `shift_handover_draft` composer.
 *
 * Pure, no I/O: given the SAME content source R-SH-F1 uses
 * (`resolveShiftWindow` + the now-exported `aggregateDeltas`, both in
 * `server/lib/shift-handover-generator.ts`) plus an already-resolved
 * `locale`, composes a `NewActionProposalInput`. Mirrors
 * `crash-cart-drift-composer.ts`'s pattern — all user-facing copy goes
 * through the typed `translate()` / locale-dictionary pattern, no
 * hardcoded strings.
 *
 * PARALLEL-RUN SCOPE BOUNDARY (binding for this slice): R-SH-F1's
 * auto-publish path (`server/lib/shift-handover-scheduler.ts`,
 * `generateShiftHandover`) is completely untouched. This composer/worker
 * pair stages a SHADOW `action_proposal` for the SAME ended session — it
 * never reads, writes, or races with the `vt_shift_handover` artifact table.
 * Both artifacts are produced independently from the same underlying
 * `vt_audit_logs`/`vt_event_outbox` window.
 *
 * citedFacts per-origin sourceTable: `aggregateDeltas` builds each
 * `ShiftHandoverDeltaEntry.sourceId` from ONE of two id spaces, and the
 * merged `ShiftHandoverDeltas` shape does not itself retain which table an
 * entry came from — so this composer re-derives it from the id's shape:
 *   - audit-sourced entries: `sourceId = auditLogs.id`, a `randomUUID()`
 *     TEXT primary key — always hyphenated (`8-4-4-4-12`), never pure digits.
 *   - outbox-sourced entries: `sourceId = String(eventOutbox.id)`, a
 *     `bigserial` primary key stringified — always pure digits.
 * A UUID can never collide with the pure-digit pattern (the hyphens are
 * fixed-position in the UUID string form), so `isOutboxSourcedId` is a
 * deterministic, honest discriminator — not a heuristic guess.
 *
 * `draftContent` carries the `ShiftHandoverDeltas` artifact shape (the SAME
 * shape R-SH-F1 persists to `vt_shift_handover.deltas`) plus `openItems`,
 * derived by a LOCAL pure re-implementation of
 * `shift-handover-generator.ts`'s private `deriveOpenItems` — that function
 * stays private (only `aggregateDeltas`'s `export` keyword was the sanctioned
 * diff to that file for this slice), so this is a disclosed, deliberate
 * duplication of a small (~15-line) pure derivation, not a design fork. If
 * `deriveOpenItems` is ever exported in a later slice, this local copy
 * should be replaced with the import.
 *
 * `observedSignals` and `patientWorklist` (the other two `vt_shift_handover`
 * artifact fields) are DELIBERATELY NOT included in `draftContent` — both
 * require DB I/O (`collectObservedSignals`, `resolvePatientWorklist`) that
 * stays private/out of scope for this composer's "pure, no I/O" contract and
 * this slice's one-line-diff constraint on `shift-handover-generator.ts`.
 * This is a disclosed gap, not a silent omission — tracked as a follow-up
 * for whoever extends this composer's content source.
 *
 * R-SH-F1 PARITY on empty deltas: `generateShiftHandover` has no
 * "skip if nothing happened" branch — it always inserts a handover artifact,
 * even an empty one, so a quiet shift is still documented for the next
 * shift rather than silently absent. This composer mirrors that choice
 * exactly: it NEVER throws for an empty `ShiftHandoverDeltas` (unlike the
 * signal-detection kinds §3–§5, which only propose when a drift/off-roster
 * signal is present) — every ended shift session gets a proposal.
 */
import { getLocaleDictionaries } from "../../../lib/i18n/loader.js";
import { translate, type Locale, type TranslationParams } from "../../../lib/i18n/index.js";
import type { ShiftHandoverDeltas, ShiftHandoverDeltaEntry, ShiftHandoverOpenItem } from "../shift-handover.js";
import type { ShiftWindow } from "../shift-handover-generator.js";
import type { ActionProposalCitedFact, NewActionProposalInput } from "./action-proposal-types.js";

/** Task/alert kinds that CLOSE an open item — mirrors `shift-handover-generator.ts`'s own sets exactly. */
const TASK_TERMINAL = new Set<string>(["task_completed", "task_cancelled"]);
const ALERT_TERMINAL = new Set<string>(["alert_resolved"]);

/**
 * Local re-implementation of `shift-handover-generator.ts`'s private
 * `deriveOpenItems` — see this file's header doc for why it is duplicated
 * rather than imported. Kept behaviorally IDENTICAL: same terminal sets,
 * same "latest delta per targetId wins" rule (entries arrive oldest→newest,
 * already sorted by `aggregateDeltas`), same sort order.
 */
function deriveOpenItems(deltas: ShiftHandoverDeltas): ShiftHandoverOpenItem[] {
  const items: ShiftHandoverOpenItem[] = [];

  const latestByTarget = (entries: ShiftHandoverDeltaEntry[]): Map<string, ShiftHandoverDeltaEntry> => {
    const map = new Map<string, ShiftHandoverDeltaEntry>();
    for (const e of entries) {
      if (!e.targetId) continue;
      map.set(e.targetId, e);
    }
    return map;
  };

  for (const [targetId, entry] of latestByTarget(deltas.taskState)) {
    if (TASK_TERMINAL.has(entry.kind)) continue;
    items.push({ id: targetId, kind: "task", summary: `${entry.kind}:${targetId}` });
  }
  for (const [targetId, entry] of latestByTarget(deltas.alerts)) {
    if (ALERT_TERMINAL.has(entry.kind)) continue;
    items.push({ id: targetId, kind: "alert", summary: `${entry.kind}:${targetId}` });
  }

  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return items;
}

/** Pure-digit sourceId = a stringified `eventOutbox.id` bigserial; anything else = an `auditLogs.id` UUID. */
function isOutboxSourcedId(sourceId: string): boolean {
  return /^\d+$/.test(sourceId);
}

function citeDeltaEntries(entries: ShiftHandoverDeltaEntry[]): ActionProposalCitedFact[] {
  return entries.map((entry) => ({
    sourceId: entry.sourceId,
    sourceTable: isOutboxSourcedId(entry.sourceId) ? "vt_event_outbox" : "vt_audit_logs",
    kind: entry.kind,
    at: entry.at,
  }));
}

export interface HandoverDraftContent {
  shiftSessionId: string;
  windowStart: string;
  windowEnd: string;
  deltas: ShiftHandoverDeltas;
  openItems: ShiftHandoverOpenItem[];
  title: string;
}

export interface ComposeHandoverDraftProposalInput {
  clinicId: string;
  shiftSessionId: string;
  window: ShiftWindow;
  deltas: ShiftHandoverDeltas;
  locale: Locale;
}

type Translator = (key: string, params?: TranslationParams) => string;

function deltaCount(deltas: ShiftHandoverDeltas): number {
  return deltas.custody.length + deltas.taskState.length + deltas.alerts.length + deltas.dispenses.length;
}

export function composeHandoverDraftProposal(input: ComposeHandoverDraftProposalInput): NewActionProposalInput {
  const { clinicId, shiftSessionId, window, deltas, locale } = input;

  const { primary, fallback, locale: resolvedLocale } = getLocaleDictionaries(locale);
  const t: Translator = (key, params) => translate(primary, key, params, { fallbackDict: fallback, locale: resolvedLocale });

  const citedFacts: ActionProposalCitedFact[] = [
    ...citeDeltaEntries(deltas.custody),
    ...citeDeltaEntries(deltas.taskState),
    ...citeDeltaEntries(deltas.alerts),
    ...citeDeltaEntries(deltas.dispenses),
  ];

  const openItems = deriveOpenItems(deltas);
  const title = t("autopilotQueue.kinds.shiftHandoverDraft.title");

  const draftContent: HandoverDraftContent = {
    shiftSessionId,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    deltas,
    openItems,
    title,
  };

  return {
    clinicId,
    kind: "shift_handover_draft",
    sourceSessionId: shiftSessionId,
    summary: t("autopilotQueue.kinds.shiftHandoverDraft.summaryTemplate", {
      deltaCount: deltaCount(deltas),
    }),
    citedFacts,
    draftContent,
    sourceRef: { clinicId, shiftSessionId, windowStart: draftContent.windowStart, windowEnd: draftContent.windowEnd },
  };
}
