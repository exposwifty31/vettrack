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
