import { describe, it, expect, afterEach } from "vitest";
import { formatProposalDate } from "../../server/lib/autopilot/format-proposal-date.js";

const ISO_DAY = "2026-07-22";
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("formatProposalDate", () => {
  it("renders an ISO day in the en-US civil format for locale 'en'", () => {
    expect(formatProposalDate(ISO_DAY, "en")).toBe("7/22/2026");
  });

  it("renders an ISO day in the he-IL civil format for locale 'he'", () => {
    expect(formatProposalDate(ISO_DAY, "he")).toBe("22.7.2026");
  });

  it("never returns the raw ISO string for a parseable day — that is the defect this helper exists to prevent", () => {
    expect(formatProposalDate(ISO_DAY, "en")).not.toBe(ISO_DAY);
    expect(formatProposalDate(ISO_DAY, "he")).not.toBe(ISO_DAY);
  });

  it("fails soft: returns the input unchanged when the value does not parse, so one bad row cannot throw mid-scan", () => {
    expect(formatProposalDate("not-a-date", "en")).toBe("not-a-date");
    expect(formatProposalDate("2026-13-45", "he")).toBe("2026-13-45");
    expect(formatProposalDate("", "en")).toBe("");
  });

  it("holds the calendar day fixed regardless of the host timezone — a date-only value must not shift west of UTC", () => {
    process.env.TZ = "America/New_York";
    expect(formatProposalDate(ISO_DAY, "en")).toBe("7/22/2026");
    process.env.TZ = "Pacific/Kiritimati";
    expect(formatProposalDate(ISO_DAY, "en")).toBe("7/22/2026");
  });
});

describe("calendar-overflow rejection (round-trip guard)", () => {
  it("returns overflow days unchanged instead of the normalized WRONG day", () => {
    // Date.parse normalizes these (2026-02-30 → Mar 2) — NaN cannot catch them.
    expect(formatProposalDate("2026-02-30", "en")).toBe("2026-02-30");
    expect(formatProposalDate("2026-02-29", "en")).toBe("2026-02-29"); // 2026 is not a leap year
    expect(formatProposalDate("2026-04-31", "he")).toBe("2026-04-31");
  });

  it("still formats a real leap day", () => {
    expect(formatProposalDate("2024-02-29", "en")).toBe(
      new Date("2024-02-29T00:00:00.000Z").toLocaleDateString("en-US", { timeZone: "UTC" }),
    );
  });

  it("rejects non-ISO-day shapes outright", () => {
    expect(formatProposalDate("29/02/2024", "en")).toBe("29/02/2024");
    expect(formatProposalDate("2024-2-9", "en")).toBe("2024-2-9");
  });
});
