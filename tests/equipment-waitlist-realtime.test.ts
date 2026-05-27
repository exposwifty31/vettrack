import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { applyEvent } from "../src/lib/event-reducer.js";
import { invalidateEquipmentCaches } from "../src/lib/equipment-realtime.js";

vi.mock("@/lib/equipment-realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/equipment-realtime.js")>();
  return {
    ...actual,
    invalidateEquipmentCaches: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@/lib/auth-store", () => ({
  getCurrentUserId: () => "user-b",
}));

describe("equipment waitlist realtime reducer", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    vi.mocked(invalidateEquipmentCaches).mockClear();
  });

  it("invalidates equipment caches on WAITLIST_JOINED", async () => {
    await applyEvent(client, {
      type: "EQUIPMENT_WAITLIST_JOINED",
      payload: { equipmentId: "eq-1", userId: "user-a", queueSize: 1, position: 1 },
      timestamp: new Date().toISOString(),
    });
    expect(invalidateEquipmentCaches).toHaveBeenCalledWith(client, "eq-1");
  });

  it("invalidates equipment caches on CUSTODY_STATE_CHANGED", async () => {
    await applyEvent(client, {
      type: "EQUIPMENT_CUSTODY_STATE_CHANGED",
      payload: { equipmentId: "eq-2", custodyState: "returned" },
      timestamp: new Date().toISOString(),
    });
    expect(invalidateEquipmentCaches).toHaveBeenCalledWith(client, "eq-2");
  });
});
