import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Request } from "express";
import {
  parseAdminEmailsFromEnv,
  isAdminEmail,
  __resetAdminEmailAllowlistCacheForTests,
} from "../server/lib/admin-email-allowlist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authSource = fs.readFileSync(
  path.join(__dirname, "../server/middleware/auth.ts"),
  "utf8",
);

const { dbResolves, insertValuesLog, getAuthMock, dbUpdateMock } = vi.hoisted(() => {
  const dbResolves: unknown[] = [];
  const insertValuesLog: unknown[] = [];
  const getAuthMock = vi.fn();
  const dbUpdateMock = vi.fn();
  return { dbResolves, insertValuesLog, getAuthMock, dbUpdateMock };
});

type ChainProxy = Record<string, unknown>;

function makeChain(): ChainProxy {
  const chain: ChainProxy = {};
  const methods = [
    "from",
    "where",
    "limit",
    "returning",
    "values",
    "set",
    "onConflictDoNothing",
    "onConflictDoUpdate",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.values = vi.fn((vals: unknown) => {
    insertValuesLog.push(vals);
    return chain;
  });
  chain.then = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void,
  ) => {
    const v = dbResolves.shift() ?? [];
    Promise.resolve(v).then(resolve, reject);
  };
  return chain;
}

vi.mock("@clerk/express", () => ({
  getAuth: (...args: unknown[]) => getAuthMock(...args),
  clerkClient: {
    users: {
      getUser: vi.fn().mockResolvedValue({
        emailAddresses: [{ emailAddress: "owner@vettrack.uk" }],
        firstName: "Owner",
        lastName: "User",
      }),
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
  users: {
    id: "id",
    clinicId: "clinicId",
    clerkId: "clerkId",
    email: "email",
    name: "name",
    displayName: "displayName",
    role: "role",
    status: "status",
    deletedAt: "deletedAt",
    secondaryRole: "secondaryRole",
  },
}));

describe("parseAdminEmailsFromEnv", () => {
  const original = process.env.ADMIN_EMAILS;

  afterEach(() => {
    __resetAdminEmailAllowlistCacheForTests();
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
  });

  it("normalizes case, trims whitespace, dedupes", () => {
    process.env.ADMIN_EMAILS = " Admin@Clinic.com , admin@clinic.com , OTHER@test.io ";
    expect(parseAdminEmailsFromEnv()).toEqual(["admin@clinic.com", "other@test.io"]);
  });

  it("isAdminEmail matches normalized allowlist", () => {
    process.env.ADMIN_EMAILS = "Owner@VetTrack.uk";
    expect(isAdminEmail("owner@vettrack.uk")).toBe(true);
    expect(isAdminEmail("tech@vettrack.uk")).toBe(false);
  });
});

describe("ADMIN_EMAILS promotion policy — source contracts", () => {
  it("insert-time promotion uses isAdminEmail for defaultRole/defaultStatus", () => {
    expect(authSource).toContain("const adminEmail = clerkEmail ? isAdminEmail(clerkEmail) : false");
    expect(authSource).toContain('const defaultRole: UserRole = adminEmail ? "admin" : "technician"');
  });

  it("onConflictDoUpdate excludes role (demoted role not clobbered on upsert)", () => {
    const conflictBlock =
      authSource.match(
        /deliberately excludes `role`[\s\S]*?onConflictDoUpdate\([\s\S]*?\}\)\s*\.returning/,
      )?.[0] ?? "";
    expect(conflictBlock).toContain("onConflictDoUpdate");
    const setClause = conflictBlock.match(/set: \{([\s\S]*?)\},/)?.[1] ?? "";
    expect(setClause).not.toContain("role:");
  });

  it("per-request ADMIN_EMAILS UPDATE promotion block removed", () => {
    expect(authSource).not.toMatch(
      /ADMIN_EMAILS\.includes\(user\.email\.toLowerCase\(\)\)/,
    );
    expect(authSource).not.toMatch(
      /\.update\(users\)\s*\n\s*\.set\(\{ role: "admin", status: "active" \}\)/,
    );
  });

  it("dev-bypass path does not reference ADMIN_EMAILS", () => {
    const devBypassBlock = authSource.match(/if \(isDevBypass\) \{[\s\S]*?return \{ ok: true, user: resolved \}/)?.[0] ?? "";
    expect(devBypassBlock).not.toContain("ADMIN_EMAILS");
    expect(devBypassBlock).not.toContain("isAdminEmail");
  });
});

describe("resolveAuthUser — ADMIN_EMAILS promotion runtime", () => {
  let resolveAuthUser: (req: Request) => Promise<{
    ok: boolean;
    user?: { role: string; status: string };
  }>;

  const originalAdminEmails = process.env.ADMIN_EMAILS;
  const originalClerkSecret = process.env.CLERK_SECRET_KEY;
  const originalClerkEnabled = process.env.CLERK_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.CLERK_SECRET_KEY = "sk_test_mock_for_admin_emails_tests";
    // .env.local sets CLERK_ENABLED=false for local dev-bypass; clear it so
    // resolveAuthMode picks the Clerk path (the promotion runtime under test).
    // Otherwise resolveAuthUser short-circuits into ensureDevUserRecord.
    delete process.env.CLERK_ENABLED;
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
  });

  beforeEach(() => {
    __resetAdminEmailAllowlistCacheForTests();
    dbResolves.length = 0;
    insertValuesLog.length = 0;
    dbUpdateMock.mockClear();
    getAuthMock.mockReturnValue({
      userId: "clerk-owner-1",
      orgId: "clinic-prod-1",
      sessionClaims: { email: "owner@vettrack.uk", name: "Owner User" },
    });
    process.env.ADMIN_EMAILS = "owner@vettrack.uk";
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  function makeReq(): Request {
    return {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
  }

  function queueClinicAndUserReturning(userRow: Record<string, unknown>): void {
    dbResolves.push(undefined);
    dbResolves.push([userRow]);
  }

  it("insert-time promotion assigns admin role for allowlisted email on first upsert", async () => {
    queueClinicAndUserReturning({
      id: "user-1",
      clerkId: "clerk-owner-1",
      email: "owner@vettrack.uk",
      name: "Owner User",
      role: "admin",
      status: "active",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    const result = await resolveAuthUser(makeReq());
    expect(result.ok).toBe(true);
    expect(result.user?.role).toBe("admin");
    expect(result.user?.status).toBe("active");

    const userInsertValues = insertValuesLog.find(
      (v) =>
        v &&
        typeof v === "object" &&
        "clerkId" in v &&
        (v as { clerkId: string }).clerkId === "clerk-owner-1",
    );
    expect(userInsertValues).toMatchObject({ role: "admin", status: "active" });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("does not re-promote demoted admin on second request (DB role wins over ADMIN_EMAILS)", async () => {
    const demotedRow = {
      id: "user-1",
      clerkId: "clerk-owner-1",
      email: "owner@vettrack.uk",
      name: "Owner User",
      role: "technician",
      status: "active",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    };
    queueClinicAndUserReturning(demotedRow);
    queueClinicAndUserReturning(demotedRow);

    const req = makeReq();
    const first = await resolveAuthUser(req);
    const second = await resolveAuthUser(req);

    expect(first.ok).toBe(true);
    expect(first.user?.role).toBe("technician");
    expect(second.ok).toBe(true);
    expect(second.user?.role).toBe("technician");
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("non-allowlisted email gets technician role and pending status on insert", async () => {
    process.env.ADMIN_EMAILS = "other@vettrack.uk";
    getAuthMock.mockReturnValue({
      userId: "clerk-tech-1",
      orgId: "clinic-prod-1",
      sessionClaims: { email: "tech@vettrack.uk", name: "Tech User" },
    });
    queueClinicAndUserReturning({
      id: "user-2",
      clerkId: "clerk-tech-1",
      email: "tech@vettrack.uk",
      name: "Tech User",
      role: "technician",
      status: "pending",
      clinicId: "clinic-prod-1",
      deletedAt: null,
      secondaryRole: null,
    });

    const result = await resolveAuthUser(makeReq());
    expect(result.ok).toBe(true);
    expect(result.user?.role).toBe("technician");
    expect(result.user?.status).toBe("pending");

    const userInsertValues = insertValuesLog.find(
      (v) =>
        v &&
        typeof v === "object" &&
        "clerkId" in v &&
        (v as { clerkId: string }).clerkId === "clerk-tech-1",
    );
    expect(userInsertValues).toMatchObject({ role: "technician", status: "pending" });
  });
});
