import { describe, it, expect } from "vitest";
import {
  classifyReconciliationBucket,
  type ClassifierItem,
  type ClassifierCtx,
} from "../server/services/docking.service.js";

// Baseline: an item resting at home, anchored at its home dock → "at_home".
// Individual tests override only the fields relevant to the bucket under test.
const item = (over: Partial<ClassifierItem> = {}): ClassifierItem => ({
  checkedOutById: null,
  homeRoomId: "icu",
  assetTypeId: "pump",
  roomId: "icu",
  lastRfidRoomId: null,
  ...over,
});

const ctx = (over: Partial<ClassifierCtx> = {}): ClassifierCtx => ({
  homeDock: { id: "dock-icu-pump" },
  currentAnchor: { dockId: "dock-icu-pump" },
  lastContradictionReason: null,
  ...over,
});

describe("classifyReconciliationBucket", () => {
  describe("checked_out", () => {
    it("returns checked_out when checkedOutById is set", () => {
      expect(classifyReconciliationBucket(item({ checkedOutById: "user-1" }), ctx())).toBe("checked_out");
    });

    it("returns checked_out even when the last contradiction reason is not_found_here (D-9: never missing)", () => {
      expect(
        classifyReconciliationBucket(
          item({ checkedOutById: "user-1" }),
          ctx({ currentAnchor: null, lastContradictionReason: "not_found_here" }),
        ),
      ).toBe("checked_out");
    });
  });

  describe("unassigned", () => {
    it("returns unassigned when homeRoomId is null", () => {
      expect(classifyReconciliationBucket(item({ homeRoomId: null }), ctx())).toBe("unassigned");
    });

    it("returns unassigned when assetTypeId is null (homeRoomId set)", () => {
      expect(classifyReconciliationBucket(item({ assetTypeId: null }), ctx())).toBe("unassigned");
    });
  });

  describe("no_station", () => {
    it("returns no_station when homed + categorized but no dock exists for (room, category)", () => {
      expect(classifyReconciliationBucket(item(), ctx({ homeDock: null }))).toBe("no_station");
    });
  });

  describe("at_home", () => {
    it("returns at_home when resting and the current anchor is at the home dock", () => {
      expect(classifyReconciliationBucket(item(), ctx())).toBe("at_home");
    });
  });

  describe("misplaced_at_station", () => {
    it("returns misplaced_at_station when resting and the current anchor is at a non-home dock", () => {
      expect(classifyReconciliationBucket(item(), ctx({ currentAnchor: { dockId: "dock-ward-pump" } }))).toBe(
        "misplaced_at_station",
      );
    });
  });

  describe("returned_away", () => {
    it("returns returned_away when resting, no current anchor, and presence (RFID) is a room other than home", () => {
      expect(
        classifyReconciliationBucket(
          item({ roomId: "icu", lastRfidRoomId: "ward" }),
          ctx({ currentAnchor: null }),
        ),
      ).toBe("returned_away");
    });
  });

  describe("missing", () => {
    it("returns missing when presence is not outside home and the last contradiction is sweep_missing", () => {
      expect(
        classifyReconciliationBucket(
          item({ roomId: "icu", lastRfidRoomId: null }),
          ctx({ currentAnchor: null, lastContradictionReason: "sweep_missing" }),
        ),
      ).toBe("missing");
    });

    it("returns missing when presence is not outside home and the last contradiction is not_found_here", () => {
      expect(
        classifyReconciliationBucket(
          item({ roomId: "icu", lastRfidRoomId: null }),
          ctx({ currentAnchor: null, lastContradictionReason: "not_found_here" }),
        ),
      ).toBe("missing");
    });
  });

  describe("returned_unverified", () => {
    it("returns returned_unverified when resting, no current anchor, no contradiction, and presence is not outside home", () => {
      expect(
        classifyReconciliationBucket(
          item({ roomId: "icu", lastRfidRoomId: null }),
          ctx({ currentAnchor: null, lastContradictionReason: null }),
        ),
      ).toBe("returned_unverified");
    });
  });

  describe("ladder precedence", () => {
    it("checked_out beats unassigned — a checked-out item with no home still returns checked_out", () => {
      expect(classifyReconciliationBucket(item({ checkedOutById: "user-1", homeRoomId: null }), ctx())).toBe(
        "checked_out",
      );
    });

    it("returned_away beats missing — known location outside home wins over a not_found_here contradiction", () => {
      expect(
        classifyReconciliationBucket(
          item({ roomId: "icu", lastRfidRoomId: "ward" }),
          ctx({ currentAnchor: null, lastContradictionReason: "not_found_here" }),
        ),
      ).toBe("returned_away");
    });
  });
});
