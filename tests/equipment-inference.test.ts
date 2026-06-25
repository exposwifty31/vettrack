import { describe, it, expect, vi, beforeEach } from "vitest";

// --- DB query chain mock factory ---
// Each call to `limit()` pops the next pre-loaded result from `rows`.
function makeSelectChain(rows: Array<unknown[]>) {
  const results = [...rows];
  const limit = vi.fn(() => Promise.resolve(results.shift() ?? []));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ limit, orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, orderBy, limit };
}

vi.mock("../server/db.js", () => ({
  db: { select: vi.fn() },
  equipment: { id: "id", clinicId: "clinic_id" },
  docks: {},
  rooms: {},
  scanLogs: {},
  users: {},
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

// drizzle-orm operators are used as query-builder call arguments only —
// we don't need real implementations because the mock chain ignores them.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  desc: (col: unknown) => col,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  isNotNull: (col: unknown) => col,
}));

import { inferEquipmentLocation } from "../server/services/equipment-location-inference.js";
import * as dbModule from "../server/db.js";
import { logAudit } from "../server/lib/audit.js";

function buildEquipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "eq-1",
    checkedOutById: null,
    checkedOutAt: null,
    checkedOutLocation: null,
    dockId: null,
    dockConfirmedReadyAt: null,
    dockConfirmedById: null,
    lastRfidSeenAt: null,
    lastRfidRoomId: null,
    custodyState: "untracked",
    name: "Ventilator A",
    ...overrides,
  };
}

function nowMinus(ms: number) {
  return new Date(Date.now() - ms);
}

const HOUR = 60 * 60 * 1000;

