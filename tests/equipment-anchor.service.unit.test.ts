import { describe, it, expect } from "vitest";
import { nextAnchorState } from "../server/services/equipment-anchor.service.js";
import type { InvalidationReason } from "../server/services/equipment-anchor.service.js";

describe("nextAnchorState (D-13 sticky-until-contradicted)", () => {
  it("time alone never invalidates", () => {
    expect(nextAnchorState({ invalidatedAt: null }, { kind: "time_elapsed" }))
      .toEqual({ invalidated: false, reason: null });
  });

  it.each<InvalidationReason>(["checkout", "rfid_elsewhere", "sweep_missing", "not_found_here"])(
    "a %s contradiction invalidates with that reason",
    (reason) => {
      expect(nextAnchorState({ invalidatedAt: null }, { kind: "contradiction", reason }))
        .toEqual({ invalidated: true, reason });
    },
  );

  it("already-invalidated is idempotent — stays invalidated, no throw", () => {
    expect(() =>
      nextAnchorState({ invalidatedAt: new Date() }, { kind: "contradiction", reason: "checkout" }),
    ).not.toThrow();
    expect(nextAnchorState({ invalidatedAt: new Date() }, { kind: "contradiction", reason: "checkout" }))
      .toEqual({ invalidated: true, reason: null });
  });

  it("already-invalidated + time_elapsed stays invalidated, idempotent", () => {
    expect(nextAnchorState({ invalidatedAt: new Date() }, { kind: "time_elapsed" }))
      .toEqual({ invalidated: true, reason: null });
  });
});
