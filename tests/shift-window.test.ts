/**
 * Phase 0 (stale shift-chat root cause) — pure window math for the
 * roster-derived chat session. The synthetic window id replaces the orphaned
 * vt_shift_sessions row as the conversation anchor, so its determinism,
 * rollover, and overnight behavior are the contract the client's
 * reconcileMessages depends on.
 */
import { describe, it, expect } from "vitest";
import {
  buildShiftWindow,
  combineLocal,
  isWindowSessionId,
  localDateKey,
  parseWindowSessionId,
  windowBounds,
  windowSessionId,
} from "../server/lib/shift-window.js";

describe("windowBounds", () => {
  it("same-day shift spans start to end on the shift date", () => {
    const { startedAt, endsAt } = windowBounds({
      date: "2026-07-04",
      startTime: "07:00:00",
      endTime: "15:00:00",
    });
    expect(startedAt).toEqual(new Date(2026, 6, 4, 7, 0, 0));
    expect(endsAt).toEqual(new Date(2026, 6, 4, 15, 0, 0));
  });

  it("overnight shift (end at/before start) ends the following day", () => {
    const { startedAt, endsAt } = windowBounds({
      date: "2026-07-04",
      startTime: "23:00:00",
      endTime: "07:00:00",
    });
    expect(startedAt).toEqual(new Date(2026, 6, 4, 23, 0, 0));
    expect(endsAt).toEqual(new Date(2026, 6, 5, 7, 0, 0));
  });
});

describe("buildShiftWindow", () => {
  it("returns ISO instants matching windowBounds plus the role", () => {
    const shift = { date: "2026-07-04", startTime: "07:00:00", endTime: "15:00:00", role: "technician" };
    const bounds = windowBounds(shift);
    expect(buildShiftWindow(shift)).toEqual({
      startedAt: bounds.startedAt.toISOString(),
      endsAt: bounds.endsAt.toISOString(),
      role: "technician",
    });
  });
});

describe("windowSessionId / parseWindowSessionId", () => {
  it("round-trips clinic, date and start time", () => {
    const id = windowSessionId("clinic-1", { date: "2026-07-04", startTime: "07:00:00" });
    expect(id).toBe("win:clinic-1:2026-07-04:07:00:00");
    expect(parseWindowSessionId(id)).toEqual({
      clinicId: "clinic-1",
      date: "2026-07-04",
      startTime: "07:00:00",
    });
  });

  it("survives a clinic id containing ':'", () => {
    const id = windowSessionId("org:42", { date: "2026-07-04", startTime: "23:00:00" });
    expect(parseWindowSessionId(id)).toEqual({
      clinicId: "org:42",
      date: "2026-07-04",
      startTime: "23:00:00",
    });
  });

  it("is deterministic — end-time adjustments never change the id", () => {
    const a = windowSessionId("c", { date: "2026-07-04", startTime: "07:00:00" });
    const b = windowSessionId("c", { date: "2026-07-04", startTime: "07:00:00" });
    expect(a).toBe(b);
  });

  it("changes when the window rolls over", () => {
    const morning = windowSessionId("c", { date: "2026-07-04", startTime: "07:00:00" });
    const evening = windowSessionId("c", { date: "2026-07-04", startTime: "15:00:00" });
    const nextDay = windowSessionId("c", { date: "2026-07-05", startTime: "07:00:00" });
    expect(new Set([morning, evening, nextDay]).size).toBe(3);
  });

  it("rejects legacy vt_shift_sessions ids", () => {
    expect(isWindowSessionId("2f5c0f4e-79f7-4a7e-9a3c-6a3d0d3f1c9e")).toBe(false);
    expect(parseWindowSessionId("2f5c0f4e-79f7-4a7e-9a3c-6a3d0d3f1c9e")).toBeNull();
  });

  it("rejects malformed window ids", () => {
    expect(parseWindowSessionId("win:missing-parts")).toBeNull();
  });
});

describe("combineLocal / localDateKey", () => {
  it("localDateKey formats a local YYYY-MM-DD", () => {
    expect(localDateKey(new Date(2026, 6, 4, 12, 0, 0))).toBe("2026-07-04");
  });

  it("combineLocal applies the day offset", () => {
    expect(combineLocal("2026-07-04", "07:30:00", 1)).toEqual(new Date(2026, 6, 5, 7, 30, 0));
  });
});
