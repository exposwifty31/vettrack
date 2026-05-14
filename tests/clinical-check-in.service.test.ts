/**
 * Unit tests for clinical-check-in.service.ts.
 * Uses in-memory mocks — does not require a running DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockLogAudit = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
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
  chain["then"] = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    Promise.resolve(returnValue).then(resolve, reject);
  };
  return chain;
}

// chainable that throws on `.returning()` await
function insertThatThrows(err: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "limit", "values", "set"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain["returning"] = vi.fn().mockImplementation(() => {
    return {
      then: (_res: (v: unknown) => void, rej?: (e: unknown) => void) => {
        Promise.reject(err).catch((e) => rej?.(e));
      },
    };
  });
  return chain;
}

const VET_ACTOR = {
  userId: "user-vet",
  email: "vet@clinic.test",
  clinicId: "clinic-1",
  role: "vet" as const,
};
const TECH_ACTOR = {
  userId: "user-tech",
  email: "tech@clinic.test",
  clinicId: "clinic-1",
  role: "technician" as const,
};
const SENIOR_ACTOR = {
  userId: "user-sr",
  email: "sr@clinic.test",
  clinicId: "clinic-1",
  role: "senior_technician" as const,
};
const ADMIN_ACTOR = {
  userId: "user-admin",
  email: "admin@clinic.test",
  clinicId: "clinic-1",
  role: "admin" as const,
};
const STUDENT_ACTOR = {
  userId: "user-stu",
  email: "stu@clinic.test",
  clinicId: "clinic-1",
  role: "student" as const,
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "user-vet",
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

function mockInsertReturning(rows: unknown[]) {
  const chain = chainable(rows);
  mockInsert.mockReturnValue(chain);
}

function mockSelectSequence(...returns: unknown[]) {
  for (const r of returns) {
    mockSelect.mockReturnValueOnce(chainable(r));
  }
}

describe("openCheckIn — happy paths", () => {
  beforeEach(() => vi.resetAllMocks());

  it("vet check-in writes row with operationalRole and snapshot role", async () => {
    mockSelectSequence([{ allowed: ["admission", "ward"] }]);
    const row = makeRow();
    mockInsertReturning([row]);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    const result = await openCheckIn({
      actor: VET_ACTOR,
      operationalRole: "admission",
    });
    expect(result.replayed).toBe(false);
    expect(result.row).toEqual(row);
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit.mock.calls[0][0].actionType).toBe("clinical_check_in");
  });

  it("vet insert values include UUID id and null shift fields", async () => {
    mockSelectSequence([{ allowed: ["admission"] }]);
    const insertChain = chainable([makeRow()]);
    mockInsert.mockReturnValue(insertChain);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await openCheckIn({ actor: VET_ACTOR, operationalRole: "admission" });

    const valuesFn = insertChain["values"] as ReturnType<typeof vi.fn>;
    expect(valuesFn).toHaveBeenCalledTimes(1);
    const inserted = valuesFn.mock.calls[0][0];
    expect(typeof inserted.id).toBe("string");
    expect(inserted.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(inserted.activeShiftId).toBeNull();
    expect(inserted.shiftSessionId).toBeNull();
    expect(inserted.clinicalRoleAtCheckIn).toBe("vet");
    expect(inserted.operationalRole).toBe("admission");
  });

  it("technician check-in writes row with operationalRole = null", async () => {
    const row = makeRow({
      userId: "user-tech",
      operationalRole: null,
      clinicalRoleAtCheckIn: "technician",
    });
    const insertChain = chainable([row]);
    mockInsert.mockReturnValue(insertChain);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    const result = await openCheckIn({ actor: TECH_ACTOR });
    expect(result.row.operationalRole).toBeNull();
    const inserted = (insertChain["values"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.operationalRole).toBeNull();
    expect(inserted.clinicalRoleAtCheckIn).toBe("technician");
  });

  it("senior_technician check-in writes row with operationalRole = null", async () => {
    const row = makeRow({
      userId: "user-sr",
      operationalRole: null,
      clinicalRoleAtCheckIn: "senior_technician",
    });
    const insertChain = chainable([row]);
    mockInsert.mockReturnValue(insertChain);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    const result = await openCheckIn({ actor: SENIOR_ACTOR });
    expect(result.row.operationalRole).toBeNull();
    const inserted = (insertChain["values"] as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.clinicalRoleAtCheckIn).toBe("senior_technician");
  });
});

describe("openCheckIn — role / role-class rejections", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects admin with ROLE_NOT_ELIGIBLE_FOR_CHECK_IN", async () => {
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(openCheckIn({ actor: ADMIN_ACTOR })).rejects.toMatchObject({
      code: "ROLE_NOT_ELIGIBLE_FOR_CHECK_IN",
      status: 403,
    });
  });

  it("rejects student with STUDENT_NOT_CLINICAL", async () => {
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(openCheckIn({ actor: STUDENT_ACTOR })).rejects.toMatchObject({
      code: "STUDENT_NOT_CLINICAL",
      status: 403,
    });
  });

  it("rejects vet missing operationalRole with OPERATIONAL_ROLE_REQUIRED_FOR_VET", async () => {
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(openCheckIn({ actor: VET_ACTOR })).rejects.toMatchObject({
      code: "OPERATIONAL_ROLE_REQUIRED_FOR_VET",
      status: 400,
    });
  });

  it("rejects vet with unknown operationalRole", async () => {
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({ actor: VET_ACTOR, operationalRole: "garbage" }),
    ).rejects.toMatchObject({
      code: "OPERATIONAL_ROLE_UNKNOWN",
      status: 400,
    });
  });

  it("rejects vet with empty allowlist as NO_ALLOWED_OPERATIONAL_ROLES", async () => {
    mockSelectSequence([{ allowed: [] }]);
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({ actor: VET_ACTOR, operationalRole: "admission" }),
    ).rejects.toMatchObject({
      code: "NO_ALLOWED_OPERATIONAL_ROLES",
      status: 403,
    });
  });

  it("rejects vet whose role is outside allowlist", async () => {
    mockSelectSequence([{ allowed: ["ward"] }]);
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({ actor: VET_ACTOR, operationalRole: "admission" }),
    ).rejects.toMatchObject({
      code: "OPERATIONAL_ROLE_NOT_ALLOWED",
      status: 403,
    });
  });

  it("rejects non-vet supplying operationalRole", async () => {
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({ actor: TECH_ACTOR, operationalRole: "admission" }),
    ).rejects.toMatchObject({
      code: "OPERATIONAL_ROLE_NOT_ALLOWED_FOR_NON_VET",
      status: 400,
    });
  });

  it("rejects array operationalRole as OPERATIONAL_ROLE_INVALID", async () => {
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({ actor: VET_ACTOR, operationalRole: ["admission"] }),
    ).rejects.toMatchObject({
      code: "OPERATIONAL_ROLE_INVALID",
      status: 400,
    });
  });

  it("does not auto-default vet when allowlist has size 1", async () => {
    mockSelectSequence([{ allowed: ["admission"] }]);
    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(openCheckIn({ actor: VET_ACTOR })).rejects.toMatchObject({
      code: "OPERATIONAL_ROLE_REQUIRED_FOR_VET",
    });
  });
});

describe("openCheckIn — idempotency and duplicates", () => {
  beforeEach(() => vi.resetAllMocks());

  function dupErr(viaCause = false) {
    if (viaCause) {
      return Object.assign(new Error("dup"), { cause: { code: "23505" } });
    }
    return Object.assign(new Error("dup"), { code: "23505" });
  }

  it("returns existing row with replayed=true when matching idempotency key within 60s", async () => {
    const existing = makeRow({
      checkedInAt: new Date(Date.now() - 10_000),
      clientId: "abc-123",
    });
    mockInsert.mockReturnValue(insertThatThrows(dupErr()));
    mockSelectSequence([{ allowed: ["admission"] }], [existing]);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    const result = await openCheckIn({
      actor: VET_ACTOR,
      operationalRole: "admission",
      idempotencyKey: "abc-123",
    });
    expect(result.replayed).toBe(true);
    expect(result.row.id).toBe(existing.id);
  });

  it("detects unique-constraint via err.cause.code = 23505", async () => {
    const existing = makeRow({
      checkedInAt: new Date(Date.now() - 5_000),
      clientId: "abc-123",
    });
    mockInsert.mockReturnValue(insertThatThrows(dupErr(true)));
    mockSelectSequence([{ allowed: ["admission"] }], [existing]);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    const result = await openCheckIn({
      actor: VET_ACTOR,
      operationalRole: "admission",
      idempotencyKey: "abc-123",
    });
    expect(result.replayed).toBe(true);
  });

  it("rejects ALREADY_CHECKED_IN with no idempotency key", async () => {
    const existing = makeRow();
    mockInsert.mockReturnValue(insertThatThrows(dupErr()));
    mockSelectSequence([{ allowed: ["admission"] }], [existing]);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({ actor: VET_ACTOR, operationalRole: "admission" }),
    ).rejects.toMatchObject({ code: "ALREADY_CHECKED_IN", status: 409 });
  });

  it("rejects ALREADY_CHECKED_IN when key mismatches within window", async () => {
    const existing = makeRow({
      checkedInAt: new Date(Date.now() - 5_000),
      clientId: "abc-123",
    });
    mockInsert.mockReturnValue(insertThatThrows(dupErr()));
    mockSelectSequence([{ allowed: ["admission"] }], [existing]);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({
        actor: VET_ACTOR,
        operationalRole: "admission",
        idempotencyKey: "different-key",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_CHECKED_IN" });
  });

  it("rejects ALREADY_CHECKED_IN when key matches but row is older than 60s", async () => {
    const existing = makeRow({
      checkedInAt: new Date(Date.now() - 120_000),
      clientId: "abc-123",
    });
    mockInsert.mockReturnValue(insertThatThrows(dupErr()));
    mockSelectSequence([{ allowed: ["admission"] }], [existing]);

    const { openCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      openCheckIn({
        actor: VET_ACTOR,
        operationalRole: "admission",
        idempotencyKey: "abc-123",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_CHECKED_IN" });
  });
});

describe("closeCheckIn", () => {
  beforeEach(() => vi.resetAllMocks());

  it("closes the active row and fires audit", async () => {
    const existing = makeRow();
    const closed = makeRow({
      checkedOutAt: new Date("2026-05-14T16:00:00Z"),
      checkOutReason: "self",
    });
    mockSelectSequence([existing]);
    const updChain = chainable([closed]);
    mockUpdate.mockReturnValue(updChain);

    const { closeCheckIn } = await import("../server/services/clinical-check-in.js");
    const row = await closeCheckIn({ actor: VET_ACTOR, reason: "self" });
    expect(row.checkOutReason).toBe("self");
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit.mock.calls[0][0].actionType).toBe("clinical_check_out");
  });

  it("throws NOT_CHECKED_IN when no open row", async () => {
    mockSelectSequence([]);
    const { closeCheckIn } = await import("../server/services/clinical-check-in.js");
    await expect(
      closeCheckIn({ actor: VET_ACTOR, reason: "self" }),
    ).rejects.toMatchObject({ code: "NOT_CHECKED_IN", status: 404 });
  });

  it("returns the row already closed by a concurrent closer without firing a second audit", async () => {
    const existing = makeRow();
    const sessionClosed = makeRow({
      checkedOutAt: new Date("2026-05-14T15:00:00Z"),
      checkOutReason: "session_close",
    });
    // SELECT 1: getActiveCheckIn returns the open row.
    // SELECT 2: post-update re-read returns the row already closed by the race winner.
    mockSelectSequence([existing], [sessionClosed]);
    // UPDATE returns [] — predicate `checked_out_at IS NULL` no longer matched.
    mockUpdate.mockReturnValue(chainable([]));

    const { closeCheckIn } = await import(
      "../server/services/clinical-check-in.js"
    );
    const row = await closeCheckIn({ actor: VET_ACTOR, reason: "self" });
    expect(row.checkOutReason).toBe("session_close");
    expect(row.checkedOutAt).toEqual(sessionClosed.checkedOutAt);
    // No second audit row — the winning closer already wrote one.
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("snapshot — clinicalRoleAtCheckIn on existing row is preserved regardless of actor role today", async () => {
    const existing = makeRow({ clinicalRoleAtCheckIn: "vet" });
    const closed = makeRow({
      clinicalRoleAtCheckIn: "vet",
      checkedOutAt: new Date(),
      checkOutReason: "self",
    });
    mockSelectSequence([existing]);
    mockUpdate.mockReturnValue(chainable([closed]));

    const { closeCheckIn } = await import("../server/services/clinical-check-in.js");
    const row = await closeCheckIn({ actor: VET_ACTOR, reason: "self" });
    expect(row.clinicalRoleAtCheckIn).toBe("vet");
  });
});

describe("getAllowedOperationalRoles", () => {
  beforeEach(() => vi.resetAllMocks());

  it("filters non-canonical values out of jsonb", async () => {
    mockSelectSequence([
      { allowed: ["admission", "junk", 42, "ward", null] },
    ]);
    const { getAllowedOperationalRoles } = await import(
      "../server/services/clinical-check-in.js"
    );
    const result = await getAllowedOperationalRoles("user-1", "clinic-1");
    expect(result).toEqual(["admission", "ward"]);
  });

  it("returns [] when user row is missing", async () => {
    mockSelectSequence([]);
    const { getAllowedOperationalRoles } = await import(
      "../server/services/clinical-check-in.js"
    );
    const result = await getAllowedOperationalRoles("user-1", "clinic-1");
    expect(result).toEqual([]);
  });
});
