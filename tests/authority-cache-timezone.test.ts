// tests/authority-cache-timezone.test.ts
import { describe, it, expect } from "vitest";
import { clinicTodayIsoDate } from "../server/lib/clinic-timezone.js";

describe("authority-cache day-bucket consistency with clinic timezone (TZ-01)", () => {
  it("23:30 UTC on 2026-01-15 buckets as 2026-01-16 for Asia/Jerusalem", () => {
    const now = new Date("2026-01-15T23:30:00.000Z");
    expect(clinicTodayIsoDate("Asia/Jerusalem", now)).toBe("2026-01-16");
    expect(clinicTodayIsoDate("UTC", now)).toBe("2026-01-15");
  });

  it("00:30 UTC on 2026-01-15 buckets as 2026-01-15 for Asia/Jerusalem", () => {
    const now = new Date("2026-01-15T00:30:00.000Z");
    expect(clinicTodayIsoDate("Asia/Jerusalem", now)).toBe("2026-01-15");
  });

  it("returns identical day for noon UTC across both zones", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    expect(clinicTodayIsoDate("Asia/Jerusalem", now)).toBe("2026-01-15");
    expect(clinicTodayIsoDate("UTC", now)).toBe("2026-01-15");
  });
});
