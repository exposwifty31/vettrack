/**
 * Responsibles v2 fill mapping (TV board phase 1, spec §4 — binding table).
 * Pure functions: doctorSlotFill / coordinatorSlotFill / countFilledSlots.
 */
import { describe, it, expect } from "vitest";
import {
  doctorSlotFill,
  coordinatorSlotFill,
  countFilledSlots,
} from "../src/features/command-board/responsibles-fill";
import type {
  BoardResponsibles,
  DoctorTeamBlock,
  BoardCoordinatorStatus,
} from "../src/types/safety-surfaces";

const ENTRY = { name: "Dr. A", since: "2026-08-13T06:00:00.000Z" };
const EMPTY_TEAM: DoctorTeamBlock = { senior: null, members: [] };

function responsibles(overrides: Partial<BoardResponsibles> = {}): BoardResponsibles {
  return {
    doctors: { icu: EMPTY_TEAM, admission: EMPTY_TEAM, internal_medicine: EMPTY_TEAM },
    seniorTechnician: null,
    equipmentCoordinator: { name: null, status: "unresolved" },
    ...overrides,
  };
}

describe("doctorSlotFill", () => {
  it("senior present → filled (with or without members)", () => {
    expect(doctorSlotFill({ senior: ENTRY, members: [] })).toBe("filled");
    expect(doctorSlotFill({ senior: ENTRY, members: [ENTRY] })).toBe("filled");
  });
  it("members without senior → filled_flagged", () => {
    expect(doctorSlotFill({ senior: null, members: [ENTRY] })).toBe("filled_flagged");
  });
  it("neither senior nor members → empty; undefined block → empty", () => {
    expect(doctorSlotFill(EMPTY_TEAM)).toBe("empty");
    expect(doctorSlotFill(undefined)).toBe("empty");
  });
});

describe("coordinatorSlotFill", () => {
  const cases: Array<[BoardCoordinatorStatus, string]> = [
    ["auto", "filled"],
    ["confirmed", "filled"],
    ["fallback_senior", "filled_flagged"],
    ["needs_confirmation", "filled_flagged"],
    ["unresolved", "empty"],
  ];
  for (const [status, expected] of cases) {
    it(`${status} → ${expected}`, () => {
      expect(coordinatorSlotFill(status)).toBe(expected);
    });
  }
});

describe("countFilledSlots", () => {
  it("all five empty → 0", () => {
    expect(countFilledSlots(responsibles())).toBe(0);
  });
  it("all five filled → 5", () => {
    expect(
      countFilledSlots(
        responsibles({
          doctors: {
            icu: { senior: ENTRY, members: [] },
            admission: { senior: ENTRY, members: [] },
            internal_medicine: { senior: ENTRY, members: [] },
          },
          seniorTechnician: { name: "Tami" },
          equipmentCoordinator: { name: "Coby", status: "confirmed" },
        }),
      ),
    ).toBe(5);
  });
  it("filled_flagged counts as filled (members-only doctor + needs_confirmation coordinator)", () => {
    expect(
      countFilledSlots(
        responsibles({
          doctors: {
            icu: { senior: null, members: [ENTRY] },
            admission: EMPTY_TEAM,
            internal_medicine: EMPTY_TEAM,
          },
          equipmentCoordinator: { name: "Coby", status: "needs_confirmation" },
        }),
      ),
    ).toBe(2);
  });
  it("mixed: two doctors + technician → 3", () => {
    expect(
      countFilledSlots(
        responsibles({
          doctors: {
            icu: { senior: ENTRY, members: [] },
            admission: { senior: null, members: [ENTRY] },
            internal_medicine: EMPTY_TEAM,
          },
          seniorTechnician: { name: "Tami" },
        }),
      ),
    ).toBe(3);
  });
});
