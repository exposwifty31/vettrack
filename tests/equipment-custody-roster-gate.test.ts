/**
 * D1 — the off-shift roster gate on equipment custody, server side.
 *
 * The client-side gate's own docblock states the hole this closes:
 * "the server's enforcement boundary is requireEffectiveRole; there is NO
 * server-side roster denial for scan/checkout" (src/lib/shift-gate.ts). Any
 * student-or-above could take clinic equipment while not rostered — from our
 * UI, a replayed offline write, or curl — and nothing refused it.
 *
 * The gate is a middleware that runs AFTER requireEffectiveRole (which already
 * resolves and stamps `req.activeShift` — no extra query) and mirrors the
 * client rule exactly:
 *   - permanent admins (role or secondaryRole) and vets are exempt — the
 *     server-side reading of `equipment.actOffShift` (doctor pilot 2026-07;
 *     admins per owner decision 2026-07). Permanent role, never the
 *     roster-derived one (the D11 rule).
 *   - anyone with an active roster shift passes, whatever the shift role —
 *     which is also why the vet-roster enum question does not block this
 *     gate: vets are exempt before the roster is consulted.
 *   - everyone else: `shadow` logs and passes, `enforce` refuses 403
 *     OFF_SHIFT, `off` (the default) is a no-op.
 *
 * Per-clinic envelope: authority.custody_roster_enforce.<clinicId> →
 * AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1 → "off", 10s TTL — the same rollback
 * contract as every other enforcement family, so the live Capacitor fleet
 * cannot hit a day-one hard 403.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const configMock = vi.hoisted(() => ({ resolveCustodyRosterEnforcementMode: vi.fn() }));
vi.mock("../server/lib/authority/enforcement/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/lib/authority/enforcement/config.js")>();
  return { ...actual, resolveCustodyRosterEnforcementMode: configMock.resolveCustodyRosterEnforcementMode };
});

import type { Request, Response } from "express";

import { custodyRosterGate, custodyRosterLogger } from "../server/middleware/custody-roster-gate.js";

/** Exactly the request surface the gate reads — nothing else is modeled. */
type GateRequestDouble = {
  clinicId: string;
  authUser: { id: string; name: string; role: string; secondaryRole: string | null } | null;
  activeShift: { id: string; role: string; date: string } | null;
  method: string;
  path: string;
  headers: Record<string, string>;
};

/** Exactly the response surface the gate writes: status(...).json(...). */
type GateResponseDouble = {
  statusCode: number;
  body: unknown;
  status(code: number): GateResponseDouble;
  json(payload: unknown): GateResponseDouble;
};

function makeReq(over: Partial<GateRequestDouble> = {}): GateRequestDouble {
  return {
    clinicId: "clinic-1",
    authUser: { id: "u1", name: "Tech", role: "technician", secondaryRole: null },
    activeShift: null,
    method: "POST",
    path: "/api/equipment/scan",
    headers: {},
    ...over,
  };
}

function makeRes(): GateResponseDouble {
  const res: GateResponseDouble = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

async function run(req: GateRequestDouble) {
  const res = makeRes();
  const next = vi.fn();
  // One unknown-boundary cast per argument: the doubles model exactly the
  // fields the gate touches (see the two types above), not all of Express.
  await custodyRosterGate()(req as unknown as Request, res as unknown as Response, next);
  return { res, next };
}

beforeEach(() => {
  configMock.resolveCustodyRosterEnforcementMode.mockReset();
});

describe("custodyRosterGate — D1 server half", () => {
  it("enforce: refuses an off-shift technician with 403 OFF_SHIFT", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockResolvedValue("enforce");
    const { res, next } = await run(makeReq());
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ reason: "OFF_SHIFT" });
  });

  it("enforce: a rostered technician passes, whatever the shift role", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockResolvedValue("enforce");
    const { res, next } = await run(
      makeReq({ activeShift: { id: "s1", role: "technician", date: "2026-08-28" } }),
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it("enforce: a permanent admin is exempt before the roster is consulted", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockResolvedValue("enforce");
    const { next } = await run(
      makeReq({ authUser: { id: "u2", name: "Boss", role: "admin", secondaryRole: null } }),
    );
    expect(next).toHaveBeenCalledTimes(1);
    // exemption must not even read the envelope — permanent roles are static
    expect(configMock.resolveCustodyRosterEnforcementMode).not.toHaveBeenCalled();
  });

  it("enforce: a secondaryRole admin is exempt (the server checks both halves)", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockResolvedValue("enforce");
    const { next } = await run(
      makeReq({ authUser: { id: "u3", name: "Lead", role: "technician", secondaryRole: "admin" } }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("enforce: a vet is exempt — the doctor-pilot actOffShift grant, server-side", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockResolvedValue("enforce");
    const { next } = await run(
      makeReq({ authUser: { id: "u4", name: "Doc", role: "vet", secondaryRole: null } }),
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(configMock.resolveCustodyRosterEnforcementMode).not.toHaveBeenCalled();
  });

  it("shadow: passes AND emits exactly one structured audit event", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockResolvedValue("shadow");
    const shadowSpy = vi.spyOn(custodyRosterLogger, "shadowRefusal");
    try {
      const { res, next } = await run(makeReq({ path: `/api/equipment/scan-${Date.now()}` }));
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(0);
      expect(shadowSpy).toHaveBeenCalledTimes(1);
      expect(shadowSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: "clinic-1",
          userId: "u1",
          role: "technician",
          method: "POST",
        }),
      );
    } finally {
      shadowSpy.mockRestore();
    }
  });

  it("off (the default): a no-op for everyone", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockResolvedValue("off");
    const { next } = await run(makeReq());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN when the envelope read itself throws — an outage must not lock custody", async () => {
    configMock.resolveCustodyRosterEnforcementMode.mockRejectedValue(new Error("config down"));
    const { res, next } = await run(makeReq());
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });
});

describe("custodyRosterGate — wiring", () => {
  it("guards all four custody routes in the load-bearing order: validate → role → replay → gate", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/routes/equipment.ts", "utf8");
    for (const route of ['"/scan"', '"/:id/toggle"', '"/:id/checkout"', '"/:id/return"']) {
      const at = src.indexOf(`router.post(\n  ${route}`) >= 0 ? src.indexOf(`router.post(\n  ${route}`) : src.indexOf(`router.post(${route}`);
      expect(at, `route ${route} not found`).toBeGreaterThan(-1);
      const windowText = src.slice(at, at + 700);
      // Order is load-bearing (see the gate's docblock): a schema error must
      // beat 403 OFF_SHIFT, and a stored replay must outrank a roster change.
      const validateAt = windowText.indexOf("validateBody(");
      const roleAt = windowText.indexOf("requireEffectiveRole(");
      const replayAt = windowText.indexOf("equipmentReplayIdempotency(");
      const gateAt = windowText.indexOf("custodyRosterGate(");
      for (const [name, idx] of [["validateBody", validateAt], ["requireEffectiveRole", roleAt], ["equipmentReplayIdempotency", replayAt], ["custodyRosterGate", gateAt]] as const) {
        expect(idx, `route ${route} lacks ${name}`).toBeGreaterThan(-1);
      }
      expect(validateAt, `route ${route}: validation precedes the role floor`).toBeLessThan(roleAt);
      expect(roleAt, `route ${route}: the role floor precedes replay`).toBeLessThan(replayAt);
      expect(replayAt, `route ${route}: replay precedes the roster gate`).toBeLessThan(gateAt);
    }
  });
});
