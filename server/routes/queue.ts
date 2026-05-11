import { Router } from "express";
import { randomUUID } from "crypto";
import { getNotificationsDlq, getNotificationsQueue, getQueueJobCounts, queueMetrics } from "../lib/queue.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { safeRedisGet, getRedisUrl } from "../lib/redis.js";

const router = Router();

function resolveRequestId(
  res: { getHeader: (name: string) => unknown; setHeader?: (name: string, value: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

/**
 * GET /api/queue/metrics
 * Read-only BullMQ queue observability: live job counts, in-process counters,
 * worker heartbeat, and degraded-state flag. Admin-only.
 */
router.get("/metrics", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    // Live BullMQ counts from Redis (null when Redis is unavailable)
    const liveCounts = await getQueueJobCounts();

    // DLQ live counts
    let dlqLiveCounts: Record<string, number> | null = null;
    const dlq = await getNotificationsDlq();
    if (dlq) {
      try {
        dlqLiveCounts = await dlq.getJobCounts("wait", "active", "completed", "failed", "delayed");
      } catch {
        dlqLiveCounts = null;
      }
    }

    // Worker heartbeat: notification.worker.ts writes vettrack:worker:heartbeat every 30s (TTL 120s)
    let workerHeartbeat: { status: "ok" | "stale" | "dead" | "no_redis"; ageMs: number | null } = {
      status: "no_redis",
      ageMs: null,
    };
    if (getRedisUrl()) {
      const beat = await safeRedisGet("vettrack:worker:heartbeat");
      if (beat) {
        const ageMs = Date.now() - Number(beat);
        workerHeartbeat = {
          status: ageMs < 120_000 ? "ok" : "stale",
          ageMs,
        };
      } else {
        workerHeartbeat = { status: "dead", ageMs: null };
      }
    }

    // Degraded state: any of: worker not alive, circuit broken, DLQ receiving jobs
    const isDegraded =
      workerHeartbeat.status === "dead" ||
      workerHeartbeat.status === "stale" ||
      queueMetrics.circuitQueueBroken > 0 ||
      (dlqLiveCounts !== null && (dlqLiveCounts.wait ?? 0) + (dlqLiveCounts.active ?? 0) > 0);

    res.json({
      queue: {
        name: "notifications",
        live: liveCounts,
        inProcess: {
          enqueued: queueMetrics.enqueued,
          completed: queueMetrics.completed,
          failed: queueMetrics.failed,
          droppedRateLimit: queueMetrics.droppedRateLimit,
          droppedNoRedis: queueMetrics.droppedNoRedis,
          circuitQueueBroken: queueMetrics.circuitQueueBroken,
        },
      },
      dlq: {
        name: "notifications_dlq",
        live: dlqLiveCounts,
      },
      workerHeartbeat,
      isDegraded,
      redisAvailable: getRedisUrl() !== null,
      requestId,
    });
  } catch (err) {
    console.error("[queue-route] failed to fetch queue metrics", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "QUEUE_METRICS_FETCH_FAILED",
        message: "Failed to fetch queue metrics",
        requestId,
      }),
    );
  }
});

router.get("/dlq", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const dlq = await getNotificationsDlq();
    if (!dlq) {
      res.json({ queue: "notifications_dlq", jobs: [] });
      return;
    }
    const jobs = await dlq.getJobs(["waiting", "active", "completed", "failed", "delayed"], 0, 100, true);
    res.json({
      queue: "notifications_dlq",
      jobs: jobs.map((job) => ({
        id: String(job.id ?? ""),
        name: job.name,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        failedReason: job.failedReason ?? null,
        data: job.data,
      })),
    });
  } catch (err) {
    console.error("[queue-route] failed to fetch DLQ jobs", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "QUEUE_DLQ_FETCH_FAILED",
        message: "Failed to fetch DLQ jobs",
        requestId,
      }),
    );
  }
});

router.post("/dlq/:jobId/replay", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const jobId = String(req.params.jobId ?? "").trim();
  if (!jobId) {
    res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "MISSING_JOB_ID",
        message: "DLQ job id is required",
        requestId,
      }),
    );
    return;
  }

  try {
    const [dlq, queue] = await Promise.all([getNotificationsDlq(), getNotificationsQueue()]);
    if (!dlq || !queue) {
      res.status(503).json(
        apiError({
          code: "SERVICE_UNAVAILABLE",
          reason: "QUEUE_UNAVAILABLE",
          message: "Queue service unavailable",
          requestId,
        }),
      );
      return;
    }

    const job = await dlq.getJob(jobId);
    if (!job) {
      res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "DLQ_JOB_NOT_FOUND",
          message: "DLQ job not found",
          requestId,
        }),
      );
      return;
    }

    const sourceName = typeof job.data?.sourceJobName === "string" ? job.data.sourceJobName : "";
    if (!sourceName) {
      res.status(422).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "DLQ_SOURCE_JOB_NAME_MISSING",
          message: "DLQ job does not contain a source job name",
          requestId,
        }),
      );
      return;
    }

    await queue.add(sourceName, job.data?.data ?? {}, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    await job.remove();

    res.status(200).json({
      status: "ok",
      replayedJobId: jobId,
      replayedAs: sourceName,
      requestId,
    });
  } catch (err) {
    console.error("[queue-route] failed to replay DLQ job", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "QUEUE_DLQ_REPLAY_FAILED",
        message: "Failed to replay DLQ job",
        requestId,
      }),
    );
  }
});

export default router;
