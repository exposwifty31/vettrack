/**
 * Integration ops — retry, window re-run, webhook replay (Sprint 3 + 4).
 * Mounted at /api/integrations/ops
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, integrationSyncLog, integrationConfigs } from "../../db.js";
import { requireAdmin } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { isKnownAdapter } from "../index.js";
import {
  integrationQueue,
  classifyIntegrationQueueError,
} from "../../queues/integration.queue.js";
import type { IntegrationSyncJobType, IntegrationSyncDirection } from "../../queues/integration.queue.js";
import { evaluateIntegrationGloballyKill } from "../feature-flags.js";
import {
  getWebhookEventForClinic,
  markWebhookReplayPending,
} from "../webhooks/repository.js";
import { evaluateVendorXSyncRollout } from "../vendor-x-rollout.js";
import { VENDOR_X_ADAPTER_ID } from "../adapters/vendor-x.js";
import { param } from "../../lib/route-params.js";

const router = Router();

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

const syncWindowBodySchema = z.object({
  adapterId: z.string().min(1),
  syncType: z.enum(["patients", "inventory", "appointments", "billing"]),
  direction: z.enum(["inbound", "outbound"]).optional(),
  since: z.string().min(1),
  until: z.string().min(1),
  dryRun: z.boolean().optional(),
  correlationId: z.string().optional(),
});

const retryBodySchema = z.object({
  dryRun: z.boolean().optional(),
  correlationId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /runs/:runId/retry
// ---------------------------------------------------------------------------
router.post("/runs/:runId/retry", requireAdmin, validateBody(retryBodySchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const runId = param(req, "runId");
  const body = req.body as z.infer<typeof retryBodySchema>;

  const row = await db
    .select()
    .from(integrationSyncLog)
    .where(and(eq(integrationSyncLog.id, runId), eq(integrationSyncLog.clinicId, clinicId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!row) {
    return res.status(404).json(apiError({ code: "RUN_NOT_FOUND", reason: "No sync log for this clinic", message: "Run not found", requestId }));
  }

  if (!["failed", "partial"].includes(row.status)) {
    return res.status(400).json(
      apiError({
        code: "RUN_NOT_RETRYABLE",
        reason: `Status ${row.status} cannot be retried`,
        message: "Only failed or partial runs can be retried",
        requestId,
      }),
    );
  }

  if (!isKnownAdapter(row.adapterId)) {
    return res.status(400).json(apiError({ code: "UNKNOWN_ADAPTER", reason: row.adapterId, message: "Adapter not registered", requestId }));
  }

  const kill = evaluateIntegrationGloballyKill();
  if (!kill.allowed) {
    return res.status(503).json({
      code: "INTEGRATIONS_DEGRADED",
      error: "INTEGRATIONS_DEGRADED",
      reason: kill.reason ?? "integration_globally_killed",
      message: kill.message ?? "Integration enqueue blocked",
      requestId,
      degraded: true,
      retryAfterSeconds: 60,
    });
  }

  const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
  const sinceMeta = typeof meta.since === "string" ? meta.since : undefined;
  const untilMeta = typeof meta.until === "string" ? meta.until : undefined;

  try {
    const job = await integrationQueue.add(
      {
        clinicId: row.clinicId,
        adapterId: row.adapterId,
        syncType: row.syncType as IntegrationSyncJobType,
        direction: row.direction as IntegrationSyncDirection,
        since: sinceMeta,
        until: untilMeta,
        dryRun: body.dryRun,
        correlationId: body.correlationId ?? nanoid(),
      },
      {
        jobId: `${row.clinicId}:${row.adapterId}:${row.syncType}:${row.direction}:retry:${runId}:${Date.now()}`,
      },
    );
    res.status(202).json({ ok: true, jobId: job.id, retriedRunId: runId });
  } catch (err) {
    const classified = classifyIntegrationQueueError(err);
    res.status(503).json({
      code: classified.code,
      error: classified.code,
      reason: classified.reason,
      message: classified.message,
      requestId,
      degraded: true,
      retryAfterSeconds: 30,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/:id/replay — Sprint 4 (event store + patient sync re-enqueue)
// ---------------------------------------------------------------------------
router.post("/webhooks/:id/replay", requireAdmin, async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const id = param(req, "id");

  const event = await getWebhookEventForClinic(clinicId, id);
  if (!event) {
    return res.status(404).json(apiError({ code: "WEBHOOK_EVENT_NOT_FOUND", reason: id, message: "Webhook event not found", requestId }));
  }
  if (!event.signatureValid) {
    return res.status(400).json(
      apiError({
        code: "WEBHOOK_REPLAY_INVALID",
        reason: "signature_invalid",
        message: "Cannot replay an event that failed signature verification",
        requestId,
      }),
    );
  }

  const kill = evaluateIntegrationGloballyKill();
  if (!kill.allowed) {
    return res.status(503).json({
      code: "INTEGRATIONS_DEGRADED",
      error: "INTEGRATIONS_DEGRADED",
      reason: kill.reason ?? "integration_globally_killed",
      message: kill.message ?? "Integration enqueue blocked",
      requestId,
      degraded: true,
      retryAfterSeconds: 60,
    });
  }

  await markWebhookReplayPending(id);

  try {
    const job = await integrationQueue.add(
      {
        clinicId: event.clinicId,
        adapterId: event.adapterId,
        syncType: "patients",
        direction: "inbound",
        correlationId: id,
        webhookEventId: id,
      },
      {
        jobId: `${event.clinicId}:${event.adapterId}:patients:inbound:webhook:replay:${id}:${Date.now()}`,
      },
    );
    res.status(202).json({ ok: true, jobId: job.id, eventId: id, requestId });
  } catch (err) {
    const classified = classifyIntegrationQueueError(err);
    res.status(503).json({
      code: classified.code,
      error: classified.code,
      reason: classified.reason,
      message: classified.message,
      requestId,
      degraded: true,
      retryAfterSeconds: 30,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /sync/window
// ---------------------------------------------------------------------------
router.post("/sync/window", requireAdmin, validateBody(syncWindowBodySchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const body = req.body as z.infer<typeof syncWindowBodySchema>;

  const direction: IntegrationSyncDirection =
    body.direction ?? (body.syncType === "billing" ? "outbound" : "inbound");

  if (!isKnownAdapter(body.adapterId)) {
    return res.status(400).json(apiError({ code: "UNKNOWN_ADAPTER", reason: body.adapterId, message: "Unknown adapter", requestId }));
  }

  if (body.adapterId === VENDOR_X_ADAPTER_ID) {
    const cfgRow = await db
      .select({ metadata: integrationConfigs.metadata })
      .from(integrationConfigs)
      .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, body.adapterId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const vx = evaluateVendorXSyncRollout(cfgRow?.metadata);
    if (!vx.allowed) {
      return res.status(403).json({
        code: vx.reason ?? "VENDOR_X_BLOCKED",
        error: vx.reason ?? "VENDOR_X_BLOCKED",
        reason: vx.reason ?? "",
        message: vx.message ?? "Vendor X sync blocked by rollout policy",
        requestId,
      });
    }
  }

  const kill = evaluateIntegrationGloballyKill();
  if (!kill.allowed) {
    return res.status(503).json({
      code: "INTEGRATIONS_DEGRADED",
      error: "INTEGRATIONS_DEGRADED",
      reason: kill.reason ?? "integration_globally_killed",
      message: kill.message ?? "Integration enqueue blocked",
      requestId,
      degraded: true,
      retryAfterSeconds: 60,
    });
  }

  try {
    const job = await integrationQueue.add(
      {
        clinicId,
        adapterId: body.adapterId,
        syncType: body.syncType as IntegrationSyncJobType,
        direction,
        since: body.since,
        until: body.until,
        dryRun: body.dryRun,
        correlationId: body.correlationId ?? nanoid(),
      },
      {
        jobId: `${clinicId}:${body.adapterId}:${body.syncType}:${direction}:window:${Date.now()}`,
      },
    );
    res.status(202).json({ ok: true, jobId: job.id });
  } catch (err) {
    const classified = classifyIntegrationQueueError(err);
    res.status(503).json({
      code: classified.code,
      error: classified.code,
      reason: classified.reason,
      message: classified.message,
      requestId,
      degraded: true,
      retryAfterSeconds: 30,
    });
  }
});

export default router;
