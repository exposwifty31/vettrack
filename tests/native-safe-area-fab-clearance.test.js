/**
 * H4 + H5 (UX audit) — static source checks in the house
 * phase-6-state-consistency style.
 *
 * H4: landscape iPhone puts the camera housing on a horizontal edge; the
 * native chrome (header, tab bar) and the phone scroll container must pad
 * with env(safe-area-inset-left/right) or leading controls render under it.
 * H5: the floating chat FAB (48px + 8px gap above the tab bar) overlapped
 * the last rows of the equipment and alerts screens; their scrollers must
 * reserve FAB clearance in their bottom padding.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");

const nativeShell = read("src/native/NativeShell.tsx");
const nativeHeader = read("src/native/NativeHeader.tsx");
const nativeTabBar = read("src/native/NativeTabBar.tsx");
const equipmentScreen = read("src/features/equipment/EquipmentListScreen.tsx");
const alertsScreen = read("src/features/alerts/AlertsScreen.tsx");

describe("H4 — horizontal safe-area insets on native chrome", () => {
  it("phone scroll container pads both horizontal safe areas", () => {
    expect(nativeShell.includes('paddingLeft: "env(safe-area-inset-left)"')).toBe(true);
    expect(nativeShell.includes('paddingRight: "env(safe-area-inset-right)"')).toBe(true);
  });

  it("header row clears the housing on either edge", () => {
    expect(nativeHeader.includes("env(safe-area-inset-left)")).toBe(true);
    expect(nativeHeader.includes("env(safe-area-inset-right)")).toBe(true);
  });

  it("tab bar pads both horizontal safe areas", () => {
    expect(nativeTabBar.includes("env(safe-area-inset-left)")).toBe(true);
    expect(nativeTabBar.includes("env(safe-area-inset-right)")).toBe(true);
  });
});

describe("H5 — content clears the floating chat FAB", () => {
  it("equipment list scroller reserves FAB clearance", () => {
    expect(equipmentScreen.includes("calc(72px + env(safe-area-inset-bottom))")).toBe(true);
  });

  it("alerts scroller reserves FAB clearance", () => {
    expect(alertsScreen.includes("calc(72px + env(safe-area-inset-bottom))")).toBe(true);
  });
});
