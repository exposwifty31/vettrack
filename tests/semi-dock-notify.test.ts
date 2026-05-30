/**
 * Semi-dock notify — pure helper regression tests.
 *
 * Covers home-room detection used before semi-dock push delivery
 * (server/lib/semi-dock-notify.ts). No DB or push required.
 */

import { describe, expect, it } from "vitest";
import {
  buildSemiDockTag,
  isEquipmentHomeRoom,
} from "../server/lib/semi-dock-notify.js";

describe("buildSemiDockTag", () => {
  it("prefixes equipment id for push dedupe tag", () => {
    expect(buildSemiDockTag("eq-abc")).toBe("semi-dock:eq-abc");
  });
});

describe("isEquipmentHomeRoom", () => {
  const dockRoomIds = new Set(["dock-room-a", "dock-room-b"]);

  it("returns true when new room matches equipment home room", () => {
    expect(isEquipmentHomeRoom("home-room", "home-room", dockRoomIds)).toBe(true);
  });

  it("returns true when new room is a known dock room (no explicit home)", () => {
    expect(isEquipmentHomeRoom(null, "dock-room-a", dockRoomIds)).toBe(true);
  });

  it("returns false for a non-home, non-dock room", () => {
    expect(isEquipmentHomeRoom("home-room", "other-room", dockRoomIds)).toBe(false);
  });

  it("returns false when equipment has no home and room is not a dock", () => {
    expect(isEquipmentHomeRoom(null, "other-room", dockRoomIds)).toBe(false);
  });

  it("prefers explicit home match over dock membership", () => {
    expect(isEquipmentHomeRoom("home-room", "home-room", new Set())).toBe(true);
  });
});
