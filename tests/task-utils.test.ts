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
  toErrorMessage,
  isAppointmentConflictError,
} from "@/pages/tasks/task-utils";
import { t } from "@/lib/i18n";
import { ApiError } from "@/lib/api";

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

  describe("toErrorMessage (T3 fail-loud audit)", () => {
    // BUG FIX: this used to compare `err.message` against bare server reason
    // codes ("OUTSIDE_SHIFT", …), but `ApiError.message` is the server's
    // human-readable text (via toApiErrorMessage), never the code — so every
    // branch silently fell through to the raw, unlocalized server string.
    // These pin the fix: match on `ApiError.code`.
    it("maps OUTSIDE_SHIFT to the localized outside-shift copy", () => {
      const err = new ApiError(400, "Cannot schedule outside vet shift hours", {
        code: "OUTSIDE_SHIFT",
        error: "OUTSIDE_SHIFT",
        message: "Cannot schedule outside vet shift hours",
      });
      expect(toErrorMessage(err)).toBe(t.appointmentsPage.errorOutsideShift);
    });

    it("maps APPOINTMENT_CONFLICT to the localized conflict copy", () => {
      const err = new ApiError(409, "Appointment overlaps existing slot", {
        code: "APPOINTMENT_CONFLICT",
        error: "APPOINTMENT_CONFLICT",
        message: "Appointment overlaps existing slot",
      });
      expect(toErrorMessage(err)).toBe(t.appointmentsPage.errorConflict);
    });

    it("maps INSUFFICIENT_ROLE, VALIDATION_FAILED, and the task-ownership codes", () => {
      const codeToExpected: Array<[string, string]> = [
        ["INSUFFICIENT_ROLE", t.appointmentsPage.errorInsufficientRole],
        ["VALIDATION_FAILED", t.appointmentsPage.errorValidationFailed],
        ["TASK_NOT_OWNED_BY_TECH", t.appointmentsPage.errorTaskNotOwned],
        ["TASK_NOT_ASSIGNED", t.appointmentsPage.errorTaskNotAssigned],
        ["OVERRIDE_REASON_REQUIRED", t.appointmentsPage.errorOverrideReason],
        ["TIMEZONE_REQUIRED", t.appointmentsPage.errorTimezone],
      ];
      for (const [code, expected] of codeToExpected) {
        const err = new ApiError(400, "server text", { code, error: code, message: "server text" });
        expect(toErrorMessage(err)).toBe(expected);
      }
    });

    it("falls back to the server's own (already-localized) message for an unmapped ApiError code", () => {
      const err = new ApiError(500, "Something else broke", {
        code: "SOME_OTHER_CODE",
        error: "SOME_OTHER_CODE",
        message: "Something else broke",
      });
      expect(toErrorMessage(err)).toBe("Something else broke");
    });

    it("maps a bare Error('UNAUTHORIZED') / 'Session expired' to the session-expired copy", () => {
      expect(toErrorMessage(new Error("UNAUTHORIZED"))).toBe(t.appointmentsPage.errorSessionExpired);
      expect(toErrorMessage(new Error("Session expired"))).toBe(t.appointmentsPage.errorSessionExpired);
    });

    it("falls back to the localized generic server-error copy for a non-ApiError error (never a raw string)", () => {
      expect(toErrorMessage(new TypeError("Failed to fetch"))).toBe(t.api.serverError);
    });
  });

  describe("isAppointmentConflictError", () => {
    it("is true only for an ApiError with code APPOINTMENT_CONFLICT", () => {
      const err = new ApiError(409, "conflict", { code: "APPOINTMENT_CONFLICT", error: "APPOINTMENT_CONFLICT" });
      expect(isAppointmentConflictError(err)).toBe(true);
    });

    it("is false for any other ApiError code or a non-ApiError error", () => {
      const err = new ApiError(400, "outside shift", { code: "OUTSIDE_SHIFT", error: "OUTSIDE_SHIFT" });
      expect(isAppointmentConflictError(err)).toBe(false);
      expect(isAppointmentConflictError(new Error("APPOINTMENT_CONFLICT"))).toBe(false);
    });
  });
});
