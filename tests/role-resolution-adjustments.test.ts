/**
 * Phase 1 Increment 2 — shift-adjustment authority wiring (FROZEN SURFACE).
 *
 * `resolveCurrentRole` now layers approved `vt_shift_adjustments` onto the
 * roster result via `resolveEffectiveShift`. This suite is the byte-identical
 * gate promised for that change: when NO approved adjustment applies (or the
 * caller has no userId, or the adjustment query throws), the returned snapshot
 * must be exactly the pure roster result — the same `activeShift` object,
 * unchanged `source`/`effectiveRole`. Only an approved adjustment may move the
 * effective window.
 *
 * The db is mocked with a semantic query stub keyed by table (users / shifts /
 * shiftAdjustments, extend vs. leave_early distinguished by innerJoin), so the
 * real `resolveEffectiveShift` + `shiftWindowContains` logic runs against
 * controlled rows. `now` is passed explicitly and built with local-time
 * `new Date(y, mo, d, …)` so the window math is timezone-independent (it mirrors
 * `shiftWindowContains`, which also constructs local Dates).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveShiftSnapshot } from "../server/lib/role-resolution.js";

interface QueryResults {
  users: unknown[];
  shifts: unknown[];
  leaveEarly: unknown[];
  extend: unknown[];
  throwOn: "leaveEarly" | "extend" | null;
}

const { results, TABLE } = vi.hoisted(() => {
  const TABLE = {
    users: { __table: "users" },
    shifts: { __table: "shifts" },
    shiftAdjustments: { __table: "shiftAdjustments" },
  };
  const results: { current: QueryResults } = {
    current: { users: [], shifts: [], leaveEarly: [], extend: [], throwOn: null },
  };
  return { results, TABLE };
});

vi.mock("../server/db.js", () => {
  function resultFor(state: { table: { __table: string } | null; innerJoin: boolean }): unknown[] {
    const r = results.current;
    const t = state.table?.__table;
    if (t === "users") return r.users;
    if (t === "shifts") return r.shifts;
    if (t === "shiftAdjustments") {
      if (state.innerJoin) {
        if (r.throwOn === "extend") throw new Error("adjustments query boom");
        return r.extend;
      }
      if (r.throwOn === "leaveEarly") throw new Error("adjustments query boom");
      return r.leaveEarly;
    }
    return [];
  }

  function builder() {
    const state: { table: { __table: string } | null; innerJoin: boolean } = {
      table: null,
      innerJoin: false,
    };
    const b = {
      from(t: { __table: string }) {
        state.table = t;
        return b;
      },
      innerJoin() {
        state.innerJoin = true;
        return b;
      },
      where() {
        return b;
      },
      orderBy() {
        return b;
      },
      limit() {
        return b;
      },
      then(res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve()
          .then(() => resultFor(state))
          .then(res, rej);
      },
    };
    return b;
  }

  return {
    db: { select: () => builder() },
    users: TABLE.users,
    shifts: TABLE.shifts,
    shiftAdjustments: TABLE.shiftAdjustments,
  };
});

// Inert query-fragment builders so role-resolution's drizzle expressions
// construct cleanly against the sentinel tables (the mocked db ignores them).
vi.mock("drizzle-orm", () => {
  const frag = (op: string) => (...args: unknown[]) => ({ __op: op, args });
  return {
    and: frag("and"),
    or: frag("or"),
    eq: frag("eq"),
    desc: frag("desc"),
    inArray: frag("inArray"),
    sql: (..._args: unknown[]) => ({ __op: "sql" }),
  };
});

import { resolveCurrentRole } from "../server/lib/role-resolution.js";

const ROSTER: ActiveShiftSnapshot = {
  id: "shift-1",
  date: "2026-07-02",
  startTime: "07:30:00",
  endTime: "19:30:00",
  employeeName: "Test User",
  role: "senior_technician",
};

/** July 2 2026 at local h:m — mirrors shiftWindowContains' local-time frame. */
const at = (h: number, m: number) => new Date(2026, 6, 2, h, m, 0, 0);

function setResults(partial: Partial<QueryResults>): void {
  results.current = {
    users: [],
    shifts: [],
    leaveEarly: [],
    extend: [],
    throwOn: null,
    ...partial,
  };
}

const baseInput = {
  clinicId: "clinic-1",
  userId: "user-1",
  userName: "Test User",
  fallbackRole: "technician" as const,
};

beforeEach(() => {
  setResults({});
});

