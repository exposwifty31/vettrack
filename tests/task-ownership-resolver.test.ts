/**
 * Phase 3 PR 3.2 — task-ownership resolver unit tests.
 *
 * Pure function tests. The resolver accepts an injectable candidate-lookup,
 * so no DB is required. The vt_users table is stubbed via the lookup
 * argument, mirroring the dependency-injection style used in other
 * Phase 2.5 unit tests.
 *
 * Tests prove:
 *  - only Tier 1 / Tier 2 exact matches auto-resolve
 *  - clinic-scope is enforced (cross-clinic matches NEVER auto-resolve)
 *  - blocked / soft-deleted users NEVER auto-resolve
 *  - no fuzzy / edit-distance behavior leaked in
 *  - no email / name matching exists
 */
import { describe, expect, it, vi } from "vitest";

// Prevent side effects from importing db.ts inside the resolver module.
vi.mock("../server/db.js", () => ({
  db: {},
  users: {},
}));

import { resolveOwnership, MATCHER_VERSION } from "../server/lib/task-ownership-resolver.js";

interface StubUser {
  id: string;
  clerkId: string;
  clinicId: string;
  status: string;
  deletedAt: Date | null;
}

function lookup(users: StubUser[]) {
  return async (rawAcknowledgedBy: string) =>
    users.filter((u) => u.id === rawAcknowledgedBy || u.clerkId === rawAcknowledgedBy);
}

const ACTIVE_USER_A: StubUser = {
  id: "user-a-id",
  clerkId: "clerk-a",
  clinicId: "clinic-1",
  status: "active",
  deletedAt: null,
};

const BLOCKED_USER: StubUser = {
  id: "user-blocked",
  clerkId: "clerk-blocked",
  clinicId: "clinic-1",
  status: "blocked",
  deletedAt: null,
};

const DELETED_USER: StubUser = {
  id: "user-deleted",
  clerkId: "clerk-deleted",
  clinicId: "clinic-1",
  status: "active",
  deletedAt: new Date("2026-01-01T00:00:00Z"),
};

const OTHER_CLINIC_USER: StubUser = {
  id: "user-cross",
  clerkId: "clerk-cross",
  clinicId: "clinic-2",
  status: "active",
  deletedAt: null,
};

describe("resolveOwnership — auto-resolve tiers", () => {
  it("Tier 1: exact id match in same clinic, active user → auto_exact_id", async () => {
    const result = await resolveOwnership("clinic-1", "user-a-id", { lookup: lookup([ACTIVE_USER_A]) });
    expect(result).toEqual({ source: "auto_exact_id", userId: "user-a-id" });
  });

  it("Tier 2: exact clerk_id match in same clinic, active user → auto_exact_clerk_id", async () => {
    const result = await resolveOwnership("clinic-1", "clerk-a", { lookup: lookup([ACTIVE_USER_A]) });
    expect(result).toEqual({ source: "auto_exact_clerk_id", userId: "user-a-id" });
  });
});

describe("resolveOwnership — clinic-scope hard invariant", () => {
  it("cross-clinic id match NEVER auto-resolves; queues with CROSS_CLINIC_REJECTED", async () => {
    const result = await resolveOwnership("clinic-1", "user-cross", {
      lookup: lookup([OTHER_CLINIC_USER]),
    });
    expect(result).toEqual({
      source: "queued",
      reason: "CROSS_CLINIC_REJECTED",
      candidateUserIds: [],
    });
  });

  it("cross-clinic clerk_id match NEVER auto-resolves; queues with CROSS_CLINIC_REJECTED", async () => {
    const result = await resolveOwnership("clinic-1", "clerk-cross", {
      lookup: lookup([OTHER_CLINIC_USER]),
    });
    expect(result).toEqual({
      source: "queued",
      reason: "CROSS_CLINIC_REJECTED",
      candidateUserIds: [],
    });
  });
});

