import { describe, it, expect } from "vitest";
import {
  normalizeTime,
  checkAdjustmentDirection,
} from "../server/lib/shift-adjustment-window.js";

describe("normalizeTime", () => {
  it("pads short hours and appends seconds", () => {
    expect(normalizeTime("7:30")).toBe("07:30:00");
    expect(normalizeTime("07:30")).toBe("07:30:00");
    expect(normalizeTime("23:59:00")).toBe("23:59:00");
    expect(normalizeTime(" 8:05 ")).toBe("08:05:00");
  });

  it("rejects malformed or out-of-range times", () => {
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("12:60")).toBeNull();
    expect(normalizeTime("7:5")).toBeNull();
    expect(normalizeTime("abc")).toBeNull();
    expect(normalizeTime("")).toBeNull();
    expect(normalizeTime(730)).toBeNull();
    expect(normalizeTime(null)).toBeNull();
  });
});

describe("checkAdjustmentDirection — same-day shift 07:30–19:30", () => {
  const start = "07:30:00";
  const end = "19:30:00";

  it("accepts an extension to a later same-day time", () => {
    expect(checkAdjustmentDirection("extend", start, end, "23:00:00")).toEqual({ ok: true });
  });

  it("accepts an extension that crosses midnight into the next day", () => {
    // 02:00 is numerically < start, so it projects to +24h → still later than 19:30.
    expect(checkAdjustmentDirection("extend", start, end, "02:00:00")).toEqual({ ok: true });
  });

  it("rejects an 'extension' that is earlier than or equal to the current end", () => {
    expect(checkAdjustmentDirection("extend", start, end, "18:00:00")).toEqual({
      ok: false,
      reason: "NOT_AN_EXTENSION",
    });
    expect(checkAdjustmentDirection("extend", start, end, "19:30:00")).toEqual({
      ok: false,
      reason: "NOT_AN_EXTENSION",
    });
  });

  it("accepts a leave-early to an earlier time", () => {
    expect(checkAdjustmentDirection("leave_early", start, end, "15:00:00")).toEqual({ ok: true });
  });

  it("rejects a 'leave-early' that is later than the current end", () => {
    expect(checkAdjustmentDirection("leave_early", start, end, "22:00:00")).toEqual({
      ok: false,
      reason: "NOT_EARLIER",
    });
  });
});

describe("checkAdjustmentDirection — overnight shift 23:30–06:00", () => {
  const start = "23:30:00";
  const end = "06:00:00";

  it("accepts extending the morning end later", () => {
    expect(checkAdjustmentDirection("extend", start, end, "08:00:00")).toEqual({ ok: true });
  });

  it("rejects an 'extension' to before the current morning end", () => {
    expect(checkAdjustmentDirection("extend", start, end, "05:00:00")).toEqual({
      ok: false,
      reason: "NOT_AN_EXTENSION",
    });
  });

  it("accepts leaving early before the morning end", () => {
    expect(checkAdjustmentDirection("leave_early", start, end, "03:00:00")).toEqual({ ok: true });
  });

  it("rejects a 'leave-early' past the morning end", () => {
    expect(checkAdjustmentDirection("leave_early", start, end, "07:00:00")).toEqual({
      ok: false,
      reason: "NOT_EARLIER",
    });
  });
});
