/**
 * Phase 2C PR 1: Unit tests for the container dispense route's
 * requireClinicalAuthority wiring.
 *
 * Scope:
 *   POST /api/containers/:id/dispense
 *
 * These tests exercise requireClinicalAuthority in isolation — no DB, no
 * full Express app, no network — using the same mocking strategy as
 * tests/require-clinical-authority.test.ts. The route file is intentionally
 * not booted; we only assert the middleware's behavior under the same
 * options that server/routes/containers.ts now uses:
 *
 *   {
 *     allow: ["vet", "senior_technician", "technician"],
 *     allowPermanentClinicalRoleFallbackForLegacyDispense: true,
 *   }
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Architectural invariant (do not break in this suite):
 *
 *   requireClinicalAuthority consumes an already-resolved AuthoritySnapshot.
 *   The resolver, not this middleware, owns the rule that students can
 *   NEVER be elevated by shift rows. Therefore a snapshot with
 *     clinicalRole: "student"
 *   AND
 *     effectiveClinicalRole !== null
 *   is an impossible resolver state and MUST NOT appear in any test below.
 *
 * A static source-level guard at the bottom of this file re-reads the
 * suite source and fails the run if anyone ever fabricates that
 * impossible snapshot.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ActiveShiftRole,
  AuthorityReason,
  AuthoritySnapshot,
  ClinicalRole,
} from "../shared/authority.js";

const resolveAuthorityMock = vi.fn<
  (input: unknown) => Promise<AuthoritySnapshot>
>();

vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: (input: unknown) => resolveAuthorityMock(input),
}));

// Prevent server/db.ts from being touched by the import chain via access-denied.
vi.mock("../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
}));

import { requireClinicalAuthority } from "../server/middleware/authority.js";

// ---------------------------------------------------------------------------
// Helpers — mirror tests/require-clinical-authority.test.ts
// ---------------------------------------------------------------------------
type FakeRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  getHeader: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  statusCode?: number;
  body?: unknown;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    status: vi.fn(),
    json: vi.fn(),
    getHeader: vi.fn().mockReturnValue(undefined),
    setHeader: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function makeReq(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    headers: { "x-request-id": "req-container-dispense-1" },
    clinicId: "clinic-1",
    authUser: {
      id: "user-1",
      name: "Test User",
      role: "technician",
      clerkId: "clerk-1",
      email: "u@example.com",
      status: "active",
      clinicId: "clinic-1",
    },
    ...overrides,
  };
}

function makeSnapshot(
  args: Partial<AuthoritySnapshot> & {
    effectiveClinicalRole: ActiveShiftRole | null;
    reason: AuthorityReason;
  },
): AuthoritySnapshot {
  return {
    systemRole: args.systemRole ?? "User",
    clinicalRole: (args.clinicalRole ?? null) as ClinicalRole | null,
    activeShiftRole: args.activeShiftRole ?? null,
    operationalRole: null,
    effectiveClinicalRole: args.effectiveClinicalRole,
    source: args.source ?? "no_active_shift",
    reason: args.reason,
    resolvedAt: args.resolvedAt ?? "2026-05-14T12:00:00.000Z",
  };
}

/** The exact options server/routes/containers.ts passes to the middleware. */
function buildContainerDispenseMiddleware() {
  return requireClinicalAuthority({
    allow: ["vet", "senior_technician", "technician"],
    allowPermanentClinicalRoleFallbackForLegacyDispense: true,
  });
}

beforeEach(() => {
  resolveAuthorityMock.mockReset();
});

