import { describe, it, expect } from "vitest";
import { composeCoordinatorReassignProposal } from "../../server/lib/autopilot/coordinator-reassign-composer.js";
import type { CoordinatorRosterReadResult } from "../../server/lib/autopilot/coordinator-roster-reader.port.js";
import type { ShiftEquipmentCoordinatorRow } from "../../server/schema/ops.js";

const CLINIC_A = "clinic-a";
const SHIFT_DATE = "2026-07-22";

function buildPersistedRow(overrides: Partial<ShiftEquipmentCoordinatorRow> = {}): ShiftEquipmentCoordinatorRow {
  return {
    id: "coord-row-1",
    clinicId: CLINIC_A,
    shiftDate: SHIFT_DATE,
    coordinatorUserId: "user-stale",
    source: "confirmed",
    assignedByUserId: "user-admin",
    createdAt: new Date("2026-07-22T06:00:00.000Z"),
    escalationStage: 0,
    currentResponsibleUserId: null,
    escalatedAt: null,
    ...overrides,
  } as ShiftEquipmentCoordinatorRow;
}

function buildReaderResult(overrides: Partial<CoordinatorRosterReadResult> = {}): CoordinatorRosterReadResult {
  return {
    offRoster: true,
    persistedRow: buildPersistedRow(),
    candidates: [{ userId: "user-fresh", name: "Dana Cohen" }],
    seniorTechUserId: "user-senior",
    rosterRows: [{ id: "shift-row-1", employeeName: "Dana Cohen" }],
    ...overrides,
  };
}

describe("coordinator-reassign-composer", () => {
  it("cites the stale assignment row and the roster rows consulted", () => {
    const input = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader: buildReaderResult(), locale: "en" });

    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({ sourceId: "coord-row-1", sourceTable: "vt_shift_equipment_coordinator" }),
    );
    expect(input.citedFacts).toContainEqual(
      expect.objectContaining({ sourceId: "shift-row-1", sourceTable: "vt_shifts" }),
    );
  });

  it("sets kind and sourceSessionId correctly", () => {
    const input = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader: buildReaderResult(), locale: "en" });
    expect(input.kind).toBe("coordinator_reassign_off_roster");
    expect(input.sourceSessionId).toBe(SHIFT_DATE);
    expect(input.clinicId).toBe(CLINIC_A);
  });

  it("proposes a replacement drawn only from the current candidates list — single candidate resolves to 'auto'", () => {
    const input = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader: buildReaderResult(), locale: "en" });
    const draft = input.draftContent as any;
    expect(draft.proposedReplacement.status).toBe("auto");
    expect(draft.proposedReplacement.coordinatorUserId).toBe("user-fresh");
  });

  it("multiple candidates -> needs_confirmation, listing only current candidates and the resolver's own senior fallback", () => {
    const reader = buildReaderResult({
      candidates: [
        { userId: "user-fresh-1", name: "Dana Cohen" },
        { userId: "user-fresh-2", name: "Noa Levi" },
      ],
    });
    const input = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader, locale: "en" });
    const draft = input.draftContent as any;
    expect(draft.proposedReplacement.status).toBe("needs_confirmation");
    expect(draft.proposedReplacement.coordinatorUserId).toBeNull();
    expect(draft.proposedReplacement.candidates).toEqual(reader.candidates);
    expect(draft.proposedReplacement.suggestedFallbackUserId).toBe("user-senior");
  });

  it("zero candidates, senior on shift -> fallback_senior", () => {
    const reader = buildReaderResult({ candidates: [] });
    const input = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader, locale: "en" });
    const draft = input.draftContent as any;
    expect(draft.proposedReplacement.status).toBe("fallback_senior");
    expect(draft.proposedReplacement.coordinatorUserId).toBe("user-senior");
  });

  it("zero candidates, no senior -> unresolved", () => {
    const reader = buildReaderResult({ candidates: [], seniorTechUserId: null });
    const input = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader, locale: "en" });
    const draft = input.draftContent as any;
    expect(draft.proposedReplacement.status).toBe("unresolved");
    expect(draft.proposedReplacement.coordinatorUserId).toBeNull();
  });

  it("summary is key-driven through the i18n translate pattern, not a hardcoded English literal — locale switch changes the rendered text", () => {
    const enInput = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader: buildReaderResult(), locale: "en" });
    const heInput = composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader: buildReaderResult(), locale: "he" });

    // Neither locale falls back to the raw key path (which would prove the
    // key doesn't resolve at all), and the two locales render DIFFERENT
    // text — impossible if the summary were a hardcoded English string.
    expect(enInput.summary).not.toContain("autopilotQueue.kinds.coordinatorReassignOffRoster");
    expect(heInput.summary).not.toContain("autopilotQueue.kinds.coordinatorReassignOffRoster");
    expect(enInput.summary).not.toBe(heInput.summary);
    expect(enInput.summary).toContain(SHIFT_DATE);
  });

  it("throws if the reader did not actually detect an off-roster signal (contract guard)", () => {
    const reader = buildReaderResult({ offRoster: false });
    expect(() =>
      composeCoordinatorReassignProposal({ clinicId: CLINIC_A, shiftDate: SHIFT_DATE, reader, locale: "en" }),
    ).toThrow();
  });
});
