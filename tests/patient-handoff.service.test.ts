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
  const methods = ["from", "where", "limit", "leftJoin", "innerJoin", "orderBy", "returning", "values", "set", "as"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain itself a thenable so `await chain` resolves to returnValue
  chain["then"] = (resolve: (v: unknown) => void, _reject?: (e: unknown) => void) => {
    Promise.resolve(returnValue).then(resolve, _reject);
  };
  return chain;
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
