/**
 * Unit tests for stale-checkout sweep worker.
 *
 * Does NOT require Redis, a live server, or a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

vi.mock("../server/lib/push.js", () => ({
  sendPushToUser: vi.fn(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

vi.mock("../server/lib/metrics.js", () => ({
  incrementMetric: vi.fn(),
}));

vi.mock("../server/lib/resolve-user-locale.js", () => ({
  resolveUserLocale: vi.fn().mockResolvedValue("he"),
}));

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  equipment: {
    id: "id",
    clinicId: "clinic_id",
    custodyState: "custody_state",
    checkedOutAt: "checked_out_at",
    checkedOutById: "checked_out_by_id",
  },
  alertAcks: {
    clinicId: "clinic_id",
    equipmentId: "equipment_id",
    alertType: "alert_type",
    acknowledgedAt: "acknowledged_at",
  },
}));

import {
  runStaleCheckoutSweep,
  __test,
} from "../server/workers/staleCheckoutSweepWorker.js";
import { sendPushToUser } from "../server/lib/push.js";
import { logAudit } from "../server/lib/audit.js";
import { incrementMetric } from "../server/lib/metrics.js";
import { db } from "../server/db.js";

const NOW = new Date("2026-06-13T12:00:00.000Z");
const STALE_HOURS = Number(process.env.STALE_CHECKOUT_HOURS) || 12;

function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 3600_000);
}

function makeSelectChain(rows: unknown[]) {
  const chain: {
    from: () => typeof chain;
    where: ReturnType<typeof vi.fn>;
  } = {
    from: () => chain,
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function makeCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "eq-1",
    clinicId: "clinic-1",
    checkedOutById: "user-1",
    checkedOutAt: hoursAgo(NOW, STALE_HOURS + 1),
    custodyState: "checked_out",
    ...overrides,
  };
}

function setupTransactionMock(options: {
  priorAcks?: { acknowledgedAt: Date }[];
  insertCapture?: { values: ReturnType<typeof vi.fn> };
}) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  if (options.insertCapture) {
    options.insertCapture.values = insertValues;
  }
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnValue(makeSelectChain(options.priorAcks ?? [])),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
  };
  vi.mocked(db.transaction).mockImplementation(async (cb) => cb(tx as never));
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendPushToUser).mockResolvedValue({ deliveredAny: true, sent: 1, failed: 0 });
});

describe("runStaleCheckoutSweep", () => {
  it("case 1: no stale candidates → scanned 0, nudged 0", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]) as never);
    const result = await runStaleCheckoutSweep(NOW);
    expect(result).toEqual({ scanned: 0, nudged: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("case 2: stale + deliveredAny false → no ack insert", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([makeCandidate()]) as never);
    setupTransactionMock({});
    vi.mocked(sendPushToUser).mockResolvedValue({ deliveredAny: false, sent: 0, failed: 0 });
    const result = await runStaleCheckoutSweep(NOW);
    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(incrementMetric).not.toHaveBeenCalledWith("stale_checkout_nudged");
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("case 3: stale + deliveredAny true, 0 prior acks → insert ack + metrics + audit", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([makeCandidate()]) as never);
    const insertCapture: { values?: ReturnType<typeof vi.fn> } = {};
    setupTransactionMock({ priorAcks: [], insertCapture });
    const result = await runStaleCheckoutSweep(NOW);
    expect(result).toEqual({ scanned: 1, nudged: 1 });
    expect(insertCapture.values).toHaveBeenCalled();
    expect(incrementMetric).toHaveBeenCalledWith("stale_checkout_nudged");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "equipment_stale_checkout_nudged" }),
    );
  });

  it("case 4: 3 prior acks since checkedOutAt → skipped, no push", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([makeCandidate()]) as never);
    const priorAcks = [
      { acknowledgedAt: hoursAgo(NOW, 1) },
      { acknowledgedAt: hoursAgo(NOW, 2) },
      { acknowledgedAt: hoursAgo(NOW, 3) },
    ];
    setupTransactionMock({ priorAcks });
    const result = await runStaleCheckoutSweep(NOW);
    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(incrementMetric).toHaveBeenCalledWith("stale_checkout_skipped");
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("case 5: last ack within RENUDGE_INTERVAL_MS → skipped, no push", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([makeCandidate()]) as never);
    const recentAck = { acknowledgedAt: new Date(NOW.getTime() - __test.RENUDGE_INTERVAL_MS + 60_000) };
    setupTransactionMock({ priorAcks: [recentAck] });
    const result = await runStaleCheckoutSweep(NOW);
    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(incrementMetric).toHaveBeenCalledWith("stale_checkout_skipped");
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("case 6: last ack older than RENUDGE_INTERVAL_MS → push + ack", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([makeCandidate()]) as never);
    const oldAck = { acknowledgedAt: new Date(NOW.getTime() - __test.RENUDGE_INTERVAL_MS - 60_000) };
    setupTransactionMock({ priorAcks: [oldAck] });
    const result = await runStaleCheckoutSweep(NOW);
    expect(result).toEqual({ scanned: 1, nudged: 1 });
    expect(sendPushToUser).toHaveBeenCalled();
    expect(incrementMetric).toHaveBeenCalledWith("stale_checkout_nudged");
  });
});

describe("staleCheckoutPushCopyForLocale", () => {
  it("case 7: locale en → English copy from locales/en.json", () => {
    const copy = __test.staleCheckoutPushCopyForLocale("en");
    expect(copy.title).toBe("Equipment still checked out");
    expect(copy.body).toBe(
      "This device has been checked out a while. If you're done, please return it.",
    );
  });

  it("case 8: locale he → Hebrew copy from locales/he.json", () => {
    const copy = __test.staleCheckoutPushCopyForLocale("he");
    expect(copy.title).toBe("ציוד עדיין בשימוש");
    expect(copy.body).toBe("המכשיר הזה בשימוש כבר זמן מה. אם סיימת, אנא החזר אותו.");
  });
});

describe("source contract", () => {
  it("worker contains delivery gate, renudge interval, audit kind, and cutoff filter", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/workers/staleCheckoutSweepWorker.ts"),
      "utf8",
    );
    expect(src).toContain("deliveredAny");
    expect(src).toContain("RENUDGE_INTERVAL_MS");
    expect(src).toContain("equipment_stale_checkout_nudged");
    expect(src).toContain("lt(equipment.checkedOutAt, cutoff)");
    expect(src).toContain("isNull(equipment.deletedAt)");
  });
});
