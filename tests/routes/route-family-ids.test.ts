import { describe, expect, it } from "vitest";
import { resolveRouteFamilyId } from "../../src/lib/routes/route-family-ids.js";

describe("resolveRouteFamilyId", () => {
  it("matches locations family for canonical and trailing slash paths", () => {
    expect(resolveRouteFamilyId("/locations/123")).toBe("locations");
    expect(resolveRouteFamilyId("/locations/123/")).toBe("locations");
    expect(resolveRouteFamilyId("/rooms/abc")).toBe("locations");
  });

  it("returns null for internal duplicate slash paths", () => {
    expect(resolveRouteFamilyId("/locations//123")).toBeNull();
    expect(resolveRouteFamilyId("/display//settings")).toBeNull();
  });

  it("matches equipment board aliases", () => {
    expect(resolveRouteFamilyId("/display")).toBe("equipmentBoard");
    expect(resolveRouteFamilyId("/equipment-board")).toBe("equipmentBoard");
  });
});
