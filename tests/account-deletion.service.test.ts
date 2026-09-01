import { readFileSync } from "node:fs";
import path from "node:path";

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

/**
 * The tenant filter on the avatar lookup, asserted from SOURCE.
 *
 * `deleteStoredAvatar` carries a `// tenant-lint:scoped` waiver, and a waiver is
 * unconditional: measured by mutation, replacing that query's filter with an
 * id-only one still passes `tenant-query-lint` while the waiver is there. The
 * waiver is correct — the lint's function-header pattern cannot see a signature
 * that carries a return type, so it resolves the wrong enclosing scope and flags
 * a query that IS scoped — but "correct waiver" and "detection disarmed on that
 * line forever" are the same thing. This is the guard that replaces it.
 *
 * A source-contract test is the right shape here, not a behavioural one: the
 * defect being guarded against is a filter disappearing from a query, and every
 * behavioural path to it needs a live database.
 */
describe("deleteStoredAvatar stays tenant-scoped (the waived lint's replacement)", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "server", "services", "account-deletion.service.ts"),
    "utf8",
  );

  it("filters the avatar lookup by clinic AND user, not by user alone", () => {
    const fn = source.slice(source.indexOf("async function deleteStoredAvatar"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain(".from(users)");
    expect(body).toMatch(/eq\(users\.clinicId,\s*clinicId\)/);
    expect(body).toMatch(/eq\(users\.id,\s*userId\)/);
  });

  it("audits the object KEY when its deletion failed, so the orphan is recoverable", () => {
    // A `failed` outcome without the key is an unrecoverable orphan: eraseUserData
    // removes the only row naming that object microseconds later, and a
    // console.error is not a recovery path (review finding on RN #203). Asserted
    // from source for the same reason as the test above — every behavioural route
    // to `deleteOwnAccount` needs a live database, Clerk and a bucket.
    expect(source).toMatch(/avatarObject === "failed"[\s\S]{0,80}avatarObjectKey/);
    // And ONLY on failure — a successful delete has no orphan to name.
    expect(source).not.toMatch(/metadata:\s*\{[^}]*avatarObjectKey: avatar\.key,/);
  });

  it("still carries the waiver it is standing in for", () => {
    // If the waiver goes, the lint covers this line again and this guard is
    // redundant rather than load-bearing — which is worth noticing, not silently
    // keeping. Fails loudly so the pair is reconsidered together.
    expect(source).toContain("tenant-lint:scoped");
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
