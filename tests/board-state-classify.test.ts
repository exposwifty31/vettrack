import { describe, it, expect } from "vitest";
import { classifyBoardState, hasActiveAlert } from "../src/features/command-board/board-state";
import type { BoardResponsibles, DisplaySnapshot } from "../src/types/safety-surfaces";
import type {
  EquipmentBoardUnitRow,
  EquipmentCommandBoardSnapshot,
  EquipmentReadinessStatus,
} from "../shared/equipment-board";

function makeBoard(over: Partial<EquipmentCommandBoardSnapshot> = {}): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-08-13T08:00:00Z",
    clinicId: "c1",
    overview: {
      totalCritical: 12,
      ready: 12,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    },
    byType: [],
    byLocation: [],
    criticalUnits: [],
    alerts: [],
    roiSignals: {
      overusedUnits: [],
      underusedUnits: [],
      repairReplaceCandidates: [],
      typeShortages: [],
      duplicatePurchaseRisks: [],
    },
    ...over,
  };
}

function unit(status: EquipmentReadinessStatus): EquipmentBoardUnitRow {
  return {
    equipmentId: "u1",
    displayName: "Vent 1",
    status,
    blockingReasons: [],
    citationsCount: 0,
    truthHref: "/equipment/u1",
  };
}

function makeSnapshot(over: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    currentTime: "10:18",
    currentShift: [],
    hospitalizations: [],
    equipment: [],
    upcomingTasks: [],
    overdueTasks: [],
    activeAlertCount: 0,
    totalOverdueCount: 0,
    crashCartStatus: null,
    codeBlueSession: null,
    commandBoard: makeBoard(),
    responsibles: null,
    ...over,
  };
}

const gapResponsibles: BoardResponsibles = {
  doctors: {
    icu: { senior: null, members: [] },
    admission: { senior: null, members: [] },
    internal_medicine: { senior: null, members: [] },
  },
  seniorTechnician: null,
  equipmentCoordinator: { name: null, status: "unresolved" },
};

describe("classifyBoardState priority order", () => {
  it("stale connection outranks everything (incl. unconfigured)", () => {
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: null }), connection: "stale" }),
    ).toBe("stale");
    expect(classifyBoardState({ snapshot: makeSnapshot(), connection: "offline" })).toBe("stale");
  });

  it("unconfigured when commandBoard absent or zero critical units configured", () => {
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: null }), connection: "live" }),
    ).toBe("unconfigured");
    const empty = makeBoard({
      overview: {
        totalCritical: 0,
        ready: 0,
        inUse: 0,
        blocked: 0,
        stale: 0,
        overdue: 0,
        unknown: 0,
        belowThresholdTypes: 0,
        activeEmergencyUnits: 0,
      },
    });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: empty }), connection: "live" }),
    ).toBe("unconfigured");
  });

  it("unconfigured outranks alert: a zero-config board with active-alert inputs is still unconfigured", () => {
    // totalCritical 0 ⇒ no equipment configured, so any 'alert' input is a config
    // artifact, not a real exception — the config hole wins (spec §1 priority order,
    // classifier line 41 before line 42).
    const zero = {
      totalCritical: 0,
      ready: 0,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    };
    const withPowerAlert = makeBoard({ overview: zero, power: { plugged: 0, unplugged: 0, alert: 3 } });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: withPowerAlert }), connection: "live" }),
    ).toBe("unconfigured");
    const withBlockedUnit = makeBoard({ overview: zero, criticalUnits: [unit("blocked")] });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: withBlockedUnit }), connection: "live" }),
    ).toBe("unconfigured");
  });

  it("alert on any not-ready-not-in-use critical unit", () => {
    const b = makeBoard({ criticalUnits: [unit("blocked")] });
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: b }), connection: "live" })).toBe(
      "alert",
    );
  });

  it("ready and in_use critical units do not alert", () => {
    const b = makeBoard({ criticalUnits: [unit("ready"), unit("in_use")] });
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: b }), connection: "live" })).toBe(
      "all_clear",
    );
  });

  it("alert on active power alerts, but NOT on power undefined", () => {
    const withAlerts = makeBoard({ power: { plugged: 2, unplugged: 0, alert: 1 } });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: withAlerts }), connection: "live" }),
    ).toBe("alert");
    const noPower = makeBoard({ power: undefined });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: noPower }), connection: "live" }),
    ).toBe("all_clear");
  });

  it("zero power alerts is not an alert (absent vs zero both quiet)", () => {
    const zeroAlerts = makeBoard({ power: { plugged: 3, unplugged: 1, alert: 0 } });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: zeroAlerts }), connection: "live" }),
    ).toBe("all_clear");
  });

  it("attention on non-zero waitlist/staging depth", () => {
    const withWaitlist = makeBoard({ waitlist: { depth: 2 } });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: withWaitlist }), connection: "live" }),
    ).toBe("attention");
    const withStaging = makeBoard({ staging: { depth: 1 } });
    expect(
      classifyBoardState({ snapshot: makeSnapshot({ commandBoard: withStaging }), connection: "live" }),
    ).toBe("attention");
  });

  it("attention on responsibles gaps only while currentShift is non-empty", () => {
    const onShift = makeSnapshot({
      responsibles: gapResponsibles,
      currentShift: [{ employeeName: "Dana", role: "vet_tech" }],
    });
    expect(classifyBoardState({ snapshot: onShift, connection: "live" })).toBe("attention");
    const offShift = makeSnapshot({ responsibles: gapResponsibles, currentShift: [] });
    expect(classifyBoardState({ snapshot: offShift, connection: "live" })).toBe("all_clear");
  });

  it("fully-filled responsibles on shift is all_clear", () => {
    const filled: BoardResponsibles = {
      doctors: {
        icu: { senior: { name: "Dr. A", since: "2026-08-13T06:00:00Z" }, members: [] },
        admission: { senior: null, members: [{ name: "Dr. B", since: "2026-08-13T06:00:00Z" }] },
        internal_medicine: { senior: { name: "Dr. C", since: "2026-08-13T06:00:00Z" }, members: [] },
      },
      seniorTechnician: { name: "Tami" },
      equipmentCoordinator: { name: "Noa", status: "confirmed" },
    };
    const s = makeSnapshot({
      responsibles: filled,
      currentShift: [{ employeeName: "Dana", role: "vet_tech" }],
    });
    expect(classifyBoardState({ snapshot: s, connection: "live" })).toBe("all_clear");
  });

  it("responsibles null (build failure) is NOT a gap signal", () => {
    const s = makeSnapshot({
      responsibles: null,
      currentShift: [{ employeeName: "Dana", role: "vet_tech" }],
    });
    expect(classifyBoardState({ snapshot: s, connection: "live" })).toBe("all_clear");
  });

  it("an all-ready board on a live connection is all_clear", () => {
    expect(classifyBoardState({ snapshot: makeSnapshot(), connection: "live" })).toBe("all_clear");
  });

  it("an undefined snapshot (no board at all) is unconfigured, never a false all_clear", () => {
    expect(classifyBoardState({ snapshot: undefined, connection: "live" })).toBe("unconfigured");
  });
});

