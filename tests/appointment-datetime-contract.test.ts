/**
 * Appointment datetime ISO-contract test (PR-17).
 *
 * `toUtcDate` (server/services/appointments.service.ts) is the single
 * coercion point for appointment start/end/scheduled timestamps. The
 * contract: callers MUST send a timezone-qualified ISO string (an
 * explicit offset or `Z`). An offset-less string is ambiguous and is
 * rejected with TIMEZONE_REQUIRED rather than silently assumed UTC.
 *
 * This test locks that contract on the server, and a source guard
 * checks the appointments UI still emits `.toISOString()` (always `Z`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { toUtcDate } from "../server/services/appointments.service.js";

function errCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe("toUtcDate — timezone-qualified ISO contract", () => {
  it("rejects an offset-less ISO string", () => {
    expect(() => toUtcDate("2026-05-21T14:30:00", "startTime")).toThrow();
    expect(errCode(() => toUtcDate("2026-05-21T14:30:00", "startTime"))).toBe("TIMEZONE_REQUIRED");
  });

  it("rejects a date-only string", () => {
    expect(() => toUtcDate("2026-05-21", "startTime")).toThrow();
  });

  it("accepts an ISO string with a Z (UTC) suffix", () => {
    const d = toUtcDate("2026-05-21T14:30:00Z", "startTime");
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2026-05-21T14:30:00.000Z");
  });

  it("accepts an ISO string with a positive offset", () => {
    const d = toUtcDate("2026-05-21T14:30:00+02:00", "startTime");
    expect(d.toISOString()).toBe("2026-05-21T12:30:00.000Z");
  });

  it("accepts an ISO string with a negative offset", () => {
    const d = toUtcDate("2026-05-21T09:30:00-05:00", "startTime");
    expect(d.toISOString()).toBe("2026-05-21T14:30:00.000Z");
  });

  it("rejects an empty string", () => {
    expect(() => toUtcDate("   ", "startTime")).toThrow();
  });

  it("rejects a non-date string", () => {
    expect(() => toUtcDate("not-a-date", "startTime")).toThrow();
  });

  it("accepts a valid Date object", () => {
    const now = new Date();
    expect(toUtcDate(now, "startTime").getTime()).toBe(now.getTime());
  });

  it("rejects an invalid Date object", () => {
    expect(() => toUtcDate(new Date("nonsense"), "startTime")).toThrow();
  });
});

describe("appointments UI emits timezone-qualified ISO", () => {
  it("sends start/end/scheduled timestamps via .toISOString()", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/pages/appointments.tsx"),
      "utf-8",
    );
    // Every datetime payload field must be assigned from a .toISOString()
    // call — never a raw datetime-local value (which carries no offset).
    for (const field of ["startTime:", "endTime:", "scheduledAt:"]) {
      const re = new RegExp(`${field}[^,\\n]*toISOString\\(\\)`);
      expect(re.test(src), `${field} must be assigned via .toISOString()`).toBe(true);
    }
  });
});
