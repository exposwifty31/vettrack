import {
  getAccessDeniedMetricsSnapshot,
  getAccessDeniedMetricsWindowSnapshot,
  type AccessDeniedReason,
} from "./access-denied.js";
import { createLogLimiter } from "./log-safety.js";

export type AlertType =
  | "ACCESS_DENIED_SPIKE"
  | "CRITICAL_MISSING_CLINIC"
  | "DATA_CORRUPTION";

export interface DataIntegrityTotals {
  nullClinicIdRows: number;
  crossTenantMismatches: number;
  orphanRelations: number;
}

export interface DataIntegrityPayload {
  status: "ok" | "degraded" | "error";
  totals: DataIntegrityTotals;
}

interface AlertEvent {
  type: AlertType;
  reason: string;
  severity: "warning" | "critical";
  payload: Record<string, unknown>;
  ts: string;
}

interface AlertThresholds {
  accessDeniedPerMinute: number;
}

type DataIntegrityChecker = () => Promise<DataIntegrityPayload>;

const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  accessDeniedPerMinute: Number.parseInt(process.env.ALERT_ACCESS_DENIED_PER_MINUTE ?? "30", 10) || 30,
};

const DATA_INTEGRITY_CACHE_TTL_MS = Number.parseInt(process.env.ALERT_DATA_INTEGRITY_CACHE_MS ?? "120000", 10) || 120_000;
const DATA_INTEGRITY_FETCH_TIMEOUT_MS = 5_000;
const ALERT_ENDPOINT = process.env.ALERT_DATA_INTEGRITY_URL ?? `http://127.0.0.1:${process.env.PORT || "3000"}/health/data-integrity`;
const alertLogLimiter = createLogLimiter({
  dedupeWindowMs: 10_000,
  sampleRate: 0.5,
  maxEntries: 100,
});

const alertCounts: Record<AlertType, number> = {
  ACCESS_DENIED_SPIKE: 0,
  CRITICAL_MISSING_CLINIC: 0,
  DATA_CORRUPTION: 0,
};

let lastAlertAt: string | null = null;
let systemDegraded = false;
let cachedIntegrity: { value: DataIntegrityPayload; cachedAt: number } | null = null;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeTotals(raw: unknown): DataIntegrityTotals {
  const fallback: DataIntegrityTotals = {
    nullClinicIdRows: 0,
    crossTenantMismatches: 0,
    orphanRelations: 0,
  };
  if (!raw || typeof raw !== "object") return fallback;
  const source = raw as Partial<Record<keyof DataIntegrityTotals, unknown>>;
  return {
    nullClinicIdRows: Number(source.nullClinicIdRows ?? 0),
    crossTenantMismatches: Number(source.crossTenantMismatches ?? 0),
    orphanRelations: Number(source.orphanRelations ?? 0),
  };
}

function dataIntegrityHealthFetchInit(): RequestInit {
  const token = process.env.DATA_INTEGRITY_HEALTH_TOKEN?.trim();
  if (!token) return {};
  return { headers: { "x-health-token": token } };
}

async function fetchDataIntegrityHealth(): Promise<DataIntegrityPayload> {
  const response = await withTimeout(
    fetch(ALERT_ENDPOINT, dataIntegrityHealthFetchInit()),
    DATA_INTEGRITY_FETCH_TIMEOUT_MS,
    "data-integrity fetch",
  );
  if (!response.ok) {
    return {
      status: "error",
      totals: {
        nullClinicIdRows: 0,
        crossTenantMismatches: 0,
        orphanRelations: 0,
      },
    };
  }

  const body = (await response.json()) as { status?: "ok" | "degraded" | "error"; totals?: unknown };
  return {
    status: body.status ?? "error",
    totals: normalizeTotals(body.totals),
  };
}

async function getDataIntegrityHealth(checker: DataIntegrityChecker): Promise<DataIntegrityPayload> {
  const now = Date.now();
  if (cachedIntegrity && now - cachedIntegrity.cachedAt < DATA_INTEGRITY_CACHE_TTL_MS) {
    return cachedIntegrity.value;
  }

  const value = await checker();
  cachedIntegrity = { value, cachedAt: now };
  return value;
}

export function sendAlert(type: AlertType, payload: Record<string, unknown>): void {
  alertCounts[type] += 1;
  lastAlertAt = new Date().toISOString();
  const severity: AlertEvent["severity"] = type === "DATA_CORRUPTION" || type === "CRITICAL_MISSING_CLINIC" ? "critical" : "warning";
  if (severity === "critical") {
    systemDegraded = true;
  }

  const event: AlertEvent = {
    type,
    severity,
    reason: String(payload.reason ?? "unknown"),
    payload,
    ts: lastAlertAt,
  };

  const logKey = `alert:${type}:${event.reason}`;
  if (alertLogLimiter.shouldLog(logKey)) {
    console.error("[alert]", JSON.stringify(event));
  }
}

export async function evaluateAlerts(options?: {
  thresholds?: Partial<AlertThresholds>;
  dataIntegrityChecker?: DataIntegrityChecker;
}): Promise<void> {
  const thresholds: AlertThresholds = {
    ...DEFAULT_ALERT_THRESHOLDS,
    ...options?.thresholds,
  };
  const totals = getAccessDeniedMetricsSnapshot();
  const window = getAccessDeniedMetricsWindowSnapshot();
  const windowTotal = Object.values(window).reduce((sum, value) => sum + value, 0);

  if (windowTotal > thresholds.accessDeniedPerMinute) {
    sendAlert("ACCESS_DENIED_SPIKE", {
      reason: "ACCESS_DENIED threshold breached",
      threshold: thresholds.accessDeniedPerMinute,
      windowTotal,
      breakdown: window,
      totals,
    });
  }

  if (window.MISSING_CLINIC_ID > 0) {
    sendAlert("CRITICAL_MISSING_CLINIC", {
      reason: "MISSING_CLINIC_ID observed",
      count: window.MISSING_CLINIC_ID,
      breakdown: window,
      totals,
    });
  }

  const checker = options?.dataIntegrityChecker ?? fetchDataIntegrityHealth;
  const dataIntegrity = await getDataIntegrityHealth(checker);
  const corruptionFound =
    dataIntegrity.totals.nullClinicIdRows > 0 ||
    dataIntegrity.totals.crossTenantMismatches > 0 ||
    dataIntegrity.totals.orphanRelations > 0;

  if (corruptionFound) {
    sendAlert("DATA_CORRUPTION", {
      reason: "Data integrity checks detected corruption",
      totals: dataIntegrity.totals,
      status: dataIntegrity.status,
    });
  }
}

export function getAlertEngineSnapshot(): {
  counts: Record<AlertType, number>;
  lastAlertAt: string | null;
  isDegraded: boolean;
  logSafety: { trackedKeys: number; suppressedLogs: number };
} {
  return {
    counts: { ...alertCounts },
    lastAlertAt,
    isDegraded: systemDegraded,
    logSafety: alertLogLimiter.getSnapshot(),
  };
}

export function resetAlertEngineForTests(): void {
  alertCounts.ACCESS_DENIED_SPIKE = 0;
  alertCounts.CRITICAL_MISSING_CLINIC = 0;
  alertCounts.DATA_CORRUPTION = 0;
  lastAlertAt = null;
  systemDegraded = false;
  cachedIntegrity = null;
}

export function buildReasonBreakdown(snapshot: Record<AccessDeniedReason, number>): Array<{ reason: AccessDeniedReason; count: number }> {
  return (Object.keys(snapshot) as AccessDeniedReason[])
    .map((reason) => ({ reason, count: snapshot[reason] }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}
