/**
 * F1 regression — quick-scan (POST /api/equipment/scan) must enforce the same
 * checkout gates as /checkout and /toggle:
 *   - evaluateCheckoutV1Preconditions() (custody chain, staging claims, bundle readiness)
 *   - assertWaitlistCheckoutAllowed()   (single-holder waitlist reservation)
 *
 * Hermetic: db and all custody-service side-effect modules are mocked, so this
 * runs in the default `pnpm test` suite without a database.
 * DB-backed end-to-end coverage lives in tests/equipment-waitlist.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const h = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  transactionCount: 0,
}));

vi.mock("../server/db.js", () => {
  const chain = () => {
    const rows = () => Promise.resolve(h.selectResults.shift() ?? []);
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.limit = rows;
    c.orderBy = rows;
    c.then = (onFulfilled: never, onRejected: never) => rows().then(onFulfilled, onRejected);
    return c;
  };
  return {
    db: {
      select: () => chain(),
      transaction: async () => {
        h.transactionCount += 1;
        throw new Error("TX_SENTINEL");
      },
    },
    equipment: {},
    equipmentReturns: {},
    scanLogs: {},
    stagingQueue: {},
    assetTypeConditions: {},
    unitConditionStates: {},
  };
});

vi.mock("../server/services/equipment-waitlist.service.js", () => {
  class EquipmentWaitlistError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    EquipmentWaitlistError,
    getActiveNotifiedUserId: vi.fn(),
    fulfillWaitlistOnCheckout: vi.fn(),
    promoteNextWaitlistInTx: vi.fn(),
  };
});

vi.mock("../server/lib/realtime-outbox.js", () => ({ insertRealtimeDomainEvent: vi.fn() }));
vi.mock("../server/services/operational-metrics.service.js", () => ({
  recordOperationalMetric: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/lib/staging-promotion.js", () => ({ promoteStagingQueueNext: vi.fn() }));
vi.mock("../server/lib/equipment-waitlist-promotion.js", () => ({ notifyWaitlistPromoted: vi.fn() }));
vi.mock("../server/lib/audit.js", () => ({ logAudit: vi.fn() }));
vi.mock("../server/lib/analytics-cache.js", () => ({ invalidateAnalyticsCache: vi.fn() }));
vi.mock("../server/lib/sync-metrics.js", () => ({ trackSyncSuccess: vi.fn() }));
vi.mock("../server/lib/role-notification-scheduler.js", () => ({
  scheduleSmartReturnReminder: vi.fn(),
  cancelSmartReturnReminder: vi.fn(),
}));
vi.mock("../server/lib/push.js", () => ({
  checkDedupe: vi.fn(() => true),
  sendPushToAll: vi.fn(),
  shouldSendPilotEnglishEquipmentPush: vi.fn(() => false),
}));
vi.mock("../server/jobs/charge-alert-enqueue.js", () => ({ enqueueChargeAlertJob: vi.fn() }));
vi.mock("../server/routes/equipment/equipment-undo-tokens.js", () => ({
  insertEquipmentUndoToken: vi.fn(),
  snapshotEquipmentState: vi.fn(),
}));

import {
  quickScanEquipmentCustody,
  CheckoutPreconditionError,
} from "../server/services/equipment-custody-toggle.service.js";
import {
  EquipmentWaitlistError,
  getActiveNotifiedUserId,
} from "../server/services/equipment-waitlist.service.js";

const CLINIC_ID = "clinic-1";
const RESERVED_USER = "user-beta";
const OTHER_USER = "user-admin";

function availableSnap(overrides: Record<string, unknown> = {}) {
  return {
    id: "eq-1",
    clinicId: CLINIC_ID,
    name: "Pump 05",
    status: "ok",
    custodyState: "returned",
    usageState: "available",
    readinessState: "unknown",
    assetTypeId: null,
    checkedOutById: null,
    checkedOutByEmail: null,
    checkedOutAt: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

async function runQuickScan(actorId: string) {
  return quickScanEquipmentCustody({
    clinicId: CLINIC_ID,
    equipmentId: "eq-1",
    actor: { id: actorId, email: `${actorId}@test.local` },
  }).then(
    () => null,
    (err: unknown) => err,
  );
}

beforeEach(() => {
  h.selectResults.length = 0;
  h.transactionCount = 0;
  vi.mocked(getActiveNotifiedUserId).mockReset();
});

describe("quick-scan checkout gates (F1 regression)", () => {
  it("denies quick-scan by a non-reserved user while a waitlist reservation is held", async () => {
    h.selectResults.push([availableSnap()]);
    vi.mocked(getActiveNotifiedUserId).mockResolvedValue(RESERVED_USER);

    const err = await runQuickScan(OTHER_USER);

    expect(err).toBeInstanceOf(EquipmentWaitlistError);
    expect((err as { code: string }).code).toBe("WAITLIST_RESERVATION_HELD_BY_OTHER");
    expect(h.transactionCount).toBe(0);
  });

  it("allows the reserved holder through the gates to the checkout transaction", async () => {
    h.selectResults.push([availableSnap()]);
    vi.mocked(getActiveNotifiedUserId).mockResolvedValue(RESERVED_USER);

    const err = await runQuickScan(RESERVED_USER);

    expect((err as Error | null)?.message).toBe("TX_SENTINEL");
    expect(h.transactionCount).toBe(1);
  });

  it("denies quick-scan of an untracked unit (CUSTODY_CHAIN_BROKEN) before any waitlist lookup", async () => {
    h.selectResults.push([availableSnap({ custodyState: "untracked" })]);

    const err = await runQuickScan(OTHER_USER);

    expect(err).toBeInstanceOf(CheckoutPreconditionError);
    expect((err as CheckoutPreconditionError).code).toBe("CUSTODY_CHAIN_BROKEN");
    expect((err as CheckoutPreconditionError).httpStatus).toBe(422);
    expect(getActiveNotifiedUserId).not.toHaveBeenCalled();
    expect(h.transactionCount).toBe(0);
  });

  it("denies quick-scan of a staged unit when the caller does not hold the top claim", async () => {
    h.selectResults.push([availableSnap({ usageState: "staged" })]);
    h.selectResults.push([
      { id: "claim-1", requestedById: RESERVED_USER, clinicalPriority: "routine" },
    ]);

    const err = await runQuickScan(OTHER_USER);

    expect(err).toBeInstanceOf(CheckoutPreconditionError);
    expect((err as CheckoutPreconditionError).code).toBe("STAGING_CONFLICT");
    expect((err as CheckoutPreconditionError).httpStatus).toBe(409);
    expect(h.transactionCount).toBe(0);
  });
});

describe("POST /api/equipment/scan route — gate error mapping contract", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const routeSource = fs.readFileSync(path.resolve(__dirname, "../server/routes/equipment.ts"), "utf8");
  const scanHandler = routeSource.slice(
    routeSource.indexOf('router.post("/scan"'),
    routeSource.indexOf("// POST /api/equipment/:id/toggle"),
  );
  const toggleHandler = routeSource.slice(
    routeSource.indexOf("// POST /api/equipment/:id/toggle"),
    routeSource.indexOf("// POST /api/equipment/:id/checkout"),
  );
  const mapperSource = routeSource.slice(
    routeSource.indexOf("function mapCheckoutGateError("),
    routeSource.indexOf("router.get("),
  );

  it("scan and toggle share the checkout gate error mapper", () => {
    expect(scanHandler).toContain("mapCheckoutGateError(err, req, res)");
    expect(toggleHandler).toContain("mapCheckoutGateError(err, req, res)");
  });

  it("the mapper covers CheckoutPreconditionError's documented status codes", () => {
    expect(mapperSource).toContain("CheckoutPreconditionError");
    expect(mapperSource).toContain("STAGING_CONFLICT");
    expect(mapperSource).toContain("BUNDLE_INCOMPLETE");
    expect(mapperSource).toContain("err.httpStatus");
  });

  it("the mapper covers EquipmentWaitlistError via the i18n error envelope", () => {
    expect(mapperSource).toContain("EquipmentWaitlistError");
    expect(mapperSource).toContain("WAITLIST_RESERVATION_HELD_BY_OTHER");
    expect(mapperSource).toContain("apiErrorI18n");
  });
});
