/**
 * Phase 2.5 PR 6 — Route-handler invalidation wiring tests.
 *
 * Covers:
 *  - test #8 PATCH /:id/role  → invalidateForUser
 *  - test #8b PATCH /:id/display_name → invalidateForUser
 *  - test #8c POST /sync (both existing-user and insert paths) → invalidateForUser
 *  - test #9 POST /shift-handover/session/start and /session/end → invalidateClinicShift
 *
 * Handlers are extracted directly from the routers, mirroring the existing
 * pattern in `tests/users-me-authority.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const invalidateForUserSpy = vi.fn();
const invalidateClinicShiftSpy = vi.fn();

vi.mock("../../server/lib/authority-cache.js", () => ({
  invalidateForUser: (clinicId: string, userId: string) =>
    invalidateForUserSpy(clinicId, userId),
  invalidateClinicShift: (clinicId: string) =>
    invalidateClinicShiftSpy(clinicId),
  getOpenClinicalCheckInCached: vi.fn(),
  resolveCurrentRoleCached: vi.fn(),
  __resetAuthorityCacheForTests: vi.fn(),
}));

vi.mock("../../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: vi.fn(() => "admin"),
}));

vi.mock("../../server/lib/role-resolution.js", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../server/lib/role-resolution.js")
  >();
  return {
    ...original,
    resolveCurrentRole: vi.fn().mockResolvedValue({
      effectiveRole: "technician",
      permanentRole: "technician",
      source: "permanent",
      activeShift: null,
      resolvedAt: new Date(),
    }),
  };
});

vi.mock("../../server/lib/authority.js", () => ({
  resolveAuthority: vi.fn().mockResolvedValue({
    systemRole: "User",
    clinicalRole: "technician",
    activeShiftRole: null,
    operationalRole: null,
    effectiveClinicalRole: null,
    source: "no_active_shift",
    reason: "EZSHIFT_NONE",
    resolvedAt: new Date().toISOString(),
  }),
}));

vi.mock("../../server/services/user-sync.service.js", () => ({
  ensureUserEmail: vi.fn(),
}));

vi.mock("../../server/lib/cleanup-scheduler.js", () => ({
  countPurgeCandidates: vi.fn(),
  purgeDeletedUsers: vi.fn(),
  PURGE_AFTER_DAYS: 30,
}));

vi.mock("../../server/lib/er-mode-permissions.js", () => ({
  canManageErModeForUser: vi.fn(() => false),
}));

vi.mock("../../server/middleware/auth.js", () => ({
  requireAuth: vi.fn(),
  requireAuthAny: vi.fn(),
  requireAdmin: vi.fn(),
  requireEffectiveRole: vi.fn(() => vi.fn()),
}));

vi.mock("../../server/middleware/validate.js", () => ({
  validateBody: vi.fn(() => vi.fn()),
  validateUuid: vi.fn(() => vi.fn()),
}));

vi.mock("../../server/middleware/rate-limiters.js", () => ({
  authSensitiveLimiter: vi.fn(),
}));

vi.mock("../../server/lib/queue.js", () => ({
  enqueueShiftReportEmailJob: vi.fn(),
}));

vi.mock("../../server/lib/shift-chat-presence.js", () => ({
  postSystemMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../server/services/clinical-check-in.js", () => ({
  autoCheckOutForSessionEnd: vi.fn().mockResolvedValue({ closedCount: 0 }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {},
}));

// ─── DB mock with per-call chainable behavior ──────────────────────────────
type ChainProxy = Record<string, unknown>;
const dbResolves: unknown[] = [];

function makeChain(): ChainProxy {
  const chain: ChainProxy = {};
  const methods = [
    "from",
    "where",
    "limit",
    "leftJoin",
    "innerJoin",
    "orderBy",
    "returning",
    "values",
    "set",
    "as",
    "onConflictDoNothing",
    "onConflictDoUpdate",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void,
  ) => {
    const v = dbResolves.shift() ?? [];
    Promise.resolve(v).then(resolve, reject);
  };
  return chain;
}

vi.mock("../../server/db.js", () => ({
  db: {
    insert: vi.fn(() => makeChain()),
    update: vi.fn(() => makeChain()),
    select: vi.fn(() => makeChain()),
  },
  users: {
    id: "id",
    clinicId: "clinicId",
    clerkId: "clerkId",
    email: "email",
    name: "name",
    displayName: "displayName",
    role: "role",
    deletedAt: "deletedAt",
  },
  shifts: {},
  shiftSessions: {
    id: "id",
    clinicId: "clinicId",
    startedAt: "startedAt",
    endedAt: "endedAt",
  },
  shiftHandoverSnapshots: {
    id: "id",
    clinicId: "clinicId",
  },
  hospitalizations: {
    clinicId: "clinicId",
    animalId: "animalId",
    dischargedAt: "dischargedAt",
  },
  medicationTasks: {
    clinicId: "clinicId",
    id: "id",
    animalId: "animalId",
    status: "status",
  },
  codeBlueSessions: {
    clinicId: "clinicId",
    id: "id",
    status: "status",
    isReconciled: "isReconciled",
  },
  appointments: {},
  alertAcks: {},
  animals: {},
  billingItems: {},
  billingLedger: {},
  containerItems: {},
  containers: {},
  dispenseEvents: {},
  equipment: {},
  inventoryItems: {},
  inventoryJobs: {},
  inventoryLogs: {},
  scanLogs: {},
  serverConfig: {},
  usageSessions: {},
}));

// ─── Helpers ───────────────────────────────────────────────────────────────
function makeRes(): {
  res: Response;
  recorded: { statusCode: number; body: unknown };
} {
  const recorded = { statusCode: 200, body: undefined as unknown };
  const res = {
    getHeader: () => undefined,
    setHeader: () => {},
    status(code: number) {
      recorded.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      recorded.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, recorded };
}

interface RouterShape {
  stack: Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (req: Request, res: Response) => unknown }>;
    };
  }>;
}

async function loadHandler(
  modulePath: "users" | "shift-handover",
  method: "patch" | "post",
  path: string,
): Promise<(req: Request, res: Response) => Promise<void> | void> {
  const mod =
    modulePath === "users"
      ? await import("../../server/routes/users.js")
      : await import("../../server/routes/shift-handover.js");
  const router = mod.default as unknown as RouterShape;
  const layer = router.stack.find(
    (l) => l.route?.path === path && l.route?.methods[method],
  );
  if (!layer?.route) {
    throw new Error(
      `${method.toUpperCase()} ${path} handler not found in ${modulePath} router`,
    );
  }
  return layer.route.stack[layer.route.stack.length - 1]!
    .handle as (req: Request, res: Response) => Promise<void> | void;
}

beforeEach(() => {
  invalidateForUserSpy.mockReset();
  invalidateClinicShiftSpy.mockReset();
  dbResolves.length = 0;
});

// ─── Test #8: PATCH /:id/role ──────────────────────────────────────────────
describe("PATCH /:id/role invalidation (test #8)", () => {
  it("calls invalidateForUser after successful role update", async () => {
    // 1. select target user → returns existing
    dbResolves.push([
      { id: "user-1", clinicId: "clinic-a", role: "technician", email: "u@x.com", deletedAt: null },
    ]);
    // 2. update users → returns updated row
    dbResolves.push([{ id: "user-1", role: "vet" }]);

    const handler = await loadHandler("users", "patch", "/:id/role");
    const req = {
      params: { id: "user-1" },
      body: { role: "vet" },
      clinicId: "clinic-a",
      authUser: { id: "admin-1", email: "a@x.com", role: "admin" },
      headers: {},
    } as unknown as Request;
    const { res } = makeRes();
    await handler(req, res);
    expect(invalidateForUserSpy).toHaveBeenCalledWith("clinic-a", "user-1");
  });
});

// ─── Test #8b: PATCH /:id/display_name ─────────────────────────────────────
describe("PATCH /:id/display_name invalidation (test #8b)", () => {
  it("calls invalidateForUser after successful display name update", async () => {
    // 1. select existing user
    dbResolves.push([
      { id: "user-1", clinicId: "clinic-a", displayName: "Old Name", deletedAt: null },
    ]);
    // 2. update → returns updated row
    dbResolves.push([{ id: "user-1", displayName: "New Name" }]);

    const handler = await loadHandler("users", "patch", "/:id/display_name");
    const req = {
      params: { id: "user-1" },
      body: { display_name: "New Name" },
      clinicId: "clinic-a",
      authUser: { id: "user-1", email: "u@x.com", role: "technician" },
      headers: {},
    } as unknown as Request;
    const { res } = makeRes();
    await handler(req, res);
    expect(invalidateForUserSpy).toHaveBeenCalledWith("clinic-a", "user-1");
  });
});

// ─── Test #8c: POST /sync (both paths) ─────────────────────────────────────
describe("POST /sync invalidation (test #8c)", () => {
  it("existing-user update path calls invalidateForUser", async () => {
    // 1. select existing → returns row
    dbResolves.push([
      {
        id: "user-1",
        clinicId: "clinic-a",
        clerkId: "clerk-1",
        role: "technician",
        name: "User",
        email: "u@x.com",
        deletedAt: null,
      },
    ]);
    // 2. update users → returns updated row
    dbResolves.push([
      { id: "user-1", clinicId: "clinic-a", role: "technician", name: "User", email: "u@x.com" },
    ]);

    const handler = await loadHandler("users", "post", "/sync");
    const req = {
      params: {},
      body: { clerkId: "clerk-1", email: "u@x.com" },
      clinicId: "clinic-a",
      authUser: {
        id: "user-1",
        clerkId: "clerk-1",
        email: "u@x.com",
        name: "User",
        role: "technician",
      },
      headers: {},
    } as unknown as Request;
    const { res } = makeRes();
    await handler(req, res);
    expect(invalidateForUserSpy).toHaveBeenCalledWith("clinic-a", "user-1");
  });

  it("insert path calls invalidateForUser", async () => {
    // 1. select existing → empty
    dbResolves.push([]);
    // 2. insert with onConflictDoUpdate → returns new row
    dbResolves.push([
      {
        id: "newly-created-id",
        clinicId: "clinic-a",
        clerkId: "clerk-2",
        role: "technician",
        name: "Newcomer",
        email: "n@x.com",
      },
    ]);

    const handler = await loadHandler("users", "post", "/sync");
    const req = {
      params: {},
      body: { clerkId: "clerk-2", email: "n@x.com" },
      clinicId: "clinic-a",
      authUser: {
        id: "newly-created-id",
        clerkId: "clerk-2",
        email: "n@x.com",
        name: "Newcomer",
        role: "technician",
      },
      headers: {},
    } as unknown as Request;
    const { res } = makeRes();
    await handler(req, res);
    expect(invalidateForUserSpy).toHaveBeenCalledWith(
      "clinic-a",
      "newly-created-id",
    );
  });
});

// ─── Test #9: shift-handover session start/end ─────────────────────────────
describe("POST /shift-handover/session/start invalidation (test #9)", () => {
  it("calls invalidateClinicShift after start", async () => {
    // 1. getOpenShiftSession → returns no row
    dbResolves.push([]);
    // 2. insert shift session → ignored (chain.then)
    dbResolves.push([]);

    const handler = await loadHandler("shift-handover", "post", "/session/start");
    const req = {
      body: { note: "starting" },
      clinicId: "clinic-a",
      authUser: { id: "user-1", email: "u@x.com", role: "technician" },
      headers: {},
    } as unknown as Request;
    const { res } = makeRes();
    await handler(req, res);
    expect(invalidateClinicShiftSpy).toHaveBeenCalledWith("clinic-a");
  });
});

describe("POST /shift-handover/session/end invalidation (test #9)", () => {
  it("calls invalidateClinicShift after end", async () => {
    // 1. getOpenShiftSession → existing open
    dbResolves.push([
      {
        id: "session-1",
        clinicId: "clinic-a",
        startedAt: new Date(),
        endedAt: null,
        note: null,
      },
    ]);
    // 2. active hospitalizations → none
    dbResolves.push([]);
    // 3. unreconciled code blue → none
    dbResolves.push([]);
    // 4. buildPatientHandoverPayload's calls (we override below)
    // 5. insert snapshot → []
    dbResolves.push([]);
    // 6. update shiftSessions → []
    dbResolves.push([]);

    const handler = await loadHandler("shift-handover", "post", "/session/end");
    const req = {
      body: { note: "ending" },
      query: {},
      clinicId: "clinic-a",
      authUser: { id: "user-1", email: "u@x.com", role: "technician" },
      headers: {},
    } as unknown as Request;
    const { res } = makeRes();
    await handler(req, res);
    expect(invalidateClinicShiftSpy).toHaveBeenCalledWith("clinic-a");
  });
});
