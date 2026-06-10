import { Router } from "express";
import { randomUUID } from "crypto";
import { pool } from "../db.js";
import { isPostgresqlConfigured } from "../lib/postgresql.js";
import { safeRedisGet, getRedisUrl } from "../lib/redis.js";
import https from "https";
import { withDbRetry, withDbTimeout } from "../lib/db-resilience.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();



router.get("/live", (_req, res) => {
  res.status(200).json({ status: "ok", type: "liveness" });
});

router.get("/startup", async (_req, res) => {
  const checks = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    hasDatabaseUrl: isPostgresqlConfigured(),
    hasRedisUrl: Boolean(process.env.REDIS_URL?.trim()),
    hasSessionSecret: Boolean(process.env.SESSION_SECRET?.trim()),
    hasClerkSecretKey: Boolean(process.env.CLERK_SECRET_KEY?.trim()),
  };

  let databaseReachable = false;
  if (checks.hasDatabaseUrl) {
    try {
      await withDbRetry(() => withDbTimeout(() => pool.query("SELECT 1")));
      databaseReachable = true;
    } catch {
      return res.status(503).json({
        status: "error",
        type: "startup",
        code: "DATABASE_UNREACHABLE",
        checks: {
          ...checks,
          databaseReachable: false,
        },
      });
    }
  }

  res.status(200).json({
    status: "ok",
    type: "startup",
    checks: {
      ...checks,
      databaseReachable,
    },
  });
});

function clerkReachable(secretKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.clerk.com",
      port: 443,
      path: "/v1/users?limit=1",
      method: "GET",
      timeout: 5000,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      res.resume();
      const code = res.statusCode ?? 0;
      resolve(code >= 200 && code < 300);
    });

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.on("error", () => {
      resolve(false);
    });

    req.end();
  });
}

async function vapidValid(): Promise<boolean> {
  let publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  let privateKey = process.env.VAPID_PRIVATE_KEY ?? "";

  if (!publicKey || !privateKey) {
    try {
      const pubRows = await pool.query(
        "SELECT value FROM vt_server_config WHERE key = 'vapid_public_key'"
      );
      const privRows = await pool.query(
        "SELECT value FROM vt_server_config WHERE key = 'vapid_private_key'"
      );
      publicKey = pubRows.rows[0]?.value ?? "";
      privateKey = privRows.rows[0]?.value ?? "";
    } catch {
      return false;
    }
  }

  if (!publicKey || !privateKey) return false;

  try {
    const { default: webpush } = await import("web-push");
    webpush.setVapidDetails("mailto:health@vettrack.app", publicKey, privateKey);
    return true;
  } catch {
    return false;
  }
}

router.get("/", async (_req, res) => {
  const checks: Record<string, string> = {
    db: "fail",
    clerk: "fail",
    vapid: "fail",
    worker: "skip",
  };

  let allOk = true;

  try {
    await withDbRetry(() => withDbTimeout(() => pool.query("SELECT 1")));
    checks.db = "ok";
  } catch {
    checks.db = "fail";
    allOk = false;
  }

  if (process.env.CLERK_SECRET_KEY) {
    const reachable = await clerkReachable(process.env.CLERK_SECRET_KEY);
    if (reachable) {
      checks.clerk = "ok";
    } else {
      checks.clerk = "fail";
      allOk = false;
    }
  } else {
    checks.clerk = "skip";
  }

  const vapidOk = await vapidValid();
  if (vapidOk) {
    checks.vapid = "ok";
  } else {
    checks.vapid = "fail";
    allOk = false;
  }

  // Worker heartbeat: notification.worker.ts writes vettrack:worker:heartbeat
  // every 30s with a 120s TTL. A missing key means the worker process is dead.
  if (getRedisUrl()) {
    const beat = await safeRedisGet("vettrack:worker:heartbeat");
    if (beat) {
      const age = Date.now() - Number(beat);
      checks.worker = age < 120_000 ? "ok" : "stale";
      if (checks.worker !== "ok") allOk = false;
    } else {
      checks.worker = "fail";
      allOk = false;
    }
  } else {
    checks.worker = "skip";
  }

  const status = allOk ? "ok" : "degraded";
  const httpStatus = allOk ? 200 : 503;

  res.status(httpStatus).json({ status, type: "readiness", checks });
});

