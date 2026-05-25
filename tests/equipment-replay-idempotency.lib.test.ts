import { describe, expect, it } from "vitest";
import {
  buildEquipmentReplayStorageKey,
  hashEquipmentReplayRequest,
  stableStringify,
} from "../server/lib/equipment-replay-idempotency.js";

describe("equipment-replay-idempotency lib", () => {
  it("buildEquipmentReplayStorageKey scopes by user", () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";
    expect(buildEquipmentReplayStorageKey("user-a", key)).toBe(`user-a:${key}`);
    expect(buildEquipmentReplayStorageKey("user-b", key)).toBe(`user-b:${key}`);
    expect(buildEquipmentReplayStorageKey("user-a", key)).not.toBe(
      buildEquipmentReplayStorageKey("user-b", key),
    );
  });

  it("hashEquipmentReplayRequest is stable for equivalent bodies", () => {
    const h1 = hashEquipmentReplayRequest("POST", "/api/equipment/eq-1/checkout", { location: "ICU" });
    const h2 = hashEquipmentReplayRequest("POST", "/api/equipment/eq-1/checkout", { location: "ICU" });
    expect(h1).toBe(h2);
  });

  it("hashEquipmentReplayRequest differs when body changes", () => {
    const h1 = hashEquipmentReplayRequest("POST", "/api/equipment/eq-1/checkout", { location: "A" });
    const h2 = hashEquipmentReplayRequest("POST", "/api/equipment/eq-1/checkout", { location: "B" });
    expect(h1).not.toBe(h2);
  });

  it("stableStringify sorts object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});
