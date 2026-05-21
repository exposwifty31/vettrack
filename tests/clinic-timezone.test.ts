import { describe, it, expect } from "vitest";
import { clinicDayUtcRange, clinicTodayIsoDate } from "../server/lib/clinic-timezone.js";

describe("clinic-timezone", () => {
  it("Asia/Jerusalem midnight maps to correct UTC offset in winter", () => {
    const { dayStart, dayEnd } = clinicDayUtcRange("2026-01-15", "Asia/Jerusalem");
    expect(dayStart.toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-01-15T22:00:00.000Z");
  });

  it("clinicTodayIsoDate uses clinic timezone, not UTC calendar", () => {
    // 2026-01-15 23:30 UTC is already 2026-01-16 in Jerusalem (UTC+2 winter)
    const now = new Date("2026-01-15T23:30:00.000Z");
    expect(clinicTodayIsoDate("Asia/Jerusalem", now)).toBe("2026-01-16");
    expect(clinicTodayIsoDate("UTC", now)).toBe("2026-01-15");
  });
});

describe("clinic-timezone — DST transitions (Asia/Jerusalem)", () => {
  const TZ = "Asia/Jerusalem";
  const HOUR_MS = 60 * 60 * 1000;

  it("day BEFORE spring-forward (2026-03-26) is 24h long in UTC", () => {
    const { dayStart, dayEnd } = clinicDayUtcRange("2026-03-26", TZ);
    expect(dayStart.toISOString()).toBe("2026-03-25T22:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-03-26T22:00:00.000Z");
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(24 * HOUR_MS);
  });

  it("spring-forward day (2026-03-27) is 23h long in UTC", () => {
    const { dayStart, dayEnd } = clinicDayUtcRange("2026-03-27", TZ);
    expect(dayStart.toISOString()).toBe("2026-03-26T22:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-03-27T21:00:00.000Z");
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(23 * HOUR_MS);
  });

  it("day AFTER spring-forward (2026-03-28) is 24h long at +3 offset", () => {
    const { dayStart, dayEnd } = clinicDayUtcRange("2026-03-28", TZ);
    expect(dayStart.toISOString()).toBe("2026-03-27T21:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-03-28T21:00:00.000Z");
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(24 * HOUR_MS);
  });

  it("day BEFORE fall-back (2026-10-24) is 24h long at +3 offset", () => {
    const { dayStart, dayEnd } = clinicDayUtcRange("2026-10-24", TZ);
    expect(dayStart.toISOString()).toBe("2026-10-23T21:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(24 * HOUR_MS);
  });

  it("fall-back day (2026-10-25) is 25h long in UTC", () => {
    const { dayStart, dayEnd } = clinicDayUtcRange("2026-10-25", TZ);
    expect(dayStart.toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(25 * HOUR_MS);
  });

  it("clinicTodayIsoDate after spring-forward boundary (UTC 23:30)", () => {
    const now = new Date("2026-03-26T23:30:00.000Z");
    expect(clinicTodayIsoDate(TZ, now)).toBe("2026-03-27");
  });

  it("clinicTodayIsoDate after fall-back boundary (UTC 22:30)", () => {
    const now = new Date("2026-10-25T22:30:00.000Z");
    expect(clinicTodayIsoDate(TZ, now)).toBe("2026-10-26");
  });
});