describe("inferEquipmentLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when equipment not found", async () => {
    // db.select chain returns empty array (equipment row not found)
    const chain = makeSelectChain([[]]);
    vi.mocked(dbModule.db).select = chain.select;

    const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");
    expect(result).toBeNull();
  });

  describe("Signal: checkout (priority 1)", () => {
    it("returns HIGH confidence checkout signal", async () => {
      const checkedOutAt = nowMinus(1 * HOUR);
      const chain = makeSelectChain([
        [buildEquipmentRow({ checkedOutById: "user-1", checkedOutAt, checkedOutLocation: "OR-3" })],
        [{ id: "user-1", name: "Dr. Lior", displayName: "Dr. Lior Cohen" }], // user lookup
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result).not.toBeNull();
      expect(result!.signalSource).toBe("checkout");
      expect(result!.confidence).toBe("high");
      expect(result!.inferredLocation).toBe("OR-3");
      expect(result!.accountablePerson?.name).toBe("Dr. Lior Cohen");
      expect(result!.lastConfirmedAt).toBe(checkedOutAt.toISOString());
    });

    it("falls back to displayName when set, else name", async () => {
      const checkedOutAt = nowMinus(30 * 60 * 1000);
      const chain = makeSelectChain([
        [buildEquipmentRow({ checkedOutById: "user-2", checkedOutAt })],
        [{ id: "user-2", name: "Hila Ben-David", displayName: "" }],
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");
      expect(result!.accountablePerson?.name).toBe("Hila Ben-David");
    });
  });

  describe("Signal: dock (priority 2)", () => {
    it("returns HIGH confidence when dock confirmed < 4 h ago", async () => {
      const dockConfirmedReadyAt = nowMinus(2 * HOUR);
      const chain = makeSelectChain([
        [buildEquipmentRow({ dockId: "dock-1", dockConfirmedReadyAt })],
        [{ id: "dock-1", name: "Dock A", roomId: "room-1" }], // dock lookup
        [{ name: "Recovery Room" }], // room lookup
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result!.signalSource).toBe("dock");
      expect(result!.confidence).toBe("high");
      expect(result!.inferredLocation).toBe("Dock A – Recovery Room");
    });

    it("returns MEDIUM confidence when dock confirmed 4–12 h ago", async () => {
      const dockConfirmedReadyAt = nowMinus(6 * HOUR);
      const chain = makeSelectChain([
        [buildEquipmentRow({ dockId: "dock-1", dockConfirmedReadyAt })],
        [{ id: "dock-1", name: "Dock B", roomId: null }],
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result!.signalSource).toBe("dock");
      expect(result!.confidence).toBe("medium");
      expect(result!.inferredLocation).toBe("Dock B");
    });

    it("returns LOW confidence when dock confirmed > 12 h ago", async () => {
      const dockConfirmedReadyAt = nowMinus(14 * HOUR);
      const chain = makeSelectChain([
        [buildEquipmentRow({ dockId: "dock-1", dockConfirmedReadyAt })],
        [{ id: "dock-1", name: "Dock C", roomId: null }],
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result!.signalSource).toBe("dock");
      expect(result!.confidence).toBe("low");
    });
  });

  describe("Signal: scan (priority 3)", () => {
    it("returns MEDIUM confidence from a recent scan (< 8 h)", async () => {
      const scanTime = nowMinus(3 * HOUR);
      const chain = makeSelectChain([
        [buildEquipmentRow()], // no checkout, no dock
        [{ userId: "u-scan", userEmail: "tech@vet.com", timestamp: scanTime }], // scan log
        [{ id: "u-scan", name: "Rina Zohar", displayName: "Rina Z." }], // user
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result!.signalSource).toBe("scan");
      expect(result!.confidence).toBe("medium");
      expect(result!.accountablePerson?.name).toBe("Rina Z.");
      expect(result!.inferredLocation).toBeNull();
    });

    it("falls through to rfid when last scan is > 8 h old", async () => {
      const scanTime = nowMinus(10 * HOUR);
      const rfidSeenAt = nowMinus(2 * HOUR);
      const chain = makeSelectChain([
        [buildEquipmentRow({ lastRfidSeenAt: rfidSeenAt, lastRfidRoomId: "room-x" })],
        [{ userId: "u-scan", userEmail: "tech@vet.com", timestamp: scanTime }], // stale scan
        [{ name: "ICU" }], // room lookup for rfid
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result!.signalSource).toBe("rfid");
      expect(result!.confidence).toBe("low");
    });
  });

  describe("Signal: rfid (priority 4)", () => {
    it("returns LOW confidence from RFID read", async () => {
      const rfidSeenAt = nowMinus(1 * HOUR);
      const chain = makeSelectChain([
        [buildEquipmentRow({ lastRfidSeenAt: rfidSeenAt, lastRfidRoomId: "room-2" })],
        [], // no scan logs
        [{ name: "Surgery Bay" }], // room lookup
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result!.signalSource).toBe("rfid");
      expect(result!.confidence).toBe("low");
      expect(result!.inferredLocation).toBe("Surgery Bay");
      expect(result!.accountablePerson).toBeNull();
    });
  });

  describe("Signal: none (priority 5)", () => {
    it("returns UNKNOWN confidence and fires audit when no signal exists", async () => {
      const chain = makeSelectChain([
        [buildEquipmentRow()], // nothing set
        [],                    // no scan logs
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");

      expect(result!.signalSource).toBe("none");
      expect(result!.confidence).toBe("unknown");
      expect(result!.inferredLocation).toBeNull();
      expect(result!.accountablePerson).toBeNull();
      expect(vi.mocked(logAudit)).toHaveBeenCalledOnce();
      expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: "clinic-1",
          actionType: "equipment_location_unknown",
          targetId: "eq-1",
        }),
      );
    });
  });

  describe("Priority ordering", () => {
    it("checkout wins over dock when both signals are present", async () => {
      const checkedOutAt = nowMinus(1 * HOUR);
      const dockConfirmedReadyAt = nowMinus(30 * 60 * 1000);
      const chain = makeSelectChain([
        [buildEquipmentRow({
          checkedOutById: "u-co",
          checkedOutAt,
          checkedOutLocation: "ER-1",
          dockId: "dock-1",
          dockConfirmedReadyAt,
        })],
        [{ id: "u-co", name: "Alon", displayName: "Alon K." }],
      ]);
      vi.mocked(dbModule.db).select = chain.select;

      const result = await inferEquipmentLocation("eq-1", "clinic-1", "u1", "u@vet.com");
      expect(result!.signalSource).toBe("checkout");
    });
  });
});
