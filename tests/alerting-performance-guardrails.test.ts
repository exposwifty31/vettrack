import { describe, it, expect, afterAll } from "vitest";
import {
  evaluateAlerts,
  getAlertEngineSnapshot,
  resetAlertEngineForTests,
} from "../server/lib/alert-engine.js";
import {
  getAccessDeniedMetricsWindowSnapshot,
  recordAccessDenied,
  resetAccessDeniedMetricsWindow,
} from "../server/lib/access-denied.js";
import { createLogLimiter } from "../server/lib/log-safety.js";
import {
  runSystemWatchdogTick,
  stopSystemWatchdogForTests,
} from "../server/lib/system-watchdog.js";

type FakeRequest = {
  originalUrl: string;
  path: string;
  method: string;
  clinicId?: string | null;
  authUser?: { id?: string | null };
};

function makeReq(): FakeRequest {
  return {
    originalUrl: "/api/equipment",
    path: "/api/equipment",
    method: "GET",
    clinicId: "clinic_1",
    authUser: { id: "user_1" },
  };
}

afterAll(() => {
  stopSystemWatchdogForTests();
});

describe("Access Denied Spike Alert", () => {
  it("should trigger ACCESS_DENIED_SPIKE", async () => {
    resetAlertEngineForTests();
    resetAccessDeniedMetricsWindow();
    const req = makeReq();
    for (let i = 0; i < 12; i += 1) {
      recordAccessDenied({
        req: req as never,
        reason: "TENANT_MISMATCH",
        statusCode: 403,
        source: "test",
      });
    }

    await evaluateAlerts({
      thresholds: { accessDeniedPerMinute: 10 },
      dataIntegrityChecker: async () => ({
        status: "ok",
        totals: { nullClinicIdRows: 0, crossTenantMismatches: 0, orphanRelations: 0 },
      }),
    });

    const snapshot = getAlertEngineSnapshot();
    expect(snapshot.counts.ACCESS_DENIED_SPIKE).toBe(1);
  });
});

describe("Data Corruption Alert", () => {
  it("should trigger DATA_CORRUPTION alert", async () => {
    resetAlertEngineForTests();
    resetAccessDeniedMetricsWindow();

    await evaluateAlerts({
      thresholds: { accessDeniedPerMinute: 9999 },
      dataIntegrityChecker: async () => ({
        status: "degraded",
        totals: { nullClinicIdRows: 1, crossTenantMismatches: 0, orphanRelations: 2 },
      }),
    });

    const snapshot = getAlertEngineSnapshot();
    expect(snapshot.counts.DATA_CORRUPTION).toBe(1);
  });

  it("should not alert when only orphanRelations are present (status ok)", async () => {
    resetAlertEngineForTests();
    resetAccessDeniedMetricsWindow();

    await evaluateAlerts({
      thresholds: { accessDeniedPerMinute: 9999 },
      dataIntegrityChecker: async () => ({
        status: "ok",
        totals: { nullClinicIdRows: 0, crossTenantMismatches: 0, orphanRelations: 3540 },
      }),
    });

    const snapshot = getAlertEngineSnapshot();
    expect(snapshot.counts.DATA_CORRUPTION).toBe(0);
    expect(snapshot.isDegraded).toBe(false);
  });

  it("should mark system degraded for critical corruption", async () => {
    resetAlertEngineForTests();
    resetAccessDeniedMetricsWindow();

    await evaluateAlerts({
      thresholds: { accessDeniedPerMinute: 9999 },
      dataIntegrityChecker: async () => ({
        status: "degraded",
        totals: { nullClinicIdRows: 1, crossTenantMismatches: 0, orphanRelations: 2 },
      }),
    });

    const snapshot = getAlertEngineSnapshot();
    expect(snapshot.isDegraded).toBe(true);
  });
});

describe("Watchdog No Overlap", () => {
  it("first watchdog tick should run", async () => {
    stopSystemWatchdogForTests();
    let runs = 0;
    const runChecks = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
    };

    const first = runSystemWatchdogTick({ runChecks, timeoutMs: 500 });
    const second = runSystemWatchdogTick({ runChecks, timeoutMs: 500 });
    const [firstResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(true);
  });

  it("second overlapping watchdog tick should be skipped", async () => {
    stopSystemWatchdogForTests();
    let runs = 0;
    const runChecks = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
    };

    const first = runSystemWatchdogTick({ runChecks, timeoutMs: 500 });
    const second = runSystemWatchdogTick({ runChecks, timeoutMs: 500 });
    const [, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toBe(false);
  });

  it("watchdog should execute checks only once", async () => {
    stopSystemWatchdogForTests();
    let runs = 0;
    const runChecks = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
    };

    const first = runSystemWatchdogTick({ runChecks, timeoutMs: 500 });
    const second = runSystemWatchdogTick({ runChecks, timeoutMs: 500 });
    await Promise.all([first, second]);
    expect(runs).toBe(1);
  });
});

describe("Metrics Reset", () => {
  it("window metrics should include the recorded event", () => {
    resetAccessDeniedMetricsWindow();
    const req = makeReq();
    recordAccessDenied({
      req: req as never,
      reason: "MISSING_CLINIC_ID",
      statusCode: 403,
      source: "test",
    });
    const beforeReset = getAccessDeniedMetricsWindowSnapshot();
    expect(beforeReset.MISSING_CLINIC_ID).toBe(1);
  });

  it("window metrics should reset to zero", () => {
    resetAccessDeniedMetricsWindow();
    const req = makeReq();
    recordAccessDenied({
      req: req as never,
      reason: "MISSING_CLINIC_ID",
      statusCode: 403,
      source: "test",
    });
    resetAccessDeniedMetricsWindow();
    const afterReset = getAccessDeniedMetricsWindowSnapshot();
    expect(afterReset.MISSING_CLINIC_ID).toBe(0);
  });
});

describe("Record Access Denied Without Headers", () => {
  it("recordAccessDenied should handle requests without headers and still count metrics", () => {
    resetAccessDeniedMetricsWindow();
    const req = makeReq();
    recordAccessDenied({
      req: req as never,
      reason: "TENANT_CONTEXT_MISSING",
      statusCode: 403,
      source: "test",
    });
    const snapshot = getAccessDeniedMetricsWindowSnapshot();
    expect(snapshot.TENANT_CONTEXT_MISSING).toBe(1);
  });
});

describe("Log Explosion Protection", () => {
  it("repeated identical logs should be deduplicated", () => {
    const limiter = createLogLimiter({ dedupeWindowMs: 10_000, sampleRate: 1, maxEntries: 5 });
    let allowed = 0;
    for (let i = 0; i < 50; i += 1) {
      if (limiter.shouldLog("same-error-key")) {
        allowed += 1;
      }
    }
    expect(allowed).toBe(1);
  });

  it("suppressed logs count should increase", () => {
    const limiter = createLogLimiter({ dedupeWindowMs: 10_000, sampleRate: 1, maxEntries: 5 });
    for (let i = 0; i < 50; i += 1) {
      limiter.shouldLog("same-error-key");
    }
    const snapshot = limiter.getSnapshot();
    expect(snapshot.suppressedLogs >= 49).toBeTruthy();
  });
});
