/**
 * Client contract: equipment SSE events invalidate paginated list React Query keys.
 * Complements Playwright API drills in equipment-waitlist-sse.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { applyEvent } from "../src/lib/event-reducer.js";
import * as equipmentRealtime from "../src/lib/equipment-realtime.js";
import { getPaginatedEquipmentQueryOptions } from "../src/hooks/use-paginated-equipment.js";

vi.mock("@/lib/auth-store", () => ({
  getCurrentUserId: () => null,
}));

describe("equipment paginated list SSE invalidation contract", () => {
  let client: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new QueryClient();
    invalidateSpy = vi.spyOn(client, "invalidateQueries");
    vi.spyOn(equipmentRealtime, "invalidateEquipmentCaches").mockImplementation(async (qc, equipmentId) => {
      await qc.invalidateQueries({ queryKey: ["/api/equipment"] });
      await qc.invalidateQueries({ queryKey: ["/api/equipment/my"] });
      await qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "/api/equipment" &&
          q.queryKey[1] === "paginated",
      });
      if (equipmentId) {
        await qc.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}`] });
      }
    });
  });

  const paginatedKey = getPaginatedEquipmentQueryOptions({ page: 1, pageSize: 50 }).queryKey;

  async function expectPaginatedInvalidated(eventType: string, payload: Record<string, unknown>) {
    invalidateSpy.mockClear();
    await applyEvent(client, {
      type: eventType as never,
      payload,
      timestamp: new Date().toISOString(),
    });
    const paginatedInvalidated = invalidateSpy.mock.calls.some((call) => {
      const arg = call[0];
      if (typeof arg === "object" && arg !== null && "predicate" in arg) return true;
      if (Array.isArray((arg as { queryKey?: unknown })?.queryKey)) {
        const key = (arg as { queryKey: unknown[] }).queryKey;
        return key[0] === paginatedKey[0] && key[1] === "paginated";
      }
      return false;
    });
    expect(paginatedInvalidated).toBe(true);
  }

  const equipmentId = "eq-paginated-1";

  it("invalidates paginated list on return (custody changed)", async () => {
    await expectPaginatedInvalidated("EQUIPMENT_CUSTODY_STATE_CHANGED", {
      equipmentId,
      custodyState: "returned",
    });
  });

  it("invalidates paginated list on dock-return", async () => {
    await expectPaginatedInvalidated("EQUIPMENT_DOCK_RETURN", { equipmentId, readinessState: "ready" });
  });

  it("invalidates paginated list on waitlist join", async () => {
    await expectPaginatedInvalidated("EQUIPMENT_WAITLIST_JOINED", {
      equipmentId,
      userId: "u1",
      queueSize: 1,
    });
  });

  it("invalidates paginated list on waitlist leave", async () => {
    await expectPaginatedInvalidated("EQUIPMENT_WAITLIST_LEFT", { equipmentId, userId: "u1", queueSize: 0 });
  });

  it("invalidates paginated list on waitlist promote", async () => {
    await expectPaginatedInvalidated("EQUIPMENT_WAITLIST_PROMOTED", {
      equipmentId,
      userId: "u2",
    });
  });

  it("invalidates paginated list on reservation expiry", async () => {
    await expectPaginatedInvalidated("EQUIPMENT_WAITLIST_EXPIRED", {
      equipmentId,
      userId: "u2",
    });
  });
});
