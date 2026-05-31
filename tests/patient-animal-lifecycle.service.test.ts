/**
 * Behavioral unit tests for patient-animal-lifecycle.service.ts.
 *
 * Covers restore-on-readmission, purge eligibility, and delete guardrails.
 * Complements static wiring checks in patient-animal-lifecycle.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockLogAudit = vi.fn();
const mockReleaseProcedureBoundEquipment = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
  },
  animals: {
    id: "id",
    clinicId: "clinicId",
    deletedAt: "deletedAt",
    deletedBy: "deletedBy",
    updatedAt: "updatedAt",
    name: "name",
  },
  hospitalizations: {
    id: "id",
    clinicId: "clinicId",
    animalId: "animalId",
    dischargedAt: "dischargedAt",
    status: "status",
    dischargeNotes: "dischargeNotes",
    updatedAt: "updatedAt",
    createdAt: "createdAt",
  },
  appointments: {
    id: "id",
    clinicId: "clinicId",
    hospitalizationId: "hospitalizationId",
    animalId: "animalId",
    status: "status",
    createdAt: "createdAt",
  },
  dispenseEvents: {
    id: "id",
    clinicId: "clinicId",
    patientId: "patientId",
    status: "status",
  },
  inventoryJobs: {
    id: "id",
    clinicId: "clinicId",
    animalId: "animalId",
    status: "status",
  },
  medicationTasks: {
    id: "id",
    clinicId: "clinicId",
    animalId: "animalId",
    createdAt: "createdAt",
  },
  billingLedger: {
    id: "id",
    clinicId: "clinicId",
    animalId: "animalId",
    createdAt: "createdAt",
  },
  shiftPatientHandoffItems: {
    clinicId: "clinicId",
    animalId: "animalId",
  },
}));

vi.mock("../server/lib/audit.js", () => ({ logAudit: mockLogAudit }));
vi.mock("../server/services/equipment-operational-state.service.js", () => ({
  releaseProcedureBoundEquipment: mockReleaseProcedureBoundEquipment,
}));

function chainable(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "limit", "set", "innerJoin", "orderBy"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    Promise.resolve(returnValue).then(resolve, reject);
  };
  return chain;
}

function selectResolving(rows: unknown[]) {
  return chainable(rows);
}

describe("restoreAnimalIfSoftDeleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue(chainable([]));
  });

  it("returns false when the animal is not soft-deleted", async () => {
    mockSelect.mockReturnValueOnce(selectResolving([{ id: "animal-1", deletedAt: null }]));

    const { restoreAnimalIfSoftDeleted } = await import(
      "../server/services/patient-animal-lifecycle.service.js"
    );
    const restored = await restoreAnimalIfSoftDeleted("clinic-1", "animal-1");

    expect(restored).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("clears deletedAt and returns true when the animal was soft-deleted", async () => {
    const deletedAt = new Date("2026-01-01T00:00:00Z");
    mockSelect.mockReturnValueOnce(selectResolving([{ id: "animal-1", deletedAt }]));
    const updChain = chainable([]);
    mockUpdate.mockReturnValueOnce(updChain);

    const { restoreAnimalIfSoftDeleted } = await import(
      "../server/services/patient-animal-lifecycle.service.js"
    );
    const restored = await restoreAnimalIfSoftDeleted("clinic-1", "animal-1");

    expect(restored).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
    expect(updChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: null, deletedBy: null }),
    );
  });

  it("returns false when the animal row is missing", async () => {
    mockSelect.mockReturnValueOnce(selectResolving([]));

    const { restoreAnimalIfSoftDeleted } = await import(
      "../server/services/patient-animal-lifecycle.service.js"
    );
    const restored = await restoreAnimalIfSoftDeleted("clinic-1", "missing");

    expect(restored).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("countAnimalPurgeCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts only stale soft-deletes with no post-delete clinical activity", async () => {
    const deletedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    mockSelect
      .mockReturnValueOnce(
        selectResolving([
          { id: "purge-me", clinicId: "clinic-1", deletedAt },
          { id: "active-stay", clinicId: "clinic-1", deletedAt },
        ]),
      )
      // purge-me: no active hospitalization
      .mockReturnValueOnce(selectResolving([]))
      // purge-me: no post-delete appointments / med tasks / billing / hospitalizations
      .mockReturnValueOnce(selectResolving([]))
      .mockReturnValueOnce(selectResolving([]))
      .mockReturnValueOnce(selectResolving([]))
      .mockReturnValueOnce(selectResolving([]))
      // active-stay: still has an open hospitalization
      .mockReturnValueOnce(selectResolving([{ id: "hosp-open" }]));

    const { countAnimalPurgeCandidates } = await import(
      "../server/services/patient-animal-lifecycle.service.js"
    );
    const count = await countAnimalPurgeCandidates();

    expect(count).toBe(1);
  });
});

describe("softDeletePatientByHospitalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseProcedureBoundEquipment.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue(chainable([]));
  });

  it("throws HOSPITALIZATION_NOT_FOUND when the stay does not exist", async () => {
    mockSelect.mockReturnValueOnce(selectResolving([]));

    const { softDeletePatientByHospitalization } = await import(
      "../server/services/patient-animal-lifecycle.service.js"
    );

    await expect(
      softDeletePatientByHospitalization({
        clinicId: "clinic-1",
        hospitalizationId: "hosp-missing",
        performedBy: "user-1",
        performedByEmail: "vet@test.com",
        actorRole: "admin",
      }),
    ).rejects.toThrow("HOSPITALIZATION_NOT_FOUND");
  });

  it("throws ANIMAL_ALREADY_DELETED when the animal is already soft-deleted", async () => {
    mockSelect.mockReturnValueOnce(
      selectResolving([
        {
          hospId: "hosp-1",
          animalId: "animal-1",
          animalDeletedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]),
    );

    const { softDeletePatientByHospitalization } = await import(
      "../server/services/patient-animal-lifecycle.service.js"
    );

    await expect(
      softDeletePatientByHospitalization({
        clinicId: "clinic-1",
        hospitalizationId: "hosp-1",
        performedBy: "user-1",
        performedByEmail: "vet@test.com",
        actorRole: "admin",
      }),
    ).rejects.toThrow("ANIMAL_ALREADY_DELETED");
  });

  it("throws PatientDeleteBlockedError when open tasks block discharge", async () => {
    mockSelect
      .mockReturnValueOnce(
        selectResolving([
          { hospId: "hosp-1", animalId: "animal-1", animalDeletedAt: null },
        ]),
      )
      .mockReturnValueOnce(selectResolving([{ id: "hosp-1", dischargedAt: null }]))
      .mockReturnValueOnce(selectResolving([{ id: "task-open-1" }]))
      .mockReturnValueOnce(selectResolving([]))
      .mockReturnValueOnce(selectResolving([]));

    const { softDeletePatientByHospitalization, PatientDeleteBlockedError } = await import(
      "../server/services/patient-animal-lifecycle.service.js"
    );

    const err = await softDeletePatientByHospitalization({
      clinicId: "clinic-1",
      hospitalizationId: "hosp-1",
      performedBy: "user-1",
      performedByEmail: "vet@test.com",
      actorRole: "admin",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PatientDeleteBlockedError);
    expect(err).toMatchObject({
      blockingConditions: [{ type: "open_tasks", ids: ["task-open-1"] }],
    });
  });
});
