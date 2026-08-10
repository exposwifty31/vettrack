/**
 * Unit tests for the room-sweep missing-equipment alert (Part B Phase 1).
 *
 * No DB / Redis / live server — the DB layer is mocked (mirrors
 * tests/stale-returned-sweep.test.ts). Proves the emit path and the per-item
 * idempotency decision. The full route → outbox/acks path is covered by the
 * DB-gated tests/equipment-missing-alert.integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/lib/push.js", () => ({
  sendPushToRole: vi.fn(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

vi.mock("../server/lib/realtime-outbox.js", () => ({
  insertRealtimeDomainEvent: vi.fn().mockResolvedValue(1),
}));

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  alertAcks: {
    clinicId: "clinic_id",
    equipmentId: "equipment_id",
    alertType: "alert_type",
    acknowledgedAt: "acknowledged_at",
  },
}));

import {
  alertMissingEquipmentAfterSweep,
  selectUnalertedMissing,
} from "../server/services/equipment-missing-alert.service.js";
import { sendPushToRole } from "../server/lib/push.js";
import { logAudit } from "../server/lib/audit.js";
import { insertRealtimeDomainEvent } from "../server/lib/realtime-outbox.js";
import { db } from "../server/db.js";

const NOW = new Date("2026-08-10T12:00:00.000Z");

/** Mocks the single db.select().from().where() ack read → resolves to `rows`. */
function makeSelectChain(rows: unknown[]) {
  const chain: { from: () => typeof chain; where: ReturnType<typeof vi.fn> } = {
    from: () => chain,
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

/**
 * Mocks db.transaction with a tx exposing insert().values().onConflictDoUpdate() — the alertAcks
 * writes upsert on the lifetime UNIQUE(equipment_id, alert_type) so an expired prior claim is
 * reclaimed in place rather than raising 23505 and rolling the transaction back.
 */
function setupTransactionMock() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const tx = { insert: vi.fn().mockReturnValue({ values }) };
  vi.mocked(db.transaction).mockImplementation((async (cb: (t: unknown) => unknown) => cb(tx)) as never);
  return { tx, values, onConflictDoUpdate };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(insertRealtimeDomainEvent).mockResolvedValue(1);
  vi.mocked(sendPushToRole).mockResolvedValue({ deliveredAny: true, transientFailures: 0, invalidOrGoneCount: 0 });
});

