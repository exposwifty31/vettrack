/**
 * Unit tests for the doctor check-in auto-expiry sweep (doctor shift gate,
 * spec 2026-08-13). Mocked-db pattern from tests/stale-checkin-sweep.test.ts —
 * no Redis, no live server, no real database.
 *
 * The sweep enumerates the clinics holding expired doctor rows (a distinct
 * SELECT), then closes each clinic's rows with a clinic-scoped UPDATE (repo
 * rule: every query filters by clinicId). Both WHERE clauses target rows by
 * the IMMUTABLE `check_in_source` column (migration 184): open rows only,
 * checkedInAt < now - 14h, check_in_source = 'doctor_gate'. Classification
 * happens once at insert in the check-in service — the sweep never consults
 * the mutable users.allowedOperationalRoles. The unit tests assert those
 * exact clauses (a mocked db cannot execute SQL); row-level behavior against
 * a real database lands in the Task 14 integration test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { and, eq, isNull, lt } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { mockUpdate, mockSelectDistinct } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSelectDistinct: vi.fn(),
}));

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(),
    selectDistinct: mockSelectDistinct,
    insert: vi.fn(),
    update: mockUpdate,
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  clinicalCheckIns: {
    id: "id",
    clinicId: "clinicId",
    userId: "userId",
    checkedInAt: "checkedInAt",
    checkedOutAt: "checkedOutAt",
    operationalRole: "operationalRole",
    isSenior: "isSenior",
    checkOutReason: "checkOutReason",
    checkInSource: "checkInSource",
  },
  users: {
    id: "id",
    clinicId: "clinicId",
    allowedOperationalRoles: "allowedOperationalRoles",
  },
}));

vi.mock("../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../server/lib/authority-cache.js", () => ({ invalidateForUser: vi.fn() }));

import { clinicalCheckIns } from "../server/db.js";
import { logAudit } from "../server/lib/audit.js";
import { invalidateForUser } from "../server/lib/authority-cache.js";
import {
  sweepExpiredDoctorCheckIns,
  startDoctorCheckInExpiryWorker,
  DOCTOR_CHECKIN_EXPIRY_HOURS,
} from "../server/workers/doctorCheckInExpiryWorker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateChain(returningRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["set", "where"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["returning"] = vi.fn().mockResolvedValue(returningRows);
  return chain;
}

function selectDistinctChain(clinicRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain["from"] = vi.fn().mockReturnValue(chain);
  chain["where"] = vi.fn().mockResolvedValue(clinicRows);
  return chain;
}

/**
 * Shared sweep-mock setup: the candidate SELECT enumerates the clinics in
 * `closedByClinic` (insertion order) and each clinic's UPDATE chain returns
 * its rows.
 */
function mockSweep(closedByClinic: Record<string, unknown[]> = {}) {
  const clinicIds = Object.keys(closedByClinic);
  const selectChain = selectDistinctChain(clinicIds.map((clinicId) => ({ clinicId })));
  mockSelectDistinct.mockReturnValue(selectChain);
  const updateChains = clinicIds.map((clinicId) => updateChain(closedByClinic[clinicId]));
  for (const chain of updateChains) {
    mockUpdate.mockReturnValueOnce(chain);
  }
  return { selectChain, updateChains };
}

/** Recursively collect every string value inside an object graph (cycle-safe). */
function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const out: string[] = [];
  for (const v of Object.values(value as Record<string, unknown>)) {
    out.push(...collectStrings(v, seen));
  }
  return out;
}

