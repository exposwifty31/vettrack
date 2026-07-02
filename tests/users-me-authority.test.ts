/**
 * Phase 2A PR 3: /api/users/me authority passthrough tests.
 *
 * Covers:
 *  1. /api/users/me still returns legacy fields unchanged (regression).
 *  2. authority field exists on success and contains required snapshot keys.
 *  3. authority field is omitted when resolveAuthority throws — endpoint still 200.
 *  4. Frontend wiring: User type, api.ts return type, and use-auth context
 *     accept/propagate authority.
 *  5. Legacy resolveCurrentRole output (effectiveRole, roleSource, activeShift,
 *     resolvedAt) is unchanged regardless of authority resolution outcome.
 *
 * No DB, no Express boot, no network. The /me handler is exercised directly
 * by extracting it from the router stack with all heavy dependencies mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Request, Response } from "express";
import type { AuthoritySnapshot } from "../shared/authority.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────
const resolveCurrentRoleMock = vi.fn();
const resolveAuthorityMock = vi.fn();
const canManageErModeForUserMock = vi.fn(() => false);
const logAuditMock = vi.fn();

vi.mock("../server/lib/role-resolution.js", () => ({
  resolveCurrentRole: (input: unknown) => resolveCurrentRoleMock(input),
}));

vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: (input: unknown) => resolveAuthorityMock(input),
}));

vi.mock("../server/lib/er-mode-permissions.js", () => ({
  canManageErModeForUser: (user: unknown) => canManageErModeForUserMock(user),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args),
  resolveAuditActorRole: () => "admin",
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireAuthAny: (_req: Request, _res: Response, next: () => void) => next(),
  requireAdmin: (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: () => void) => next(),
  validateUuid: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../server/middleware/rate-limiters.js", () => ({
  authSensitiveLimiter: (_req: Request, _res: Response, next: () => void) => next(),
}));

// /me selects the profile row (avatar) directly; provide a chainable stub that
// resolves to a null-avatar row so presignObjectUrl short-circuits to null.
vi.mock("../server/db.js", () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve([{ avatarUrl: null }]),
  };
  return {
    db: { select: () => selectChain },
    users: { avatarUrl: {} },
  };
});

vi.mock("../server/services/user-sync.service.js", () => ({
  ensureUserEmail: async (u: unknown) => u,
}));

vi.mock("../server/lib/cleanup-scheduler.js", () => ({
  countPurgeCandidates: async () => 0,
  purgeDeletedUsers: async () => ({ purged: 0 }),
  PURGE_AFTER_DAYS: 30,
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    organizations: {
      getOrganizationMembershipList: async () => ({ data: [] }),
    },
  },
}));

// ─── Test helpers ───────────────────────────────────────────────────────────
type RecordedRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

function makeRes(): { res: Response; recorded: RecordedRes } {
  const recorded: RecordedRes = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code: number) {
      recorded.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      recorded.body = payload;
      return this;
    },
    getHeader(name: string) {
      return recorded.headers[name];
    },
    setHeader(name: string, value: string) {
      recorded.headers[name] = value;
    },
  } as unknown as Response;
  return { res, recorded };
}

function makeReq(authUser: Record<string, unknown> | undefined = undefined): Request {
  return {
    headers: {},
    authUser,
    clinicId: "dev-clinic-default",
  } as unknown as Request;
}

const FIXED_RESOLVED_AT = new Date("2026-05-13T12:00:00.000Z");

const baseAuthUser = {
  id: "user-1",
  clerkId: "clerk-1",
  email: "tech@example.com",
  name: "Tech User",
  role: "technician" as const,
  secondaryRole: null,
  status: "active",
  clinicId: "dev-clinic-default",
};

const baseAuthoritySnapshot: AuthoritySnapshot = {
  systemRole: "User",
  clinicalRole: "technician",
  activeShiftRole: "technician",
  operationalRole: null,
  effectiveClinicalRole: "technician",
  source: "shift",
  reason: "EZSHIFT_ACTIVE",
  resolvedAt: FIXED_RESOLVED_AT.toISOString(),
};

async function loadMeHandler(): Promise<
  (req: Request, res: Response) => Promise<void> | void
> {
  const usersModule = await import("../server/routes/users.js");
  const router = usersModule.default as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => unknown }>;
      };
    }>;
  };
  const layer = router.stack.find(
    (l) => l.route?.path === "/me" && l.route?.methods.get,
  );
  if (!layer?.route) throw new Error("GET /me handler not found in users router");
  // The handler runs as the LAST entry in the layer's sub-stack (after middleware).
  const handler = layer.route.stack[layer.route.stack.length - 1]!.handle as (
    req: Request,
    res: Response,
  ) => Promise<void> | void;
  return handler;
}

beforeEach(() => {
  resolveCurrentRoleMock.mockReset();
  resolveAuthorityMock.mockReset();
  canManageErModeForUserMock.mockReset();
  canManageErModeForUserMock.mockReturnValue(false);
  resolveCurrentRoleMock.mockResolvedValue({
    effectiveRole: "technician",
    permanentRole: "technician",
    source: "permanent",
    activeShift: null,
    resolvedAt: FIXED_RESOLVED_AT,
  });
  resolveAuthorityMock.mockResolvedValue(baseAuthoritySnapshot);
});

// ─── 1. Legacy fields unchanged ─────────────────────────────────────────────
describe("GET /api/users/me — legacy field regression", () => {
  it("returns all legacy fields on success", async () => {
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    expect(recorded.statusCode).toBe(200);
    const body = recorded.body as Record<string, unknown>;
    expect(body.effectiveRole).toBe("technician");
    expect(body.roleSource).toBe("permanent");
    expect(body.activeShift).toBeNull();
    expect(typeof body.resolvedAt).toBe("string");
    expect(body.canManageErMode).toBe(false);
  });

  it("legacy fields are unchanged when authority resolution fails", async () => {
    resolveAuthorityMock.mockRejectedValueOnce(new Error("authority boom"));
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    expect(recorded.statusCode).toBe(200);
    const body = recorded.body as Record<string, unknown>;
    expect(body.effectiveRole).toBe("technician");
    expect(body.roleSource).toBe("permanent");
    expect(body.activeShift).toBeNull();
    expect(typeof body.resolvedAt).toBe("string");
    expect(body.canManageErMode).toBe(false);
  });

  it("preserves authUser identity fields (id, email, name, role)", async () => {
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    const body = recorded.body as Record<string, unknown>;
    expect(body.id).toBe(baseAuthUser.id);
    expect(body.email).toBe(baseAuthUser.email);
    expect(body.name).toBe(baseAuthUser.name);
    expect(body.role).toBe(baseAuthUser.role);
  });
});

// ─── 2. authority field on success ──────────────────────────────────────────
describe("GET /api/users/me — authority field on success", () => {
  it("includes authority in response when resolver succeeds", async () => {
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    expect(recorded.statusCode).toBe(200);
    const body = recorded.body as { authority?: AuthoritySnapshot };
    expect(body.authority).toBeDefined();
    expect(body.authority!.systemRole).toBe("User");
    expect(body.authority!.source).toBe("shift");
    expect(body.authority!.reason).toBe("EZSHIFT_ACTIVE");
    expect(typeof body.authority!.resolvedAt).toBe("string");
  });

  it("passes shared `now` to both resolveCurrentRole and resolveAuthority", async () => {
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res } = makeRes();
    await handler(req, res);

    expect(resolveCurrentRoleMock).toHaveBeenCalledTimes(1);
    expect(resolveAuthorityMock).toHaveBeenCalledTimes(1);

    const roleCallArg = resolveCurrentRoleMock.mock.calls[0]![0] as { now: Date };
    const authorityCallArg = resolveAuthorityMock.mock.calls[0]![0] as { now: Date };

    expect(roleCallArg.now).toBeInstanceOf(Date);
    expect(authorityCallArg.now).toBeInstanceOf(Date);
    expect(authorityCallArg.now).toBe(roleCallArg.now);
  });
});

// ─── 3. authority optional (resolver failure) ───────────────────────────────
describe("GET /api/users/me — authority omitted on resolver failure", () => {
  it("returns 200 when resolveAuthority throws", async () => {
    resolveAuthorityMock.mockRejectedValueOnce(new Error("resolver down"));
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    expect(recorded.statusCode).toBe(200);
  });

  it("omits authority field entirely (not present, not undefined)", async () => {
    resolveAuthorityMock.mockRejectedValueOnce(new Error("resolver down"));
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    const body = recorded.body as Record<string, unknown>;
    expect("authority" in body).toBe(false);
  });
});

// ─── 4. Frontend wiring (static checks) ─────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("Frontend wiring — types accept authority", () => {
  it("User interface declares authority?: AuthoritySnapshot", () => {
    const src = readRepo("src/types/platform.ts");
    expect(src).toMatch(/authority\?\s*:\s*AuthoritySnapshot/);
    expect(src).toMatch(/from\s+["'][^"']*shared\/authority/);
    expect(readRepo("src/types/index.ts")).toMatch(/export \* from ["']\.\/platform\.js["']/);
  });

  it("api.users.me() return type widens with authority?: AuthoritySnapshot", () => {
    const src = readRepo("src/lib/api.ts");
    // The widening must appear in the inline /api/users/me return-type intersection.
    const meBlock = src.slice(
      src.indexOf("me: () => request<User & {"),
      src.indexOf("}>(\"/api/users/me\")"),
    );
    expect(meBlock).toMatch(/authority\?\s*:\s*AuthoritySnapshot/);
  });

  it("use-auth context state and synced response declare authority", () => {
    const src = readRepo("src/hooks/use-auth.tsx");
    expect(src).toMatch(/authority\?\s*:\s*AuthoritySnapshot/);
    // Passthrough from /me response to setState in both auth providers.
    const passthroughMatches = src.match(/authority:\s*data\.authority/g) ?? [];
    expect(passthroughMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("use-auth does NOT persist authority to offline session", () => {
    const src = readRepo("src/hooks/use-auth.tsx");
    // saveOfflineSession should not be invoked with an authority field.
    const saveBlock = src.match(/saveOfflineSession\(\{[^}]*\}\)/g) ?? [];
    for (const block of saveBlock) {
      expect(block).not.toContain("authority");
    }
  });
});

// ─── 5. No runtime auth behavior changed ────────────────────────────────────
describe("Phase 2A invariant — runtime auth behavior unchanged", () => {
  it("effectiveRole reflects legacy resolveCurrentRole, not authority", async () => {
    resolveCurrentRoleMock.mockResolvedValueOnce({
      effectiveRole: "senior_technician",
      permanentRole: "technician",
      source: "shift",
      activeShift: {
        id: "shift-1",
        date: "2026-05-13",
        startTime: "08:00:00",
        endTime: "18:00:00",
        employeeName: "Tech User",
        role: "senior_technician",
      },
      resolvedAt: FIXED_RESOLVED_AT,
    });
    resolveAuthorityMock.mockResolvedValueOnce({
      ...baseAuthoritySnapshot,
      activeShiftRole: "vet",
      effectiveClinicalRole: "vet",
    });

    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    const body = recorded.body as Record<string, unknown>;
    // Legacy effectiveRole / roleSource / activeShift come from resolveCurrentRole.
    expect(body.effectiveRole).toBe("senior_technician");
    expect(body.roleSource).toBe("shift");
    expect((body.activeShift as { role: string } | null)?.role).toBe("senior_technician");
    // authority remains advisory-only and is NOT used to derive any legacy field.
    const authority = body.authority as AuthoritySnapshot | undefined;
    expect(authority?.effectiveClinicalRole).toBe("vet");
  });

  it("response shape preserves the legacy bootstrap keys in addition to authority", async () => {
    const handler = await loadMeHandler();
    const req = makeReq(baseAuthUser);
    const { res, recorded } = makeRes();
    await handler(req, res);

    const body = recorded.body as Record<string, unknown>;
    for (const key of [
      "id",
      "email",
      "name",
      "role",
      "effectiveRole",
      "roleSource",
      "activeShift",
      "resolvedAt",
      "canManageErMode",
    ]) {
      expect(body, `missing legacy field ${key}`).toHaveProperty(key);
    }
  });
});
