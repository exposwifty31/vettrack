/**
 * `x-dev-clinic-id-override` must not be honored outside local dev bypass.
 *
 * `server/middleware/tenant-context.ts` reads the client-supplied
 * `x-dev-clinic-id-override` header with no environment condition, four lines
 * above an implicit dev default that IS gated on `NODE_ENV !== "production"`.
 * The sibling middleware gates the identical header twice — `NODE_ENV !==
 * "production"` (auth.ts:159) AND auth-mode dev-bypass (auth.ts:312) — before
 * reading it at auth.ts:317, and `.cursorrules:26` documents that contract:
 * "Dev-only headers ... honored only in dev bypass path".
 *
 * Severity note (deliberately not inflated): `tenantContext` is mounted at
 * server/index.ts:312, before any per-route `requireAuth`, so `req.authUser` is
 * usually unset and precedence can fall through to the header. But `requireAuth`
 * then overwrites `req.clinicId` from the session (auth.ts:633/675/774/907), so
 * on authenticated routes the header value is discarded. End-to-end
 * exploitability is NOT claimed here. What these tests lock is the invariant
 * itself: a client-supplied header must never be able to source tenant scope in
 * production or in Clerk mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Deterministic "no Clerk session" — the real helper calls getAuth(), which
// throws without clerkMiddleware. tenantContext catches that, but mocking keeps
// the test about header gating rather than about Clerk's failure mode.
vi.mock("../server/lib/clerk-session-auth.js", () => ({
  readClerkUserSession: () => null,
}));

const { tenantContext } = await import("../server/middleware/tenant-context.js");

const ATTACKER_HEADER_VALUE = "attacker-controlled-clinic";

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function runMiddleware(req: Request): Promise<void> {
  const next = (() => undefined) as unknown as NextFunction;
  return tenantContext(req, {} as Response, next);
}

const ENV_KEYS = ["NODE_ENV", "CLERK_SECRET_KEY", "CLERK_ENABLED", "DEV_DEFAULT_CLINIC_ID"] as const;
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("tenantContext — x-dev-clinic-id-override gating", () => {
  it("ignores the dev clinic override header in production", async () => {
    process.env.NODE_ENV = "production";

    const req = makeReq({ "x-dev-clinic-id-override": ATTACKER_HEADER_VALUE });
    await runMiddleware(req);

    expect(req.clinicId).toBeUndefined();
  });

  it("ignores the dev clinic override header in dev when auth mode is Clerk", async () => {
    // NODE_ENV alone is not enough: auth.ts refuses this header whenever the
    // server is in Clerk mode, so tenantContext honoring it there would let the
    // hint diverge from the identity the session actually proves.
    process.env.NODE_ENV = "development";
    process.env.CLERK_SECRET_KEY = "sk_test_not_a_real_secret";

    const req = makeReq({ "x-dev-clinic-id-override": ATTACKER_HEADER_VALUE });
    await runMiddleware(req);

    // The invariant is "the header was refused", asserted directly so this test
    // survives any future change to the implicit dev default it falls back to.
    expect(req.clinicId).not.toBe(ATTACKER_HEADER_VALUE);
    expect(req.clinicId).toBe("dev-clinic-default");
  });

  it("still honors the dev clinic override header in local dev bypass", async () => {
    process.env.NODE_ENV = "development";

    const req = makeReq({ "x-dev-clinic-id-override": "wetcheck-other-clinic" });
    await runMiddleware(req);

    expect(req.clinicId).toBe("wetcheck-other-clinic");
  });

  it("honors the dev clinic override header when Clerk is explicitly disabled", async () => {
    // `pnpm dev:bypass` sets CLERK_ENABLED=false with a secret still present.
    process.env.NODE_ENV = "development";
    process.env.CLERK_SECRET_KEY = "sk_test_not_a_real_secret";
    process.env.CLERK_ENABLED = "false";

    const req = makeReq({ "x-dev-clinic-id-override": "wetcheck-other-clinic" });
    await runMiddleware(req);

    expect(req.clinicId).toBe("wetcheck-other-clinic");
  });

  it("prefers the authenticated user's clinic over the header in dev bypass", async () => {
    process.env.NODE_ENV = "development";

    const req = makeReq({ "x-dev-clinic-id-override": ATTACKER_HEADER_VALUE });
    (req as Request & { authUser?: { clinicId: string } }).authUser = { clinicId: "real-clinic" };
    await runMiddleware(req);

    expect(req.clinicId).toBe("real-clinic");
  });
});
