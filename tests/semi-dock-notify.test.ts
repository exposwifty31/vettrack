/**
 * Semi-dock notify — pure helper regression tests.
 *
 * Covers home-room detection used before semi-dock push delivery
 * (server/lib/semi-dock-notify.ts). No DB or push required.
 */

import { describe, expect, it } from "vitest";
import {
  buildEquipmentHomeRoomIds,
  buildSemiDockTag,
  isEquipmentHomeRoom,
} from "../server/lib/semi-dock-notify.js";

describe("buildSemiDockTag", () => {
  it("prefixes equipment id for push dedupe tag", () => {
    expect(buildSemiDockTag("eq-abc")).toBe("semi-dock:eq-abc");
  });
});

describe("buildEquipmentHomeRoomIds + isEquipmentHomeRoom", () => {
  it("treats the equipment's own room as home", () => {
    const home = buildEquipmentHomeRoomIds("home-room", null);
    expect(isEquipmentHomeRoom("home-room", home)).toBe(true);
  });

  it("treats the equipment's dock room as home", () => {
    const home = buildEquipmentHomeRoomIds(null, "dock-room-a");
    expect(isEquipmentHomeRoom("dock-room-a", home)).toBe(true);
  });

  it("matches either the equipment room or its dock room", () => {
    const home = buildEquipmentHomeRoomIds("home-room", "dock-room-a");
    expect(isEquipmentHomeRoom("home-room", home)).toBe(true);
    expect(isEquipmentHomeRoom("dock-room-a", home)).toBe(true);
  });

  it("returns false for a room that is neither the equipment room nor its dock room", () => {
    const home = buildEquipmentHomeRoomIds("home-room", "dock-room-a");
    expect(isEquipmentHomeRoom("other-room", home)).toBe(false);
  });

  it("returns false when equipment has no home room and no dock room", () => {
    const home = buildEquipmentHomeRoomIds(null, null);
    expect(isEquipmentHomeRoom("other-room", home)).toBe(false);
  });
});
