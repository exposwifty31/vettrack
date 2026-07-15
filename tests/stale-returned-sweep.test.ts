/**
 * Unit tests for stale-returned sweep worker (docking P3 T3.5).
 *
 * Does NOT require Redis, a live server, or a real database.
 * Mirrors tests/stale-checkout-sweep.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

vi.mock("../server/lib/push.js", () => ({
  sendPushToRole: vi.fn(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

vi.mock("../server/lib/metrics.js", () => ({
  incrementMetric: vi.fn(),
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
    custodyStateSince: "custody_state_since",
    deletedAt: "deleted_at",
  },
  equipmentAnchors: {
    equipmentId: "equipment_id",
    invalidatedAt: "invalidated_at",
  },
  alertAcks: {
    clinicId: "clinic_id",
    equipmentId: "equipment_id",
    alertType: "alert_type",
    acknowledgedAt: "acknowledged_at",
  },
}));

import {
  runStaleReturnedSweep,
  __test,
} from "../server/workers/stale-returned-sweep.worker.js";
import { sendPushToRole } from "../server/lib/push.js";
import { logAudit } from "../server/lib/audit.js";
import { incrementMetric } from "../server/lib/metrics.js";
import { db } from "../server/db.js";

const NOW = new Date("2026-06-13T12:00:00.000Z");
const STALE_HOURS = Number(process.env.STALE_RETURNED_HOURS) || 4;

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
    custodyState: "returned",
    custodyStateSince: hoursAgo(NOW, STALE_HOURS + 1),
    deletedAt: null,
    ...overrides,
  };
}

/** Mocks the two sequential db.select() calls: candidate scan, then batched anchor lookup. */
function mockCandidatesAndAnchors(candidates: unknown[], anchoredEquipmentIds: string[] = []) {
  const chainCandidates = makeSelectChain(candidates);
  const chainAnchors = makeSelectChain(anchoredEquipmentIds.map((equipmentId) => ({ equipmentId })));
  vi.mocked(db.select)
    .mockReturnValueOnce(chainCandidates as never)
    .mockReturnValueOnce(chainAnchors as never);
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
  // resetAllMocks (not clearAllMocks): mockReturnValueOnce queues persist across clearAllMocks,
  // and early-return cases (0 candidates / anchored / checked_out) consume fewer than 2 queued
  // db.select() values, which would otherwise leak into the next test's calls.
  vi.resetAllMocks();
  vi.mocked(sendPushToRole).mockResolvedValue({ deliveredAny: true, transientFailures: 0, invalidOrGoneCount: 0 });
});

