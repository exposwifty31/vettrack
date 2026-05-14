/**
 * Phase 2.5 PR 7 — Stale evaluator unit tests.
 *
 * PURE function tests over (config, checkIn, now). No DB. No cache. Mode
 * resolver is injected; production env vars are not touched.
 *
 * Asserts:
 *   - Under ceiling → allow.
 *   - Over ceiling → deny in enforce; would-have-denied counter in shadow.
 *   - Night roles use the 36h carve-out.
 *   - Edge case at exact ceiling: not stale (strict >).
 *   - Missing checkedInAt → not stale → allow (defensive).
 *   - off mode → allow without inspecting the row.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

// Prevent server/db.ts side effects via the audit chain.
vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
}));

import { resetMetrics, getMetricsSnapshot } from "../server/lib/metrics.js";
import {
  evaluateStaleEnforcement,
  isStaleAt,
} from "../server/lib/authority/enforcement/stale.evaluator.js";
import type {
  EnforcementContext,
  StaleEnforcementMode,
} from "../server/lib/authority/enforcement/result.js";
import type { OpenClinicalCheckInRow } from "../server/lib/check-in-resolution.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

function rowAgedHours(hours: number, operationalRole: string | null = null): OpenClinicalCheckInRow {
  const checkedInAt = new Date(FIXED_NOW.getTime() - hours * 60 * 60 * 1000);
  return {
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "user-1",
    clinicalRoleAtCheckIn: "vet",
    operationalRole,
    checkedInAt,
    checkedOutAt: null,
  } as unknown as OpenClinicalCheckInRow;
}

function ctx(row: OpenClinicalCheckInRow): EnforcementContext {
  return {
    clinicId: "clinic-1",
    userId: "user-1",
    now: FIXED_NOW,
    checkIn: row,
  };
}

const ALLOW_MODE = (m: StaleEnforcementMode) => async (): Promise<StaleEnforcementMode> => m;

beforeEach(() => {
  resetMetrics();
  delete process.env.AUTHORITY_STALE_CEILING_HOURS;
  delete process.env.AUTHORITY_STALE_CEILING_NIGHT_HOURS;
});

afterEach(() => {
  delete process.env.AUTHORITY_STALE_CEILING_HOURS;
  delete process.env.AUTHORITY_STALE_CEILING_NIGHT_HOURS;
});

describe("isStaleAt — pure helper", () => {
  it("returns false under default 24h ceiling at 23h", () => {
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 23 * 3600 * 1000),
        operationalRole: null,
        now: FIXED_NOW,
      }),
    ).toBe(false);
  });

  it("returns true over default 24h ceiling at 25h", () => {
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 25 * 3600 * 1000),
        operationalRole: null,
        now: FIXED_NOW,
      }),
    ).toBe(true);
  });

  it("uses 36h carve-out for night_admission_only", () => {
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 30 * 3600 * 1000),
        operationalRole: "night_admission_only",
        now: FIXED_NOW,
      }),
    ).toBe(false);
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 37 * 3600 * 1000),
        operationalRole: "night_admission_only",
        now: FIXED_NOW,
      }),
    ).toBe(true);
  });

  it("uses 36h carve-out for night_senior_no_admission", () => {
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 37 * 3600 * 1000),
        operationalRole: "night_senior_no_admission",
        now: FIXED_NOW,
      }),
    ).toBe(true);
  });

  it("treats exact-ceiling age as NOT stale (strict greater-than)", () => {
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 24 * 3600 * 1000),
        operationalRole: null,
        now: FIXED_NOW,
      }),
    ).toBe(false);
  });

  it("returns false when checkedInAt missing (defensive)", () => {
    expect(isStaleAt({ checkedInAt: null, operationalRole: null, now: FIXED_NOW })).toBe(false);
    expect(isStaleAt({ checkedInAt: undefined, operationalRole: null, now: FIXED_NOW })).toBe(false);
  });

  it("respects AUTHORITY_STALE_CEILING_HOURS env override", () => {
    process.env.AUTHORITY_STALE_CEILING_HOURS = "12";
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 13 * 3600 * 1000),
        operationalRole: null,
        now: FIXED_NOW,
      }),
    ).toBe(true);
  });

  it("respects AUTHORITY_STALE_CEILING_NIGHT_HOURS env override", () => {
    process.env.AUTHORITY_STALE_CEILING_NIGHT_HOURS = "48";
    expect(
      isStaleAt({
        checkedInAt: new Date(FIXED_NOW.getTime() - 40 * 3600 * 1000),
        operationalRole: "night_admission_only",
        now: FIXED_NOW,
      }),
    ).toBe(false);
  });
});

describe("evaluateStaleEnforcement", () => {
  it("off mode → allow, no counter", async () => {
    const verdict = await evaluateStaleEnforcement(ctx(rowAgedHours(48)), ALLOW_MODE("off"));
    expect(verdict).toEqual({ action: "allow" });
    expect(getMetricsSnapshot().authority.staleEnforce.wouldHaveDenied).toBe(0);
    expect(getMetricsSnapshot().authority.staleEnforce.denied).toBe(0);
  });

  it("shadow mode + under ceiling → allow, no counter", async () => {
    const verdict = await evaluateStaleEnforcement(ctx(rowAgedHours(12)), ALLOW_MODE("shadow"));
    expect(verdict).toEqual({ action: "allow" });
    expect(getMetricsSnapshot().authority.staleEnforce.wouldHaveDenied).toBe(0);
    expect(getMetricsSnapshot().authority.staleEnforce.denied).toBe(0);
  });

  it("shadow mode + over ceiling → allow + would-have-denied counter", async () => {
    const verdict = await evaluateStaleEnforcement(ctx(rowAgedHours(48)), ALLOW_MODE("shadow"));
    expect(verdict).toEqual({ action: "allow" });
    expect(getMetricsSnapshot().authority.staleEnforce.wouldHaveDenied).toBe(1);
    expect(getMetricsSnapshot().authority.staleEnforce.denied).toBe(0);
  });

  it("enforce mode + over ceiling → deny + denied counter", async () => {
    const verdict = await evaluateStaleEnforcement(ctx(rowAgedHours(48)), ALLOW_MODE("enforce"));
    expect(verdict).toEqual({ action: "deny", reason: "CHECKED_IN_STALE" });
    expect(getMetricsSnapshot().authority.staleEnforce.wouldHaveDenied).toBe(0);
    expect(getMetricsSnapshot().authority.staleEnforce.denied).toBe(1);
  });

  it("enforce mode + under ceiling → allow, no counter movement", async () => {
    const verdict = await evaluateStaleEnforcement(ctx(rowAgedHours(20)), ALLOW_MODE("enforce"));
    expect(verdict).toEqual({ action: "allow" });
    expect(getMetricsSnapshot().authority.staleEnforce.denied).toBe(0);
  });

  it("enforce + 30h on night role → allow (under 36h)", async () => {
    const verdict = await evaluateStaleEnforcement(
      ctx(rowAgedHours(30, "night_admission_only")),
      ALLOW_MODE("enforce"),
    );
    expect(verdict).toEqual({ action: "allow" });
  });

  it("enforce + 40h on night role → deny (over 36h)", async () => {
    const verdict = await evaluateStaleEnforcement(
      ctx(rowAgedHours(40, "night_senior_no_admission")),
      ALLOW_MODE("enforce"),
    );
    expect(verdict).toEqual({ action: "deny", reason: "CHECKED_IN_STALE" });
  });

  it("tombstone skipped_legacy_path counter stays 0 (isolation invariant)", async () => {
    await evaluateStaleEnforcement(ctx(rowAgedHours(48)), ALLOW_MODE("enforce"));
    expect(getMetricsSnapshot().authority.staleEnforce.skippedLegacyPath).toBe(0);
  });
});
