import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { applyEvent, DISPLAY_SNAPSHOT_QUERY_KEY } from "../src/lib/event-reducer.js";
import { invalidateEquipmentCaches } from "../src/lib/equipment-realtime.js";
import { invalidateEquipmentRfidCaches } from "../src/lib/invalidate-equipment-rfid-caches.js";

vi.mock("@/lib/equipment-realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/equipment-realtime.js")>();
  return {
    ...actual,
    invalidateEquipmentCaches: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@/lib/invalidate-equipment-rfid-caches", () => ({
  invalidateEquipmentRfidCaches: vi.fn(() => Promise.resolve()),
}));

describe("EQUIPMENT_RFID_OBSERVED event reducer", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    vi.mocked(invalidateEquipmentRfidCaches).mockClear();
    vi.mocked(invalidateEquipmentCaches).mockClear();
  });

  it("calls narrow RFID invalidation only", async () => {
    await applyEvent(client, {
      type: "EQUIPMENT_RFID_OBSERVED",
      payload: { equipmentId: "eq-rfid-1" },
      timestamp: new Date().toISOString(),
    });

    expect(invalidateEquipmentRfidCaches).toHaveBeenCalledWith(client, "eq-rfid-1");
    expect(invalidateEquipmentCaches).not.toHaveBeenCalled();
  });

  it("does not invalidate waitlist, staging, deployability, my, display, containers", async () => {
    const spy = vi.spyOn(client, "invalidateQueries");
    await applyEvent(client, {
      type: "EQUIPMENT_RFID_OBSERVED",
      payload: { equipmentId: "eq-rfid-2" },
      timestamp: new Date().toISOString(),
    });

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).not.toContainEqual(["equipment-waitlist", "eq-rfid-2"]);
    expect(keys).not.toContainEqual(["staging-queue", "eq-rfid-2"]);
    expect(keys).not.toContainEqual(["deployability", "eq-rfid-2"]);
    expect(keys).not.toContainEqual(["/api/equipment/my"]);
    expect(keys).not.toContainEqual([...DISPLAY_SNAPSHOT_QUERY_KEY]);
    expect(keys).not.toContainEqual(["/api/containers"]);
    spy.mockRestore();
  });
});
