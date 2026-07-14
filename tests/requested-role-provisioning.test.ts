/**
 * T24b — requested-role staging column, secure separation.
 *
 * T24 makes the sign-up chips tag a *requested* role into Clerk
 * `unsafeMetadata.requestedRole`. T24b consumes it into a nullable
 * `vt_users.requestedRole` staging column that is DISTINCT from the
 * authoritative `role`. The security invariant under test: a self-requested
 * role NEVER becomes the granted role.
 *
 *   - A sign-up requesting "vet" → row inserted with role default "technician"
 *     AND requestedRole "vet" (captured, not applied).
 *   - An invalid/privileged/absent requested role → requestedRole null,
 *     role default unchanged.
 *   - requestedRole is advisory only: it is never carried on the AuthUser and
 *     never referenced by the clinical-authority resolver.
 *
 * The runtime portion mocks the DB + Clerk exactly like
 * admin-emails-promotion.test.ts and captures the values passed to the JIT
 * insert. The source-contract portion pins the additive-only guarantees.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Request } from "express";
import { __resetAdminEmailAllowlistCacheForTests } from "../server/lib/admin-email-allowlist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const authSource = fs.readFileSync(path.join(ROOT, "server/middleware/auth.ts"), "utf8");

const { dbResolves, insertValuesLog, getAuthMock, getUserMock, dbUpdateMock } = vi.hoisted(() => {
  const dbResolves: unknown[] = [];
  const insertValuesLog: unknown[] = [];
  const getAuthMock = vi.fn();
  const getUserMock = vi.fn();
  const dbUpdateMock = vi.fn();
  return { dbResolves, insertValuesLog, getAuthMock, getUserMock, dbUpdateMock };
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
    update: (...args: unknown[]) => dbUpdateMock(...args),
    select: vi.fn(() => makeChain()),
  },
  clinics: { id: "id" },
  displayDevices: { id: "id", clinicId: "clinicId", tokenHash: "tokenHash", revokedAt: "revokedAt" },
  users: {
    id: "id",
    clinicId: "clinicId",
    clerkId: "clerkId",
    email: "email",
    name: "name",
    displayName: "displayName",
    role: "role",
    requestedRole: "requestedRole",
    status: "status",
    deletedAt: "deletedAt",
    secondaryRole: "secondaryRole",
  },
}));

// ---------------------------------------------------------------------------
// Pure guard — sanitizeRequestedRole (the self-escalation filter)
// ---------------------------------------------------------------------------
describe("sanitizeRequestedRole — self-escalation guard", () => {
  let sanitizeRequestedRole: (value: unknown) => "technician" | "vet" | "student" | null;

  beforeAll(async () => {
    const mod = await import("../server/middleware/auth.js");
    sanitizeRequestedRole = mod.sanitizeRequestedRole;
  });

  it("accepts the three self-selectable roles", () => {
    expect(sanitizeRequestedRole("technician")).toBe("technician");
    expect(sanitizeRequestedRole("vet")).toBe("vet");
    expect(sanitizeRequestedRole("student")).toBe("student");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(sanitizeRequestedRole("  VET ")).toBe("vet");
    expect(sanitizeRequestedRole("Student")).toBe("student");
  });

  it("rejects privileged roles a user must never be able to self-request", () => {
    expect(sanitizeRequestedRole("admin")).toBeNull();
    expect(sanitizeRequestedRole("senior_technician")).toBeNull();
    expect(sanitizeRequestedRole("lead_technician")).toBeNull();
  });

  it("rejects junk / non-string / empty values", () => {
    expect(sanitizeRequestedRole("")).toBeNull();
    expect(sanitizeRequestedRole("   ")).toBeNull();
    expect(sanitizeRequestedRole("superuser")).toBeNull();
    expect(sanitizeRequestedRole(undefined)).toBeNull();
    expect(sanitizeRequestedRole(null)).toBeNull();
    expect(sanitizeRequestedRole(42)).toBeNull();
    expect(sanitizeRequestedRole({ requestedRole: "vet" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Runtime — JIT provisioning captures requestedRole WITHOUT touching role
// ---------------------------------------------------------------------------
describe("resolveAuthUser — requested-role capture (secure separation)", () => {
  let resolveAuthUser: (req: Request) => Promise<{ ok: boolean; user?: Record<string, unknown> }>;

  const originalAdminEmails = process.env.ADMIN_EMAILS;
  const originalClerkSecret = process.env.CLERK_SECRET_KEY;
  const originalClerkEnabled = process.env.CLERK_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.CLERK_SECRET_KEY = "sk_test_mock_for_requested_role_tests";
    delete process.env.CLERK_ENABLED; // force Clerk path, not dev-bypass
    const mod = await import("../server/middleware/auth.js");
    resolveAuthUser = mod.resolveAuthUser;
  }, 30000);

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalClerkSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = originalClerkSecret;
    if (originalClerkEnabled === undefined) delete process.env.CLERK_ENABLED;
    else process.env.CLERK_ENABLED = originalClerkEnabled;
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  beforeEach(() => {
    __resetAdminEmailAllowlistCacheForTests();
    dbResolves.length = 0;
    insertValuesLog.length = 0;
    dbUpdateMock.mockClear();
    process.env.ADMIN_EMAILS = "owner@vettrack.uk"; // the sign-up email is NOT this
    // No `email` claim → resolveAuthUser fetches the Clerk user for enrichment,
    // which is where unsafeMetadata (and thus requestedRole) is read.
    getAuthMock.mockReturnValue({
      userId: "clerk-new-1",
      orgId: "clinic-prod-1",
      sessionClaims: {},
    });
  });

  function makeReq(): Request {
    return { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
  }

  function mockClerkUser(unsafeMetadata: Record<string, unknown> | undefined): void {
    getUserMock.mockResolvedValue({
      emailAddresses: [{ emailAddress: "newtech@clinic.example" }],
      firstName: "New",
      lastName: "Tech",
      unsafeMetadata,
    });
  }

  function queueClinicThenUser(userRow: Record<string, unknown>): void {
    dbResolves.push(undefined); // ensureClinicExistsForOrg insert
    dbResolves.push([userRow]); // user upsert .returning()
  }

  function findUserInsert(): Record<string, unknown> | undefined {
    return insertValuesLog.find(
      (v) => v && typeof v === "object" && "clerkId" in v && (v as { clerkId: string }).clerkId === "clerk-new-1",
    ) as Record<string, unknown> | undefined;
  }

  it("a sign-up requesting 'vet' is provisioned as role=technician, requestedRole='vet'", async () => {
    mockClerkUser({ requestedRole: "vet" });
    queueClinicThenUser({
      id: "user-new-1",
      clerkId: "clerk-new-1",
      email: "newtech@clinic.example",
      name: "New Tech",
      role: "technician",
      requestedRole: "vet",
      status: "pending",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    const result = await resolveAuthUser(makeReq());
    expect(result.ok).toBe(true);
    // Authoritative role is the hardcoded default — the request did NOT grant it.
    expect(result.user?.role).toBe("technician");

    const insert = findUserInsert();
    expect(insert).toBeDefined();
    expect(insert).toMatchObject({ role: "technician", requestedRole: "vet", status: "pending" });
  });

  it("captures the vet license number from unsafeMetadata on a vet sign-up (C3)", async () => {
    mockClerkUser({ requestedRole: "vet", vetLicenseNumber: "MD-555" });
    queueClinicThenUser({
      id: "user-new-1",
      clerkId: "clerk-new-1",
      email: "newvet@clinic.example",
      name: "New Vet",
      role: "technician",
      requestedRole: "vet",
      status: "pending",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    await resolveAuthUser(makeReq());

    const insert = findUserInsert();
    expect(insert).toMatchObject({ requestedRole: "vet", vetLicenseNumber: "MD-555" });
  });

  it("ignores a license number when the requested role is not vet (C3)", async () => {
    mockClerkUser({ requestedRole: "technician", vetLicenseNumber: "MD-555" });
    queueClinicThenUser({
      id: "user-new-1",
      clerkId: "clerk-new-1",
      email: "newtech@clinic.example",
      name: "New Tech",
      role: "technician",
      requestedRole: "technician",
      status: "pending",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    await resolveAuthUser(makeReq());

    const insert = findUserInsert();
    expect(insert).toMatchObject({ requestedRole: "technician", vetLicenseNumber: null });
  });

  it("an invalid/privileged requested role ('admin') is dropped to requestedRole=null", async () => {
    mockClerkUser({ requestedRole: "admin" });
    queueClinicThenUser({
      id: "user-new-1",
      clerkId: "clerk-new-1",
      email: "newtech@clinic.example",
      name: "New Tech",
      role: "technician",
      requestedRole: null,
      status: "pending",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    const result = await resolveAuthUser(makeReq());
    expect(result.ok).toBe(true);
    expect(result.user?.role).toBe("technician");

    const insert = findUserInsert();
    expect(insert).toMatchObject({ role: "technician" });
    expect(insert?.requestedRole).toBeNull();
  });

  it("absent unsafeMetadata → requestedRole=null, role default unchanged", async () => {
    mockClerkUser(undefined);
    queueClinicThenUser({
      id: "user-new-1",
      clerkId: "clerk-new-1",
      email: "newtech@clinic.example",
      name: "New Tech",
      role: "technician",
      requestedRole: null,
      status: "pending",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    const result = await resolveAuthUser(makeReq());
    expect(result.ok).toBe(true);
    expect(result.user?.role).toBe("technician");

    const insert = findUserInsert();
    expect(insert).toMatchObject({ role: "technician" });
    expect(insert?.requestedRole).toBeNull();
  });

  it("never carries requestedRole onto the resolved AuthUser (advisory isolation)", async () => {
    mockClerkUser({ requestedRole: "vet" });
    queueClinicThenUser({
      id: "user-new-1",
      clerkId: "clerk-new-1",
      email: "newtech@clinic.example",
      name: "New Tech",
      role: "technician",
      requestedRole: "vet",
      status: "pending",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    const result = await resolveAuthUser(makeReq());
    expect(result.ok).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user).not.toHaveProperty("requestedRole");
  });
});

// ---------------------------------------------------------------------------
// Source contracts — additive-only + advisory-only guarantees
// ---------------------------------------------------------------------------
describe("requested-role — additive-only source contracts", () => {
  // Scope the source contracts to resolveAuthUser so they can't accidentally
  // match the unrelated dev-user / sync insert blocks elsewhere in the file.
  const resolveFnBody = (() => {
    const start = authSource.indexOf("export async function resolveAuthUser(");
    const end = authSource.indexOf("export async function sessionContextMiddleware(");
    return authSource.slice(start, end);
  })();

  it("role default assignment is unchanged (still the hardcoded default)", () => {
    expect(resolveFnBody).toContain('const defaultRole: UserRole = adminEmail ? "admin" : "technician"');
  });

  it("JIT insert stages requestedRole and role: defaultRole side by side", () => {
    const insertBlock =
      resolveFnBody.match(/\.insert\(users\)\s*\n\s*\.values\(\{([\s\S]*?)\}\)\s*\n\s*\.onConflictDoUpdate/)?.[1] ?? "";
    expect(insertBlock).toContain("role: defaultRole");
    expect(insertBlock).toContain("requestedRole,");
  });

  it("onConflictDoUpdate set never re-stages requestedRole or role (no self-escalation on re-login)", () => {
    const conflictBlock =
      resolveFnBody.match(/onConflictDoUpdate\(\{[\s\S]*?set: \{([\s\S]*?)\},\s*\}\)/)?.[1] ?? "";
    expect(conflictBlock.length).toBeGreaterThan(0);
    expect(conflictBlock).not.toContain("requestedRole");
    expect(conflictBlock).not.toContain("role:");
  });

  it("the clinical-authority resolver never reads requestedRole", () => {
    const authoritySrc = fs.readFileSync(path.join(ROOT, "server/lib/authority.ts"), "utf8");
    const roleResolutionSrc = fs.readFileSync(path.join(ROOT, "server/lib/role-resolution.ts"), "utf8");
    expect(authoritySrc).not.toContain("requestedRole");
    expect(roleResolutionSrc).not.toContain("requestedRole");
  });

  it("the AuthUser interface does not expose requestedRole", () => {
    const ifaceBlock = authSource.match(/export interface AuthUser \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(ifaceBlock.length).toBeGreaterThan(0);
    expect(ifaceBlock).not.toContain("requestedRole");
  });
});

// ---------------------------------------------------------------------------
// Source contracts — schema column + pending API projection
// ---------------------------------------------------------------------------
describe("requested-role — schema + pending API", () => {
  it("vt_users has a nullable requested_role staging column distinct from role", () => {
    const coreSrc = fs.readFileSync(path.join(ROOT, "server/schema/core.ts"), "utf8");
    expect(coreSrc).toContain('requestedRole: varchar("requested_role", { length: 20 })');
    // Nullable: no .notNull() chained onto the requested_role column.
    expect(coreSrc).not.toMatch(/requested_role", \{ length: 20 \}\)\.notNull\(\)/);
  });

  it("a numbered migration adds the requested_role column", () => {
    const migration = fs.readFileSync(path.join(ROOT, "migrations/161_vt_users_requested_role.sql"), "utf8");
    expect(migration).toMatch(/ALTER TABLE vt_users ADD COLUMN IF NOT EXISTS requested_role/i);
  });

  it("GET /api/users/pending projects requestedRole (clinic-scoped as before)", () => {
    const usersSrc = fs.readFileSync(path.join(ROOT, "server/routes/users.ts"), "utf8");
    const pendingBlock =
      usersSrc.match(/router\.get\("\/pending"[\s\S]*?res\.json\(pendingUsers\)/)?.[0] ?? "";
    expect(pendingBlock.length).toBeGreaterThan(0);
    expect(pendingBlock).toContain("requestedRole: users.requestedRole");
    expect(pendingBlock).toContain("eq(users.clinicId, clinicId)");
  });
});