describe("runStaleReturnedSweep", () => {
  it("case 1: returned item older than threshold, no current anchor → nudged (managers pushed, ack inserted)", async () => {
    mockCandidatesAndAnchors([makeCandidate()], []);
    const insertCapture: { values?: ReturnType<typeof vi.fn> } = {};
    setupTransactionMock({ priorAcks: [], insertCapture });

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 1, nudged: 1 });
    expect(insertCapture.values).toHaveBeenCalled();
    expect(incrementMetric).toHaveBeenCalledWith("stale_returned_nudged");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "equipment_stale_returned_nudged" }),
    );
    expect(sendPushToRole).toHaveBeenCalledWith("clinic-1", "admin", expect.any(Object));
    expect(sendPushToRole).toHaveBeenCalledWith("clinic-1", "vet", expect.any(Object));
  });

  it("case 2: returned item WITHIN the threshold → not scanned, not nudged (SQL cutoff excludes it)", async () => {
    // Simulates the cutoff filter already excluding it at the DB layer.
    mockCandidatesAndAnchors([], []);

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 0, nudged: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(sendPushToRole).not.toHaveBeenCalled();
  });

  it("case 3: returned item that HAS a current anchor → NOT nudged (already verified / resolved)", async () => {
    mockCandidatesAndAnchors([makeCandidate()], ["eq-1"]);

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(sendPushToRole).not.toHaveBeenCalled();
    expect(incrementMetric).not.toHaveBeenCalledWith("stale_returned_nudged");
  });

  it("case 4: item already nudged MAX_NUDGES times → skipped, not re-nudged", async () => {
    mockCandidatesAndAnchors([makeCandidate()], []);
    const priorAcks = [
      { acknowledgedAt: hoursAgo(NOW, 1) },
      { acknowledgedAt: hoursAgo(NOW, 2) },
      { acknowledgedAt: hoursAgo(NOW, 3) },
    ];
    setupTransactionMock({ priorAcks });

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(incrementMetric).toHaveBeenCalledWith("stale_returned_skipped");
    expect(sendPushToRole).not.toHaveBeenCalled();
  });

  it("case 4b: last ack within RENUDGE_INTERVAL_MS → skipped, no push", async () => {
    mockCandidatesAndAnchors([makeCandidate()], []);
    const recentAck = { acknowledgedAt: new Date(NOW.getTime() - __test.RENUDGE_INTERVAL_MS + 60_000) };
    setupTransactionMock({ priorAcks: [recentAck] });

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(incrementMetric).toHaveBeenCalledWith("stale_returned_skipped");
    expect(sendPushToRole).not.toHaveBeenCalled();
  });

  it("case 4c: last ack older than RENUDGE_INTERVAL_MS → re-nudged", async () => {
    mockCandidatesAndAnchors([makeCandidate()], []);
    const oldAck = { acknowledgedAt: new Date(NOW.getTime() - __test.RENUDGE_INTERVAL_MS - 60_000) };
    setupTransactionMock({ priorAcks: [oldAck] });

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 1, nudged: 1 });
    expect(sendPushToRole).toHaveBeenCalled();
    expect(incrementMetric).toHaveBeenCalledWith("stale_returned_nudged");
  });

  it("case 5: a checked_out item is never touched by this worker", async () => {
    const checkedOutRow = makeCandidate({ id: "eq-2", custodyState: "checked_out" });
    mockCandidatesAndAnchors([checkedOutRow], []);

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(sendPushToRole).not.toHaveBeenCalled();
  });

  it("case 6: deliveredAny false → no ack insert, not counted as nudged", async () => {
    mockCandidatesAndAnchors([makeCandidate()], []);
    setupTransactionMock({});
    vi.mocked(sendPushToRole).mockResolvedValue({ deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 });

    const result = await runStaleReturnedSweep(NOW);

    expect(result).toEqual({ scanned: 1, nudged: 0 });
    expect(incrementMetric).not.toHaveBeenCalledWith("stale_returned_nudged");
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("staleReturnedPushCopyForLocale", () => {
  it("locale en → English copy from locales/en.json", () => {
    const copy = __test.staleReturnedPushCopyForLocale("en");
    expect(copy.title).toBe("Returned equipment needs verification");
    expect(copy.body).toBe(
      "An item was returned but hasn't been re-verified at its station yet. Please check it in.",
    );
  });

  it("locale he → Hebrew copy from locales/he.json", () => {
    const copy = __test.staleReturnedPushCopyForLocale("he");
    expect(copy.title).toBe("ציוד הוחזר — טרם אומת מיקום");
    expect(copy.body).toBe("פריט הוחזר אך מיקומו בעמדה טרם אומת. יש לבדוק ולעגן את הפריט.");
  });
});

describe("source contract", () => {
  it("worker contains delivery gate, renudge interval, audit kind, cutoff filter, and anchor filter", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../server/workers/stale-returned-sweep.worker.ts"),
      "utf8",
    );
    expect(src).toContain("deliveredAny");
    expect(src).toContain("RENUDGE_INTERVAL_MS");
    expect(src).toContain("equipment_stale_returned_nudged");
    expect(src).toContain('eq(equipment.custodyState, "returned")');
    expect(src).toContain("lt(equipment.custodyStateSince, cutoff)");
    expect(src).toContain("isNull(equipment.deletedAt)");
    expect(src).toContain("isNull(equipmentAnchors.invalidatedAt)");
  });
});