describe("resolveCurrentRole — byte-identical when no adjustment applies", () => {
  it("roster shift + zero approved adjustments → same activeShift object, unchanged", async () => {
    setResults({ users: [{ name: "Test User", displayName: null }], shifts: [ROSTER], leaveEarly: [] });

    const result = await resolveCurrentRole({ ...baseInput, now: at(12, 0) });

    expect(result.source).toBe("shift");
    // The adjustment layer must pass the roster snapshot through untouched.
    expect(result.activeShift).toBe(ROSTER);
    expect(result.effectiveRole).toBe("senior_technician");
    expect(result.permanentRole).toBe("technician");
  });

  it("no userId → adjustment layer is skipped entirely; roster snapshot passes through", async () => {
    setResults({ shifts: [ROSTER] });

    const result = await resolveCurrentRole({
      clinicId: "clinic-1",
      userName: "Test User",
      fallbackRole: "technician",
      now: at(12, 0),
    });

    expect(result.source).toBe("shift");
    expect(result.activeShift).toBe(ROSTER);
    expect(result.effectiveRole).toBe("senior_technician");
  });

  it("no roster shift + zero approved extensions → permanent branch, unchanged", async () => {
    setResults({
      users: [{ name: "Test User", displayName: null }],
      shifts: [],
      extend: [],
    });

    const result = await resolveCurrentRole({
      ...baseInput,
      fallbackRole: "vet",
      secondaryRole: "student",
      now: at(21, 0),
    });

    expect(result.source).toBe("permanent");
    expect(result.activeShift).toBeNull();
    // Permanent branch still picks the higher of primary/secondary.
    expect(result.effectiveRole).toBe("vet");
    expect(result.permanentRole).toBe("vet");
  });
});

describe("resolveCurrentRole — approved leave_early shortens the active window", () => {
  it("effective end already passed → off shift (null / permanent)", async () => {
    setResults({
      users: [{ name: "Test User", displayName: null }],
      shifts: [ROSTER],
      leaveEarly: [{ requestedEndTime: "11:00:00" }],
    });

    const result = await resolveCurrentRole({ ...baseInput, now: at(12, 0) });

    expect(result.source).toBe("permanent");
    expect(result.activeShift).toBeNull();
    expect(result.effectiveRole).toBe("technician");
  });

  it("effective end still in the future → on shift with the shortened end", async () => {
    setResults({
      users: [{ name: "Test User", displayName: null }],
      shifts: [ROSTER],
      leaveEarly: [{ requestedEndTime: "15:00:00" }],
    });

    const result = await resolveCurrentRole({ ...baseInput, now: at(12, 0) });

    expect(result.source).toBe("shift");
    expect(result.effectiveRole).toBe("senior_technician");
    expect(result.activeShift?.endTime).toBe("15:00:00");
    // Role never changes; only the window moves.
    expect(result.activeShift?.role).toBe("senior_technician");
  });
});

describe("resolveCurrentRole — approved extend keeps the person on past the rostered end", () => {
  const extRow = {
    requestedEndTime: "23:00:00",
    shiftId: "shift-1",
    shiftDate: "2026-07-02",
    startTime: "07:30:00",
    employeeName: "Test User",
    role: "senior_technician",
  };

  it("extended window still covers now → on shift (synthesized snapshot)", async () => {
    setResults({
      users: [{ name: "Test User", displayName: null }],
      shifts: [], // rostered shift already ended at 19:30
      extend: [extRow],
    });

    const result = await resolveCurrentRole({ ...baseInput, now: at(21, 0) });

    expect(result.source).toBe("shift");
    expect(result.effectiveRole).toBe("senior_technician");
    expect(result.activeShift?.endTime).toBe("23:00:00");
    expect(result.activeShift?.id).toBe("shift-1");
  });

  it("extended window has also elapsed → off shift", async () => {
    setResults({
      users: [{ name: "Test User", displayName: null }],
      shifts: [],
      extend: [{ ...extRow, requestedEndTime: "20:00:00" }],
    });

    const result = await resolveCurrentRole({ ...baseInput, now: at(21, 0) });

    expect(result.source).toBe("permanent");
    expect(result.activeShift).toBeNull();
  });
});

describe("resolveCurrentRole — fail-safe: adjustment query throw degrades to roster", () => {
  it("leave_early query throws with an active roster shift → roster snapshot preserved", async () => {
    setResults({
      users: [{ name: "Test User", displayName: null }],
      shifts: [ROSTER],
      throwOn: "leaveEarly",
    });

    const result = await resolveCurrentRole({ ...baseInput, now: at(12, 0) });

    expect(result.source).toBe("shift");
    expect(result.activeShift).toBe(ROSTER);
  });

  it("extend query throws with no roster shift → degrades to permanent (no crash)", async () => {
    setResults({
      users: [{ name: "Test User", displayName: null }],
      shifts: [],
      throwOn: "extend",
    });

    const result = await resolveCurrentRole({ ...baseInput, now: at(21, 0) });

    expect(result.source).toBe("permanent");
    expect(result.activeShift).toBeNull();
  });
});