router.get("/data-integrity", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const expectedToken = process.env.DATA_INTEGRITY_HEALTH_TOKEN?.trim();
  const providedToken = typeof req.headers["x-health-token"] === "string"
    ? req.headers["x-health-token"].trim()
    : "";

  // Fail closed in production: this probe exposes tenant-isolation counts
  // (null clinicId rows, cross-tenant mismatches, orphan relations) and must
  // never be reachable unauthenticated. A missing DATA_INTEGRITY_HEALTH_TOKEN
  // is a misconfiguration, not an open door — reject rather than serve.
  if (process.env.NODE_ENV === "production") {
    if (!expectedToken) {
      return res.status(503).json(
        apiError({
          code: "SERVICE_UNAVAILABLE",
          reason: "HEALTH_TOKEN_NOT_CONFIGURED",
          message: "Data-integrity health check is not configured",
          requestId,
        }),
      );
    }
    if (providedToken !== expectedToken) {
      return res.status(401).json(
        apiError({
          code: "UNAUTHORIZED",
          reason: "INVALID_HEALTH_TOKEN",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
  }

  try {
    const nullCountsResult = await withDbRetry(() => withDbTimeout(() => pool.query<{ table_name: string; null_or_empty_count: string }>(
      "SELECT table_name, null_or_empty_count::text FROM vt_data_integrity_null_clinic_counts ORDER BY table_name"
    )));
    const mismatchCountsResult = await withDbRetry(() => withDbTimeout(() => pool.query<{ check_name: string; mismatch_count: string }>(
      "SELECT check_name, mismatch_count::text FROM vt_data_integrity_cross_tenant_mismatch_counts ORDER BY check_name"
    )));
    const orphanCountsResult = await withDbRetry(() => withDbTimeout(() => pool.query<{ check_name: string; orphan_count: string }>(
      "SELECT check_name, orphan_count::text FROM vt_data_integrity_orphan_counts ORDER BY check_name"
    )));
    const fallbackResult = await withDbRetry(() => withDbTimeout(() => pool.query<{ table_name: string; fallback_row_count: string }>(`
      SELECT table_name, fallback_row_count::text
      FROM vt_clinic_backfill_fallback_audit
      WHERE migration_name = '025_data_integrity_hardening.sql'
      ORDER BY table_name
    `)));

    const nullClinicCounts = Object.fromEntries(
      nullCountsResult.rows.map((row) => [row.table_name, Number.parseInt(row.null_or_empty_count, 10)])
    );
    const crossTenantMismatchCounts = Object.fromEntries(
      mismatchCountsResult.rows.map((row) => [row.check_name, Number.parseInt(row.mismatch_count, 10)])
    );
    const orphanCounts = Object.fromEntries(
      orphanCountsResult.rows.map((row) => [row.check_name, Number.parseInt(row.orphan_count, 10)])
    );
    const fallbackUsage = Object.fromEntries(
      fallbackResult.rows.map((row) => [row.table_name, Number.parseInt(row.fallback_row_count, 10)])
    );

    const totalNullClinic = Object.values(nullClinicCounts).reduce((sum, value) => sum + value, 0);
    const totalMismatches = Object.values(crossTenantMismatchCounts).reduce((sum, value) => sum + value, 0);
    const totalOrphans = Object.values(orphanCounts).reduce((sum, value) => sum + value, 0);
    const totalFallbackRows = Object.values(fallbackUsage).reduce((sum, value) => sum + value, 0);

    const status = totalNullClinic === 0 && totalMismatches === 0 ? "ok" : "degraded";

    res.status(status === "ok" ? 200 : 503).json({
      status,
      totals: {
        nullClinicIdRows: totalNullClinic,
        crossTenantMismatches: totalMismatches,
        orphanRelations: totalOrphans,
        fallbackRows: totalFallbackRows,
      },
      nullClinicCounts,
      crossTenantMismatchCounts,
      orphanCounts,
      fallbackUsage,
    });
  } catch (error) {
    console.error("[health] data-integrity check failed", error);
    res.status(503).json({
      code: "INTERNAL_ERROR",
      status: "error",
      error: "INTERNAL_ERROR",
      reason: "DATA_INTEGRITY_HEALTH_FAILED",
      message: "Failed to evaluate data integrity checks",
      requestId,
    });
  }
});

export default router;
