// Phase 9 — Display-device pairing: ALLOW path.
//
// A valid display token authenticates ONLY the display-consumable surfaces
// (snapshot / heartbeat / stream), is scoped to exactly its own clinic, and a
// revoked/unknown token is rejected. Cross-clinic isolation holds: a token for
// clinic A never resolves to clinic B.
//
// Hermetic: `resolveDisplayAuth` takes an injectable device lookup (default hits
// the DB); we inject a fake so no database is required. `createRequireDisplayOrUser`
// takes an injectable display resolver + user middleware so the wiring is tested
// without touching the real requireAuth path.

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { hashToken } from "../server/lib/display-token.js";

type DisplayAuthResult =
  | { ok: true; clinicId: string; deviceId: string }
  | { ok: false; status: number; body: Record<string, string> };

type DeviceRow = { id: string; clinicId: string; tokenHash: string };

let resolveDisplayAuth: (
  req: Request,
  lookup?: (tokenHash: string) => Promise<DeviceRow | null>,
) => Promise<DisplayAuthResult>;
let createRequireDisplayOrUser: (
  resolveDisplay?: (req: Request) => Promise<DisplayAuthResult>,
  userMiddleware?: (req: Request, res: Response, next: NextFunction) => unknown,
) => (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
let extractDisplayToken: (req: Request) => string | null;

beforeAll(async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/vettrack_test";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const mod = await import("../server/middleware/auth.js");
  resolveDisplayAuth = mod.resolveDisplayAuth;
  createRequireDisplayOrUser = mod.createRequireDisplayOrUser;
  extractDisplayToken = mod.extractDisplayToken;
}, 30000);

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

/** Build a lookup keyed by the token hashes of the given active devices. */
function activeLookup(devices: DeviceRow[]) {
  const byHash = new Map(devices.map((d) => [d.tokenHash, d]));
  return async (tokenHash: string): Promise<DeviceRow | null> => byHash.get(tokenHash) ?? null;
}

describe("resolveDisplayAuth — token extraction", () => {
  it("reads an x-display-token header", () => {
    const token = "vtd_headertoken";
    expect(extractDisplayToken(makeReq({ "x-display-token": token }))).toBe(token);
  });

  it("reads a Bearer token only when it has the vtd_ shape", () => {
    const token = "vtd_bearertoken";
    expect(extractDisplayToken(makeReq({ authorization: `Bearer ${token}` }))).toBe(token);
    // A Clerk JWT bearer must NOT be treated as a display token.
    expect(extractDisplayToken(makeReq({ authorization: "Bearer eyJhbGciOi.jwt.body" }))).toBeNull();
    expect(extractDisplayToken(makeReq({}))).toBeNull();
  });
});

describe("resolveDisplayAuth — allow / deny", () => {
  it("resolves an active token (x-display-token) to its clinic + device id", async () => {
    const token = "vtd_active_A";
    const device: DeviceRow = { id: "dev-A", clinicId: "clinic-A", tokenHash: hashToken(token) };
    const result = await resolveDisplayAuth(
      makeReq({ "x-display-token": token }),
      activeLookup([device]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clinicId).toBe("clinic-A");
      expect(result.deviceId).toBe("dev-A");
    }
  });

  it("resolves an active token via a Bearer header too", async () => {
    const token = "vtd_active_bearer";
    const device: DeviceRow = { id: "dev-B", clinicId: "clinic-B", tokenHash: hashToken(token) };
    const result = await resolveDisplayAuth(
      makeReq({ authorization: `Bearer ${token}` }),
      activeLookup([device]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.clinicId).toBe("clinic-B");
  });

  it("rejects when no token is present (401 MISSING_DISPLAY_TOKEN)", async () => {
    const result = await resolveDisplayAuth(makeReq({}), activeLookup([]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.body.reason).toBe("MISSING_DISPLAY_TOKEN");
    }
  });

  it("rejects an unknown / revoked token (lookup returns null → 401)", async () => {
    // A revoked device is filtered out by the `revoked_at IS NULL` predicate, so
    // the lookup returns null — identical to an unknown token.
    const result = await resolveDisplayAuth(
      makeReq({ "x-display-token": "vtd_unknown" }),
      activeLookup([]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.body.reason).toBe("INVALID_DISPLAY_TOKEN");
    }
  });

  it("rejects when the stored hash does not match (constant-time guard)", async () => {
    const token = "vtd_active_C";
    // Lookup returns a row whose tokenHash is NOT the hash of the presented token.
    const mismatched = async (): Promise<DeviceRow> => ({
      id: "dev-C",
      clinicId: "clinic-C",
      tokenHash: "0".repeat(64),
    });
    const result = await resolveDisplayAuth(makeReq({ "x-display-token": token }), mismatched);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("keeps tokens clinic-scoped — cross-clinic isolation", async () => {
    const tokenA = "vtd_iso_A";
    const tokenB = "vtd_iso_B";
    const lookup = activeLookup([
      { id: "dev-A", clinicId: "clinic-A", tokenHash: hashToken(tokenA) },
      { id: "dev-B", clinicId: "clinic-B", tokenHash: hashToken(tokenB) },
    ]);
    const rA = await resolveDisplayAuth(makeReq({ "x-display-token": tokenA }), lookup);
    const rB = await resolveDisplayAuth(makeReq({ "x-display-token": tokenB }), lookup);
    expect(rA.ok && rA.clinicId).toBe("clinic-A");
    expect(rB.ok && rB.clinicId).toBe("clinic-B");
  });
});

describe("requireDisplayOrUser — allow wiring", () => {
  it("authenticates the display device and scopes req.clinicId, without calling the user path", async () => {
    const userMiddleware = vi.fn((_req, _res, next: NextFunction) => next());
    const mw = createRequireDisplayOrUser(
      async () => ({ ok: true, clinicId: "clinic-A", deviceId: "dev-A" }),
      userMiddleware,
    );
    const req = makeReq({ "x-display-token": "vtd_ok" });
    const { res, state } = makeRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(state.statusCode).toBe(200);
    expect((req as Request & { clinicId?: string }).clinicId).toBe("clinic-A");
    expect((req as Request & { isDisplayAuth?: boolean }).isDisplayAuth).toBe(true);
    expect((req as Request & { displayDeviceId?: string }).displayDeviceId).toBe("dev-A");
    expect(userMiddleware).not.toHaveBeenCalled();
  });

  it("delegates to the existing user middleware when no display token is present", async () => {
    const userMiddleware = vi.fn((_req, _res, next: NextFunction) => next());
    const displayResolver = vi.fn();
    const mw = createRequireDisplayOrUser(
      displayResolver as unknown as (req: Request) => Promise<DisplayAuthResult>,
      userMiddleware,
    );
    const req = makeReq({});
    const { res } = makeRes();
    await mw(req, res, () => {});
    expect(userMiddleware).toHaveBeenCalledTimes(1);
    expect(displayResolver).not.toHaveBeenCalled();
  });
});
