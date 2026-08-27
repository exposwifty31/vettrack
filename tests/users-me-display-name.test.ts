/**
 * S17a — `displayName` is persisted but never returned by GET /api/users/me.
 *
 * `PATCH /api/users/:id/display_name` writes `vt_users.display_name` and hands the
 * row back via `.returning()`, but `AuthUser` (server/middleware/auth.ts) has no
 * `displayName` field and the literal that builds `result.user` omits it. Since
 * `/me` responds with `{ ...req.authUser, ... }` (server/routes/users.ts), the
 * saved value can never reach a client.
 *
 * Two layers, both runtime:
 *   A. `resolveAuthUser` must carry `displayName` off the DB row — the root cause.
 *   B. the real GET /me handler, driven with the AuthUser that `resolveAuthUser`
 *      actually produced, must emit `displayName` in its payload.
 *
 * No DB, no Express boot, no network: Clerk and `server/db.js` are mocked and the
 * /me handler is pulled straight out of the router stack, the same way
 * tests/users-me-authority.test.ts and tests/requested-role-provisioning.test.ts do.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

const { dbResolves, getAuthMock, getUserMock } = vi.hoisted(() => ({
  dbResolves: [] as unknown[],
  getAuthMock: vi.fn(),
  getUserMock: vi.fn(),
}));

type ChainProxy = Record<string, unknown>;

function makeChain(): ChainProxy {
  const chain: ChainProxy = {};
  for (const m of [
    "from",
    "where",
    "limit",
    "returning",
    "values",
    "set",
    "onConflictDoNothing",
    "onConflictDoUpdate",
    "orderBy",
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    const v = dbResolves.shift() ?? [];
    Promise.resolve(v).then(resolve, reject);
  };
  return chain;
}

vi.mock("@clerk/express", () => ({
  getAuth: (...args: unknown[]) => getAuthMock(...args),
  clerkClient: {
    users: { getUser: (...args: unknown[]) => getUserMock(...args) },
    organizations: { getOrganizationMembershipList: async () => ({ data: [] }) },
  },
}));

vi.mock("../server/db.js", () => {
  const columnBag = new Proxy({}, { get: (_t, prop) => String(prop) });
  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => makeChain()),
      update: vi.fn(() => makeChain()),
    },
    users: columnBag,
    clinics: columnBag,
    displayDevices: columnBag,
    appleOauthTokens: columnBag,
    shiftSessions: columnBag,
  };
});

// /me collaborators — irrelevant to this contract, stubbed to keep the handler pure.
vi.mock("../server/lib/role-resolution.js", () => ({
  resolveCurrentRole: async () => ({
    effectiveRole: "technician",
    permanentRole: "technician",
    source: "permanent",
    activeShift: null,
    resolvedAt: new Date("2026-08-26T00:00:00.000Z"),
  }),
}));
vi.mock("../server/lib/authority.js", () => ({ resolveAuthority: async () => undefined }));
vi.mock("../server/lib/er-mode-permissions.js", () => ({ canManageErModeForUser: () => false }));
vi.mock("../server/lib/audit.js", () => ({
  logAudit: async () => undefined,
  resolveAuditActorRole: () => "technician",
}));
vi.mock("../server/lib/object-storage.js", () => ({ presignObjectUrl: async () => null }));
vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: () => void) => next(),
  validateUuid: () => (_req: Request, _res: Response, next: () => void) => next(),
}));
vi.mock("../server/middleware/rate-limiters.js", () => ({
  authSensitiveLimiter: (_req: Request, _res: Response, next: () => void) => next(),
}));
vi.mock("../server/services/user-sync.service.js", () => ({ ensureUserEmail: async (u: unknown) => u }));
vi.mock("../server/lib/cleanup-scheduler.js", () => ({
  countPurgeCandidates: async () => 0,
  purgeDeletedUsers: async () => ({ purged: 0 }),
  PURGE_AFTER_DAYS: 30,
}));

const CLERK_ID = "clerk-display-name-1";
const CLINIC_ID = "clinic-display-name-1";

/** The row PATCH /:id/display_name leaves behind: `name` and `display_name` differ. */
const USER_ROW = {
  id: "user-display-name-1",
  clerkId: CLERK_ID,
  email: "tech@clinic.example",
  name: "Original Name",
  displayName: "Chosen Nickname",
  role: "technician",
  secondaryRole: null,
  status: "active",
  clinicId: CLINIC_ID,
  deletedAt: null,
};

