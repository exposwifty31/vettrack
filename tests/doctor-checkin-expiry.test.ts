/**
 * Unit tests for the doctor check-in auto-expiry sweep (doctor shift gate,
 * spec 2026-08-13). Mocked-db pattern from tests/stale-checkin-sweep.test.ts —
 * no Redis, no live server, no real database.
 *
 * The sweep is ONE clinic-agnostic UPDATE whose WHERE clause makes technician
 * rows (operationalRole NULL) and legacy-role vet rows untouchable by
 * construction: it filters operationalRole IN (icu, admission,
 * internal_medicine), open rows only, checkedInAt < now - 14h. The unit tests
 * assert that exact clause (a mocked db cannot execute SQL); row-level
 * behavior against a real database lands in the Task 14 integration test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { and, inArray, isNull, lt } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(),
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
  },
  users: {
    id: "id",
    clinicId: "clinicId",
  },
}));

vi.mock("../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../server/lib/authority-cache.js", () => ({ invalidateForUser: vi.fn() }));

import { clinicalCheckIns } from "../server/db.js";
import {
  sweepExpiredDoctorCheckIns,
  startDoctorCheckInExpiryWorker,
  DOCTOR_CHECKIN_EXPIRY_HOURS,
} from "../server/workers/doctorCheckInExpiryWorker.js";
import { DOCTOR_TEAM_ROLES } from "../server/services/clinical-check-in.js";

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

const NOW = new Date("2026-08-13T12:00:00.000Z");

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
  it("closes doctor rows past 14h with checkOutReason 'auto_expired' and returns closedCount", async () => {
    const chain = updateChain([
      { id: "ci-1", clinicId: "clinic-1" },
      { id: "ci-2", clinicId: "clinic-2" },
    ]);
    mockUpdate.mockReturnValue(chain);

    const result = await sweepExpiredDoctorCheckIns(NOW);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(clinicalCheckIns);
    expect(chain.set).toHaveBeenCalledWith({
      checkedOutAt: NOW,
      checkOutReason: "auto_expired",
    });
    expect(result.closedCount).toBe(2);
  });

  it("returns closedCount 0 when no rows match", async () => {
    mockUpdate.mockReturnValue(updateChain([]));
    const result = await sweepExpiredDoctorCheckIns(NOW);
    expect(result.closedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. WHERE clause — the safety contract
// ---------------------------------------------------------------------------

describe("sweepExpiredDoctorCheckIns — WHERE clause contract", () => {
  it("targets EXACTLY open doctor-team rows older than the 14h cutoff (technician/legacy rows untouchable by construction; a 13h doctor row is younger than the cutoff)", async () => {
    const chain = updateChain([]);
    mockUpdate.mockReturnValue(chain);

    await sweepExpiredDoctorCheckIns(NOW);

    const whereArg = vi.mocked(chain.where as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const expectedCutoff = new Date(NOW.getTime() - 14 * 3_600_000);
    const expected = and(
      isNull(clinicalCheckIns.checkedOutAt),
      inArray(clinicalCheckIns.operationalRole, [...DOCTOR_TEAM_ROLES]),
      lt(clinicalCheckIns.checkedInAt, expectedCutoff),
    );
    expect(whereArg).toEqual(expected);
  });

  it("filters on the three doctor team roles only (icu, admission, internal_medicine)", async () => {
    const chain = updateChain([]);
    mockUpdate.mockReturnValue(chain);

    await sweepExpiredDoctorCheckIns(NOW);

    const whereArg = vi.mocked(chain.where as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const strings = collectStrings(whereArg);
    expect(strings).toContain("icu");
    expect(strings).toContain("admission");
    expect(strings).toContain("internal_medicine");
    // No legacy roles are ever swept.
    expect(strings).not.toContain("ward");
    expect(strings).not.toContain("senior_lead");
  });

  it("does NOT filter on isSenior — senior rows auto-expire the same way", async () => {
    const chain = updateChain([]);
    mockUpdate.mockReturnValue(chain);

    await sweepExpiredDoctorCheckIns(NOW);

    const whereArg = vi.mocked(chain.where as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(collectStrings(whereArg)).not.toContain("isSenior");
  });
});

// ---------------------------------------------------------------------------
// 4. Scheduler — hourly interval, guarded failures
// ---------------------------------------------------------------------------

describe("startDoctorCheckInExpiryWorker — interval scheduler", () => {
  it("runs an immediate sweep on start, then hourly", async () => {
    vi.useFakeTimers();
    mockUpdate.mockImplementation(() => updateChain([]));

    startDoctorCheckInExpiryWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockUpdate).toHaveBeenCalledTimes(1); // immediate boot sweep

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockUpdate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockUpdate).toHaveBeenCalledTimes(3);
  });

  it("a sweep failure is caught and logged — the interval survives", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpdate.mockImplementation(() => {
      throw new Error("db down");
    });

    startDoctorCheckInExpiryWorker();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Two failed sweeps (boot + first tick) — both caught, none unhandled.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(
      errorSpy.mock.calls.some(
        ([msg]) => typeof msg === "string" && msg.includes("[doctor-checkin-expiry]"),
      ),
    ).toBe(true);

    // Interval keeps ticking after failures.
    mockUpdate.mockImplementation(() => updateChain([]));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockUpdate).toHaveBeenCalledTimes(3);

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

  it("imports DOCTOR_TEAM_ROLES from the check-in service (no hand-rolled role list)", () => {
    expect(source).toMatch(/import\s*\{[^}]*DOCTOR_TEAM_ROLES[^}]*\}\s*from\s*"\.\.\/services\/clinical-check-in\.js"/);
  });

  it("does not import the shadow-only staleCheckInSweepWorker", () => {
    expect(source).not.toMatch(/from\s*"[^"]*staleCheckInSweepWorker/);
  });

  it("does not call closeCheckIn (single direct UPDATE by design)", () => {
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
