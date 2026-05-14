/**
 * Phase 2.5 PR 5: Authority observability — durable audit emission.
 *
 * Fire-and-forget durable audit writes for authority outcomes. These are an
 * INDEPENDENT observability path from `recordAccessDenied` (which is
 * console+metrics, 20% sampled, 10s deduped). This module is durable
 * (vt_audit_logs) and intentionally rate-limited per (clinicId, userId, route)
 * so a 403 storm cannot turn into a transaction-per-request audit insert.
 *
 * Gated by env flag `AUTHORITY_OBS_V1=true`. When the flag is unset the
 * module no-ops — no audit row is written, no error is logged. Counters are
 * NOT gated by this flag; they live in metrics.ts and increment unconditionally.
 *
 * Pure additive. Adds no enforcement.
 */

import type { Request } from "express";

import type { AuthoritySnapshot } from "../../shared/authority.js";

import { logAudit } from "./audit.js";
import { createLogLimiter } from "./log-safety.js";

export type AuthorityDenialKind =
  | "ROLE_NOT_IN_ALLOW"
  | "LEGACY_FALLBACK_NOT_MATCHED";

function isAuthorityObsV1Enabled(): boolean {
  return process.env.AUTHORITY_OBS_V1 === "true";
}

// Per-(clinicId, userId, route) rate limit. 60s dedupe window matches the
// drift limiter in authority.ts. maxEntries scaled to typical clinic size.
const deniedAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

const resolutionFailedAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 200,
});

// Legacy-fallback rows would otherwise inflate vt_audit_logs under normal
// dispense workflow. One row per (clinicId, userId, route) per hour is
// sufficient sunset-readiness signal; per-grant counters in metrics.ts cover
// volume.
const dispenseLegacyFallbackAuditLimiter = createLogLimiter({
  dedupeWindowMs: 3_600_000,
  sampleRate: 1,
  maxEntries: 500,
});

function safeRoute(req: Request): string {
  // Strip query string: requests to the same endpoint with different query
  // values would otherwise hash to distinct rate-limit keys, bypassing the
  // per-(clinicId,userId,route) dedupe and allowing a denial storm to inflate
  // vt_audit_logs. The normalized path is also what we want in audit metadata
  // — query params add cardinality without observability value and may
  // contain PII.
  const raw = req.originalUrl || req.path || "unknown";
  const queryIdx = raw.indexOf("?");
  return queryIdx === -1 ? raw : raw.slice(0, queryIdx);
}

function safeUserId(req: Request): string {
  return req.authUser?.id ?? "unknown";
}

function safeUserEmail(req: Request): string {
  return req.authUser?.email ?? "unknown";
}

function safeClinicId(req: Request): string | null {
  return req.clinicId ?? req.authUser?.clinicId ?? null;
}

function safeRequestId(req: Request): string | null {
  const h = (req.headers as Record<string, unknown> | undefined)?.[
    "x-request-id"
  ];
  return typeof h === "string" && h.length > 0 ? h : null;
}

export function emitAuthorityDeniedAudit(args: {
  req: Request;
  snapshot: AuthoritySnapshot;
  denialKind: AuthorityDenialKind;
}): void {
  if (!isAuthorityObsV1Enabled()) return;

  const { req, snapshot, denialKind } = args;
  const clinicId = safeClinicId(req);
  if (!clinicId) return;

  const userId = safeUserId(req);
  const route = safeRoute(req);
  const key = `authority_denied:${clinicId}:${userId}:${route}`;
  if (!deniedAuditLimiter.shouldLog(key)) return;

  // Fire-and-forget. Must not block the 403 response.
  try {
    logAudit({
      clinicId,
      actionType: "authority_denied",
      performedBy: userId,
      performedByEmail: safeUserEmail(req),
      targetId: null,
      targetType: "authority_decision",
      metadata: {
        route,
        method: req.method,
        requestId: safeRequestId(req),
        denialKind,
        snapshotReason: snapshot.reason,
        snapshotSource: snapshot.source,
        effectiveClinicalRole: snapshot.effectiveClinicalRole,
        clinicalRole: snapshot.clinicalRole,
        operationalRole: snapshot.operationalRole,
      },
      actorRole: snapshot.effectiveClinicalRole ?? snapshot.clinicalRole ?? null,
    });
  } catch (err) {
    // logAudit is already fire-and-forget; this catch is defense-in-depth.
    console.error("[authority-audit] denied emission failed", err);
  }
}

export function emitAuthorityResolutionFailedAudit(args: {
  req: Request;
  error: unknown;
}): void {
  if (!isAuthorityObsV1Enabled()) return;

  const { req, error } = args;
  const clinicId = safeClinicId(req);
  if (!clinicId) return;

  const userId = safeUserId(req);
  const route = safeRoute(req);
  const key = `authority_resolution_failed:${clinicId}:${userId}:${route}`;
  if (!resolutionFailedAuditLimiter.shouldLog(key)) return;

  const errMsg =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";

  try {
    logAudit({
      clinicId,
      actionType: "authority_resolution_failed",
      performedBy: userId,
      performedByEmail: safeUserEmail(req),
      targetId: null,
      targetType: "authority_decision",
      metadata: {
        route,
        method: req.method,
        requestId: safeRequestId(req),
        error: errMsg,
      },
      actorRole: null,
    });
  } catch (err) {
    console.error("[authority-audit] resolution-failed emission failed", err);
  }
}

export function emitDispenseLegacyFallbackAudit(args: {
  req: Request;
  snapshot: AuthoritySnapshot;
}): void {
  if (!isAuthorityObsV1Enabled()) return;

  const { req, snapshot } = args;
  const clinicId = safeClinicId(req);
  if (!clinicId) return;

  const userId = safeUserId(req);
  const route = safeRoute(req);
  const key = `dispense_legacy_fallback:${clinicId}:${userId}:${route}`;
  if (!dispenseLegacyFallbackAuditLimiter.shouldLog(key)) return;

  try {
    logAudit({
      clinicId,
      actionType: "dispense_legacy_role_fallback_used",
      performedBy: userId,
      performedByEmail: safeUserEmail(req),
      targetId: null,
      targetType: "authority_decision",
      metadata: {
        route,
        method: req.method,
        requestId: safeRequestId(req),
        snapshotReason: snapshot.reason,
        snapshotSource: snapshot.source,
        clinicalRole: snapshot.clinicalRole,
      },
      actorRole: snapshot.clinicalRole ?? null,
    });
  } catch (err) {
    console.error("[authority-audit] legacy-fallback emission failed", err);
  }
}
