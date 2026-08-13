/**
 * Unit tests for board-responsibles.service.ts (doctor shift gate — Task 8).
 * Uses in-memory mocks — does not require a running DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockResolveShiftCoordinator = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  clinicalCheckIns: {
    id: "id",
    clinicId: "clinicId",
    userId: "userId",
    checkedInAt: "checkedInAt",
    checkedOutAt: "checkedOutAt",
    operationalRole: "operationalRole",
    isSenior: "isSenior",
  },
  users: {
    id: "id",
    clinicId: "clinicId",
    name: "name",
    displayName: "displayName",
  },
}));

vi.mock("../server/services/equipment-coordinator.service.js", () => ({
  resolveShiftCoordinator: mockResolveShiftCoordinator,
}));

const { buildBoardResponsibles } = await import(
  "../server/services/board-responsibles.service.js"
);

const CLINIC_ID = "clinic-1";
const TODAY = "2026-08-13";

function chainable(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "limit", "leftJoin", "innerJoin", "orderBy"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    Promise.resolve(returnValue).then(resolve, reject);
  };
  return chain;
}

/** Recursively collects every literal/param value inside a drizzle SQL tree. */
function collectValues(node: unknown, out: unknown[] = [], seen = new Set<unknown>()): unknown[] {
  if (node === null || node === undefined) return out;
  if (typeof node !== "object") {
    out.push(node);
    return out;
  }
  if (seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const child of node) collectValues(child, out, seen);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if ("queryChunks" in rec) collectValues(rec.queryChunks, out, seen);
  if ("value" in rec) collectValues(rec.value, out, seen);
  return out;
}

/** Query chain whose awaited result rejects — simulates a DB failure. */
function rejectingChain(err: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "limit", "leftJoin", "innerJoin", "orderBy"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (_resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    reject?.(err);
  };
  return chain;
}

function unresolvedCoordinator() {
  return {
    coordinatorUserId: null,
    status: "unresolved" as const,
    candidates: [],
    seniorTechUserId: null,
  };
}

function doctorRow(overrides: Record<string, unknown> = {}) {
  return {
    operationalRole: "icu",
    isSenior: false,
    checkedInAt: new Date("2026-08-13T07:00:00Z"),
    userName: "fallback name",
    userDisplayName: "Display Name",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveShiftCoordinator.mockResolvedValue(unresolvedCoordinator());
});