// ---------------------------------------------------------------------------
// 1–3. Active-shift authority passes
// ---------------------------------------------------------------------------
describe("containers dispense authority — active-shift allow", () => {
  it("vet on active authority passes", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "vet",
        activeShiftRole: "vet",
        clinicalRole: "vet",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("senior_technician on active authority passes", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "senior_technician",
        activeShiftRole: "senior_technician",
        clinicalRole: "senior_technician",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq({
      authUser: {
        ...(makeReq().authUser as object),
        role: "senior_technician",
      },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("technician on active authority passes", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "technician",
        activeShiftRole: "technician",
        clinicalRole: "technician",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4–5. No-active-shift transitional fallback passes
// ---------------------------------------------------------------------------
describe("containers dispense authority — legacy dispense fallback", () => {
  it("vet no-active-shift fallback passes (EZSHIFT_NONE, clinicalRole=vet)", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "EZSHIFT_NONE",
      }),
    );
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("technician no-active-shift fallback passes (EZSHIFT_NONE, clinicalRole=technician)", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "technician",
        reason: "EZSHIFT_NONE",
      }),
    );
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6–7. Deny: student / admin
// ---------------------------------------------------------------------------
describe("containers dispense authority — denials", () => {
  it("student is denied (snapshot preserves STUDENT_NEVER_ELEVATED reason)", async () => {
    const snap = makeSnapshot({
      effectiveClinicalRole: null,
      clinicalRole: "student",
      reason: "STUDENT_NEVER_ELEVATED",
    });
    resolveAuthorityMock.mockResolvedValue(snap);
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "student" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
    });

    const reqWithSnap = req as {
      authoritySnapshot?: AuthoritySnapshot;
    };
    expect(reqWithSnap.authoritySnapshot).toEqual(snap);
    expect(reqWithSnap.authoritySnapshot!.effectiveClinicalRole).toBeNull();
    expect(reqWithSnap.authoritySnapshot!.reason).toBe(
      "STUDENT_NEVER_ELEVATED",
    );
  });

  it("identity admin with no clinical role is denied (allowSystemAdmin not set)", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: null,
        systemRole: "Admin",
        reason: "LEGACY_ADMIN_NO_CLINICAL",
      }),
    );
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "admin" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Unauthenticated denied
// ---------------------------------------------------------------------------
describe("containers dispense authority — unauthenticated", () => {
  it("returns 401 when req.authUser is missing", async () => {
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq({ authUser: undefined });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      code: "UNAUTHORIZED",
      error: "UNAUTHORIZED",
      reason: "MISSING_AUTH_USER",
    });
    expect(resolveAuthorityMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. 403 response body shape
// ---------------------------------------------------------------------------
describe("containers dispense authority — 403 response shape", () => {
  it("denial body includes code, error, reason, message, requestId", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "student",
        reason: "STUDENT_NEVER_ELEVATED",
      }),
    );
    const mw = buildContainerDispenseMiddleware();
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "student" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);

    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty("code");
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("reason");
    expect(body).toHaveProperty("message");
    expect(body).toHaveProperty("requestId");
    expect(body.reason).toBe("INSUFFICIENT_CLINICAL_AUTHORITY");
  });
});

// ---------------------------------------------------------------------------
// Static source-level guard — the suite itself must never fabricate an
// impossible snapshot (clinicalRole "student" + non-null
// effectiveClinicalRole). The rule lives at the resolver layer; this suite
// must not pretend a resolver can produce such a state.
// ---------------------------------------------------------------------------
describe("containers dispense authority — invariants on test source", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const ownSource = fs.readFileSync(__filename, "utf8");

  it("does not construct a student snapshot with a non-null effectiveClinicalRole", () => {
    // Strip this suite block from the source before scanning so the regex
    // documentation here cannot accidentally trip the assertion.
    const sentinel =
      "containers dispense authority — invariants on test source";
    const cutIndex = ownSource.indexOf(sentinel);
    expect(cutIndex).toBeGreaterThan(-1);
    const scannable = ownSource.slice(0, cutIndex);

    // Forbid effectiveClinicalRole: <non-null active role> co-occurring with
    // clinicalRole: "student" inside any makeSnapshot(...) call.
    const studentBlockRe =
      /makeSnapshot\(\s*\{[^}]*clinicalRole\s*:\s*"student"[^}]*\}\s*\)/gs;
    const blocks = scannable.match(studentBlockRe) ?? [];
    for (const block of blocks) {
      expect(
        /effectiveClinicalRole\s*:\s*"(vet|senior_technician|technician)"/.test(
          block,
        ),
        `Forbidden impossible snapshot found:\n${block}`,
      ).toBe(false);
    }
  });

  it("colocates with peer suite", () => {
    // Sanity: peer suite still exists in the repo so this PR did not silently
    // drop a shared invariant comment from the test directory.
    const peer = path.join(__dirname, "require-clinical-authority.test.ts");
    expect(fs.existsSync(peer)).toBe(true);
  });
});
