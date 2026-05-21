/**
 * Phase 2.5 PR 6 — Authority cache wrapper tests.
 *
 * Tests the read-through wrappers (`getOpenClinicalCheckInCached`,
 * `resolveCurrentRoleCached`) and the inflight coalescing layer.
 *
 * No DB. The underlying `getOpenClinicalCheckIn` and `resolveCurrentRole`
 * are mocked via `vi.mock` with `importOriginal` to preserve
 * `clinicTodayIsoDate` (used by the cache wrapper for dayBucket derivation).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import type {
  OpenClinicalCheckInRow,
} from "../../server/lib/check-in-resolution.js";
import type {
  RoleResolutionInput,
  RoleResolutionResult,
} from "../../server/lib/role-resolution.js";
import { getMetricsSnapshot, resetMetrics } from "../../server/lib/metrics.js";

const getOpenClinicalCheckInMock = vi.fn<
  (input: unknown) => Promise<OpenClinicalCheckInRow | null>
>();
const resolveCurrentRoleMock = vi.fn<
  (input: unknown) => Promise<RoleResolutionResult>
>();

vi.mock("../../server/lib/check-in-resolution.js", () => ({
  getOpenClinicalCheckIn: (input: unknown) => getOpenClinicalCheckInMock(input),
}));

vi.mock("../../server/lib/role-resolution.js", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../server/lib/role-resolution.js")
  >();
  return {
    ...original,
    resolveCurrentRole: (input: unknown) => resolveCurrentRoleMock(input),
  };
});

vi.mock("../../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
  clinicalCheckIns: {},
}));

vi.mock("../../server/lib/clinic-timezone.js", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../server/lib/clinic-timezone.js")
  >();
  return {
    ...original,
    getClinicTimezone: vi.fn().mockResolvedValue("Asia/Jerusalem"),
  };
});

// Imported AFTER vi.mock so the module receives mocked dependencies.
const {
  getOpenClinicalCheckInCached,
  resolveCurrentRoleCached,
  invalidateForUser,
  invalidateClinicShift,
  __resetAuthorityCacheForTests,
  __internals,
} = await import("../../server/lib/authority-cache.js");

const baseRow: OpenClinicalCheckInRow = {
  id: "checkin-1",
  clinicId: "clinic-a",
  userId: "user-1",
  clinicalRoleAtCheckIn: "technician",
  operationalRole: "ward",
  checkedInAt: new Date("2026-05-14T08:00:00.000Z"),
};

function makeResult(overrides: Partial<RoleResolutionResult> = {}): RoleResolutionResult {
  return {
    effectiveRole: "technician",
    permanentRole: "technician",
    source: "permanent",
    activeShift: null,
    resolvedAt: new Date("2026-05-14T08:00:00.000Z"),
    ...overrides,
  };
}

const baseShiftInput: RoleResolutionInput = {
  clinicId: "clinic-a",
  userId: "user-1",
  userName: "Tech User",
  fallbackRole: "technician",
  secondaryRole: null,
  now: new Date("2026-05-14T08:00:00.000Z"),
};

beforeEach(() => {
  __resetAuthorityCacheForTests();
  resetMetrics();
  getOpenClinicalCheckInMock.mockReset();
  resolveCurrentRoleMock.mockReset();
  delete process.env.AUTHORITY_CACHE_V1;
});

afterEach(() => {
  delete process.env.AUTHORITY_CACHE_V1;
});

// ─── Cache-off (flag default) ───────────────────────────────────────────────
describe("flag-off behavior (test #1, #15)", () => {
  it("byte-identical pass-through when AUTHORITY_CACHE_V1 is unset (check-in)", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    const result = await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    expect(result).toBe(baseRow);
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(1);

    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.disabled).toBe(1);
    expect(snap.authority.cache.checkInHit).toBe(0);
    expect(snap.authority.cache.checkInMiss).toBe(0);
  });

  it("byte-identical pass-through when AUTHORITY_CACHE_V1 is unset (shift)", async () => {
    const expected = makeResult();
    resolveCurrentRoleMock.mockResolvedValue(expected);
    const result = await resolveCurrentRoleCached(baseShiftInput);
    expect(result).toBe(expected);
    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(1);

    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.disabled).toBe(1);
  });

  it("flag explicitly set to false short-circuits identically", async () => {
    process.env.AUTHORITY_CACHE_V1 = "false";
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    await getOpenClinicalCheckInCached({ clinicId: "c", userId: "u" });
    expect(__internals.checkInCache.size()).toBe(0);
    expect(__internals.checkInInflight.size).toBe(0);
  });

  it("cache-off: must NOT touch cache map, inflight map, or construct keys", async () => {
    // Wrap the internal maps with proxies that throw on access.
    const checkInGetSpy = vi.spyOn(__internals.checkInCache, "get");
    const checkInSetSpy = vi.spyOn(__internals.checkInCache, "set");
    const shiftGetSpy = vi.spyOn(__internals.shiftCache, "get");
    const shiftSetSpy = vi.spyOn(__internals.shiftCache, "set");

    getOpenClinicalCheckInMock.mockResolvedValue(null);
    resolveCurrentRoleMock.mockResolvedValue(makeResult());

    await getOpenClinicalCheckInCached({ clinicId: "c", userId: "u" });
    await resolveCurrentRoleCached(baseShiftInput);

    expect(checkInGetSpy).not.toHaveBeenCalled();
    expect(checkInSetSpy).not.toHaveBeenCalled();
    expect(shiftGetSpy).not.toHaveBeenCalled();
    expect(shiftSetSpy).not.toHaveBeenCalled();
  });
});

// ─── Cache-on basic accounting ──────────────────────────────────────────────
describe("hit/miss accounting (test #2)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CACHE_V1 = "true";
  });

  it("first call is a miss, second is a hit (check-in)", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    const a = await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    const b = await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    expect(a).toBe(baseRow);
    expect(b).toBe(baseRow);
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(1);

    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.checkInMiss).toBe(1);
    expect(snap.authority.cache.checkInHit).toBe(1);
  });

  it("first call is a miss, second is a hit (shift)", async () => {
    resolveCurrentRoleMock.mockResolvedValue(makeResult());
    await resolveCurrentRoleCached(baseShiftInput);
    await resolveCurrentRoleCached(baseShiftInput);
    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(1);

    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.shiftMiss).toBe(1);
    expect(snap.authority.cache.shiftHit).toBe(1);
  });
});

// ─── Negative caching ───────────────────────────────────────────────────────
describe("negative caching (test #3)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CACHE_V1 = "true";
  });

  it("null result caches as NONE; second call hits without DB", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(null);
    const a = await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    const b = await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(1);

    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.checkInMiss).toBe(1);
    expect(snap.authority.cache.checkInHit).toBe(1);
  });
});

// ─── TTL expiry ─────────────────────────────────────────────────────────────
describe("TTL expiry (test #4)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CACHE_V1 = "true";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("check-in cache expires after 30s", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    vi.advanceTimersByTime(29_999);
    await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(2);
  });

  it("shift cache expires after 60s", async () => {
    resolveCurrentRoleMock.mockResolvedValue(makeResult());
    await resolveCurrentRoleCached(baseShiftInput);
    vi.advanceTimersByTime(59_999);
    await resolveCurrentRoleCached(baseShiftInput);
    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await resolveCurrentRoleCached(baseShiftInput);
    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(2);
  });
});

// ─── Day-bucket boundary ────────────────────────────────────────────────────
describe("day-bucket boundary (test #13)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CACHE_V1 = "true";
  });

  it("two requests across clinic-local midnight produce distinct cache entries", async () => {
    resolveCurrentRoleMock.mockResolvedValue(makeResult());

    const { clinicTodayIsoDate } = await import("../../server/lib/clinic-timezone.js");
    const tz = "Asia/Jerusalem";
    const before = new Date("2026-01-15T21:59:00.000Z");
    const after = new Date("2026-01-15T22:01:00.000Z");
    expect(clinicTodayIsoDate(tz, before)).not.toBe(clinicTodayIsoDate(tz, after));

    await resolveCurrentRoleCached({ ...baseShiftInput, now: before });
    await resolveCurrentRoleCached({ ...baseShiftInput, now: after });
    // Two distinct day buckets → two underlying calls.
    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(2);
  });
});

// ─── fallbackRole key isolation (test #25, LOAD-BEARING) ────────────────────
describe("fallbackRole key isolation (test #25)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CACHE_V1 = "true";
  });

  it("same (clinicId,userId,dayBucket) with different fallbackRole → distinct entries", async () => {
    resolveCurrentRoleMock.mockImplementation((input: unknown) =>
      Promise.resolve(
        makeResult({
          permanentRole: (input as RoleResolutionInput).fallbackRole,
          effectiveRole: (input as RoleResolutionInput).fallbackRole,
        }),
      ),
    );

    const techInput: RoleResolutionInput = { ...baseShiftInput, fallbackRole: "technician" };
    const vetInput: RoleResolutionInput = { ...baseShiftInput, fallbackRole: "vet" };

    const a = await resolveCurrentRoleCached(techInput);
    const b = await resolveCurrentRoleCached(vetInput);
    expect(a.permanentRole).toBe("technician");
    expect(b.permanentRole).toBe("vet");
    // Two distinct keys → two underlying calls.
    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(2);

    // Verify the keys are distinct via the internals helper.
    const keyTech = await __internals.shiftKey(techInput, techInput.now!);
    const keyVet = await __internals.shiftKey(vetInput, vetInput.now!);
    expect(keyTech).not.toBe(keyVet);

    // Repeat identical calls — both hit cache independently.
    const a2 = await resolveCurrentRoleCached(techInput);
    const b2 = await resolveCurrentRoleCached(vetInput);
    expect(a2.permanentRole).toBe("technician");
    expect(b2.permanentRole).toBe("vet");
    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(2);

    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.shiftMiss).toBe(2);
    expect(snap.authority.cache.shiftHit).toBe(2);
  });
});

// ─── Cache get/set failure fallback (test #17) ──────────────────────────────
describe("cache get/set failure fallback (test #17)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CACHE_V1 = "true";
  });

  it("cache.get throwing falls back to underlying lookup", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    vi.spyOn(__internals.checkInCache, "get").mockImplementationOnce(() => {
      throw new Error("get boom");
    });
    const result = await getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    expect(result).toBe(baseRow);
    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.errorGet).toBe(1);
  });

  it("invalidate failure bumps invalidate_error counter without throwing", () => {
    vi.spyOn(__internals.checkInCache, "invalidate").mockImplementationOnce(() => {
      throw new Error("invalidate boom");
    });
    expect(() => invalidateForUser("clinic-a", "user-1")).not.toThrow();
    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.invalidateError).toBeGreaterThanOrEqual(1);
  });
});

// ─── Inflight coalescing (tests #18–24) ────────────────────────────────────
describe("inflight coalescing", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CACHE_V1 = "true";
  });

  it("100 concurrent misses collapse to 1 DB call (test #18)", async () => {
    let resolveFn: ((row: OpenClinicalCheckInRow | null) => void) | null = null;
    getOpenClinicalCheckInMock.mockImplementation(
      () =>
        new Promise<OpenClinicalCheckInRow | null>((r) => {
          resolveFn = r;
        }),
    );

    const promises: Promise<OpenClinicalCheckInRow | null>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        getOpenClinicalCheckInCached({ clinicId: "c", userId: "u" }),
      );
    }
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(1);
    resolveFn!(baseRow);
    const results = await Promise.all(promises);
    expect(results.every((r) => r === baseRow)).toBe(true);

    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.checkInMiss).toBe(1);
    expect(snap.authority.cache.inflightHit).toBe(99);
  });

  it("concurrent rejection: all see same error, cache NOT populated (test #19)", async () => {
    let rejectFn: ((err: Error) => void) | null = null;
    getOpenClinicalCheckInMock.mockImplementationOnce(
      () =>
        new Promise<OpenClinicalCheckInRow | null>((_, rej) => {
          rejectFn = rej;
        }),
    );

    const promises: Promise<OpenClinicalCheckInRow | null>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        getOpenClinicalCheckInCached({ clinicId: "c", userId: "u" }).catch(
          (e) => {
            throw e;
          },
        ),
      );
    }
    const sentinel = new Error("db fault");
    rejectFn!(sentinel);
    await Promise.all(
      promises.map((p) => p.catch((e) => expect(e).toBe(sentinel))),
    );

    // Cache must NOT be populated.
    expect(__internals.checkInCache.size()).toBe(0);

    // Next call retries, issues a new DB call.
    getOpenClinicalCheckInMock.mockResolvedValueOnce(baseRow);
    const retry = await getOpenClinicalCheckInCached({
      clinicId: "c",
      userId: "u",
    });
    expect(retry).toBe(baseRow);
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(2);
  });

  it("invalidation during inflight prevents stale repopulation (test #20)", async () => {
    let resolveFn: ((row: OpenClinicalCheckInRow | null) => void) | null = null;
    getOpenClinicalCheckInMock.mockImplementationOnce(
      () =>
        new Promise<OpenClinicalCheckInRow | null>((r) => {
          resolveFn = r;
        }),
    );

    const p = getOpenClinicalCheckInCached({
      clinicId: "clinic-a",
      userId: "user-1",
    });
    // Invalidate while the underlying call is mid-flight.
    invalidateForUser("clinic-a", "user-1");
    resolveFn!(baseRow);
    await p;

    // The cache must be empty — stale write was dropped.
    expect(__internals.checkInCache.size()).toBe(0);
    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.staleWriteDropped).toBeGreaterThanOrEqual(1);
  });

  it("inflight map is cleared after resolve (test #21)", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    await getOpenClinicalCheckInCached({ clinicId: "c", userId: "u" });
    expect(__internals.checkInInflight.size).toBe(0);
  });

  it("inflight map is cleared after reject (test #22)", async () => {
    getOpenClinicalCheckInMock.mockRejectedValueOnce(new Error("nope"));
    await expect(
      getOpenClinicalCheckInCached({ clinicId: "c", userId: "u" }),
    ).rejects.toThrow("nope");
    expect(__internals.checkInInflight.size).toBe(0);
  });

  it("negative-cache inflight collapse (test #23)", async () => {
    let resolveFn: ((row: OpenClinicalCheckInRow | null) => void) | null = null;
    getOpenClinicalCheckInMock.mockImplementationOnce(
      () =>
        new Promise<OpenClinicalCheckInRow | null>((r) => {
          resolveFn = r;
        }),
    );

    const promises: Promise<OpenClinicalCheckInRow | null>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        getOpenClinicalCheckInCached({ clinicId: "c", userId: "u" }),
      );
    }
    resolveFn!(null);
    const results = await Promise.all(promises);
    expect(results.every((r) => r === null)).toBe(true);
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(1);
  });

  it("separate keys do not share inflight state (test #24)", async () => {
    let r1: ((row: OpenClinicalCheckInRow | null) => void) | null = null;
    let r2: ((row: OpenClinicalCheckInRow | null) => void) | null = null;
    getOpenClinicalCheckInMock.mockImplementationOnce(
      () => new Promise<OpenClinicalCheckInRow | null>((res) => (r1 = res)),
    );
    getOpenClinicalCheckInMock.mockImplementationOnce(
      () => new Promise<OpenClinicalCheckInRow | null>((res) => (r2 = res)),
    );

    const pA = getOpenClinicalCheckInCached({ clinicId: "c", userId: "u-A" });
    const pB = getOpenClinicalCheckInCached({ clinicId: "c", userId: "u-B" });
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(2);
    r1!(baseRow);
    r2!(null);
    expect(await pA).toBe(baseRow);
    expect(await pB).toBeNull();
  });
});
