import { describe, it, expect, afterEach, beforeAll } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  AccountDeletionProtectedError,
  isAccountDeletionProtected,
} from "../server/services/account-deletion.service.js";

describe("isAccountDeletionProtected", () => {
  const prev = process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;

  afterEach(() => {
    if (prev === undefined) delete process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;
    else process.env.ACCOUNT_DELETION_PROTECTED_EMAILS = prev;
  });

  it("blocks the default App Review demo account", () => {
    delete process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;
    expect(isAccountDeletionProtected("reviewer@vettrack.uk")).toBe(true);
    expect(isAccountDeletionProtected("Reviewer@VetTrack.UK")).toBe(true);
  });

  it("merges ACCOUNT_DELETION_PROTECTED_EMAILS with the built-in default", () => {
    // Env additions must NOT drop the reviewer default — otherwise a Railway
    // override silently makes the App Review demo account self-deletable.
    process.env.ACCOUNT_DELETION_PROTECTED_EMAILS = "demo@example.com, other@test.io";
    expect(isAccountDeletionProtected("demo@example.com")).toBe(true);
    expect(isAccountDeletionProtected("other@test.io")).toBe(true);
    expect(isAccountDeletionProtected("reviewer@vettrack.uk")).toBe(true);
  });

  it("does not block ordinary accounts", () => {
    delete process.env.ACCOUNT_DELETION_PROTECTED_EMAILS;
    expect(isAccountDeletionProtected("user@clinic.example")).toBe(false);
  });
});

describe("AccountDeletionProtectedError", () => {
  it("uses a stable error code", () => {
    const err = new AccountDeletionProtectedError();
    expect(err.message).toBe("ACCOUNT_DELETION_PROTECTED");
  });
});

// CROSS-FLOW-1: DELETE /api/users/delete-account swapped strict requireAuth for
// requireAuthAny so a freshly-created status='pending' Apple account can still
// exercise its Guideline 5.1.1(v) right to self-delete (strict requireAuth 403s
// with ACCOUNT_PENDING_APPROVAL before the handler runs). These assert the exact
// middleware contrast the route depends on, using an injected resolver (no DB).
describe("delete-account pending gate (CROSS-FLOW-1)", () => {
  type JsonBody = Record<string, unknown>;
  type Middleware = (req: Request, res: Response, next: NextFunction) => Promise<void>;
  type Resolver = () => Promise<unknown>;

  let createRequireAuth: (resolver: Resolver) => Middleware;
  let createRequireAuthAny: (resolver: Resolver) => Middleware;

  const pendingResolved = {
    ok: true as const,
    user: {
      id: "pending-user-1",
      clerkId: "clerk-pending-1",
      email: "fresh-apple-id@privaterelay.appleid.com",
      name: "Fresh Apple User",
      role: "technician",
      status: "pending",
      locale: "en",
      clinicId: "clinic-1",
    },
  };

  function makeReq(): Request {
    return { headers: {} } as unknown as Request;
  }
  function makeRes() {
    const state: { statusCode: number; body: JsonBody | null } = { statusCode: 200, body: null };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(payload: JsonBody) {
        state.body = payload;
        return this;
      },
    } as unknown as Response;
    return { res, state };
  }
  function makeNext() {
    let called = false;
    const next: NextFunction = () => {
      called = true;
    };
    return { next, wasCalled: () => called };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/vettrack_test";
    process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
    const mod = await import("../server/middleware/auth.js");
    createRequireAuth = mod.createRequireAuth as unknown as typeof createRequireAuth;
    createRequireAuthAny = mod.createRequireAuthAny as unknown as typeof createRequireAuthAny;
  }, 30000);

  it("strict requireAuth blocks a pending account (why the route had to change)", async () => {
    const middleware = createRequireAuth(async () => pendingResolved);
    const req = makeReq();
    const { res, state } = makeRes();
    const tracker = makeNext();
    await middleware(req, res, tracker.next);
    expect(tracker.wasCalled()).toBe(false);
    expect(state.statusCode).toBe(403);
    expect(state.body?.reason).toBe("ACCOUNT_PENDING_APPROVAL");
  });

  it("requireAuthAny admits the same pending account so it can self-delete", async () => {
    const middleware = createRequireAuthAny(async () => pendingResolved);
    const req = makeReq();
    const { res, state } = makeRes();
    const tracker = makeNext();
    await middleware(req, res, tracker.next);
    expect(tracker.wasCalled()).toBe(true);
    expect(state.statusCode).toBe(200);
  });
});