describe("buildBoardResponsibles", () => {
  it("puts the senior in `senior` and non-seniors in `members`, sorted by since", async () => {
    mockSelect.mockReturnValueOnce(
      chainable([
        doctorRow({
          isSenior: false,
          checkedInAt: new Date("2026-08-13T06:00:00Z"),
          userDisplayName: "Member Early",
        }),
        doctorRow({
          isSenior: true,
          checkedInAt: new Date("2026-08-13T07:00:00Z"),
          userDisplayName: "The Senior",
        }),
        doctorRow({
          isSenior: false,
          checkedInAt: new Date("2026-08-13T08:00:00Z"),
          userDisplayName: "Member Late",
        }),
      ]),
    );

    const result = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate: TODAY,
      currentShift: [],
    });

    expect(result.doctors.icu.senior).toEqual({
      name: "The Senior",
      since: "2026-08-13T07:00:00.000Z",
    });
    expect(result.doctors.icu.members).toEqual([
      { name: "Member Early", since: "2026-08-13T06:00:00.000Z" },
      { name: "Member Late", since: "2026-08-13T08:00:00.000Z" },
    ]);
    expect(result.doctors.admission).toEqual({ senior: null, members: [] });
    expect(result.doctors.internal_medicine).toEqual({ senior: null, members: [] });
  });

  it("groups rows into their own team blocks", async () => {
    mockSelect.mockReturnValueOnce(
      chainable([
        doctorRow({ operationalRole: "admission", isSenior: true, userDisplayName: "Adm Senior" }),
        doctorRow({
          operationalRole: "internal_medicine",
          isSenior: false,
          userDisplayName: "Int Member",
        }),
      ]),
    );

    const result = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate: TODAY,
      currentShift: [],
    });

    expect(result.doctors.admission.senior?.name).toBe("Adm Senior");
    expect(result.doctors.internal_medicine.members.map((m) => m.name)).toEqual(["Int Member"]);
    expect(result.doctors.icu).toEqual({ senior: null, members: [] });
  });

  it("falls back to users.name when displayName is empty", async () => {
    mockSelect.mockReturnValueOnce(
      chainable([doctorRow({ userDisplayName: "", userName: "Plain Name" })]),
    );

    const result = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate: TODAY,
      currentShift: [],
    });

    expect(result.doctors.icu.members[0]?.name).toBe("Plain Name");
  });

  it("empty clinic → all-empty doctor blocks, null senior technician, unresolved coordinator", async () => {
    mockSelect.mockReturnValueOnce(chainable([]));

    const result = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate: TODAY,
      currentShift: [],
    });

    expect(result.doctors.icu).toEqual({ senior: null, members: [] });
    expect(result.doctors.admission).toEqual({ senior: null, members: [] });
    expect(result.doctors.internal_medicine).toEqual({ senior: null, members: [] });
    expect(result.seniorTechnician).toBeNull();
    expect(result.equipmentCoordinator).toEqual({ name: null, status: "unresolved" });
  });

  it("passes the first senior_technician currentShift entry through", async () => {
    mockSelect.mockReturnValueOnce(chainable([]));

    const result = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate: TODAY,
      currentShift: [
        { employeeName: "Vet A", role: "vet" },
        { employeeName: "Senior Tech", role: "senior_technician" },
        { employeeName: "Other Senior", role: "senior_technician" },
      ],
    });

    expect(result.seniorTechnician).toEqual({ name: "Senior Tech" });
  });

  it("resolves the coordinator name from candidates (no extra user query)", async () => {
    mockSelect.mockReturnValueOnce(chainable([]));
    mockResolveShiftCoordinator.mockResolvedValue({
      coordinatorUserId: "u-coord",
      status: "auto",
      candidates: [{ userId: "u-coord", name: "Coord Name" }],
      seniorTechUserId: null,
    });

    const result = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate: TODAY,
      currentShift: [],
    });

    expect(mockResolveShiftCoordinator).toHaveBeenCalledWith(CLINIC_ID, TODAY);
    expect(result.equipmentCoordinator).toEqual({ name: "Coord Name", status: "auto" });
    // only the doctors query — no fallback user lookup
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("falls back to a clinic-scoped user lookup when the coordinator is not in candidates", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([]))
      .mockReturnValueOnce(chainable([{ name: "raw name", displayName: "Looked Up" }]));
    mockResolveShiftCoordinator.mockResolvedValue({
      coordinatorUserId: "u-conf",
      status: "confirmed",
      candidates: [],
      seniorTechUserId: null,
    });

    const result = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate: TODAY,
      currentShift: [],
    });

    expect(result.equipmentCoordinator).toEqual({ name: "Looked Up", status: "confirmed" });
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("filters every query by clinicId", async () => {
    const doctorsChain = chainable([]);
    const userChain = chainable([{ name: "n", displayName: "d" }]);
    mockSelect.mockReturnValueOnce(doctorsChain).mockReturnValueOnce(userChain);
    mockResolveShiftCoordinator.mockResolvedValue({
      coordinatorUserId: "u-conf",
      status: "confirmed",
      candidates: [],
      seniorTechUserId: null,
    });

    await buildBoardResponsibles({ clinicId: CLINIC_ID, todayDate: TODAY, currentShift: [] });

    for (const chain of [doctorsChain, userChain]) {
      const whereMock = (chain as Record<string, ReturnType<typeof vi.fn>>).where;
      expect(whereMock).toHaveBeenCalledTimes(1);
      const values = collectValues(whereMock.mock.calls[0][0]);
      expect(values).toContain("clinicId");
      expect(values).toContain(CLINIC_ID);
    }
  });
});

describe("buildBoardResponsibles — failure paths (snapshot handler degrades to responsibles:null)", () => {
  // The snapshot handler wraps this call in withTimeout and maps ANY
  // rejection to `responsibles: null` — so each internal failure must
  // PROPAGATE as a rejection, never resolve to a half-built payload.
  it("rejects when the doctors query fails", async () => {
    mockSelect.mockReturnValueOnce(rejectingChain(new Error("doctors query down")));

    await expect(
      buildBoardResponsibles({ clinicId: CLINIC_ID, todayDate: TODAY, currentShift: [] }),
    ).rejects.toThrow("doctors query down");
  });

  it("rejects when resolveShiftCoordinator fails", async () => {
    mockSelect.mockReturnValueOnce(chainable([]));
    mockResolveShiftCoordinator.mockRejectedValue(new Error("coordinator resolver down"));

    await expect(
      buildBoardResponsibles({ clinicId: CLINIC_ID, todayDate: TODAY, currentShift: [] }),
    ).rejects.toThrow("coordinator resolver down");
  });

  it("rejects when the fallback coordinator-name user query fails", async () => {
    mockSelect
      .mockReturnValueOnce(chainable([]))
      .mockReturnValueOnce(rejectingChain(new Error("user lookup down")));
    mockResolveShiftCoordinator.mockResolvedValue({
      coordinatorUserId: "u-conf",
      status: "confirmed",
      candidates: [],
      seniorTechUserId: null,
    });

    await expect(
      buildBoardResponsibles({ clinicId: CLINIC_ID, todayDate: TODAY, currentShift: [] }),
    ).rejects.toThrow("user lookup down");
  });
});
