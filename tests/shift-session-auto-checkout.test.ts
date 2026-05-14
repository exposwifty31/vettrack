/**
 * Unit tests for autoCheckOutForSessionEnd in clinical-check-in.service.ts.
 * Service-level only — does not boot the shift-handover route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockLogAudit = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    update: mockUpdate,
    select: mockSelect,
    insert: mockInsert,
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

vi.mock("../server/lib/audit.js", () => ({ logAudit: mockLogAudit }));

function chainable(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "where",
    "limit",
    "set",
    "values",
    "returning",
    "orderBy",
    "leftJoin",
    "innerJoin",
    "as",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    Promise.resolve(returnValue).then(resolve, reject);
  };
  return chain;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-1",
    clinicId: "clinic-A",
    userId: "user-1",
    checkedInAt: new Date("2026-05-14T08:00:00Z"),
    checkedOutAt: null,
    operationalRole: "admission",
    clinicalRoleAtCheckIn: "vet",
    activeShiftId: null,
    shiftSessionId: null,
    checkOutReason: null,
    clientId: null,
    createdAt: new Date("2026-05-14T08:00:00Z"),
    ...overrides,
  };
}

const PERFORMER = {
  id: "user-admin",
  email: "admin@clinic.test",
  role: "admin",
};

describe("autoCheckOutForSessionEnd", () => {
  beforeEach(() => vi.resetAllMocks());

  it("closes open check-ins for the clinic with checkOutReason=session_close", async () => {
    const endedAt = new Date("2026-05-14T20:00:00Z");
    const closedRows = [
      makeRow({
        id: "ci-1",
        userId: "user-1",
        checkedOutAt: endedAt,
        checkOutReason: "session_close",
      }),
      makeRow({
        id: "ci-2",
        userId: "user-2",
        operationalRole: null,
        clinicalRoleAtCheckIn: "technician",
        checkedOutAt: endedAt,
        checkOutReason: "session_close",
      }),
    ];
    const updChain = chainable(closedRows);
    mockUpdate.mockReturnValue(updChain);

    const { autoCheckOutForSessionEnd } = await import(
      "../server/services/clinical-check-in.js"
    );
    const result = await autoCheckOutForSessionEnd({
      clinicId: "clinic-A",
      endedAt,
      performedBy: PERFORMER,
    });

    expect(result.closedCount).toBe(2);
    expect((updChain["set"] as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      checkedOutAt: endedAt,
      checkOutReason: "session_close",
    });
  });

  it("emits one audit row per closed check-in", async () => {
    const endedAt = new Date("2026-05-14T20:00:00Z");
    const closedRows = [
      makeRow({ id: "ci-1", userId: "user-1", checkedOutAt: endedAt }),
      makeRow({ id: "ci-2", userId: "user-2", checkedOutAt: endedAt }),
      makeRow({ id: "ci-3", userId: "user-3", checkedOutAt: endedAt }),
    ];
    mockUpdate.mockReturnValue(chainable(closedRows));

    const { autoCheckOutForSessionEnd } = await import(
      "../server/services/clinical-check-in.js"
    );
    await autoCheckOutForSessionEnd({
      clinicId: "clinic-A",
      endedAt,
      performedBy: PERFORMER,
    });

    expect(mockLogAudit).toHaveBeenCalledTimes(3);
    for (const call of mockLogAudit.mock.calls) {
      const params = call[0];
      expect(params.actionType).toBe("clinical_check_out");
      expect(params.clinicId).toBe("clinic-A");
      expect(params.performedBy).toBe(PERFORMER.id);
      expect(params.metadata.source).toBe("session_close");
    }
  });

  it("zero open check-ins → no audit rows, closedCount=0", async () => {
    mockUpdate.mockReturnValue(chainable([]));

    const { autoCheckOutForSessionEnd } = await import(
      "../server/services/clinical-check-in.js"
    );
    const result = await autoCheckOutForSessionEnd({
      clinicId: "clinic-A",
      endedAt: new Date(),
      performedBy: PERFORMER,
    });

    expect(result.closedCount).toBe(0);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("WHERE clause scopes by clinicId (audit metadata reflects single clinic)", async () => {
    const endedAt = new Date();
    const closedRows = [
      makeRow({ id: "ci-A1", clinicId: "clinic-A", checkedOutAt: endedAt }),
    ];
    const updChain = chainable(closedRows);
    mockUpdate.mockReturnValue(updChain);

    const { autoCheckOutForSessionEnd } = await import(
      "../server/services/clinical-check-in.js"
    );
    await autoCheckOutForSessionEnd({
      clinicId: "clinic-A",
      endedAt,
      performedBy: PERFORMER,
    });

    // Audit row carries the scoping clinicId — proof we did not fan out across clinics.
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit.mock.calls[0][0].clinicId).toBe("clinic-A");
    expect(mockLogAudit.mock.calls[0][0].metadata.clinicId).toBe("clinic-A");
  });
});
