/**
 * Clinic join codes — invite-free sign-up membership.
 *
 * A per-clinic join code turns membership intent into explicit data: a
 * Clerk-authenticated user with no org claim and no vt_users row can POST the
 * code to /api/auth/join-clinic and be provisioned as a PENDING member of the
 * clinic that owns the code. The admin-approval gate stays the only
 * authorization step.
 *
 * Security invariants under test:
 *   - identity-only auth: no Clerk session → 401, no DB write
 *   - invalid/malformed/unknown code → 404 (single reason, no enumeration
 *     oracle), no DB write
 *   - provisioned row is status "pending" / role "technician" (admin-allowlist
 *     emails excepted, mirroring resolveAuthUser) — never client-supplied
 *   - existing user (any clinic) → idempotent, never re-homed
 *   - requestedRole / vetLicenseNumber staging flows through the same
 *     sanitizers as resolveAuthUser
 *
 * Mock harness mirrors tests/requested-role-provisioning.test.ts.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Request, Response } from "express";
import { __resetAdminEmailAllowlistCacheForTests } from "../server/lib/admin-email-allowlist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(path.join(ROOT, "server/routes/clinic-join.ts"), "utf8");

const { dbResolves, insertValuesLog, updateSetLog, getAuthMock, getUserMock } = vi.hoisted(() => {
  const dbResolves: unknown[] = [];
  const insertValuesLog: unknown[] = [];
  const updateSetLog: unknown[] = [];
  const getAuthMock = vi.fn();
  const getUserMock = vi.fn();
  return { dbResolves, insertValuesLog, updateSetLog, getAuthMock, getUserMock };
});

type ChainProxy = Record<string, unknown>;

function makeChain(): ChainProxy {
  const chain: ChainProxy = {};
  const methods = ["from", "where", "limit", "returning", "values", "set", "onConflictDoNothing", "onConflictDoUpdate"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.values = vi.fn((vals: unknown) => {
    insertValuesLog.push(vals);
    return chain;
  });
  chain.set = vi.fn((vals: unknown) => {
    updateSetLog.push(vals);
    return chain;
  });
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    const v = dbResolves.shift() ?? [];
    Promise.resolve(v).then(resolve, reject);
  };
  return chain;
}

vi.mock("@clerk/express", () => ({
  getAuth: (...args: unknown[]) => getAuthMock(...args),
  clerkClient: {
    users: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  },
}));

vi.mock("../server/db.js", () => ({
  db: {
    insert: vi.fn(() => makeChain()),
    update: vi.fn(() => makeChain()),
    select: vi.fn(() => makeChain()),
    transaction: vi.fn(),
  },
  clinics: { id: "id", signupJoinCode: "signupJoinCode" },
  users: {
    id: "id",
    clinicId: "clinicId",
    clerkId: "clerkId",
    email: "email",
    name: "name",
    displayName: "displayName",
    role: "role",
    requestedRole: "requestedRole",
    vetLicenseNumber: "vetLicenseNumber",
    status: "status",
    deletedAt: "deletedAt",
  },
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Pure guards — sanitizeJoinCode + generateJoinCode
// ---------------------------------------------------------------------------
describe("sanitizeJoinCode", () => {
  let sanitizeJoinCode: (value: unknown) => string | null;

  beforeAll(async () => {
    const mod = await import("../server/routes/clinic-join.js");
    sanitizeJoinCode = mod.sanitizeJoinCode;
  });

  it("accepts a well-formed code and normalizes case + whitespace", () => {
    expect(sanitizeJoinCode("abcd2345")).toBe("ABCD2345");
    expect(sanitizeJoinCode("  XYZW6789  ")).toBe("XYZW6789");
  });

  it("rejects codes outside the 8-32 char alphanumeric shape", () => {
    expect(sanitizeJoinCode("SHORT")).toBeNull();
    expect(sanitizeJoinCode("A".repeat(33))).toBeNull();
    expect(sanitizeJoinCode("HAS SPACE1")).toBeNull();
    expect(sanitizeJoinCode("BAD-CHAR!")).toBeNull();
  });

  it("rejects non-string / empty values", () => {
    expect(sanitizeJoinCode("")).toBeNull();
    expect(sanitizeJoinCode(undefined)).toBeNull();
    expect(sanitizeJoinCode(null)).toBeNull();
    expect(sanitizeJoinCode(42)).toBeNull();
    expect(sanitizeJoinCode({ joinCode: "ABCD2345" })).toBeNull();
  });
});

describe("generateJoinCode", () => {
  let generateJoinCode: () => string;

  beforeAll(async () => {
    const mod = await import("../server/routes/clinic-join.js");
    generateJoinCode = mod.generateJoinCode;
  });

  it("produces a 10-char code from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
      // Explicitly no lookalike characters.
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("produces distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateJoinCode()));
    expect(codes.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Runtime — POST /api/auth/join-clinic handler
// ---------------------------------------------------------------------------
describe("POST /auth/join-clinic — provisioning", () => {
  let handleJoinClinic: (req: Request, res: Response) => Promise<unknown>;

  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeAll(async () => {
    const mod = await import("../server/routes/clinic-join.js");
    handleJoinClinic = mod.handleJoinClinic;
  });

  afterAll(() => {
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  beforeEach(() => {
    __resetAdminEmailAllowlistCacheForTests();
    dbResolves.length = 0;
    insertValuesLog.length = 0;
    updateSetLog.length = 0;
    getUserMock.mockReset();
    process.env.ADMIN_EMAILS = "owner@vettrack.uk";
    getAuthMock.mockReturnValue({
      userId: "clerk-join-1",
      orgId: null,
      sessionClaims: {},
    });
  });

  function makeReq(body: unknown): Request {
    return { headers: {}, body, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
  }

  function makeRes(): Response & { statusCode: number; jsonBody: unknown } {
    const res = {
      statusCode: 200,
      jsonBody: undefined as unknown,
      getHeader: () => undefined,
      setHeader: () => undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.jsonBody = body;
        return this;
      },
    };
    return res as unknown as Response & { statusCode: number; jsonBody: unknown };
  }

  function mockClerkUser(unsafeMetadata?: Record<string, unknown>): void {
    getUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "doctor@clinic.example" }],
      firstName: "New",
      lastName: "Doctor",
      unsafeMetadata,
    });
  }

  function findUserInsert(): Record<string, unknown> | undefined {
    return insertValuesLog.find(
      (v) => v && typeof v === "object" && "clerkId" in v,
    ) as Record<string, unknown> | undefined;
  }

  it("valid code + new user → pending technician row in the code's clinic", async () => {
    mockClerkUser({ requestedRole: "vet", vetLicenseNumber: "IL-12345" });
    dbResolves.push([{ id: "clinic-a" }]); // clinic lookup by code
    dbResolves.push([]); // no existing vt_users row
    dbResolves.push([
      {
        id: "user-1",
        clinicId: "clinic-a",
        clerkId: "clerk-join-1",
        status: "pending",
        role: "technician",
      },
    ]); // insert .returning()

    const res = makeRes();
    await handleJoinClinic(makeReq({ joinCode: "abcd2345" }), res);

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as Record<string, unknown>).status).toBe("pending");

    const inserted = findUserInsert();
    expect(inserted).toBeDefined();
    expect(inserted?.clinicId).toBe("clinic-a");
    expect(inserted?.clerkId).toBe("clerk-join-1");
    expect(inserted?.status).toBe("pending");
    expect(inserted?.role).toBe("technician");
    // Staging columns flow through the shared sanitizers — captured, not applied.
    expect(inserted?.requestedRole).toBe("vet");
    expect(inserted?.vetLicenseNumber).toBe("IL-12345");
  });

  it("admin-allowlist email → active admin (mirrors resolveAuthUser)", async () => {
    getUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "owner@vettrack.uk" }],
      firstName: "Clinic",
      lastName: "Owner",
      unsafeMetadata: undefined,
    });
    dbResolves.push([{ id: "clinic-a" }]);
    dbResolves.push([]);
    dbResolves.push([
      { id: "user-2", clinicId: "clinic-a", clerkId: "clerk-join-1", status: "active", role: "admin" },
    ]);

    const res = makeRes();
    await handleJoinClinic(makeReq({ joinCode: "ABCD2345" }), res);

    expect(res.statusCode).toBe(200);
    const inserted = findUserInsert();
    expect(inserted?.role).toBe("admin");
    expect(inserted?.status).toBe("active");
  });

  it("privileged requestedRole in unsafeMetadata is rejected to null", async () => {
    mockClerkUser({ requestedRole: "admin" });
    dbResolves.push([{ id: "clinic-a" }]);
    dbResolves.push([]);
    dbResolves.push([
      { id: "user-3", clinicId: "clinic-a", clerkId: "clerk-join-1", status: "pending", role: "technician" },
    ]);

    const res = makeRes();
    await handleJoinClinic(makeReq({ joinCode: "ABCD2345" }), res);

    const inserted = findUserInsert();
    expect(inserted?.role).toBe("technician");
    expect(inserted?.requestedRole).toBeNull();
  });

  it("no Clerk session → 401, no DB write", async () => {
    getAuthMock.mockReturnValue({});

    const res = makeRes();
    await handleJoinClinic(makeReq({ joinCode: "ABCD2345" }), res);

    expect(res.statusCode).toBe(401);
    expect(insertValuesLog).toHaveLength(0);
  });

  it("malformed code → 404 invalid-code envelope, no DB read or write", async () => {
    const res = makeRes();
    await handleJoinClinic(makeReq({ joinCode: "no" }), res);

    expect(res.statusCode).toBe(404);
    expect((res.jsonBody as Record<string, unknown>).code).toBe("errors.clinicJoin.invalidCode");
    expect(insertValuesLog).toHaveLength(0);
  });

  it("unknown code → 404 with the SAME envelope as malformed (no enumeration oracle)", async () => {
    dbResolves.push([]); // clinic lookup finds nothing

    const res = makeRes();
    await handleJoinClinic(makeReq({ joinCode: "ABCD2345" }), res);

    expect(res.statusCode).toBe(404);
    expect((res.jsonBody as Record<string, unknown>).code).toBe("errors.clinicJoin.invalidCode");
    expect(insertValuesLog).toHaveLength(0);
  });

  it("existing user (any clinic) → idempotent 200, no insert, never re-homed", async () => {
    dbResolves.push([{ id: "clinic-a" }]); // clinic lookup
    dbResolves.push([{ id: "user-old", clinicId: "clinic-b", status: "active" }]); // existing row

    const res = makeRes();
    await handleJoinClinic(makeReq({ joinCode: "ABCD2345" }), res);

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as Record<string, unknown>).alreadyMember).toBe(true);
    expect(insertValuesLog).toHaveLength(0);
    expect(updateSetLog).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Source contracts — pins on the route file itself
// ---------------------------------------------------------------------------
describe("clinic-join.ts — source contracts", () => {
  it("never reads role/status/clinicId from the request body", () => {
    expect(routeSource).not.toMatch(/req\.body\.(role|status|clinicId)/);
    expect(routeSource).not.toMatch(/body\?\.(role|status|clinicId)/);
  });

  it("uses identity-only session read, not requireAuth, on the join endpoint", () => {
    expect(routeSource).toContain("readClerkUserSession");
  });

  it("clinic lookup by join code carries the tenant-lint scoped annotation", () => {
    expect(routeSource).toContain("tenant-lint:scoped");
  });

  it("admin endpoints are gated by requireAuth + requireAdmin", () => {
    expect(routeSource).toContain("requireAdmin");
  });
});
