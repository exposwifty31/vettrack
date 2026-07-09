/**
 * @vitest-environment happy-dom
 *
 * Direct unit coverage for the pure helpers extracted from Tasks.tsx into
 * task-utils.tsx (Phase 7R R6). Also pins the tightened `looksLikeUuid`
 * heuristic (CodeRabbit #74): a canonical UUID matches, a long hyphenated
 * free-text device/location name does not.
 */
import { describe, it, expect } from "vitest";
import {
  pixelsPerMinuteFor,
  looksLikeUuid,
  formatDevice,
  formatLocation,
  dateAtLocalDay,
  minutesSinceDayStart,
  statusActions,
  compactMeta,
} from "@/pages/tasks/task-utils";
import { t } from "@/lib/i18n";

const UUID = "3f1a2b4c-1234-4abc-8def-1234567890ab";

describe("task-utils pure helpers", () => {
  describe("pixelsPerMinuteFor", () => {
    it("scales a 15-minute slot above the minimum height", () => {
      expect(pixelsPerMinuteFor(15)).toBeCloseTo(44 / 15);
    });
    it("floors long slots at 1.2 px/min", () => {
      expect(pixelsPerMinuteFor(60)).toBe(1.2);
    });
  });

  describe("looksLikeUuid", () => {
    it("matches a canonical UUID", () => {
      expect(looksLikeUuid(UUID)).toBe(true);
    });
    it("rejects a long hyphenated free-text name (the misclassification fix)", () => {
      expect(looksLikeUuid("ultrasound-probe-bay-3-north-wing")).toBe(false);
    });
    it("rejects a short plain string", () => {
      expect(looksLikeUuid("Room 5")).toBe(false);
    });
  });

  describe("formatDevice", () => {
    it("labels a UUID as a linked device", () => {
      expect(formatDevice(UUID)).toBe(t.appointmentsPage.linkedDevice);
    });
    it("passes a free-text device name through unchanged", () => {
      expect(formatDevice("Bay 3 ventilator")).toBe("Bay 3 ventilator");
    });
    it("returns the unassigned label for empty input", () => {
      expect(formatDevice(null)).toBe(t.appointmentsPage.unassigned);
    });
  });

  describe("formatLocation", () => {
    it("passes a free-text location through unchanged", () => {
      expect(formatLocation("ICU")).toBe("ICU");
    });
    it("returns null for empty input", () => {
      expect(formatLocation(null)).toBeNull();
    });
  });

  describe("date helpers", () => {
    it("clamps minutesSinceDayStart to zero before the day start", () => {
      const before = dateAtLocalDay("2026-07-09", 6, 0);
      expect(minutesSinceDayStart("2026-07-09", before, 8)).toBe(0);
    });
    it("counts elapsed minutes after the day start", () => {
      const at = dateAtLocalDay("2026-07-09", 9, 30);
      expect(minutesSinceDayStart("2026-07-09", at, 8)).toBe(90);
    });
  });

  describe("statusActions", () => {
    it("offers a completion transition from scheduled", () => {
      expect(statusActions("scheduled")).toContain("completed");
    });
    it("returns no actions for a terminal status", () => {
      expect(statusActions("completed")).toEqual([]);
    });
  });

  describe("compactMeta", () => {
    it("joins present parts with a bullet and drops empties", () => {
      expect(compactMeta("A", null, "B", undefined)).toBe("A • B");
    });
  });
});
