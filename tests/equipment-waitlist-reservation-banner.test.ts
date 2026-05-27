import { describe, expect, it } from "vitest";
import {
  formatReservationCountdown,
  isReservationExpired,
  reservationMinutesRemaining,
  shouldShowReservationBanner,
  shouldShowWaitlistJoinPanel,
} from "../src/lib/equipment-waitlist-ui";

const NOW = new Date("2026-05-27T12:00:00.000Z").getTime();

describe("equipment waitlist reservation banner visibility", () => {
  it("shows banner when notified and reservation not expired (custody returned)", () => {
    const expiresAt = new Date(NOW + 5 * 60_000).toISOString();
    expect(
      shouldShowReservationBanner("notified", expiresAt, NOW),
    ).toBe(true);
    expect(
      shouldShowWaitlistJoinPanel(
        { custodyState: "returned", checkedOutById: null },
        "user-b",
      ),
    ).toBe(false);
  });

  it("hides banner when reservation expired", () => {
    const expiresAt = new Date(NOW - 1_000).toISOString();
    expect(isReservationExpired(expiresAt, NOW)).toBe(true);
    expect(shouldShowReservationBanner("notified", expiresAt, NOW)).toBe(false);
  });

  it("hides banner when status is fulfilled after checkout", () => {
    const expiresAt = new Date(NOW + 5 * 60_000).toISOString();
    expect(shouldShowReservationBanner("fulfilled", expiresAt, NOW)).toBe(false);
  });

  it("hides banner when user left waitlist", () => {
    const expiresAt = new Date(NOW + 5 * 60_000).toISOString();
    expect(shouldShowReservationBanner("cancelled", expiresAt, NOW)).toBe(false);
  });

  it("formats countdown and minutes remaining for subtitle copy", () => {
    const expiresAt = new Date(NOW + 90_000).toISOString();
    expect(formatReservationCountdown(expiresAt, NOW)).toBe("1:30");
    expect(reservationMinutesRemaining(expiresAt, NOW)).toBe(2);
  });

  it("shows join panel only while another user holds checkout", () => {
    expect(
      shouldShowWaitlistJoinPanel(
        { custodyState: "checked_out", checkedOutById: "user-a" },
        "user-b",
      ),
    ).toBe(true);
    expect(
      shouldShowWaitlistJoinPanel(
        { custodyState: "returned", checkedOutById: null },
        "user-b",
      ),
    ).toBe(false);
  });
});
