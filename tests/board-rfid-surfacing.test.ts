/**
 * R-M1.3 — Command Board RFID surfacing (pure producer transform).
 *
 * Covers every pinned branch of the subspec RED bullet against the pure
 * `deriveUnitRfid` transform (no DB — mirrors the aggregateByLocation contract
 * test). The SQL wiring in buildCommandBoardSnapshot is thin; this pins the
 * discriminator + conflict-enum + precedence semantics.
 *
 * Pinned guardrails asserted here:
 *  - RFID NEVER becomes the resolved location (human-confirmed room stays authoritative).
 *  - locationKind 'external_zone' and 'unresolved' are DISTINCT (neither null/blank).
 *  - rfid_location_conflict (single disagreeing read) and ambiguous_rfid_location
 *    (>=2 simultaneous candidate rooms) fire DISTINCTLY.
 */
import { describe, it, expect } from "vitest";
import {
  deriveUnitRfid,
  type BoardRfidReaderInfo,
  type BoardRfidUnitInput,
} from "../server/services/equipment-command-board.service.js";
import type { EquipmentBoardAlert } from "../shared/equipment-board.js";

const T0 = new Date("2026-07-17T10:00:00.000Z");
const T1 = new Date("2026-07-17T10:05:00.000Z");
const T2 = new Date("2026-07-17T10:10:00.000Z");

function reader(overrides: Partial<BoardRfidReaderInfo> = {}): BoardRfidReaderInfo {
  return {
    id: "reader-1",
    status: "active",
    readerHealthStatus: "healthy",
    name: "ER Gateway",
    ...overrides,
  };
}

function input(overrides: Partial<BoardRfidUnitInput> = {}): BoardRfidUnitInput {
  return {
    equipmentId: "eq-1",
    displayName: "Ventilator A",
    humanRoomId: null,
    lastRfidSeenAt: T1,
    lastRfidRoomId: "room-er",
    lastRfidRoomName: "ER",
    lastRfidGatewayCode: "gw-1",
    recentReads: [{ toRoomId: "room-er", readAt: T1 }],
    latestEgressAt: null,
    ...overrides,
  };
}

function readerMap(entries: Array<[string, BoardRfidReaderInfo]> = [["gw-1", reader()]]) {
  return new Map<string, BoardRfidReaderInfo>(entries);
}

function alertTypes(alerts: EquipmentBoardAlert[]): string[] {
  return alerts.map((a) => a.type);
}

describe("deriveUnitRfid — reader resolution (branch 1)", () => {
  it("resolves readerId via (gatewayCode) lookup and shows the last-seen room", () => {
    const d = deriveUnitRfid(input(), readerMap());
    expect(d.rfid?.readerId).toBe("reader-1");
    expect(d.rfid?.locationId).toBe("room-er");
    expect(d.rfid?.locationName).toBe("ER");
    expect(d.rfid?.locationKind).toBe("room");
  });

  it("unknown gatewayCode (reader since deleted) → readerId=null, last-seen room still shown", () => {
    const d = deriveUnitRfid(input(), readerMap([])); // no reader for gw-1
    expect(d.rfid?.readerId).toBeNull();
    expect(d.rfid?.locationId).toBe("room-er");
    expect(d.rfid?.locationName).toBe("ER");
    expect(alertTypes(d.alerts)).not.toContain("rfid_reader_offline");
  });

  it("deactivated (inactive) reader → readerId present, EXCLUDED from live offline status", () => {
    const d = deriveUnitRfid(
      input(),
      readerMap([["gw-1", reader({ status: "inactive", readerHealthStatus: "offline" })]]),
    );
    expect(d.rfid?.readerId).toBe("reader-1");
    expect(alertTypes(d.alerts)).not.toContain("rfid_reader_offline");
  });

  it("stale (active + offline health) reader → readerId present + rfid_reader_offline alert", () => {
    const d = deriveUnitRfid(
      input(),
      readerMap([["gw-1", reader({ status: "active", readerHealthStatus: "offline" })]]),
    );
    expect(d.rfid?.readerId).toBe("reader-1");
    expect(alertTypes(d.alerts)).toContain("rfid_reader_offline");
  });
});

describe("deriveUnitRfid — conflict enums (branch 2)", () => {
  it("single RFID read disagreeing with the human-confirmed room → rfid_location_conflict", () => {
    const d = deriveUnitRfid(
      input({
        humanRoomId: "room-ward",
        lastRfidRoomId: "room-er",
        lastRfidRoomName: "ER",
        recentReads: [{ toRoomId: "room-er", readAt: T1 }],
      }),
      readerMap(),
    );
    expect(d.evidenceConflict?.type).toBe("rfid_location_conflict");
    expect(alertTypes(d.alerts)).toContain("rfid_location_conflict");
    expect(alertTypes(d.alerts)).not.toContain("ambiguous_rfid_location");
  });

  it(">=2 simultaneous candidate rooms → ambiguous_rfid_location (distinct from conflict)", () => {
    const d = deriveUnitRfid(
      input({
        humanRoomId: "room-ward",
        lastRfidRoomId: "room-er",
        lastRfidRoomName: "ER",
        recentReads: [
          { toRoomId: "room-er", readAt: T2 },
          { toRoomId: "room-or", readAt: T2 },
        ],
      }),
      readerMap(),
    );
    expect(d.evidenceConflict?.type).toBe("ambiguous_rfid_location");
    expect(alertTypes(d.alerts)).toContain("ambiguous_rfid_location");
    expect(alertTypes(d.alerts)).not.toContain("rfid_location_conflict");
  });

  it("a single latest winner among multiple reads is NOT ambiguous", () => {
    const d = deriveUnitRfid(
      input({
        humanRoomId: "room-er",
        lastRfidRoomId: "room-er",
        lastRfidRoomName: "ER",
        recentReads: [
          { toRoomId: "room-or", readAt: T1 },
          { toRoomId: "room-er", readAt: T2 }, // unique latest
        ],
      }),
      readerMap(),
    );
    expect(d.evidenceConflict).toBeUndefined();
    expect(alertTypes(d.alerts)).not.toContain("ambiguous_rfid_location");
    expect(alertTypes(d.alerts)).not.toContain("rfid_location_conflict");
  });
});