describe("selectUnalertedMissing", () => {
  it("returns every id when none were recently alerted", () => {
    expect(selectUnalertedMissing(["a", "b"], new Set())).toEqual(["a", "b"]);
  });

  it("drops ids that were already alerted within the window", () => {
    expect(selectUnalertedMissing(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
  });

  it("de-duplicates repeated ids in the input", () => {
    expect(selectUnalertedMissing(["a", "a", "b"], new Set())).toEqual(["a", "b"]);
  });

  it("returns empty when every id was already alerted", () => {
    expect(selectUnalertedMissing(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });
});

describe("alertMissingEquipmentAfterSweep", () => {
  it("emits an ALERT/WARNING EQUIPMENT_MISSING_ALERT outbox event, pushes the manager tier, and audits", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]) as never); // no prior acks
    const { tx, values } = setupTransactionMock();

    const result = await alertMissingEquipmentAfterSweep({
      clinicId: "clinic-1",
      roomId: "room-1",
      missingEquipmentIds: ["eq-1", "eq-2"],
      now: NOW,
    });

    expect(result.alerted).toEqual(["eq-1", "eq-2"]);

    // (a) new realtime type on the existing outbox, clinic-scoped, ALERT/WARNING, carrying ids + count.
    expect(insertRealtimeDomainEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        clinicId: "clinic-1",
        type: "EQUIPMENT_MISSING_ALERT",
        category: "ALERT",
        level: "WARNING",
        payload: expect.objectContaining({ roomId: "room-1", equipmentIds: ["eq-1", "eq-2"], count: 2 }),
      }),
    );

    // (b) manager-tier push (admin + vet) with a per-sweep coalescing tag. The push is detached
    // post-commit, so awaiting pushSettled gates the assertions below on the background fan-out
    // actually having completed — without it they could run before sendPushToRole was called.
    await result.pushSettled;
    expect(sendPushToRole).toHaveBeenCalledWith("clinic-1", "admin", expect.objectContaining({ tag: "equipment-missing:room-1" }));
    expect(sendPushToRole).toHaveBeenCalledWith("clinic-1", "vet", expect.objectContaining({ tag: "equipment-missing:room-1" }));

    // (c) audit with the closed-union kind, targetId = roomId, metadata carries ids + count.
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        actionType: "equipment_missing_alerted",
        targetId: "room-1",
        metadata: expect.objectContaining({ count: 2, equipmentIds: ["eq-1", "eq-2"] }),
      }),
    );

    // one durable ack row per alerted id (idempotency ledger).
    expect(values).toHaveBeenCalledTimes(2);
  });

  it("(d) idempotency: a repeat within the window does not double-alert (all ids already acked)", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([{ equipmentId: "eq-1" }, { equipmentId: "eq-2" }]) as never);

    const result = await alertMissingEquipmentAfterSweep({
      clinicId: "clinic-1",
      roomId: "room-1",
      missingEquipmentIds: ["eq-1", "eq-2"],
      now: NOW,
    });

    expect(result.alerted).toEqual([]);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(insertRealtimeDomainEvent).not.toHaveBeenCalled();
    expect(sendPushToRole).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("alerts only the newly-missing id when one was already acked within the window", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([{ equipmentId: "eq-1" }]) as never); // eq-1 already alerted
    setupTransactionMock();

    const result = await alertMissingEquipmentAfterSweep({
      clinicId: "clinic-1",
      roomId: "room-1",
      missingEquipmentIds: ["eq-1", "eq-2"],
      now: NOW,
    });

    expect(result.alerted).toEqual(["eq-2"]);
    expect(insertRealtimeDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: expect.objectContaining({ equipmentIds: ["eq-2"], count: 1 }) }),
    );
    // Let the detached push settle so it can't bleed into the next test's mock assertions.
    await result.pushSettled;
  });

  it("is a no-op with no missing ids (no DB read, no emit)", async () => {
    const result = await alertMissingEquipmentAfterSweep({
      clinicId: "clinic-1",
      roomId: "room-1",
      missingEquipmentIds: [],
    });

    expect(result.alerted).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(sendPushToRole).not.toHaveBeenCalled();
  });

  it("still writes the outbox event and audit when the manager push rejects", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]) as never); // no prior acks
    const { tx } = setupTransactionMock();
    vi.mocked(sendPushToRole).mockRejectedValue(new Error("push transport down"));

    const result = await alertMissingEquipmentAfterSweep({
      clinicId: "clinic-1",
      roomId: "room-1",
      missingEquipmentIds: ["eq-1", "eq-2"],
      now: NOW,
    });

    // The detached push settles without throwing into the caller (its own catch swallows the rejection).
    await result.pushSettled;

    expect(result.alerted).toEqual(["eq-1", "eq-2"]);

    // The durable outbox event still committed despite the push failure.
    expect(insertRealtimeDomainEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        clinicId: "clinic-1",
        type: "EQUIPMENT_MISSING_ALERT",
        category: "ALERT",
        level: "WARNING",
        payload: expect.objectContaining({ roomId: "room-1", equipmentIds: ["eq-1", "eq-2"], count: 2 }),
      }),
    );

    // And the audit still ran — a push failure must never skip it.
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        actionType: "equipment_missing_alerted",
        targetId: "room-1",
        metadata: expect.objectContaining({ count: 2, equipmentIds: ["eq-1", "eq-2"] }),
      }),
    );
  });
});