describe("classifyBoardState responsibles fill mapping (spec §4)", () => {
  const D = (name: string): { senior: { name: string; since: string }; members: [] } => ({
    senior: { name, since: "2026-08-13T06:00:00Z" },
    members: [],
  });
  const onShift = (r: BoardResponsibles): DisplaySnapshot =>
    makeSnapshot({ responsibles: r, currentShift: [{ employeeName: "Dana", role: "vet_tech" }] });
  const threeDoctorsAndTech = {
    doctors: { icu: D("Dr A"), admission: D("Dr B"), internal_medicine: D("Dr C") },
    seniorTechnician: { name: "Tami" },
  };

  it("provisional coordinator statuses count as filled → 5/5, no gap (all_clear)", () => {
    for (const status of ["fallback_senior", "needs_confirmation"] as const) {
      const r: BoardResponsibles = {
        ...threeDoctorsAndTech,
        equipmentCoordinator: { name: "Noa", status },
      };
      expect(classifyBoardState({ snapshot: onShift(r), connection: "live" })).toBe("all_clear");
    }
  });

  it("a single empty slot at the 4/5 boundary is a gap (attention)", () => {
    const r: BoardResponsibles = {
      ...threeDoctorsAndTech,
      equipmentCoordinator: { name: null, status: "unresolved" },
    };
    expect(classifyBoardState({ snapshot: onShift(r), connection: "live" })).toBe("attention");
  });

  it("a doctor block with members but no senior counts as filled (filled_flagged)", () => {
    const r: BoardResponsibles = {
      doctors: {
        icu: { senior: null, members: [{ name: "Dr X", since: "2026-08-13T06:00:00Z" }] },
        admission: D("Dr B"),
        internal_medicine: D("Dr C"),
      },
      seniorTechnician: { name: "Tami" },
      equipmentCoordinator: { name: "Noa", status: "confirmed" },
    };
    expect(classifyBoardState({ snapshot: onShift(r), connection: "live" })).toBe("all_clear");
  });
});

describe("hasActiveAlert", () => {
  it("true when any critical unit is neither ready nor in_use", () => {
    expect(hasActiveAlert(makeBoard({ criticalUnits: [unit("ready")] }))).toBe(false);
    expect(hasActiveAlert(makeBoard({ criticalUnits: [unit("in_use")] }))).toBe(false);
    expect(hasActiveAlert(makeBoard({ criticalUnits: [unit("unknown")] }))).toBe(true);
    expect(hasActiveAlert(makeBoard({ criticalUnits: [unit("stale")] }))).toBe(true);
  });

  it("true on active power alerts", () => {
    expect(hasActiveAlert(makeBoard({ power: { plugged: 2, unplugged: 0, alert: 2 } }))).toBe(true);
    expect(hasActiveAlert(makeBoard({ power: { plugged: 2, unplugged: 0, alert: 0 } }))).toBe(false);
  });

  it("false (not zero-alert) when board absent", () => {
    expect(hasActiveAlert(undefined)).toBe(false);
    expect(hasActiveAlert(null)).toBe(false);
  });
});