describe("deriveUnitRfid — possible_egress (branch 3)", () => {
  it("a boundary-exit-without-entry (recent egress) surfaces exactly one possible_egress", () => {
    const d = deriveUnitRfid(
      input({ lastRfidSeenAt: T1, latestEgressAt: T2 }),
      readerMap(),
    );
    const egress = d.alerts.filter((a) => a.type === "possible_egress");
    expect(egress).toHaveLength(1);
  });

  it("no egress signal → no possible_egress", () => {
    const d = deriveUnitRfid(input({ latestEgressAt: null }), readerMap());
    expect(alertTypes(d.alerts)).not.toContain("possible_egress");
  });
});

describe("deriveUnitRfid — precedence (branch 4): human room stays resolved", () => {
  it("carries NO top-level resolved-location field, so a board producer merge can't clobber the human room", () => {
    const d = deriveUnitRfid(
      input({
        humanRoomId: "room-ward",
        lastRfidRoomId: "room-er",
        lastRfidRoomName: "ER",
      }),
      readerMap(),
    );

    // STRUCTURAL guard: the derivation output exposes ONLY { rfid, evidenceConflict, alerts } —
    // never a top-level location that the producer would treat as the resolved room. If someone
    // added a top-level `locationName`/`locationId`/`roomId`, the spread-merge below would begin
    // overwriting the human-confirmed room and this test would fail.
    for (const forbidden of ["locationName", "locationId", "roomId", "resolvedLocation"]) {
      expect(Object.prototype.hasOwnProperty.call(d, forbidden)).toBe(false);
    }

    // Merge the derivation over a base unit whose locationName is the human-confirmed room —
    // the exact shape buildCommandBoardSnapshot composes (row.roomName + the additive rfid block).
    // The full DB composition path is pinned by rfid-gate-e2e / rfid-scan-only-golden; here we pin
    // that the pure transform cannot participate in an override at all.
    const merged = { locationName: "Ward", ...d };
    expect(merged.locationName).toBe("Ward"); // human room survives the merge
    expect(d.rfid?.locationName).toBe("ER"); // RFID evidence lives only in the rfid block
    expect(d.evidenceConflict?.type).toBe("rfid_location_conflict");
  });
});

describe("deriveUnitRfid — healthy clinic (branch 5): shows none", () => {
  it("RFID agreeing with the human room, healthy reader, no egress → no conflict/alert", () => {
    const d = deriveUnitRfid(
      input({
        humanRoomId: "room-er",
        lastRfidRoomId: "room-er",
        lastRfidRoomName: "ER",
      }),
      readerMap(),
    );
    expect(d.evidenceConflict).toBeUndefined();
    expect(d.alerts).toHaveLength(0);
    expect(d.rfid?.locationKind).toBe("room");
  });

  it("equipment never seen by RFID → no rfid block, no alerts", () => {
    const d = deriveUnitRfid(input({ lastRfidSeenAt: null }), readerMap());
    expect(d.rfid).toBeUndefined();
    expect(d.alerts).toHaveLength(0);
    expect(d.evidenceConflict).toBeUndefined();
  });
});

describe("deriveUnitRfid — external-zone discriminator (branch 6)", () => {
  it("boundary/dock exit to the NULL endpoint → locationKind='external_zone'", () => {
    const d = deriveUnitRfid(
      input({ lastRfidSeenAt: T1, lastRfidRoomId: "room-er", lastRfidRoomName: "ER", latestEgressAt: T2 }),
      readerMap(),
    );
    expect(d.rfid?.locationKind).toBe("external_zone");
  });

  it("unresolvable read (room since deleted) → locationKind='unresolved'", () => {
    const d = deriveUnitRfid(
      input({ lastRfidRoomId: null, lastRfidRoomName: null, latestEgressAt: null }),
      readerMap(),
    );
    expect(d.rfid?.locationKind).toBe("unresolved");
  });

  it("external_zone and unresolved are DISTINCT values and neither collapses to null/blank", () => {
    const external = deriveUnitRfid(input({ latestEgressAt: T2, lastRfidSeenAt: T1 }), readerMap());
    const unresolved = deriveUnitRfid(
      input({ lastRfidRoomId: null, lastRfidRoomName: null, latestEgressAt: null }),
      readerMap(),
    );
    expect(external.rfid?.locationKind).toBe("external_zone");
    expect(unresolved.rfid?.locationKind).toBe("unresolved");
    expect(external.rfid?.locationKind).not.toBe(unresolved.rfid?.locationKind);
    expect(external.rfid?.locationKind).not.toBeNull();
    expect(unresolved.rfid?.locationKind).not.toBeNull();
  });
});
