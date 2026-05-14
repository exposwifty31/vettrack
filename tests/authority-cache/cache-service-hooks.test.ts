/**
 * Phase 2.5 PR 6 — Service-layer invalidation hook wiring tests.
 *
 * Covers:
 *  - test #5 openCheckIn invalidation
 *  - test #6 closeCheckIn invalidation, including lost-race close branch
 *  - test #7 autoCheckOutForSessionEnd invalidation (per-row)
 *
 * Mocks db, audit, and the authority-cache module to spy on
 * invalidateForUser. No DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const invalidateForUserSpy = vi.fn();
const invalidateClinicShiftSpy = vi.fn();

vi.mock("../../server/lib/authority-cache.js", () => ({
  invalidateForUser: (clinicId: string, userId: string) =>
    invalidateForUserSpy(clinicId, userId),
  invalidateClinicShift: (clinicId: string) =>
    invalidateClinicShiftSpy(clinicId),
  // The service does not import the wrappers, but provide stubs to avoid
  // breaking unrelated transitive imports.
  getOpenClinicalCheckInCached: vi.fn(),
  resolveCurrentRoleCached: vi.fn(),
  __resetAuthorityCacheForTests: vi.fn(),
}));

vi.mock("../../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

const dbState = {
  insertReturning: undefined as unknown,
  updateReturning: undefined as unknown,
  selectReturning: undefined as unknown,
  insertThrows: undefined as unknown,
};

function chainable(getValue: () => unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "where",
    "limit",
    "leftJoin",
    "innerJoin",
    "orderBy",
    "returning",
    "values",
    "set",
    "as",
    "onConflictDoNothing",
    "onConflictDoUpdate",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void,
  ) => {
    Promise.resolve(getValue()).then(resolve, reject);
  };
  return chain;
}

vi.mock("../../server/db.js", () => ({
  db: {
    insert: vi.fn(() => {
      if (dbState.insertThrows) {
        // First call to .returning() should throw.
        const chain: Record<string, unknown> = {};
        const methods = ["values"];
        for (const m of methods) {
          chain[m] = vi.fn().mockReturnValue(chain);
        }
        chain["returning"] = () => Promise.reject(dbState.insertThrows);
        return chain;
      }
      return chainable(() => dbState.insertReturning);
    }),
    update: vi.fn(() => chainable(() => dbState.updateReturning)),
    select: vi.fn(() => chainable(() => dbState.selectReturning)),
  },
  clinicalCheckIns: {
    id: "id",
    clinicId: "clinicId",
    userId: "userId",
    checkedInAt: "checkedInAt",
    checkedOutAt: "checkedOutAt",
    operationalRole: "operationalRole",
    clinicalRoleAtCheckIn: "clinicalRoleAtCheckIn",
    checkOutReason: "checkOutReason",
    clientId: "clientId",
  },
  users: {
    id: "id",
    clinicId: "clinicId",
    allowedOperationalRoles: "allowedOperationalRoles",
  },
}));

const {
  openCheckIn,
  closeCheckIn,
  autoCheckOutForSessionEnd,
} = await import("../../server/services/clinical-check-in.js");

const ACTOR = {
  clinicId: "clinic-a",
  userId: "user-1",
  email: "u@example.com",
  role: "technician" as const,
};

beforeEach(() => {
  invalidateForUserSpy.mockReset();
  invalidateClinicShiftSpy.mockReset();
  dbState.insertReturning = undefined;
  dbState.updateReturning = undefined;
  dbState.selectReturning = undefined;
  dbState.insertThrows = undefined;
});

describe("openCheckIn invalidation (test #5)", () => {
  it("calls invalidateForUser after successful insert (technician)", async () => {
    dbState.insertReturning = [
      {
        id: "ck-1",
        clinicId: "clinic-a",
        userId: "user-1",
        operationalRole: null,
        clinicalRoleAtCheckIn: "technician",
        clientId: null,
        checkedInAt: new Date(),
        checkedOutAt: null,
      },
    ];

    // Technician without operationalRole — does not require users lookup.
    await openCheckIn({ actor: ACTOR });
    expect(invalidateForUserSpy).toHaveBeenCalledWith("clinic-a", "user-1");
  });
});

describe("closeCheckIn invalidation (test #6)", () => {
  it("calls invalidateForUser on the happy path", async () => {
    dbState.selectReturning = [
      {
        id: "ck-1",
        clinicId: "clinic-a",
        userId: "user-1",
        operationalRole: "ward",
        clinicalRoleAtCheckIn: "technician",
        checkedInAt: new Date(),
        checkedOutAt: null,
        clientId: null,
      },
    ];
    dbState.updateReturning = [
      {
        id: "ck-1",
        clinicId: "clinic-a",
        userId: "user-1",
        operationalRole: "ward",
        clinicalRoleAtCheckIn: "technician",
        checkedInAt: new Date(),
        checkedOutAt: new Date(),
        checkOutReason: "self",
        clientId: null,
      },
    ];

    await closeCheckIn({ actor: ACTOR, reason: "self" });
    expect(invalidateForUserSpy).toHaveBeenCalledWith("clinic-a", "user-1");
  });

  it("calls invalidateForUser on the lost-race branch", async () => {
    // getActiveCheckIn returns an existing open row.
    let selectCallCount = 0;
    dbState.selectReturning = [
      {
        id: "ck-1",
        clinicId: "clinic-a",
        userId: "user-1",
        operationalRole: "ward",
        clinicalRoleAtCheckIn: "technician",
        checkedInAt: new Date(),
        checkedOutAt: null,
        clientId: null,
      },
    ];
    // First update returns [] (lost race); subsequent select returns the
    // now-closed row.
    dbState.updateReturning = [];

    // Swap select behavior across calls — first call returns the active
    // row, second call (inside lost-race branch) returns the now-closed row.
    const closedRow = {
      id: "ck-1",
      clinicId: "clinic-a",
      userId: "user-1",
      operationalRole: "ward",
      clinicalRoleAtCheckIn: "technician",
      checkedInAt: new Date(),
      checkedOutAt: new Date(),
      checkOutReason: "session_close",
      clientId: null,
    };
    const activeRow = {
      id: "ck-1",
      clinicId: "clinic-a",
      userId: "user-1",
      operationalRole: "ward",
      clinicalRoleAtCheckIn: "technician",
      checkedInAt: new Date(),
      checkedOutAt: null,
      clientId: null,
    };
    dbState.selectReturning = activeRow ? [activeRow] : [];
    const selectQueue: unknown[] = [[activeRow], [closedRow]];
    // Re-stub db.select to consume from queue.
    const { db } = await import("../../server/db.js");
    (db.select as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        selectCallCount++;
        const v = selectQueue.shift() ?? [];
        return chainable(() => v);
      },
    );

    const result = await closeCheckIn({ actor: ACTOR, reason: "self" });
    expect(result.id).toBe("ck-1");
    expect(invalidateForUserSpy).toHaveBeenCalledWith("clinic-a", "user-1");
    expect(selectCallCount).toBe(2);
  });
});

describe("autoCheckOutForSessionEnd invalidation (test #7)", () => {
  it("calls invalidateForUser per closed row", async () => {
    dbState.updateReturning = [
      { id: "ck-1", userId: "user-1", operationalRole: "ward" },
      { id: "ck-2", userId: "user-2", operationalRole: "ward" },
      { id: "ck-3", userId: "user-3", operationalRole: "admission" },
    ];

    const result = await autoCheckOutForSessionEnd({
      clinicId: "clinic-a",
      endedAt: new Date(),
      performedBy: { id: "admin-1", email: "a@x.com", role: "admin" },
    });
    expect(result.closedCount).toBe(3);
    expect(invalidateForUserSpy).toHaveBeenCalledTimes(3);
    expect(invalidateForUserSpy).toHaveBeenNthCalledWith(1, "clinic-a", "user-1");
    expect(invalidateForUserSpy).toHaveBeenNthCalledWith(2, "clinic-a", "user-2");
    expect(invalidateForUserSpy).toHaveBeenNthCalledWith(3, "clinic-a", "user-3");
  });

  it("does not call invalidateForUser when no rows close", async () => {
    dbState.updateReturning = [];
    await autoCheckOutForSessionEnd({
      clinicId: "clinic-a",
      endedAt: new Date(),
      performedBy: { id: "admin-1", email: "a@x.com", role: "admin" },
    });
    expect(invalidateForUserSpy).not.toHaveBeenCalled();
  });
});
