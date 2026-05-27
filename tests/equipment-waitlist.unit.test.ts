import { describe, it, expect } from "vitest";
import {
  isWaitlistJoinEligible,
  isWaitlistPromotionEligible,
} from "../server/services/equipment-waitlist.service.js";

describe("equipment waitlist eligibility", () => {
  const base = {
    checkedOutById: "user-a",
    custodyState: "checked_out",
    deletedAt: null as Date | null,
  };

  it("allows join when another user holds checkout", () => {
    expect(isWaitlistJoinEligible(base, "user-b")).toBe(true);
  });

  it("rejects join when self holds checkout", () => {
    expect(isWaitlistJoinEligible(base, "user-a")).toBe(false);
  });

  it("rejects join when not checked out", () => {
    expect(
      isWaitlistJoinEligible({ ...base, custodyState: "docked", checkedOutById: null }, "user-b"),
    ).toBe(false);
  });

  it("allows promotion when custody released", () => {
    expect(
      isWaitlistPromotionEligible({
        checkedOutById: null,
        custodyState: "returned",
        deletedAt: null,
      }),
    ).toBe(true);
  });

  it("rejects promotion while still checked out", () => {
    expect(isWaitlistPromotionEligible(base)).toBe(false);
  });
});
