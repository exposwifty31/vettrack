import { describe, it, expect } from "vitest";
import { InMemoryCoordinatorRosterReader } from "../../server/lib/autopilot/coordinator-roster-reader.port.js";
import type { ShiftEquipmentCoordinatorRow } from "../../server/schema/ops.js";

const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
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

describe("CoordinatorRosterReader (off-roster drift detection)", () => {
  it("flags off-roster when the persisted coordinator is absent from the fresh candidate set", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [buildPersistedRow()],
      rosterRows: { [`${CLINIC_A}::${SHIFT_DATE}`]: [{ id: "shift-row-1", employeeName: "Dana Cohen" }] },
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: {
          candidates: [{ userId: "user-fresh", name: "Dana Cohen" }],
          seniorTechUserId: "user-senior",
        },
      },
    });

    const result = await reader.read(CLINIC_A, SHIFT_DATE);
    expect(result.offRoster).toBe(true);
    expect(result.persistedRow?.coordinatorUserId).toBe("user-stale");
    expect(result.candidates).toEqual([{ userId: "user-fresh", name: "Dana Cohen" }]);
    expect(result.rosterRows).toEqual([{ id: "shift-row-1", employeeName: "Dana Cohen" }]);
  });

  it("does not flag when the persisted coordinator is still present in the fresh candidate set", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [buildPersistedRow({ coordinatorUserId: "user-fresh" })],
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: {
          candidates: [{ userId: "user-fresh", name: "Dana Cohen" }],
          seniorTechUserId: null,
        },
      },
    });

    const result = await reader.read(CLINIC_A, SHIFT_DATE);
    expect(result.offRoster).toBe(false);
  });

  it("does not flag when there is no persisted row at all", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: { candidates: [{ userId: "user-fresh", name: "Dana Cohen" }], seniorTechUserId: null },
      },
    });

    const result = await reader.read(CLINIC_A, SHIFT_DATE);
    expect(result.offRoster).toBe(false);
    expect(result.persistedRow).toBeNull();
  });

  it("stage-3 transfer case: does not re-flag once escalation has already transferred responsibility to the same person the row records", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [
        buildPersistedRow({
          coordinatorUserId: "user-senior",
          escalationStage: 3,
          currentResponsibleUserId: "user-senior",
        }),
      ],
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: { candidates: [{ userId: "user-fresh", name: "Dana Cohen" }], seniorTechUserId: "user-senior" },
      },
    });

    const result = await reader.read(CLINIC_A, SHIFT_DATE);
    expect(result.offRoster).toBe(false);
  });

  it("stage-3 transfer case: still flags when escalation reached stage 3 but the stored coordinator differs from the current responsible user", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [
        buildPersistedRow({
          coordinatorUserId: "user-stale",
          escalationStage: 3,
          currentResponsibleUserId: "user-senior",
        }),
      ],
      resolutions: {
        [`${CLINIC_A}::${SHIFT_DATE}`]: { candidates: [{ userId: "user-fresh", name: "Dana Cohen" }], seniorTechUserId: "user-senior" },
      },
    });

    const result = await reader.read(CLINIC_A, SHIFT_DATE);
    expect(result.offRoster).toBe(true);
  });

  it("cross-tenant negative: clinic A's persisted row is invisible to a clinic B query for the same shift date", async () => {
    const reader = new InMemoryCoordinatorRosterReader({
      persistedRows: [buildPersistedRow()],
      resolutions: {
        [`${CLINIC_B}::${SHIFT_DATE}`]: { candidates: [], seniorTechUserId: null },
      },
    });

    const result = await reader.read(CLINIC_B, SHIFT_DATE);
    expect(result.persistedRow).toBeNull();
    expect(result.offRoster).toBe(false);
  });
});
