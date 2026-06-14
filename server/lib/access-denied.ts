import type { Request } from "express";
import { createLogLimiter } from "./log-safety.js";

export type AccessDeniedReason =
  | "MISSING_CLINIC_ID"
  | "DB_FALLBACK_DISABLED"
  | "TENANT_CONTEXT_MISSING"
  | "TENANT_MISMATCH"
  | "INSUFFICIENT_ROLE"
  | "ACCOUNT_PENDING_APPROVAL"
  | "ACCOUNT_BLOCKED"
  | "ACCOUNT_DELETED"
  | "AUTH_PROFILE_UNAVAILABLE";

type AccessDeniedMetricMap = Record<AccessDeniedReason, number>;

const WINDOW_MINUTE_MS = 60_000;
const RETAINED_BUCKETS = 6;
const WINDOW_SWEEP_INTERVAL_MS = 60_000;
const accessDeniedLogLimiter = createLogLimiter({
  dedupeWindowMs: 10_000,
  sampleRate: 0.2,
  maxEntries: 100,
});

const accessDeniedMetrics: AccessDeniedMetricMap = {
  MISSING_CLINIC_ID: 0,
  DB_FALLBACK_DISABLED: 0,
  TENANT_CONTEXT_MISSING: 0,
  TENANT_MISMATCH: 0,
  INSUFFICIENT_ROLE: 0,
  ACCOUNT_PENDING_APPROVAL: 0,
  ACCOUNT_BLOCKED: 0,
  ACCOUNT_DELETED: 0,
  AUTH_PROFILE_UNAVAILABLE: 0,
};

const emptyAccessDeniedMetrics = (): AccessDeniedMetricMap => ({
  MISSING_CLINIC_ID: 0,
  DB_FALLBACK_DISABLED: 0,
  TENANT_CONTEXT_MISSING: 0,
  TENANT_MISMATCH: 0,
  INSUFFICIENT_ROLE: 0,
  ACCOUNT_PENDING_APPROVAL: 0,
  ACCOUNT_BLOCKED: 0,
  ACCOUNT_DELETED: 0,
  AUTH_PROFILE_UNAVAILABLE: 0,
});

const minuteBuckets = new Map<number, AccessDeniedMetricMap>();
let metricsWindowSchedulerStarted = false;

function getCurrentMinuteBucket(timestampMs = Date.now()): number {
  return Math.floor(timestampMs / WINDOW_MINUTE_MS) * WINDOW_MINUTE_MS;
}

function pruneMinuteBuckets(nowMs = Date.now()): void {
  const cutoffMinute = getCurrentMinuteBucket(nowMs) - (RETAINED_BUCKETS - 1) * WINDOW_MINUTE_MS;
  for (const minute of minuteBuckets.keys()) {
    if (minute < cutoffMinute) {
      minuteBuckets.delete(minute);
    }
  }
}

export function buildAccessDeniedBody(reason: AccessDeniedReason, message: string, requestId?: string): {
  code: "ACCESS_DENIED";
  error: "ACCESS_DENIED";
  reason: AccessDeniedReason;
  message: string;
  requestId?: string;
} {
  return {
    code: "ACCESS_DENIED",
    error: "ACCESS_DENIED",
    reason,
    message,
    ...(requestId ? { requestId } : {}),
  };
}

export function recordAccessDenied(params: {
  req: Request;
  reason: AccessDeniedReason;
  statusCode: number;
  source: string;
  message?: string;
  clinicId?: string | null;
  userId?: string | null;
}): void {
  pruneMinuteBuckets();
  accessDeniedMetrics[params.reason] += 1;
  const bucket = getCurrentMinuteBucket();
  const bucketMetrics = minuteBuckets.get(bucket) ?? emptyAccessDeniedMetrics();
  bucketMetrics[params.reason] += 1;
  minuteBuckets.set(bucket, bucketMetrics);

  const payload = {
    event: "access_denied",
    reason: params.reason,
    statusCode: params.statusCode,
    source: params.source,
    route: params.req.originalUrl || params.req.path,
    method: params.req.method,
    clinicId: params.clinicId ?? params.req.clinicId ?? null,
    userId: params.userId ?? params.req.authUser?.id ?? null,
    message: params.message ?? null,
    requestId: (() => {
      const headers = (params.req as Request & { headers?: Record<string, unknown> }).headers;
      return typeof headers?.["x-request-id"] === "string" ? headers["x-request-id"] : null;
    })(),
    ts: new Date().toISOString(),
  };

  if (accessDeniedLogLimiter.shouldLog(`access-denied:${params.reason}`)) {
    console.warn("[access-denied]", JSON.stringify(payload));
  }
}

export function getAccessDeniedMetricsSnapshot(): AccessDeniedMetricMap {
  return { ...accessDeniedMetrics };
}

export function getAccessDeniedMetricsWindowSnapshot(windowMs = WINDOW_MINUTE_MS): AccessDeniedMetricMap {
  pruneMinuteBuckets();
  const now = Date.now();
  const start = now - Math.max(windowMs, WINDOW_MINUTE_MS);
  const snapshot = emptyAccessDeniedMetrics();

  for (const [minute, values] of minuteBuckets.entries()) {
    if (minute < start) continue;
    for (const reason of Object.keys(snapshot) as AccessDeniedReason[]) {
      snapshot[reason] += values[reason];
    }
  }

  return snapshot;
}

export function resetAccessDeniedMetricsWindow(): void {
  minuteBuckets.clear();
}

export function startAccessDeniedMetricsWindowScheduler(): void {
  if (metricsWindowSchedulerStarted) return;
  metricsWindowSchedulerStarted = true;
  setInterval(() => {
    pruneMinuteBuckets();
  }, WINDOW_SWEEP_INTERVAL_MS);
}

export function getAccessDeniedLogSafetySnapshot(): {
  trackedKeys: number;
  suppressedLogs: number;
} {
  return accessDeniedLogLimiter.getSnapshot();
}
