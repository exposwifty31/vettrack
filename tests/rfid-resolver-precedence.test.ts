import { describe, it, expect } from "vitest";
import { buildSyntheticEvidenceGraph } from "../server/domain/equipment/evidence/graph.loader.js";
import { resolveCurrentLocation } from "../server/domain/equipment/evidence/resolver/index.js";
import type { EvidenceGraph } from "../server/domain/equipment/evidence/graph.types.js";

/**
 * R-M1.0 — Reconcile the resolver-precedence conflict.
 *
 * PINNED canonical precedence (ADR-006, RFID is advisory-only):
 *   active checkout/scan > human-confirmed roomId > RFID last-seen > free-text > unknown
 *
 * The evidence-graph location resolver historically let a recent RFID read
 * OUTRANK a human-confirmed `eq.roomId` in the summary. That is the bug: RFID
 * corroborates / raises confidence but must NEVER override a human-confirmed
 * room. RFID stays a citation.
 */

const NOW = new Date("2026-07-16T12:00:00Z");
const CLINIC = "precedence-clinic";
const EQ = "precedence-eq";

const ROOM_HUMAN = { id: "room-surgery", clinicId: CLINIC, name: "Surgery" };
const ROOM_RFID = { id: "room-icu", clinicId: CLINIC, name: "ICU" };

function baseEquipment(
  overrides: Partial<NonNullable<EvidenceGraph["equipment"]>> = {},
): NonNullable<EvidenceGraph["equipment"]> {
  return {
    id: EQ,
    clinicId: CLINIC,
    name: "Infusion Pump",
    custodyState: "docked",
    custodyStateSince: NOW,
    checkedOutById: null,
    checkedOutByEmail: null,
    checkedOutAt: null,
    checkedOutLocation: null,
    readinessState: "ready",
    usageState: "available",
    assetTypeId: null,
    roomId: null,
    dockId: null,
    location: null,
    lastRfidSeenAt: null,
    lastRfidRoomId: null,
    lastSeen: NOW,
    ...overrides,
  };
}

function conflictingRfidRead() {
  return {
    id: "rfid-conflict",
    clinicId: CLINIC,
    equipmentId: EQ,
    fromRoomId: null,
    toRoomId: ROOM_RFID.id,
    gatewayCode: "gw-icu",
    readAt: new Date(NOW.getTime() - 2 * 60_000),
    batchId: "batch-1",
  };
}

function ctx() {
  return { clinicId: CLINIC, equipmentId: EQ, now: NOW };
}

describe("R-M1.0 · RFID resolver precedence (evidence-graph)", () => {
  it("human-confirmed roomId outranks a conflicting recent RFID read in the summary", async () => {
    const graph = buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ roomId: ROOM_HUMAN.id }),
      rooms: [ROOM_HUMAN, ROOM_RFID],
      recentRfidReads: [conflictingRfidRead()],
    });

    const r = await resolveCurrentLocation(ctx(), graph);

    // Authoritative human room wins the summary — NOT the RFID room.
    expect(r.summary).toBe(`room:${ROOM_HUMAN.name}`);
    expect(r.summary).not.toContain(ROOM_RFID.name);
  });

  it("keeps RFID as a citation/corroboration even when it does not win the summary", async () => {
    const graph = buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ roomId: ROOM_HUMAN.id }),
      rooms: [ROOM_HUMAN, ROOM_RFID],
      recentRfidReads: [conflictingRfidRead()],
    });

    const r = await resolveCurrentLocation(ctx(), graph);

    expect(r.citations.some((c) => c.type === "rfid")).toBe(true);
    expect(r.citations.some((c) => c.type === "room" && c.id === ROOM_HUMAN.id)).toBe(true);
  });

  it("still resolves to the RFID room when no human-confirmed room exists (RFID as evidence)", async () => {
    const graph = buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({ roomId: null }),
      rooms: [ROOM_RFID],
      recentRfidReads: [conflictingRfidRead()],
    });

    const r = await resolveCurrentLocation(ctx(), graph);

    expect(r.summary).toBe(`rfid_room:${ROOM_RFID.name}`);
  });

  it("active checkout outranks both human room and RFID", async () => {
    const graph = buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: baseEquipment({
        custodyState: "checked_out",
        checkedOutById: "user-a",
        checkedOutByEmail: "alice@clinic.test",
        checkedOutAt: NOW,
        checkedOutLocation: "OR-2",
        roomId: ROOM_HUMAN.id,
      }),
      rooms: [ROOM_HUMAN, ROOM_RFID],
      recentRfidReads: [conflictingRfidRead()],
    });

    const r = await resolveCurrentLocation(ctx(), graph);

    expect(r.summary).toBe("checked_out:OR-2");
  });

  it("is read-only: resolving never mutates custody state on the RFID path (ADR-006)", async () => {
    const equipment = baseEquipment({ roomId: ROOM_HUMAN.id });
    const graph = buildSyntheticEvidenceGraph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment,
      rooms: [ROOM_HUMAN, ROOM_RFID],
      recentRfidReads: [conflictingRfidRead()],
    });

    await resolveCurrentLocation(ctx(), graph);

    expect(graph.equipment?.custodyState).toBe("docked");
    expect(graph.equipment?.roomId).toBe(ROOM_HUMAN.id);
    expect(graph.equipment?.lastRfidRoomId).toBe(null);
  });
});
