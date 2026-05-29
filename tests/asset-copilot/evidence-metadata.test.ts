import { describe, it, expect } from "vitest";
import {
  ageMinutes,
  resolveEvidenceFreshness,
  OBSERVATION_FRESHNESS_MAX_MINUTES,
} from "../../server/domain/equipment/evidence/evidence-metadata.js";
import { buildSyntheticEvidenceGraph } from "../../server/domain/equipment/evidence/graph.loader.js";
import type { Citation } from "../../shared/contracts/asset-copilot.v1.js";

const NOW = new Date("2026-05-29T12:00:00Z");
const CLINIC = "clinic-1";
const EQ = "eq-1";

function graph(overrides: Parameters<typeof buildSyntheticEvidenceGraph>[0]) {
  return buildSyntheticEvidenceGraph(overrides);
}

describe("evidence-metadata freshness", () => {
  it("marks RFID stale past 4h observation window", () => {
    const observedAt = new Date(NOW.getTime() - (OBSERVATION_FRESHNESS_MAX_MINUTES.rfid! + 1) * 60_000);
    const citation: Citation = {
      type: "rfid",
      id: "rfid-1",
      label: "RFID",
      evidence: { observedAt: observedAt.toISOString() },
    };
    const g = graph({
      clinicId: CLINIC,
      equipmentId: EQ,
      recentRfidReads: [
        {
          id: "rfid-1",
          clinicId: CLINIC,
          equipmentId: EQ,
          fromRoomId: null,
          toRoomId: "room-1",
          gatewayCode: "gw",
          readAt: observedAt,
          batchId: "b1",
        },
      ],
    });
    expect(resolveEvidenceFreshness(citation, g, NOW)).toBe("stale");
  });

  it("keeps custody current after 72h checkout without supersession", () => {
    const checkedOutAt = new Date(NOW.getTime() - 72 * 60 * 60 * 1000);
    const citation: Citation = {
      type: "equipment",
      id: EQ,
      label: "Pump",
      evidence: { observedAt: checkedOutAt.toISOString() },
    };
    const g = graph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: {
        id: EQ,
        clinicId: CLINIC,
        name: "Pump",
        custodyState: "checked_out",
        custodyStateSince: checkedOutAt,
        checkedOutById: "user-1",
        checkedOutByEmail: "tech@clinic.test",
        checkedOutAt,
        checkedOutLocation: "ICU",
        readinessState: "ready",
        usageState: "in_use",
        assetTypeId: null,
        roomId: null,
        dockId: null,
        location: null,
        lastRfidSeenAt: null,
        lastRfidRoomId: null,
        lastSeen: null,
      },
      supersessionEvents: [],
    });
    expect(resolveEvidenceFreshness(citation, g, NOW)).toBe("current");
    expect(ageMinutes(checkedOutAt, NOW)).toBeGreaterThan(60);
  });

  it("marks custody not current after transfer supersession", () => {
    const checkedOutAt = new Date("2026-05-28T08:00:00Z");
    const transferAt = new Date("2026-05-29T10:00:00Z");
    const citation: Citation = {
      type: "equipment",
      id: EQ,
      label: "Pump",
      evidence: { observedAt: checkedOutAt.toISOString() },
    };
    const g = graph({
      clinicId: CLINIC,
      equipmentId: EQ,
      equipment: {
        id: EQ,
        clinicId: CLINIC,
        name: "Pump",
        custodyState: "checked_out",
        custodyStateSince: checkedOutAt,
        checkedOutById: "user-1",
        checkedOutByEmail: "tech@clinic.test",
        checkedOutAt,
        checkedOutLocation: null,
        readinessState: "ready",
        usageState: "in_use",
        assetTypeId: null,
        roomId: null,
        dockId: null,
        location: null,
        lastRfidSeenAt: null,
        lastRfidRoomId: null,
        lastSeen: null,
      },
      recentTransfers: [
        {
          id: "xfer-1",
          clinicId: CLINIC,
          equipmentId: EQ,
          timestamp: transferAt,
          fromFolderName: "A",
          toFolderName: "B",
        },
      ],
    });
    expect(resolveEvidenceFreshness(citation, g, NOW)).toBe("stale");
  });
});