function makeReq(authUser?: Record<string, unknown>): Request {
  return {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    authUser,
    clinicId: CLINIC_ID,
  } as unknown as Request;
}

function makeRes(): { res: Response; recorded: { statusCode: number; body: unknown } } {
  const recorded = { statusCode: 200, body: null as unknown };
  const headers: Record<string, string> = {};
  const res = {
    status(code: number) {
      recorded.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      recorded.body = payload;
      return this;
    },
    getHeader: (n: string) => headers[n],
    setHeader: (n: string, v: string) => {
      headers[n] = v;
    },
  } as unknown as Response;
  return { res, recorded };
}

let resolveAuthUser: (req: Request) => Promise<{ ok: boolean; user?: Record<string, unknown> }>;
let meHandler: (req: Request, res: Response) => Promise<void> | void;

const envBackup = {
  NODE_ENV: process.env.NODE_ENV,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_ENABLED: process.env.CLERK_ENABLED,
};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.CLERK_SECRET_KEY = "sk_test_mock_for_display_name_tests";
  delete process.env.CLERK_ENABLED; // force the Clerk path, not dev-bypass

  resolveAuthUser = (await import("../server/middleware/auth.js")).resolveAuthUser;

  const router = (await import("../server/routes/users.js")).default as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => unknown }>;
      };
    }>;
  };
  const layer = router.stack.find((l) => l.route?.path === "/me" && l.route?.methods.get);
  if (!layer?.route) throw new Error("GET /me handler not found in users router");
  meHandler = layer.route.stack[layer.route.stack.length - 1]!.handle as typeof meHandler;
}, 30000);

afterAll(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  dbResolves.length = 0;
  getAuthMock.mockReset();
  getUserMock.mockReset();
  getAuthMock.mockReturnValue({
    userId: CLERK_ID,
    orgId: CLINIC_ID,
    sessionClaims: { email: USER_ROW.email, name: USER_ROW.name },
  });
});

/** Queue the DB reads resolveAuthUser performs: clinic-exists guard, then the user upsert. */
function queueAuthReads(): void {
  dbResolves.push([{ id: CLINIC_ID }]);
  dbResolves.push([USER_ROW]);
}

describe("A. resolveAuthUser — displayName reaches the AuthUser", () => {
  it("carries vt_users.display_name onto the resolved user", async () => {
    queueAuthReads();
    const result = await resolveAuthUser(makeReq());

    expect(result.ok).toBe(true);
    expect(result.user!.name).toBe("Original Name");
    expect(result.user!.displayName).toBe("Chosen Nickname");
  });
});

describe("B. GET /api/users/me — payload carries displayName", () => {
  it("emits the saved display name alongside name", async () => {
    queueAuthReads();
    const resolved = await resolveAuthUser(makeReq());
    expect(resolved.ok).toBe(true);

    // The /me profile SELECT (avatar + locale + eligibility).
    dbResolves.push([{ avatarUrl: null, preferredLocale: "he", seniorDoctorEligible: false }]);

    const { res, recorded } = makeRes();
    await meHandler(makeReq(resolved.user), res);

    expect(recorded.statusCode).toBe(200);
    const body = recorded.body as Record<string, unknown>;
    expect(body.name).toBe("Original Name");
    expect(body.displayName).toBe("Chosen Nickname");
  });
});
