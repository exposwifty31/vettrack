import { describe, it, expect } from "vitest";
import { scanAffordance } from "@/lib/scan-affordance";

describe("scanAffordance — the single scan-surface gate", () => {
  it("web (not native), phone viewport → none", () => {
    expect(scanAffordance({ isNative: false, isTablet: false })).toBe("none");
  });

  it("web (not native), tablet viewport → none", () => {
    expect(scanAffordance({ isNative: false, isTablet: true })).toBe("none");
  });

  it("native phone → tab", () => {
    expect(scanAffordance({ isNative: true, isTablet: false })).toBe("tab");
  });

  it("native tablet → fab", () => {
    expect(scanAffordance({ isNative: true, isTablet: true })).toBe("fab");
  });

  it("web never shows scan UI regardless of viewport", () => {
    expect(scanAffordance({ isNative: false, isTablet: false })).toBe("none");
    expect(scanAffordance({ isNative: false, isTablet: true })).toBe("none");
  });

  it("native always shows a scan surface (never none)", () => {
    expect(scanAffordance({ isNative: true, isTablet: false })).not.toBe("none");
    expect(scanAffordance({ isNative: true, isTablet: true })).not.toBe("none");
  });
});
