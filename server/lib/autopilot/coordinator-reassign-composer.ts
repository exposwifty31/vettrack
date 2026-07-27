/**
 * VetTrack 2.0, Task 1.1 §3 — `coordinator_reassign_off_roster` composer.
 *
 * Pure, no I/O: given a `CoordinatorRosterReader`'s output (already
 * confirmed off-roster by the caller) plus an already-resolved `locale`,
 * composes a `NewActionProposalInput`. All user-facing copy goes through
 * the typed `translate()` / locale-dictionary pattern (mirrors
 * `shift-handover-generator.ts`'s `defaultEnqueueHandoverPush`) — no
 * hardcoded strings. The caller (the worker) resolves `locale` via a DB
 * read (`resolveUserLocale`) BEFORE calling this function, keeping this
 * file itself synchronous and I/O-free.
 *
 * The proposed replacement candidate is drawn ONLY from the reader's fresh
 * `candidates` list, using `resolveShiftCoordinator`'s OWN tie-break rule
 * (single candidate -> that one; zero -> senior fallback or unresolved;
 * multiple -> needs_confirmation) — this file does not invent a new
 * tie-break, it re-expresses the resolver's existing branching.
 */
import { getLocaleDictionaries } from "../../../lib/i18n/loader.js";
import { translate, type Locale, type TranslationParams } from "../../../lib/i18n/index.js";
import type { CoordinatorCandidate } from "../../services/equipment-coordinator.service.js";
import type { CoordinatorRosterReadResult } from "./coordinator-roster-reader.port.js";
import type { ActionProposalCitedFact, NewActionProposalInput } from "./action-proposal-types.js";

export interface ComposeCoordinatorReassignProposalInput {
  clinicId: string;
  shiftDate: string;
  reader: CoordinatorRosterReadResult;
  locale: Locale;
}

export type CoordinatorReassignProposedReplacement =
  | { status: "auto"; coordinatorUserId: string; candidates: CoordinatorCandidate[]; suggestedFallbackUserId: string | null }
  | { status: "fallback_senior"; coordinatorUserId: string; candidates: CoordinatorCandidate[]; suggestedFallbackUserId: string }
  | {
      status: "needs_confirmation";
      coordinatorUserId: null;
      candidates: CoordinatorCandidate[];
      suggestedFallbackUserId: string | null;
    }
  | { status: "unresolved"; coordinatorUserId: null; candidates: CoordinatorCandidate[]; suggestedFallbackUserId: null };

export interface CoordinatorReassignDraftContent {
  shiftDate: string;
  staleCoordinatorUserId: string;
  escalationStage: number;
  proposedReplacement: CoordinatorReassignProposedReplacement;
  title: string;
  proposedCandidateLabel: string;
}

/** Re-expresses `resolveShiftCoordinator`'s own eligible-count branching — never a new tie-break. */
function deriveProposedReplacement(reader: CoordinatorRosterReadResult): CoordinatorReassignProposedReplacement {
  const { candidates, seniorTechUserId } = reader;

  if (candidates.length === 1) {
    return { status: "auto", coordinatorUserId: candidates[0]!.userId, candidates, suggestedFallbackUserId: seniorTechUserId };
  }
  if (candidates.length === 0) {
    return seniorTechUserId
      ? { status: "fallback_senior", coordinatorUserId: seniorTechUserId, candidates, suggestedFallbackUserId: seniorTechUserId }
      : { status: "unresolved", coordinatorUserId: null, candidates, suggestedFallbackUserId: null };
  }
  return { status: "needs_confirmation", coordinatorUserId: null, candidates, suggestedFallbackUserId: seniorTechUserId };
}

export function composeCoordinatorReassignProposal(input: ComposeCoordinatorReassignProposalInput): NewActionProposalInput {
  const { clinicId, shiftDate, reader, locale } = input;
  if (!reader.offRoster || !reader.persistedRow) {
    throw new Error("composeCoordinatorReassignProposal: reader did not detect an off-roster signal for this shift date");
  }
  const persistedRow = reader.persistedRow;

  const { primary, fallback, locale: resolvedLocale } = getLocaleDictionaries(locale);
  const t = (key: string, params?: TranslationParams): string =>
    translate(primary, key, params, { fallbackDict: fallback, locale: resolvedLocale });

  const citedFacts: ActionProposalCitedFact[] = [
    {
      sourceId: persistedRow.id,
      sourceTable: "vt_shift_equipment_coordinator",
      kind: "stale_coordinator_assignment",
      at: (persistedRow.escalatedAt ?? persistedRow.createdAt).toISOString(),
    },
    ...reader.rosterRows.map((row) => ({
      sourceId: row.id,
      sourceTable: "vt_shifts" as const,
      kind: "roster_shift",
      at: `${shiftDate}T00:00:00.000Z`,
    })),
  ];

  const draftContent: CoordinatorReassignDraftContent = {
    shiftDate,
    staleCoordinatorUserId: persistedRow.coordinatorUserId,
    escalationStage: persistedRow.escalationStage,
    proposedReplacement: deriveProposedReplacement(reader),
    title: t("autopilotQueue.kinds.coordinatorReassignOffRoster.title"),
    proposedCandidateLabel: t("autopilotQueue.kinds.coordinatorReassignOffRoster.proposedCandidateLabel"),
  };

  return {
    clinicId,
    kind: "coordinator_reassign_off_roster",
    sourceSessionId: shiftDate,
    summary: t("autopilotQueue.kinds.coordinatorReassignOffRoster.summaryTemplate", { shiftDate }),
    citedFacts,
    draftContent,
    sourceRef: { clinicId, shiftDate, persistedCoordinatorRowId: persistedRow.id },
  };
}
