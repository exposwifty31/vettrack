import { describe, it, expect } from "vitest";
import { resolveHomeDock, dockExpectedFill } from "../server/services/docking.service.js";

const dock = (over = {}) => ({ id: "d1", clinicId: "c1", name: "ICU Pump Station",
  roomId: "icu", assetTypeId: "pump", capacity: 4, description: null, createdAt: new Date() as any, ...over });

describe("resolveHomeDock", () => {
  it("returns the unique dock matching home room + category", () => {
    const d = dock();
    expect(resolveHomeDock({ homeRoomId: "icu", assetTypeId: "pump" }, [d, dock({ id: "d2", assetTypeId: "monitor" })]))
      .toEqual(d);
  });
  it("returns null when home room is unset", () => {
    expect(resolveHomeDock({ homeRoomId: null, assetTypeId: "pump" }, [dock()])).toBeNull();
  });
  it("returns null when no station exists for that (room, category)", () => {
    expect(resolveHomeDock({ homeRoomId: "icu", assetTypeId: "pump" }, [dock({ roomId: "ward" })])).toBeNull();
  });
});

describe("dockExpectedFill", () => {
  it("counts items homed to this dock's (room, category)", () => {
    const eq = (h: string | null, a: string | null) => ({ homeRoomId: h, assetTypeId: a });
    expect(dockExpectedFill({ roomId: "icu", assetTypeId: "pump" },
      [eq("icu", "pump"), eq("icu", "pump"), eq("icu", "monitor"), eq("ward", "pump"), eq(null, "pump")]))
      .toBe(2);
  });
});
