/**
 * UX-audit remediation Phase 6 — M4–M9 consistency contracts.
 *
 * - M9: the nav model drops the "End shift" session section when the caller
 *   reports no active roster shift; both native consumers pass shift state.
 * - M5: the scan header subtitle swaps to the off-shift string when blocked.
 * - M6: the code-blue leave/back button renders only outside the native shell
 *   (Emergency is a tab root there — the tab bar / sidebar is the escape).
 * - M4: room-radar verify-all label ellipsizes on one line; the equipment
 *   card title directs the truncation line by content (dir="auto").
 * - Polish: the Code Blue manager copy no longer reads "distribution manager"
 *   in either locale; nav labels no longer collide.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";
import { getNativeNavSections } from "../src/lib/routes/native-nav-model";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("M9 — end-shift row gated on active shift", () => {
  it("drops the session section when hasActiveShift is false", () => {
    const sections = getNativeNavSections({ hasActiveShift: false });
    expect(sections.some((s) => s.id === "session")).toBe(false);
  });

  it("keeps the session section when on shift and for legacy callers", () => {
    expect(getNativeNavSections({ hasActiveShift: true }).some((s) => s.id === "session")).toBe(true);
    expect(getNativeNavSections().some((s) => s.id === "session")).toBe(true);
  });

  it("both native consumers pass roster shift state", () => {
    for (const file of ["src/features/settings/MoreSheet.tsx", "src/native/NativeTabSidebar.tsx"]) {
      const source = read(file);
      expect(source).toContain("useActiveShift");
      expect(source).toContain("getNativeNavSections({ hasActiveShift: shiftLoading || hasActiveShift })");
    }
  });
});

describe("M5 — scan subtitle follows shift state", () => {
  it("ScanScreen swaps the prompt when scanning is blocked", () => {
    const source = read("src/features/scan/ScanScreen.tsx");
    expect(source).toContain("scanBlocked ? t.scan.offShiftSubtitle : t.scan.scanPrompt");
  });

  it("scan.offShiftSubtitle exists in both locales", () => {
    expect(typeof enDict.scan.offShiftSubtitle).toBe("string");
    expect(typeof heDict.scan.offShiftSubtitle).toBe("string");
  });
});

describe("M6 — code-blue back button hidden on the tab root", () => {
  it("gates the leave-setup button on the native shell context", () => {
    const source = read("src/pages/code-blue.tsx");
    expect(source).toContain("useNativeShellContext");
    const gateIdx = source.indexOf("{!inNativeShell && (");
    const buttonIdx = source.indexOf("code-blue-leave-setup");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(buttonIdx).toBeGreaterThan(gateIdx);
  });
});

describe("M4 — room-radar detail pane fixes", () => {
  const source = read("src/pages/room-radar.tsx");

  it("verify-all button reserves min-w-0 and ellipsizes its label", () => {
    expect(source).toContain('"flex-1 min-w-0 flex items-center justify-center gap-2');
    expect(source).toMatch(/<span className="truncate">\s*\{t\.roomRadarPage\.verifyAllInRoom/);
  });

  it("equipment card title truncates by content direction", () => {
    expect(source).toMatch(/<p dir="auto" className="font-bold text-base truncate/);
  });
});

describe("Polish — Code Blue manager copy + nav label collisions", () => {
  it('English says "Event manager", not "Distribution manager"', () => {
    expect(enDict.codeBlue.managerLabel).toBe("Event manager");
    expect(enDict.codeBlue.managerInstruction).not.toMatch(/distribution/i);
    expect(enDict.codeBlue.managerOnlyHint).not.toMatch(/distribution/i);
  });

  it('Hebrew no longer uses the "distribution" (הפצה) mistranslation', () => {
    const distribution = "הפצה";
    for (const value of [
      heDict.codeBlue.managerLabel,
      heDict.codeBlue.managerLabelShort,
      heDict.codeBlue.managerInstruction,
      heDict.codeBlue.managerOnlyHint,
    ]) {
      expect(value).not.toContain(distribution);
    }
  });

  it("nav item labels no longer collide in Hebrew", () => {
    expect(heDict.nav.admin).not.toBe(heDict.nav.managementSection);
    expect(heDict.nav.inventoryItems).not.toBe(heDict.nav.inventory);
    expect(heDict.nav.mine.length).toBeGreaterThan("שלי".length);
  });
});
