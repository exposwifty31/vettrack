/**
 * D1 — the off-shift roster gate on equipment custody.
 *
 * The client gate's own docblock named the hole: "the server's enforcement
 * boundary is requireEffectiveRole; there is NO server-side roster denial for
 * scan/checkout" (src/lib/shift-gate.ts). Custody is this product's
 * accountability spine, and it was enforced only by our own UI — not against
 * a replayed offline write, not against curl.
 *
 * Placement contract — LAST in the chain, and the order is load-bearing:
 * `validateBody` → `requireEffectiveRole` → `equipmentReplayIdempotency` →
 * this gate. Validation first: a malformed request earns its schema error,
 * never 403 OFF_SHIFT. requireEffectiveRole has already resolved and stamped
 * `req.activeShift` — this middleware adds NO query. Replay BEFORE the gate:
 * a keyed replay of a write that committed on-shift must serve the stored
 * outcome even after the shift ended — a roster change cannot un-happen the
 * original write, and a 403 here would recreate the ambiguity D2 kills.
 *
 * The rule mirrors src/lib/shift-gate.ts exactly:
 *   - Permanent admins (role or secondaryRole) and vets are exempt — the
 *     server-side reading of `equipment.actOffShift` (vets under the doctor
 *     pilot 2026-07, admins per owner decision 2026-07). Permanent role only,
 *     never the roster-derived effective role (the D11 field rule) — and the
 *     exemption is decided BEFORE the envelope is read, so a config outage
 *     cannot affect the people expected to work off-roster.
 *   - Anyone with an active roster shift passes, whatever the shift role.
 *     (This is also why the vet-roster enum question does not block the gate:
 *     vets are exempt before the roster is consulted.)
 *   - Everyone else: `shadow` logs and passes, `enforce` refuses 403
 *     OFF_SHIFT, `off` — the default — is a no-op.
 *
 * Fail OPEN on an envelope read error: an infrastructure outage must never
 * lock the clinic out of its own equipment.
 */
import type { NextFunction, Request, Response } from "express";

import { buildAccessDeniedBody, recordAccessDenied } from "../lib/access-denied.js";
import { resolveCustodyRosterEnforcementMode } from "../lib/authority/enforcement/config.js";
import { createLogLimiter } from "../lib/log-safety.js";

const shadowLogLimiter = createLogLimiter({ dedupeWindowMs: 60_000 });

/** Request-derived strings can carry CRLF — strip before they reach a log line. */
function logSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, 256);
}

/**
 * Structured shadow-audit events. Console transport — the server's house
 * pattern (auth.ts, equipment-replay-idempotency.ts) — exported so tests
 * assert the EVENT, not a prose string.
 */
export const custodyRosterLogger = {
  shadowRefusal(fields: {
    clinicId: string;
    userId: string;
    role: string;
    method: string;
    path: string;
  }): void {
    console.warn("[custody-roster-gate]", {
      event: "custody_roster_shadow_refusal",
      outcome: "would_refuse_off_shift",
      ...fields,
    });
  },
};

export function custodyRosterGate() {
  return async function custodyRosterGateMw(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const user = req.authUser;
    if (!user) {
      // requireAuth owns the unauthenticated failure; this gate never doubles it.
      next();
      return;
    }
    if (user.role === "admin" || user.secondaryRole === "admin" || user.role === "vet") {
      next();
      return;
    }

    let mode: "off" | "shadow" | "enforce";
    try {
      mode = await resolveCustodyRosterEnforcementMode(req.clinicId!);
    } catch {
      next();
      return;
    }
    if (mode === "off" || req.activeShift) {
      next();
      return;
    }

    if (mode === "shadow") {
      // Dedupe key: one line per user+path per window — a sweep of taps from
      // one off-shift user must not flood the log.
      if (shadowLogLimiter.shouldLog(`${req.clinicId}:${user.id}:${req.path}`)) {
        custodyRosterLogger.shadowRefusal({
          clinicId: req.clinicId ?? "",
          userId: user.id,
          role: user.role,
          method: logSafe(req.method),
          path: logSafe(req.path),
        });
      }
      next();
      return;
    }

    recordAccessDenied({
      req,
      source: "custodyRosterGate",
      statusCode: 403,
      reason: "OFF_SHIFT",
      message: "No active roster shift",
    });
    res
      .status(403)
      .json(buildAccessDeniedBody("OFF_SHIFT", "Equipment custody requires an active roster shift"));
  };
}
