import { describe, expect, it } from "vitest";
import {
  computeHolderReturnEstimate,
  shouldShowHolderReturnContext,
  shouldShowReservationBanner,
} from "../src/lib/equipment-waitlist-ui";

const NOW = new Date("2026-05-27T12:00:00.000Z").getTime();

describe("computeHolderReturnEstimate", () => {
  it("derives expected return from checkout + configured minutes", () => {
    const checkedOutAt = new Date(NOW - 10 * 60_000).toISOString();
    const result = computeHolderReturnEstimate(
      {
        checkedOutAt,
        expectedReturnMinutes: 15,
        custodyState: "checked_out",
      },
      NOW,
    );
    expect(result.hasEstimate).toBe(true);
    expect(result.expectedReturnAt?.getTime()).toBe(NOW + 5 * 60_000);
    expect(result.isOverdue).toBe(false);
  });

  it("marks overdue when past expected return and still checked out", () => {
    const checkedOutAt = new Date(NOW - 20 * 60_000).toISOString();
    const result = computeHolderReturnEstimate(
      {
        checkedOutAt,
        expectedReturnMinutes: 15,
        custodyState: "checked_out",
      },
      NOW,
    );
    expect(result.isOverdue).toBe(true);
  });

  it("returns no estimate when expectedReturnMinutes unset", () => {
    const result = computeHolderReturnEstimate(
      {
        checkedOutAt: new Date(NOW).toISOString(),
        expectedReturnMinutes: null,
        custodyState: "checked_out",
      },
      NOW,
    );
    expect(result.hasEstimate).toBe(false);
    expect(result.isOverdue).toBe(false);
  });
});

describe("shouldShowHolderReturnContext", () => {
  it("shows for waiter while another user holds checkout", () => {
    expect(
      shouldShowHolderReturnContext(
        { custodyState: "checked_out", checkedOutById: "user-a" },
        "user-b",
        false,
      ),
    ).toBe(true);
  });

  it("hides when reservation banner is active", () => {
    expect(
      shouldShowHolderReturnContext(
        { custodyState: "returned", checkedOutById: null },
        "user-b",
        shouldShowReservationBanner("notified", new Date(NOW + 60_000).toISOString(), NOW),
      ),
    ).toBe(false);
  });
});
