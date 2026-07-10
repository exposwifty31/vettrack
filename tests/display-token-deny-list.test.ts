// Phase 9 — Display-device pairing: DENY LIST (author RED first).
//
// A valid display token must be REJECTED on every NON-display route. Those routes
// are guarded by the existing `requireAuth` (→ `resolveAuthUser`), which is left
// byte-identical by this phase. A display token is not a Clerk credential, so in
// Clerk mode `resolveAuthUser` rejects it with 401 — the deny-list holds by
// construction.
//
// 🔴 CRITICAL — dev-bypass would make these tests LIE: `resolveAuthUser` returns
// the hardcoded admin for ANY request in dev-bypass mode, so a display token on
// `/api/equipment` would be "accepted" and the test would falsely pass. We
// therefore FORCE Clerk mode (secret present, not disabled) for the resolver
// assertions — with no real Clerk session the resolver returns 401, proving the
// token is denied on non-display routes rather than silently admitted.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

type ResolveResult = { ok: boolean; status?: number; body?: Record<string, string> };
type DisplayAuthResult =
  | { ok: true; clinicId: string; deviceId: string }
  | { ok: false; status: number; body: Record<string, string> };

let resolveAuthUser: (req: Request) => Promise<ResolveResult>;
let requireAuth: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
let createRequireDisplayOrUser: (
  resolveDisplay?: (req: Request) => Promise<DisplayAuthResult>,
  userMiddleware?: (req: Request, res: Response, next: NextFunction) => unknown,
) => (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
let resolveDisplayAuth: (
  req: Request,
  lookup?: (tokenHash: string) => Promise<{ id: string; clinicId: string; tokenHash: string } | null>,
) => Promise<DisplayAuthResult>;

const A_DISPLAY_TOKEN = `vtd_${"A".repeat(43)}`;

beforeAll(async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/vettrack_test";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const mod = await import("../server/middleware/auth.js");
  resolveAuthUser = mod.resolveAuthUser;
  requireAuth = mod.requireAuth;
  createRequireDisplayOrUser = mod.createRequireDisplayOrUser;
  resolveDisplayAuth = mod.resolveDisplayAuth;
}, 30000);

/** Run `fn` with Clerk mode forced on (so resolveAuthUser does NOT dev-bypass). */
async function withClerkMode<T>(fn: () => Promise<T>): Promise<T> {
  const savedSecret = process.env.CLERK_SECRET_KEY;
  const savedEnabled = process.env.CLERK_ENABLED;
  process.env.CLERK_SECRET_KEY = "sk_test_forced_deny_list";
  delete process.env.CLERK_ENABLED;
  try {
    return await fn();
  } finally {
    if (savedSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = savedSecret;
    if (savedEnabled === undefined) delete process.env.CLERK_ENABLED;
    else process.env.CLERK_ENABLED = savedEnabled;
  }
}

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes() {
  const state: { statusCode: number; body: Record<string, unknown> | null } = {
    statusCode: 200,
    body: null,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      state.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, state };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deny-list — resolveAuthUser (the guard behind /api/equipment, /api/users, /api/dispense …)", () => {
  // Representative non-display routes; each is protected by requireAuth, so a
  // single resolveAuthUser assertion per credential shape covers them all.
  const displayCredentials: Array<[string, Record<string, string>]> = [
    ["Bearer display token", { authorization: `Bearer ${A_DISPLAY_TOKEN}` }],
    ["x-display-token header", { "x-display-token": A_DISPLAY_TOKEN }],
    ["both headers", { authorization: `Bearer ${A_DISPLAY_TOKEN}`, "x-display-token": A_DISPLAY_TOKEN }],
  ];

  for (const [label, headers] of displayCredentials) {
    it(`rejects a display token (${label}) with 401 in Clerk mode`, async () => {
      await withClerkMode(async () => {
        const result = await resolveAuthUser(makeReq(headers));
        expect(result.ok).toBe(false);
        expect(result.status).toBe(401);
      });
    });
  }

  it("sanity: forcing Clerk mode is what denies (a bare request is also 401, not dev-bypass admin)", async () => {
    await withClerkMode(async () => {
      const result = await resolveAuthUser(makeReq({}));
      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
    });
  });
});

describe("deny-list — requireAuth end-to-end blocks a display token on a non-display route", () => {
  it("returns 401 and never calls next()", async () => {
    await withClerkMode(async () => {
      const req = makeReq({ authorization: `Bearer ${A_DISPLAY_TOKEN}` });
      const { res, state } = makeRes();
      let nextCalled = false;
      await requireAuth(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(false);
      expect(state.statusCode).toBe(401);
    });
  });
});

describe("F6 — live-stream revocation predicate: resolveDisplayAuth denies a revoked device", () => {
  // The realtime /stream handler re-validates a display-authed connection on an
  // interval by calling resolveDisplayAuth(req); a `!ok` result closes the live
  // SSE stream. The active-device lookup filters `revoked_at IS NULL`, so a
  // revoked device returns null — exactly the signal below. This is what stops a
  // revoked kiosk from streaming operational data on its already-open connection.
  it("returns !ok/401 when the active-device lookup finds no row (revoked or unknown)", async () => {
    const req = makeReq({ "x-display-token": A_DISPLAY_TOKEN });
    const result = await resolveDisplayAuth(req, async () => null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });
});

describe("deny-list — requireDisplayOrUser never falls through to the user path on a bad token", () => {
  it("a present-but-invalid display token is rejected 401 without invoking the user middleware", async () => {
    const userMiddleware = vi.fn((_req, _res, next: NextFunction) => next());
    const mw = createRequireDisplayOrUser(
      async () => ({
        ok: false,
        status: 401,
        body: { error: "UNAUTHORIZED", reason: "INVALID_DISPLAY_TOKEN", message: "Unauthorized" },
      }),
      userMiddleware,
    );
    const req = makeReq({ "x-display-token": "vtd_revoked_or_unknown" });
    const { res, state } = makeRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });
    expect(state.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
    // The critical property: a bad display token must NOT fall through to the
    // user path (which, in dev-bypass, would return admin).
    expect(userMiddleware).not.toHaveBeenCalled();
  });
});
