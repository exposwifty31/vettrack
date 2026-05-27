import { describe, expect, it } from "vitest";
import { shouldShowRfidAttentionBadge } from "../src/lib/equipment-rfid-display.js";

const NOW = Date.parse("2026-05-27T12:00:00.000Z");
const FRESH = "2026-05-27T11:50:00.000Z";
const STALE = "2026-05-27T11:00:00.000Z";

const base = {
  custodyState: "checked_out" as const,
  lastRfidSeenAt: FRESH,
  lastRfidRoomIsDock: true,
  lastRfidRoomName: "Equipment Storage",
  checkedOutByEmail: "tech@clinic.test",
};

describe("shouldShowRfidAttentionBadge", () => {
  it("shows when checked out, fresh, and dock room", () => {
    expect(shouldShowRfidAttentionBadge(base, NOW)).toBe(true);
  });

  it("hidden when not checked out", () => {
    expect(shouldShowRfidAttentionBadge({ ...base, custodyState: "docked" }, NOW)).toBe(false);
  });

  it("hidden when RFID signal is stale (>15 min)", () => {
    expect(shouldShowRfidAttentionBadge({ ...base, lastRfidSeenAt: STALE }, NOW)).toBe(false);
  });

  it("hidden when last RFID room is not a dock room", () => {
    expect(shouldShowRfidAttentionBadge({ ...base, lastRfidRoomIsDock: false }, NOW)).toBe(false);
  });

  it("hidden when room name missing", () => {
    expect(shouldShowRfidAttentionBadge({ ...base, lastRfidRoomName: null }, NOW)).toBe(false);
  });
});
