/**
 * Unit tests for patient-handoff.service.ts.
 * Uses in-memory mocks — does not require a running DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock db module ───────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
    transaction: mockTransaction,
  },
  shiftPatientHandoffs: { id: "id", clinicId: "clinicId", outgoingUserId: "outgoingUserId", receivingUserId: "receivingUserId", status: "status", version: "version" },
  shiftPatientHandoffItems: { id: "id", handoffId: "handoffId", hospitalizationId: "hospitalizationId", animalId: "animalId", status: "status", version: "version" },
  users: { id: "id", clinicId: "clinicId", status: "status", displayName: "displayName", role: "role" },
  animals: { id: "id", name: "name", clinicId: "clinicId" },
  hospitalizations: { id: "id", clinicId: "clinicId", status: "status", ward: "ward", bay: "bay", dischargedAt: "dischargedAt", animalId: "animalId", admittedAt: "admittedAt" },
}));

vi.mock("../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../server/lib/realtime-outbox.js", () => ({ insertRealtimeDomainEvent: vi.fn() }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chainable(returnValue: unknown) {
  // Every method returns the same chain; awaiting the chain itself resolves to returnValue.
  const chain: Record<string, unknown> = {};
  const methods = [
    "from", "where", "limit", "leftJoin", "innerJoin", "orderBy",
    "returning", "values", "set", "as", "onConflictDoNothing", "onConflictDoUpdate",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain itself a thenable so `await chain` resolves to returnValue
  chain["then"] = (resolve: (v: unknown) => void, _reject?: (e: unknown) => void) => {
    Promise.resolve(returnValue).then(resolve, _reject);
  };
  return chain;
}

// Builds a minimal transaction object whose update() always returns the given rows.
function makeTx(updateRows: unknown) {
  return { update: vi.fn().mockReturnValue(chainable(updateRows)) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("listEligiblePatients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns active hospitalizations", async () => {
    const rows = [
      { hospitalizationId: "h1", animalId: "a1", animalName: "Max", status: "admitted", ward: "ICU", bay: "1A" },
    ];
    mockSelect.mockReturnValue(chainable(rows));

    const { listEligiblePatients } = await import("../server/services/patient-handoff.service.js");
    const result = await listEligiblePatients("clinic-1");

    expect(result.patients).toHaveLength(1);
    expect(result.patients[0].animalName).toBe("Max");
  });
});

describe("createHandoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws RECEIVING_USER_UNAVAILABLE when receiver not found", async () => {
    mockSelect.mockReturnValue(chainable([]));

    const { createHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(createHandoff("clinic-1", "user-out", "user-rx")).rejects.toMatchObject({
      code: "RECEIVING_USER_UNAVAILABLE",
      httpStatus: 409,
    });
  });

  it("creates a draft and returns id", async () => {
    mockSelect.mockReturnValue(chainable([{ id: "user-rx", role: "technician" }]));
    const insertChain = chainable(undefined);
    (insertChain["values"] as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockInsert.mockReturnValue(insertChain);

    const { createHandoff } = await import("../server/services/patient-handoff.service.js");
    const result = await createHandoff("clinic-1", "user-out", "user-rx");

    expect(result.status).toBe("draft");
    expect(result.version).toBe(1);
    expect(result.id).toBeTruthy();
  });

  it("rejects self-handoff with RECEIVING_USER_INVALID", async () => {
    const { createHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(createHandoff("clinic-1", "user-x", "user-x")).rejects.toMatchObject({
      code: "RECEIVING_USER_INVALID",
      httpStatus: 400,
    });
  });

  it("rejects ineligible receiver role with RECEIVING_USER_INVALID_ROLE", async () => {
    mockSelect.mockReturnValue(chainable([{ id: "user-rx", role: "student" }]));

    const { createHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(createHandoff("clinic-1", "user-out", "user-rx")).rejects.toMatchObject({
      code: "RECEIVING_USER_INVALID_ROLE",
      httpStatus: 400,
    });
  });
});

describe("upsertItem", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws FORBIDDEN when caller is not outgoing user", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "other-user", status: "draft" }]))
    ;

    const { upsertItem } = await import("../server/services/patient-handoff.service.js");
    await expect(
      upsertItem("clinic-1", "handoff-1", "hosp-1", "caller", {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });

  it("throws HANDOFF_NOT_DRAFT when status is submitted", async () => {
    mockSelect.mockReturnValueOnce(chainable([{ outgoingUserId: "caller", status: "submitted" }]));

    const { upsertItem } = await import("../server/services/patient-handoff.service.js");
    await expect(
      upsertItem("clinic-1", "handoff-1", "hosp-1", "caller", {}),
    ).rejects.toMatchObject({ code: "HANDOFF_NOT_DRAFT", httpStatus: 409 });
  });

  it("throws CONFLICT_STALE_DRAFT when version mismatch on update", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", status: "draft" }]))
      .mockReturnValueOnce(chainable([{ id: "hosp-1", animalId: "animal-1" }]))
      .mockReturnValueOnce(chainable([{ id: "item-1", version: 2 }]));

    const updateChain = chainable([]);
    mockUpdate.mockReturnValue(updateChain);

    const { upsertItem } = await import("../server/services/patient-handoff.service.js");
    await expect(
      upsertItem("clinic-1", "handoff-1", "hosp-1", "caller", { version: 1, status: "ready" }),
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_DRAFT", httpStatus: 409 });
  });
});

describe("submitHandoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws ITEMS_NOT_READY when item is still draft", async () => {
    const itemsArray = [{ id: "item-1", hospitalizationId: "h1", animalId: "a1", animalName: "Max", status: "draft" }];
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", receivingUserId: "rx", status: "draft", version: 1 }]))
      .mockReturnValueOnce(chainable([{ id: "rx" }]))
      .mockReturnValueOnce(chainable(itemsArray));

    const { submitHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      submitHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "ITEMS_NOT_READY", httpStatus: 409 });
  });

  it("throws FORBIDDEN when caller is not outgoing user", async () => {
    mockSelect.mockReturnValueOnce(chainable([{ outgoingUserId: "other", receivingUserId: "rx", status: "draft", version: 1 }]));

    const { submitHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      submitHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });
});

describe("cancelHandoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws FORBIDDEN when caller is not outgoing user", async () => {
    mockSelect.mockReturnValueOnce(chainable([{ outgoingUserId: "other", status: "draft", version: 1 }]));

    const { cancelHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      cancelHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });

  it("throws HANDOFF_NOT_DRAFT when status is not draft", async () => {
    mockSelect.mockReturnValueOnce(chainable([{ outgoingUserId: "caller", status: "submitted", version: 1 }]));

    const { cancelHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      cancelHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "HANDOFF_NOT_DRAFT", httpStatus: 409 });
  });

  it("throws CONFLICT_STALE_DRAFT on version mismatch", async () => {
    mockSelect.mockReturnValueOnce(chainable([{ outgoingUserId: "caller", status: "draft", version: 3 }]));

    const { cancelHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      cancelHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_DRAFT", httpStatus: 409 });
  });
});

describe("reviewHandoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws FORBIDDEN when caller is not receiving user", async () => {
    mockSelect.mockReturnValueOnce(chainable([{ receivingUserId: "other", status: "submitted", version: 1 }]));

    const { reviewHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      reviewHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });

  it("throws HANDOFF_NOT_SUBMITTED when status is draft", async () => {
    mockSelect.mockReturnValueOnce(chainable([{ receivingUserId: "caller", status: "draft", version: 1 }]));

    const { reviewHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      reviewHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "HANDOFF_NOT_SUBMITTED", httpStatus: 409 });
  });
});

// ─── Concurrency: submit race ─────────────────────────────────────────────────
//
// These tests verify the behavioral contract of the in-transaction version guard.
// True parallel DB execution cannot be replicated with synchronous mocks, so we
// test the contract directly: when the WHERE (version = N) predicate matches 0
// rows inside the transaction the service throws CONFLICT_STALE_DRAFT (409)
// rather than silently double-committing.
//
// Note: vi.resetAllMocks() (not just vi.clearAllMocks()) is used here because
// vi.clearAllMocks() only resets call history — it does not drain the
// mockReturnValueOnce queue.  Without resetAllMocks, stale queued values from
// one test bleed into the next.

describe("submitHandoff — concurrent submit race", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns CONFLICT_STALE_DRAFT when transaction update finds 0 rows (version already bumped)", async () => {
    // Simulate: pre-check passed with version=1, but by the time the transaction
    // executes its guarded UPDATE another request already incremented the version.
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", receivingUserId: "rx", status: "draft", version: 1 }]))
      .mockReturnValueOnce(chainable([{ id: "rx" }]))
      // All items skipped → no active patients, no invalidation check needed
      .mockReturnValueOnce(chainable([{ id: "item-1", hospitalizationId: "h1", animalId: "a1", animalName: "Max", status: "skipped" }]));

    // Transaction: guarded UPDATE returns 0 rows — another request won the race
    mockTransaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      return cb(makeTx([]));
    });

    const { submitHandoff } = await import("../server/services/patient-handoff.service.js");
    await expect(
      submitHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_DRAFT", httpStatus: 409 });
  });

  it("succeeds when transaction update returns the updated row", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", receivingUserId: "rx", status: "draft", version: 1 }]))
      .mockReturnValueOnce(chainable([{ id: "rx" }]))
      .mockReturnValueOnce(chainable([{ id: "item-1", hospitalizationId: "h1", animalId: "a1", animalName: "Max", status: "skipped" }]));

    // Transaction: guarded UPDATE returns the row — this request won
    mockTransaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      return cb(makeTx([{ id: "handoff-1" }]));
    });

    const { submitHandoff } = await import("../server/services/patient-handoff.service.js");
    const result = await submitHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1);
    expect(result.status).toBe("submitted");
    expect(result.version).toBe(2);
  });
});

// ─── Concurrency: first-save race ────────────────────────────────────────────
//
// Two requests try to create the same (handoffId, hospitalizationId) item
// simultaneously.  The second INSERT hits the unique constraint; the service
// uses .onConflictDoNothing() so the DB does not throw a raw 500, and the
// empty returning() array is translated to a 409.

describe("upsertItem — concurrent first-save race", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns CONFLICT_STALE_DRAFT (409) when insert returns 0 rows due to unique constraint", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", status: "draft" }]))
      .mockReturnValueOnce(chainable([{ id: "hosp-1", animalId: "animal-1" }]))
      // No pre-existing item — first-save path
      .mockReturnValueOnce(chainable([]));

    // Insert returns 0 rows: onConflictDoNothing silenced the constraint violation
    mockInsert.mockReturnValue(chainable([]));

    const { upsertItem } = await import("../server/services/patient-handoff.service.js");
    await expect(
      upsertItem("clinic-1", "handoff-1", "hosp-1", "caller", {}),
    ).rejects.toMatchObject({ code: "CONFLICT_STALE_DRAFT", httpStatus: 409 });
  });

  it("does not propagate a raw unique-constraint error as a 500", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", status: "draft" }]))
      .mockReturnValueOnce(chainable([{ id: "hosp-1", animalId: "animal-1" }]))
      .mockReturnValueOnce(chainable([]));

    mockInsert.mockReturnValue(chainable([]));

    const { upsertItem } = await import("../server/services/patient-handoff.service.js");
    const err = await upsertItem("clinic-1", "handoff-1", "hosp-1", "caller", {}).catch((e: unknown) => e);

    // Must be a shaped ApiError (has httpStatus), never an unhandled DB error
    expect(err).toHaveProperty("httpStatus", 409);
    expect(err).not.toHaveProperty("code", "23505"); // postgres unique_violation code
  });
});

// ─── Transaction atomicity: realtime outbox rollback ─────────────────────────
//
// If insertRealtimeDomainEvent throws inside the transaction, the entire
// transaction must roll back (DB guarantees this).  At the service level this
// means the error propagates — the caller receives an exception and the handoff
// status change is NOT visible (no committed row).

describe("submitHandoff — transaction rollback on realtime outbox failure", () => {
  beforeEach(() => vi.resetAllMocks());

  it("propagates outbox error so the transaction rolls back", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", receivingUserId: "rx", status: "draft", version: 1 }]))
      .mockReturnValueOnce(chainable([{ id: "rx" }]))
      .mockReturnValueOnce(chainable([{ id: "item-1", hospitalizationId: "h1", animalId: "a1", animalName: "Max", status: "skipped" }]));

    // Version guard succeeds, but outbox insert throws
    const outboxError = new Error("outbox unavailable");
    const { insertRealtimeDomainEvent } = await import("../server/lib/realtime-outbox.js");
    vi.mocked(insertRealtimeDomainEvent).mockRejectedValueOnce(outboxError);

    mockTransaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      // Execute the callback — it will throw when it hits insertRealtimeDomainEvent
      return cb(makeTx([{ id: "handoff-1" }]));
    });

    const { submitHandoff } = await import("../server/services/patient-handoff.service.js");

    // The service must throw, not swallow the error
    await expect(
      submitHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1),
    ).rejects.toThrow("outbox unavailable");

    // The transaction callback was entered exactly once
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // The state-change UPDATE was attempted inside the transaction
    const txArg = mockTransaction.mock.calls[0][0];
    expect(txArg).toBeTypeOf("function");
  });

  it("does not return a success result when the outbox fails", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([{ outgoingUserId: "caller", receivingUserId: "rx", status: "draft", version: 1 }]))
      .mockReturnValueOnce(chainable([{ id: "rx" }]))
      .mockReturnValueOnce(chainable([{ id: "item-1", hospitalizationId: "h1", animalId: "a1", animalName: "Max", status: "skipped" }]));

    const { insertRealtimeDomainEvent } = await import("../server/lib/realtime-outbox.js");
    vi.mocked(insertRealtimeDomainEvent).mockRejectedValueOnce(new Error("outbox unavailable"));

    mockTransaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      return cb(makeTx([{ id: "handoff-1" }]));
    });

    const { submitHandoff } = await import("../server/services/patient-handoff.service.js");
    const result = await submitHandoff("clinic-1", "handoff-1", "caller", "caller@test.com", "technician", 1)
      .then((v) => v)
      .catch((e: unknown) => e);

    // Must be an error, not a SubmitHandoffResponse
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("outbox unavailable");
  });
});