describe("resolveOwnership — blocked / deleted users", () => {
  it("blocked user in same clinic queues with BLOCKED_USER", async () => {
    const result = await resolveOwnership("clinic-1", "user-blocked", {
      lookup: lookup([BLOCKED_USER]),
    });
    expect(result).toEqual({
      source: "queued",
      reason: "BLOCKED_USER",
      candidateUserIds: ["user-blocked"],
    });
  });

  it("soft-deleted user in same clinic queues with DELETED_USER", async () => {
    const result = await resolveOwnership("clinic-1", "user-deleted", {
      lookup: lookup([DELETED_USER]),
    });
    expect(result).toEqual({
      source: "queued",
      reason: "DELETED_USER",
      candidateUserIds: ["user-deleted"],
    });
  });
});

describe("resolveOwnership — empty / unmatched values", () => {
  it("empty raw value → skipped, EMPTY_RAW_VALUE", async () => {
    expect(await resolveOwnership("clinic-1", "", { lookup: lookup([]) })).toEqual({
      source: "skipped",
      reason: "EMPTY_RAW_VALUE",
    });
    expect(await resolveOwnership("clinic-1", null, { lookup: lookup([]) })).toEqual({
      source: "skipped",
      reason: "EMPTY_RAW_VALUE",
    });
    expect(await resolveOwnership("clinic-1", "   ", { lookup: lookup([]) })).toEqual({
      source: "skipped",
      reason: "EMPTY_RAW_VALUE",
    });
  });

  it("no candidate anywhere → queued NO_CANDIDATE", async () => {
    const result = await resolveOwnership("clinic-1", "nonexistent-string", {
      lookup: lookup([ACTIVE_USER_A]),
    });
    expect(result).toEqual({
      source: "queued",
      reason: "NO_CANDIDATE",
      candidateUserIds: [],
    });
  });
});

describe("resolveOwnership — absence of fuzzy / email / name matching (HARD INVARIANTS)", () => {
  it("input differing by exactly ONE character from a real user id → NO_CANDIDATE (no edit-distance)", async () => {
    const result = await resolveOwnership("clinic-1", "user-a-i", { lookup: lookup([ACTIVE_USER_A]) });
    expect(result).toEqual({
      source: "queued",
      reason: "NO_CANDIDATE",
      candidateUserIds: [],
    });
  });

  it("input differing by exactly ONE character from a real clerk_id → NO_CANDIDATE", async () => {
    const result = await resolveOwnership("clinic-1", "clerk-z", { lookup: lookup([ACTIVE_USER_A]) });
    expect(result).toEqual({
      source: "queued",
      reason: "NO_CANDIDATE",
      candidateUserIds: [],
    });
  });

  it("email-shaped input → NO_CANDIDATE (no email matcher)", async () => {
    const result = await resolveOwnership("clinic-1", "user-a@clinic.test", {
      lookup: lookup([ACTIVE_USER_A]),
    });
    expect(result).toEqual({
      source: "queued",
      reason: "NO_CANDIDATE",
      candidateUserIds: [],
    });
  });

  it("display-name-shaped input → NO_CANDIDATE (no name matcher)", async () => {
    const result = await resolveOwnership("clinic-1", "Jane Doe", {
      lookup: lookup([ACTIVE_USER_A]),
    });
    expect(result).toEqual({
      source: "queued",
      reason: "NO_CANDIDATE",
      candidateUserIds: [],
    });
  });
});

describe("resolveOwnership — defensive ambiguity", () => {
  it("two same-clinic candidates returned by lookup → AMBIGUOUS_MATCH (never auto-resolve)", async () => {
    const result = await resolveOwnership("clinic-1", "shared-string", {
      lookup: lookup([
        { ...ACTIVE_USER_A, id: "shared-string", clerkId: "k1" },
        { ...ACTIVE_USER_A, id: "u2", clerkId: "shared-string" },
      ]),
    });
    expect(result.source).toBe("queued");
    if (result.source !== "queued") throw new Error("unreachable");
    expect(result.reason).toBe("AMBIGUOUS_MATCH");
    expect(result.candidateUserIds.length).toBe(2);
  });
});

describe("matcher version", () => {
  it("MATCHER_VERSION is the current matcher version constant", () => {
    expect(MATCHER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