/** The WHERE argument passed to a chain's `.where` mock. */
function whereArg(chain: Record<string, unknown>) {
  return vi.mocked(chain.where as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

const NOW = new Date("2026-08-13T12:00:00.000Z");

/** The predicate shared by the candidate SELECT and every per-clinic UPDATE. */
function expectedExpiredPredicate(now: Date) {
  const cutoff = new Date(now.getTime() - DOCTOR_CHECKIN_EXPIRY_HOURS * 3_600_000);
  return and(
    isNull(clinicalCheckIns.checkedOutAt),
    lt(clinicalCheckIns.checkedInAt, cutoff),
    eq(clinicalCheckIns.checkInSource, "doctor_gate"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Threshold constant
// ---------------------------------------------------------------------------

describe("DOCTOR_CHECKIN_EXPIRY_HOURS", () => {
  it("is 14 hours (spec-fixed)", () => {
    expect(DOCTOR_CHECKIN_EXPIRY_HOURS).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// 2. Sweep — set payload + closedCount
// ---------------------------------------------------------------------------

describe("sweepExpiredDoctorCheckIns — closes expired doctor rows", () => {
  it("closes doctor rows past 14h per clinic with checkOutReason 'auto_expired' and returns the aggregate closedCount", async () => {
    const { updateChains } = mockSweep({
      "clinic-1": [{ id: "ci-1", clinicId: "clinic-1" }],
      "clinic-2": [{ id: "ci-2", clinicId: "clinic-2" }],
    });

    const result = await sweepExpiredDoctorCheckIns(NOW);

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith(clinicalCheckIns);
    for (const chain of updateChains) {
      expect(chain.set).toHaveBeenCalledWith({
        checkedOutAt: NOW,
        checkOutReason: "auto_expired",
      });
    }
    expect(result.closedCount).toBe(2);
  });

  it("returns closedCount 0 and issues NO update when no clinic has expired rows", async () => {
    mockSweep({});
    const result = await sweepExpiredDoctorCheckIns(NOW);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.closedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. WHERE clauses — the safety contract
// ---------------------------------------------------------------------------

describe("sweepExpiredDoctorCheckIns — WHERE clause contract", () => {
  it("candidate SELECT targets EXACTLY open rows older than the 14h cutoff whose PERSISTED check_in_source is 'doctor_gate' (classified once at insert — migration 184)", async () => {
    const { selectChain } = mockSweep({});

    await sweepExpiredDoctorCheckIns(NOW);

    expect(whereArg(selectChain)).toEqual(expectedExpiredPredicate(NOW));
  });

  it("every per-clinic UPDATE carries the clinicId predicate AND the full expiry predicate (repo rule: every query filters by clinicId)", async () => {
    const { updateChains } = mockSweep({ "clinic-1": [], "clinic-2": [] });

    await sweepExpiredDoctorCheckIns(NOW);

    expect(whereArg(updateChains[0])).toEqual(
      and(eq(clinicalCheckIns.clinicId, "clinic-1"), expectedExpiredPredicate(NOW)),
    );
    expect(whereArg(updateChains[1])).toEqual(
      and(eq(clinicalCheckIns.clinicId, "clinic-2"), expectedExpiredPredicate(NOW)),
    );
  });

  it("never consults the LIVE allowlist — no users probe, no role list in the WHERE (legacy rows are untouchable via check_in_source='legacy')", async () => {
    const { selectChain, updateChains } = mockSweep({ "clinic-1": [] });

    await sweepExpiredDoctorCheckIns(NOW);

    for (const chain of [selectChain, ...updateChains]) {
      const strings = collectStrings(whereArg(chain));
      expect(strings).toContain("checkInSource");
      expect(strings).toContain("doctor_gate");
      expect(strings).not.toContain("allowedOperationalRoles");
      expect(strings.join(" ")).not.toContain("NOT EXISTS");
      // Role values must not appear — origin is the persisted column, not the role.
      for (const role of ["icu", "admission", "internal_medicine", "ward", "senior_lead"]) {
        expect(strings).not.toContain(role);
      }
    }
  });

  it("does NOT filter on isSenior — senior rows auto-expire the same way", async () => {
    const { selectChain, updateChains } = mockSweep({ "clinic-1": [] });

    await sweepExpiredDoctorCheckIns(NOW);

    expect(collectStrings(whereArg(selectChain))).not.toContain("isSenior");
    expect(collectStrings(whereArg(updateChains[0]))).not.toContain("isSenior");
  });
});

// ---------------------------------------------------------------------------
// 3b. Per-row close side effects — cache invalidation + audit (review findings)
// ---------------------------------------------------------------------------

describe("sweepExpiredDoctorCheckIns — per-row invalidation + audit", () => {
  const closedByClinic = {
    "clinic-1": [
      { id: "ci-1", clinicId: "clinic-1", userId: "user-1", operationalRole: "icu" },
    ],
    "clinic-2": [
      { id: "ci-2", clinicId: "clinic-2", userId: "user-2", operationalRole: "admission" },
    ],
  };

  it("invalidates the authority cache per closed row (writer-side invalidation contract)", async () => {
    mockSweep(closedByClinic);

    await sweepExpiredDoctorCheckIns(NOW);

    expect(invalidateForUser).toHaveBeenCalledTimes(2);
    expect(invalidateForUser).toHaveBeenCalledWith("clinic-1", "user-1");
    expect(invalidateForUser).toHaveBeenCalledWith("clinic-2", "user-2");
  });

  it("writes a clinical_check_out audit row per closed row with source 'auto_expired' (system actor)", async () => {
    mockSweep(closedByClinic);

    await sweepExpiredDoctorCheckIns(NOW);

    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        actionType: "clinical_check_out",
        performedBy: "system:doctor_checkin_expiry",
        performedByEmail: "system",
        targetId: "ci-1",
        targetType: "clinical_check_in",
        metadata: expect.objectContaining({
          checkInId: "ci-1",
          userId: "user-1",
          operationalRole: "icu",
          source: "auto_expired",
        }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-2",
        targetId: "ci-2",
        metadata: expect.objectContaining({ source: "auto_expired" }),
      }),
    );
  });

  it("no rows closed → no invalidation, no audit", async () => {
    mockSweep({});

    await sweepExpiredDoctorCheckIns(NOW);

    expect(invalidateForUser).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Scheduler — hourly interval, guarded failures
// ---------------------------------------------------------------------------

describe("startDoctorCheckInExpiryWorker — interval scheduler", () => {
  it("runs an immediate sweep on start, then hourly", async () => {
    vi.useFakeTimers();
    mockSelectDistinct.mockImplementation(() => selectDistinctChain([]));

    startDoctorCheckInExpiryWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSelectDistinct).toHaveBeenCalledTimes(1); // immediate boot sweep

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockSelectDistinct).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockSelectDistinct).toHaveBeenCalledTimes(3);
  });

  it("a sweep failure is caught and logged — the interval survives", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSelectDistinct.mockImplementation(() => {
      throw new Error("db down");
    });

    startDoctorCheckInExpiryWorker();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Two failed sweeps (boot + first tick) — both caught, none unhandled.
    expect(mockSelectDistinct).toHaveBeenCalledTimes(2);
    expect(
      errorSpy.mock.calls.some(
        ([msg]) => typeof msg === "string" && msg.includes("[doctor-checkin-expiry]"),
      ),
    ).toBe(true);

    // Interval keeps ticking after failures.
    mockSelectDistinct.mockImplementation(() => selectDistinctChain([]));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockSelectDistinct).toHaveBeenCalledTimes(3);

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. Source-level contract — separate worker, shadow sweep untouched
// ---------------------------------------------------------------------------

describe("Worker source — separation contract", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../server/workers/doctorCheckInExpiryWorker.ts"),
    "utf8",
  );

  it("filters by the persisted checkInSource, never the mutable allowlist", () => {
    expect(source).toMatch(/clinicalCheckIns\.checkInSource/);
    // No live-allowlist probe: no users import, no NOT EXISTS / jsonb containment.
    expect(source).not.toMatch(/import[^;]*\busers\b[^;]*from/);
    expect(source).not.toMatch(/NOT EXISTS/);
    expect(source).not.toMatch(/@>/);
  });

  it("scopes every close UPDATE by clinicId (repo rule: every query filters by clinicId)", () => {
    expect(source).toMatch(/eq\(clinicalCheckIns\.clinicId, clinicId\)/);
  });

  it("does not import the shadow-only staleCheckInSweepWorker", () => {
    expect(source).not.toMatch(/from\s*"[^"]*staleCheckInSweepWorker/);
  });

  it("does not call closeCheckIn (clinic-scoped direct UPDATEs by design)", () => {
    expect(source).not.toMatch(/closeCheckIn/);
  });

  it("the shadow-only staleCheckInSweepWorker source is untouched by this feature (still no db.update)", () => {
    const shadowSource = fs.readFileSync(
      path.resolve(__dirname, "../server/workers/staleCheckInSweepWorker.ts"),
      "utf8",
    );
    expect(shadowSource).not.toMatch(/\bdb\.update\(/);
    expect(shadowSource).not.toMatch(/auto_expired/);
  });
});
