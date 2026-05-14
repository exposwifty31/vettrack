/**
 * Phase 2.5 PR 7 — Isolation + precedence invariants.
 *
 * Asserts:
 *   - Precedence (§3.4): with BOTH evaluators in enforce, a stale+revoked row
 *     denies with CHECKED_IN_STALE (stale runs first).
 *   - Stale alone → CHECKED_IN_STALE.
 *   - OPROLE alone → CHECKED_IN_OPROLE_REVOKED.
 *   - Single-denial (§3.5): exactly one denial counter family increments per
 *     resolution.
 *   - Evaluators never co-increment for one request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
  auditLogs: {},
  eventOutbox: {},
}));

import { resetMetrics, getMetricsSnapshot } from "../server/lib/metrics.js";
import { evaluateStaleEnforcement } from "../server/lib/authority/enforcement/stale.evaluator.js";
import { evaluateOpRoleEnforcement } from "../server/lib/authority/enforcement/oprole.evaluator.js";
import type {
  EnforcementContext,
  OproleEnforcementMode,
  StaleEnforcementMode,
} from "../server/lib/authority/enforcement/result.js";
import type { AllowlistFetchResult } from "../server/lib/authority-cache.js";
import { recordSuccess } from "../server/lib/circuit-breaker.js";
import type { OpenClinicalCheckInRow } from "../server/lib/check-in-resolution.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

function makeRow(hoursAgo: number, operationalRole: string | null): OpenClinicalCheckInRow {
  return {
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "user-1",
    clinicalRoleAtCheckIn: "vet",
    operationalRole,
    checkedInAt: new Date(FIXED_NOW.getTime() - hoursAgo * 3600 * 1000),
    checkedOutAt: null,
  } as unknown as OpenClinicalCheckInRow;
}

function ctx(hoursAgo: number, operationalRole: string | null): EnforcementContext {
  return {
    clinicId: "clinic-1",
    userId: "user-1",
    now: FIXED_NOW,
    checkIn: makeRow(hoursAgo, operationalRole),
  };
}

const STALE = (m: StaleEnforcementMode) => async () => m;
const OPROLE = (m: OproleEnforcementMode) => async () => m;
const REVOKED_FETCHER = async (): Promise<AllowlistFetchResult> => ({
  kind: "ok",
  allowlist: [] as never,
});
const ALLOWED_FETCHER = async (): Promise<AllowlistFetchResult> => ({
  kind: "ok",
  allowlist: ["admission"] as never,
});

beforeEach(() => {
  resetMetrics();
  recordSuccess("authority-oprole-cache");
});

afterEach(() => {
  recordSuccess("authority-oprole-cache");
});

/**
 * Resolver-equivalent helper: runs stale first, OPROLE second, short-circuits
 * on first deny. Mirrors server/lib/authority.ts §3.2.
 */
async function runResolverEnforcement(
  c: EnforcementContext,
  staleMode: StaleEnforcementMode,
  oproleMode: OproleEnforcementMode,
  fetcher: () => Promise<AllowlistFetchResult>,
): Promise<{ reason: string | null }> {
  const s = await evaluateStaleEnforcement(c, STALE(staleMode));
  if (s.action === "deny") return { reason: s.reason };
  const o = await evaluateOpRoleEnforcement(c, {
    modeResolver: OPROLE(oproleMode),
    allowlistFetcher: fetcher,
  });
  if (o.action === "deny") return { reason: o.reason };
  return { reason: null };
}

describe("enforcement precedence + isolation", () => {
  it("stale-only enforce + revoked OPROLE-only-shadow-equivalent → CHECKED_IN_STALE", async () => {
    // OPROLE off entirely; only stale is enforcing.
    const result = await runResolverEnforcement(
      ctx(48, "admission"),
      "enforce",
      "off",
      REVOKED_FETCHER,
    );
    expect(result.reason).toBe("CHECKED_IN_STALE");
  });

  it("OPROLE-only enforce + stale row but stale off → CHECKED_IN_OPROLE_REVOKED", async () => {
    const result = await runResolverEnforcement(
      ctx(48, "admission"),
      "off",
      "enforce",
      REVOKED_FETCHER,
    );
    expect(result.reason).toBe("CHECKED_IN_OPROLE_REVOKED");
  });

  it("both enforce + stale row + revoked role → CHECKED_IN_STALE (stale wins by precedence)", async () => {
    const result = await runResolverEnforcement(
      ctx(48, "admission"),
      "enforce",
      "enforce",
      REVOKED_FETCHER,
    );
    expect(result.reason).toBe("CHECKED_IN_STALE");
  });

  it("both enforce + fresh row + revoked role → CHECKED_IN_OPROLE_REVOKED", async () => {
    const result = await runResolverEnforcement(
      ctx(1, "admission"),
      "enforce",
      "enforce",
      REVOKED_FETCHER,
    );
    expect(result.reason).toBe("CHECKED_IN_OPROLE_REVOKED");
  });

  it("both enforce + fresh row + allowed role → no denial", async () => {
    const result = await runResolverEnforcement(
      ctx(1, "admission"),
      "enforce",
      "enforce",
      ALLOWED_FETCHER,
    );
    expect(result.reason).toBeNull();
  });

  it("single-denial: stale+revoked overlap increments stale counter only, not OPROLE", async () => {
    await runResolverEnforcement(ctx(48, "admission"), "enforce", "enforce", REVOKED_FETCHER);
    const snap = getMetricsSnapshot().authority;
    expect(snap.staleEnforce.denied).toBe(1);
    expect(snap.oproleEnforce.denied).toBe(0);
  });

  it("single-denial: fresh+revoked increments OPROLE counter only, not stale", async () => {
    await runResolverEnforcement(ctx(1, "admission"), "enforce", "enforce", REVOKED_FETCHER);
    const snap = getMetricsSnapshot().authority;
    expect(snap.staleEnforce.denied).toBe(0);
    expect(snap.oproleEnforce.denied).toBe(1);
  });

  it("evaluators never co-increment for a single request", async () => {
    // 100 mixed runs — assert at no point do both counters move on the same call.
    for (let i = 0; i < 50; i++) {
      resetMetrics();
      await runResolverEnforcement(
        ctx(48, "admission"),
        "enforce",
        "enforce",
        REVOKED_FETCHER,
      );
      const snap = getMetricsSnapshot().authority;
      expect(snap.staleEnforce.denied + snap.oproleEnforce.denied).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < 50; i++) {
      resetMetrics();
      await runResolverEnforcement(
        ctx(1, "admission"),
        "enforce",
        "enforce",
        REVOKED_FETCHER,
      );
      const snap = getMetricsSnapshot().authority;
      expect(snap.staleEnforce.denied + snap.oproleEnforce.denied).toBeLessThanOrEqual(1);
    }
  });
});
