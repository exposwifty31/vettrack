/**
 * Phase 5 (C2) — byLocation aggregation (pure transform of already-fetched rows).
 * SQL correctness of the enrichment aggregates is covered by the DB-integration
 * suite; this pins the grouping/keying/bucketing contract without a database.
 */
import { describe, it, expect } from "vitest";
import { aggregateByLocation } from "../server/services/equipment-command-board.service.js";
import type { EquipmentBoardUnitRow, EquipmentReadinessStatus } from "../shared/equipment-board.js";

function unit(id: string, status: EquipmentReadinessStatus): EquipmentBoardUnitRow {
  return {
    equipmentId: id,
    displayName: id,
    status,
    blockingReasons: [],
    citationsCount: 0,
    truthHref: `/api/equipment/${id}/truth`,
  };
}

describe("aggregateByLocation", () => {
  it("groups critical units by room with per-status tallies", () => {
    const rows = [
      { id: "e1", roomId: "r1", roomName: "ICU" },
      { id: "e2", roomId: "r1", roomName: "ICU" },
      { id: "e3", roomId: "r2", roomName: "OR" },
    ];
    const result = aggregateByLocation(rows, [
      unit("e1", "ready"),
      unit("e2", "blocked"),
      unit("e3", "in_use"),
    ]);
    expect(result.find((r) => r.locationId === "r1")).toMatchObject({
      locationName: "ICU",
      totalCritical: 2,
      ready: 1,
      blocked: 1,
    });
    expect(result.find((r) => r.locationId === "r2")).toMatchObject({
      locationName: "OR",
      totalCritical: 1,
      inUse: 1,
    });
  });

  it("buckets room-less units under __unassigned__ with an empty (client-localized) name", () => {
    const result = aggregateByLocation([{ id: "e1", roomId: null, roomName: null }], [
      unit("e1", "stale"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ locationId: undefined, locationName: "", totalCritical: 1, stale: 1 });
  });

  it("keys by roomId, not name — distinct rooms sharing a name stay separate", () => {
    const result = aggregateByLocation(
      [
        { id: "e1", roomId: "r1", roomName: "Storage" },
        { id: "e2", roomId: "r2", roomName: "Storage" },
      ],
      [unit("e1", "ready"), unit("e2", "ready")],
    );
    expect(result).toHaveLength(2);
  });

  it("returns an empty array when there are no critical units", () => {
    expect(aggregateByLocation([], [])).toEqual([]);
  });
});
