import { describe, it, expect, vi } from "vitest";
import { runCoordinatorReassignScan } from "../../server/workers/autopilotCoordinatorReassignWorker.js";
import { InMemoryCoordinatorRosterReader } from "../../server/lib/autopilot/coordinator-roster-reader.port.js";
import { InMemoryActionProposalWriter } from "../../server/lib/autopilot/action-proposal-writer.port.js";
import type { ShiftEquipmentCoordinatorRow } from "../../server/schema/ops.js";

vi.mock("../../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../../server/lib/metrics.js", () => ({ incrementMetric: vi.fn() }));

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

describe("autopilotCoordinatorReassignWorker.runCoordinatorReassignScan", () => {
  it("stages exactly one proposal when there is an off-roster signal", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [buildPersistedRow()],
      rosterRows: { [`${CLINIC_A}::${SHIFT_DATE}`]: [{ id: "shift-row-1", employeeName: "Dana Cohen" }] },
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: { candidates: [{ userId: "user-fresh", name: "Dana Cohen" }], seniorTechUserId: "user-senior" },
      },
    });
    const writer = new InMemoryActionProposalWriter();

    const result = await runCoordinatorReassignScan({
      reader,
      writer,
      findCandidateShiftDates: async () => [{ clinicId: CLINIC_A, shiftDate: SHIFT_DATE }],
      resolveLocale: async () => "en",
    });

    expect(result).toEqual({ scanned: 1, staged: 1 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "coordinator_reassign_off_roster" });
    expect(staged).toHaveLength(1);
    expect(staged[0]?.sourceSessionId).toBe(SHIFT_DATE);
  });

  it("does not double-stage on a second scan of the same shift date (idempotent per clinic/kind/shiftDate)", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [buildPersistedRow()],
      rosterRows: { [`${CLINIC_A}::${SHIFT_DATE}`]: [{ id: "shift-row-1", employeeName: "Dana Cohen" }] },
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: { candidates: [{ userId: "user-fresh", name: "Dana Cohen" }], seniorTechUserId: "user-senior" },
      },
    });
    const writer = new InMemoryActionProposalWriter();
    const deps = {
      reader,
      writer,
      findCandidateShiftDates: async () => [{ clinicId: CLINIC_A, shiftDate: SHIFT_DATE }],
      resolveLocale: async () => "en" as const,
    };

    await runCoordinatorReassignScan(deps);
    const second = await runCoordinatorReassignScan(deps);

    expect(second.staged).toBe(0); // stage() is idempotent — the second attempt finds the existing row and doesn't add a new one
    const staged = await writer.findStaged(CLINIC_A, { kind: "coordinator_reassign_off_roster" });
    expect(staged).toHaveLength(1);
  });

  it("stages nothing when there is no off-roster signal", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [buildPersistedRow({ coordinatorUserId: "user-fresh" })],
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: { candidates: [{ userId: "user-fresh", name: "Dana Cohen" }], seniorTechUserId: null },
      },
    });
    const writer = new InMemoryActionProposalWriter();

    const result = await runCoordinatorReassignScan({
      reader,
      writer,
      findCandidateShiftDates: async () => [{ clinicId: CLINIC_A, shiftDate: SHIFT_DATE }],
      resolveLocale: async () => "en",
    });

    expect(result).toEqual({ scanned: 1, staged: 0 });
    const staged = await writer.findStaged(CLINIC_A, { kind: "coordinator_reassign_off_roster" });
    expect(staged).toHaveLength(0);
  });
});
