/**
 * PR #126 review — the board never ships a raw email address to the kiosk.
 * Custodian labels prefer the clinic-scoped display name, then the user name,
 * then the email local part; a row with no resolvable label is skipped.
 */
import { describe, it, expect } from "vitest";
import { resolveCustodianDisplayName } from "../server/lib/custodian-display-name";

describe("resolveCustodianDisplayName", () => {
  it("prefers displayName over name and email", () => {
    expect(resolveCustodianDisplayName("Dr. Dana", "dana levi", "dana@x.com")).toBe("Dr. Dana");
  });

  it("falls back to name when displayName is empty", () => {
    expect(resolveCustodianDisplayName("", "dana levi", "dana@x.com")).toBe("dana levi");
  });

  it("never returns a full email — falls back to the local part", () => {
    expect(resolveCustodianDisplayName("", "", "dana.levi@clinic.example")).toBe("dana.levi");
    expect(resolveCustodianDisplayName(null, null, "dana.levi@clinic.example")).toBe("dana.levi");
  });

  it("returns undefined when nothing resolves", () => {
    expect(resolveCustodianDisplayName("", "", null)).toBeUndefined();
    expect(resolveCustodianDisplayName(null, null, "")).toBeUndefined();
    expect(resolveCustodianDisplayName("  ", " ", "@x.com")).toBeUndefined();
  });
});
