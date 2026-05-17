import { describe, it, expect } from "vitest";
import { isInternalKey } from "../lib/i18n/internal-keys";

/**
 * Shared `isInternalKey` predicate (Phase 6 §5 invariant 13).
 *
 * Rule: a key path is internal if ANY dot-segment starts with `_`.
 * This is the canonical predicate consumed at all four enforcement
 * sites — `stripInternalKeys`, the typed `t` generator (PR 6.14),
 * `apiError`, and the notification / push / WhatsApp helpers.
 */

describe("isInternalKey predicate", () => {
  it("returns true for top-level _meta", () => {
    expect(isInternalKey("_meta")).toBe(true);
  });

  it("returns true for nested _meta.* paths", () => {
    expect(isInternalKey("_meta.appointmentsPageTerminology")).toBe(true);
    expect(isInternalKey("_meta.foo.bar")).toBe(true);
  });

  it("returns true when any segment starts with underscore", () => {
    expect(isInternalKey("foo._bar")).toBe(true);
    expect(isInternalKey("foo.bar._baz")).toBe(true);
    expect(isInternalKey("_anyUnderscoreSegment")).toBe(true);
  });

  it("returns false for regular user-facing keys", () => {
    expect(isInternalKey("errors.generic")).toBe(false);
    expect(isInternalKey("appointmentsPage.title")).toBe(false);
    expect(isInternalKey("common.toast.savedSuccess")).toBe(false);
  });

  it("returns false for an empty string (degenerate input)", () => {
    expect(isInternalKey("")).toBe(false);
  });

  it("returns false when an underscore appears mid-segment (not as prefix)", () => {
    // Only segment PREFIXES count — mid-segment underscores are fine.
    expect(isInternalKey("foo_bar")).toBe(false);
    expect(isInternalKey("foo.bar_baz")).toBe(false);
  });
});
