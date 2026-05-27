import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateEquipmentRfidCaches } from "../src/lib/invalidate-equipment-rfid-caches.js";

describe("invalidateEquipmentRfidCaches", () => {
  it("invalidates allowlist keys only", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    await invalidateEquipmentRfidCaches(client, "eq-1");

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["/api/equipment"]);
    expect(keys).toContainEqual(["/api/equipment/eq-1"]);
    expect(keys).toContainEqual(["equipment-rfid", "eq-1"]);

    const predicates = spy.mock.calls
      .map((c) => c[0]?.predicate)
      .filter((p): p is NonNullable<typeof p> => typeof p === "function");
    expect(predicates.length).toBeGreaterThan(0);
    expect(
      predicates.some((p) =>
        p({ queryKey: ["/api/equipment", "paginated", 1] } as never),
      ),
    ).toBe(true);

    const forbidden = [
      ["equipment-waitlist", "eq-1"],
      ["staging-queue", "eq-1"],
      ["deployability", "eq-1"],
      ["/api/equipment/my"],
      ["/api/containers"],
      ["er", "board"],
      ["/api/display/snapshot"],
    ];
    for (const key of forbidden) {
      expect(keys).not.toContainEqual(key);
    }

    spy.mockRestore();
  });
});
