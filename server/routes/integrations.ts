/**
 * Integration configuration and sync management routes.
 *
 * PERMISSIONS MATRIX — /api/integrations
 * ─────────────────────────────────────────────────────────────────
 * GET    /adapters                admin-only  List all registered adapters
 * GET    /configs                 admin-only  List integration configs for clinic
 * POST   /configs                 admin-only  Create or enable an integration
 * GET    /configs/:adapterId      admin-only  Get config for one adapter
 * PATCH  /configs/:adapterId      admin-only  Update sync flags / timestamps
 * DELETE /configs/:adapterId      admin-only  Disable and remove credentials
 * POST   /configs/:adapterId/credentials  admin-only  Store/update credentials
 * POST   /configs/:adapterId/validate     admin-only  Validate credentials against adapter
 * POST   /configs/:adapterId/sync         admin-only  Trigger manual sync job
 * POST   /configs/:adapterId/rollback      admin-only  Vendor X rollback (disable config + schedules)
 * POST   /configs/:adapterId/promote       admin-only  Vendor X promote environment (confirmed)
 * GET    /configs/:adapterId/logs         admin-only  Fetch sync log entries
 * GET    /dashboard                       admin-only  Integration dashboard JSON (contract v1)
 * GET    /analytics/product               admin-only  Product analytics stub (zeros until Phase D)
 * GET    /health                           admin-only  Redis/queue/worker probe + circuit snapshots
 * /ops/runs/:runId/retry                  admin-only  Re-enqueue failed/partial sync log run
 * /ops/sync/window                       admin-only  Bounded window sync job
 * /ops/webhooks/:id/replay               admin-only  Re-enqueue patient sync for stored webhook event
 * ─────────────────────────────────────────────────────────────────
 * All routes are admin-only — integration config is a privileged operation.
 * Credentials are never returned in responses (write-only).
 */

import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, integrationConfigs, integrationMappingReviews, integrationSyncLog } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { listAdapters, getAdapter, isKnownAdapter } from "../integrations/index.js";
import {
  storeCredentials,
  deleteCredentials,
  validateCredentialKeys,
} from "../integrations/credential-manager.js";
import {
  integrationQueue,
  classifyIntegrationQueueError,
} from "../queues/integration.queue.js";
import type { IntegrationSyncJobType, IntegrationSyncDirection } from "../queues/integration.queue.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { evaluateIntegrationGloballyKill } from "../integrations/feature-flags.js";
import {
  mergeIntegrationMetadata,
  parseIntegrationMetadataPatch,
} from "../integrations/config-metadata.js";
import { buildIntegrationDashboard } from "../integrations/dashboard/build-dashboard.js";
import {
  getCachedIntegrationDashboard,
  invalidateIntegrationDashboardCache,
} from "../integrations/dashboard/dashboard-cache.js";
import { buildProductAnalyticsStub } from "../integrations/analytics/product-analytics.js";
import { buildIntegrationsHealth } from "../integrations/health/build-integrations-health.js";
import opsRoutes from "../integrations/routes/ops.routes.js";
import { getRedis } from "../lib/redis.js";
import { guardedAdapterCall } from "../integrations/resilience/guarded-call.js";
import {
  evaluateVendorXSyncRollout,
  mergeCredentialsWithVendorMetadata,
} from "../integrations/vendor-x-rollout.js";
import { VENDOR_X_ADAPTER_ID } from "../integrations/adapters/vendor-x.js";

const router = Router();

function apiError(params: {
  code: string;
  reason: string;
  message: string;
  requestId: string;
}) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

// ---------------------------------------------------------------------------
// GET /adapters — list registered adapters (no credentials, no clinic data)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /dashboard — control-plane summary (API-only UI contract)
// ---------------------------------------------------------------------------
router.get("/dashboard", requireAdmin, async (req, res) => {
  const clinicId = req.clinicId!;
  const dashboard = await getCachedIntegrationDashboard(clinicId, () => buildIntegrationDashboard(clinicId));
  res.json(dashboard);
});

// ---------------------------------------------------------------------------
// GET /billing/mismatch-report — Phase D Sprint 3
// ---------------------------------------------------------------------------
router.get("/billing/mismatch-report", requireAdmin, async (req, res) => {
  const requestId = randomUUID();
  const month = typeof req.query.month === "string" ? req.query.month.trim() : "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json(
      apiError({
        code: "INVALID_MONTH",
        reason: "Expected month=YYYY-MM",
        message: "Invalid month parameter",
        requestId,
      }),
    );
  }
  res.json({
    month,
    mismatches: [],
    summary: { totalMismatches: 0, totalAmountCents: 0 },
    billingRemoved: true,
  });
});

// ---------------------------------------------------------------------------
// GET /mappings/review — Phase D Sprint 4
// ---------------------------------------------------------------------------
router.get("/mappings/review", requireAdmin, async (req, res) => {
  const clinicId = req.clinicId!;
  const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const conditions = [eq(integrationMappingReviews.clinicId, clinicId)];
  if (statusFilter === "pending" || statusFilter === "approved" || statusFilter === "rejected") {
    conditions.push(eq(integrationMappingReviews.reviewStatus, statusFilter));
  }
  const rows = await db
    .select()
    .from(integrationMappingReviews)
    .where(and(...conditions))
    .orderBy(desc(integrationMappingReviews.updatedAt))
    .limit(200);
  res.json({ items: rows });
});

const mappingReviewPatchSchema = z.object({
  reviewStatus: z.enum(["approved", "rejected"]),
});

router.patch("/mappings/:id", requireAdmin, validateBody(mappingReviewPatchSchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { id } = req.params;
  const body = req.body as z.infer<typeof mappingReviewPatchSchema>;

  const [updated] = await db
    .update(integrationMappingReviews)
    .set({ reviewStatus: body.reviewStatus, updatedAt: new Date() })
    .where(and(eq(integrationMappingReviews.id, id), eq(integrationMappingReviews.clinicId, clinicId)))
    .returning();

  if (!updated) {
    return res.status(404).json(apiError({ code: "NOT_FOUND", reason: id, message: "Mapping review not found", requestId }));
  }

  await invalidateIntegrationDashboardCache(clinicId);
  res.json({ item: updated });
});

// ---------------------------------------------------------------------------
// GET /runs — Phase D Sprint 6 (paginated sync log)
// ---------------------------------------------------------------------------
router.get("/runs", requireAdmin, async (req, res) => {
  const clinicId = req.clinicId!;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  const rows = await db
    .select()
    .from(integrationSyncLog)
    .where(eq(integrationSyncLog.clinicId, clinicId))
    .orderBy(desc(integrationSyncLog.startedAt))
    .limit(limit)
    .offset(offset);

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(integrationSyncLog)
    .where(eq(integrationSyncLog.clinicId, clinicId));

  res.json({
    runs: rows,
    pagination: {
      limit,
      offset,
      total: n ?? 0,
      nextOffset: offset + rows.length < (n ?? 0) ? offset + rows.length : null,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/product — stub aggregates (§17 Phase A)
// ---------------------------------------------------------------------------
router.get("/analytics/product", requireAdmin, (_req, res) => {
  res.json(buildProductAnalyticsStub());
});

// ---------------------------------------------------------------------------
// GET /health — queue/redis/circuit snapshot (Phase B Sprint 3)
// ---------------------------------------------------------------------------
router.get("/health", requireAdmin, async (req, res) => {
  const clinicId = req.clinicId!;
  const health = await buildIntegrationsHealth(clinicId);
  res.json(health);
});

router.use("/ops", opsRoutes);

router.get("/adapters", requireAdmin, (req, res) => {
  const adapters = listAdapters().map((a) => ({
    id: a.id,
    name: a.name,
    version: a.version,
    capabilities: a.capabilities,
    requiredCredentials: a.requiredCredentials,
  }));
  res.json({ adapters });
});

// ---------------------------------------------------------------------------
// GET /configs — list all configs for the authenticated clinic
// ---------------------------------------------------------------------------
router.get("/configs", requireAdmin, async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;

  const configs = await db
    .select()
    .from(integrationConfigs)
    .where(eq(integrationConfigs.clinicId, clinicId))
    .orderBy(integrationConfigs.adapterId);

  // Strip nothing — credentials are not in configs table
  res.json({ configs });
});

// ---------------------------------------------------------------------------
// POST /configs — upsert integration config
// ---------------------------------------------------------------------------
const createConfigSchema = z.object({
  adapterId: z.string().min(1),
  enabled: z.boolean().optional(),
  syncPatients: z.boolean().optional(),
  syncInventory: z.boolean().optional(),
  syncAppointments: z.boolean().optional(),
  exportBilling: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

router.post("/configs", requireAdmin, validateBody(createConfigSchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const body = req.body as z.infer<typeof createConfigSchema>;

  if (!isKnownAdapter(body.adapterId)) {
    return res.status(400).json(apiError({ code: "UNKNOWN_ADAPTER", reason: `No adapter registered with id "${body.adapterId}"`, message: "Unknown adapter", requestId }));
  }

  const existing = await db
    .select({ id: integrationConfigs.id })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, body.adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (existing) {
    let mergedMetadata: Record<string, unknown> | undefined;
    if (body.metadata !== undefined) {
      const patchMeta = parseIntegrationMetadataPatch(body.metadata);
      const prevRow = await db
        .select({ metadata: integrationConfigs.metadata })
        .from(integrationConfigs)
        .where(eq(integrationConfigs.id, existing.id))
        .limit(1)
        .then((r) => r[0]?.metadata as Record<string, unknown> | undefined);
      mergedMetadata = mergeIntegrationMetadata(prevRow ?? {}, patchMeta);
    }
    const [updated] = await db
      .update(integrationConfigs)
      .set({
        enabled: body.enabled ?? undefined,
        syncPatients: body.syncPatients ?? undefined,
        syncInventory: body.syncInventory ?? undefined,
        syncAppointments: body.syncAppointments ?? undefined,
        exportBilling: body.exportBilling ?? undefined,
        ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(integrationConfigs.id, existing.id))
      .returning();
    logAudit({ actorRole: resolveAuditActorRole(req), clinicId, actionType: "integration_config_updated", performedBy: req.authUser!.id, performedByEmail: req.authUser!.email ?? "", targetId: existing.id, targetType: "integration_config", metadata: { adapterId: body.adapterId, patch: body } });
    await invalidateIntegrationDashboardCache(clinicId);
    return res.json({ config: updated });
  }

  const initialMetadata =
    body.metadata !== undefined
      ? mergeIntegrationMetadata({}, parseIntegrationMetadataPatch(body.metadata))
      : undefined;

  const [created] = await db
    .insert(integrationConfigs)
    .values({
      id: nanoid(),
      clinicId,
      adapterId: body.adapterId,
      enabled: body.enabled ?? false,
      syncPatients: body.syncPatients ?? false,
      syncInventory: body.syncInventory ?? false,
      syncAppointments: body.syncAppointments ?? false,
      exportBilling: body.exportBilling ?? false,
      ...(initialMetadata !== undefined ? { metadata: initialMetadata } : {}),
    })
    .returning();

  logAudit({ actorRole: resolveAuditActorRole(req), clinicId, actionType: "integration_config_created", performedBy: req.authUser!.id, performedByEmail: req.authUser!.email ?? "", targetId: created.id, targetType: "integration_config", metadata: { adapterId: body.adapterId } });
  await invalidateIntegrationDashboardCache(clinicId);
  res.status(201).json({ config: created });
});

// ---------------------------------------------------------------------------
// GET /configs/:adapterId
// ---------------------------------------------------------------------------
router.get("/configs/:adapterId", requireAdmin, async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;

  const config = await db
    .select()
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!config) {
    return res.status(404).json(apiError({ code: "CONFIG_NOT_FOUND", reason: "No config for this adapter", message: "Integration config not found", requestId }));
  }

  res.json({ config });
});

// ---------------------------------------------------------------------------
// PATCH /configs/:adapterId — update flags
// ---------------------------------------------------------------------------
const patchConfigSchema = z.object({
  enabled: z.boolean().optional(),
  syncPatients: z.boolean().optional(),
  syncInventory: z.boolean().optional(),
  syncAppointments: z.boolean().optional(),
  exportBilling: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

router.patch("/configs/:adapterId", requireAdmin, validateBody(patchConfigSchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;
  const body = req.body as z.infer<typeof patchConfigSchema>;

  const existingRow = await db
    .select({ id: integrationConfigs.id, metadata: integrationConfigs.metadata })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  let mergedMetadata: Record<string, unknown> | undefined;
  if (body.metadata !== undefined && existingRow) {
    mergedMetadata = mergeIntegrationMetadata(
      existingRow.metadata as Record<string, unknown> | undefined,
      parseIntegrationMetadataPatch(body.metadata),
    );
  }

  const { metadata: _meta, ...restBody } = body;

  const [updated] = await db
    .update(integrationConfigs)
    .set({
      ...restBody,
      ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .returning();

  if (!updated) {
    return res.status(404).json(apiError({ code: "CONFIG_NOT_FOUND", reason: "No config for this adapter", message: "Integration config not found", requestId }));
  }

  await invalidateIntegrationDashboardCache(clinicId);
  res.json({ config: updated });
});

// ---------------------------------------------------------------------------
// DELETE /configs/:adapterId — disable and remove credentials
// ---------------------------------------------------------------------------
router.delete("/configs/:adapterId", requireAdmin, async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;

  const deleted = await db
    .delete(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .returning()
    .then((rows) => rows[0] ?? null);

  if (!deleted) {
    return res.status(404).json(apiError({ code: "CONFIG_NOT_FOUND", reason: "No config for this adapter", message: "Integration config not found", requestId }));
  }

  // Remove stored credentials
  await deleteCredentials(clinicId, adapterId);

  logAudit({ actorRole: resolveAuditActorRole(req), clinicId, actionType: "integration_config_deleted", performedBy: req.authUser!.id, performedByEmail: req.authUser!.email ?? "", targetId: deleted.id, targetType: "integration_config", metadata: { adapterId } });
  await invalidateIntegrationDashboardCache(clinicId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /configs/:adapterId/credentials — store credentials (write-only)
// ---------------------------------------------------------------------------
const credentialsSchema = z.object({
  credentials: z.record(z.string()),
});

router.post("/configs/:adapterId/credentials", requireAdmin, validateBody(credentialsSchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;
  const { credentials } = req.body as z.infer<typeof credentialsSchema>;

  if (!isKnownAdapter(adapterId)) {
    return res.status(400).json(apiError({ code: "UNKNOWN_ADAPTER", reason: `No adapter registered with id "${adapterId}"`, message: "Unknown adapter", requestId }));
  }

  const adapter = getAdapter(adapterId)!;
  const { valid, missing } = validateCredentialKeys(credentials, adapter.requiredCredentials);
  if (!valid) {
    return res.status(400).json(apiError({ code: "MISSING_CREDENTIALS", reason: `Missing required credential keys: ${missing.join(", ")}`, message: "Incomplete credentials", requestId }));
  }

  await storeCredentials(clinicId, adapterId, credentials);
  const credentialKeys = Object.keys(credentials).sort();
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ adapterId, credentialKeys }))
    .digest("hex");
  // Note: credential values are NOT logged — only keys + integrity hash (§15).
  logAudit({
    actorRole: resolveAuditActorRole(req),
    clinicId,
    actionType: "integration_credentials_stored",
    performedBy: req.authUser!.id,
    performedByEmail: req.authUser!.email ?? "",
    targetType: "integration_config",
    metadata: { adapterId, credentialKeys, payloadHash },
  });
  await invalidateIntegrationDashboardCache(clinicId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /configs/:adapterId/validate — test credentials against adapter
// ---------------------------------------------------------------------------
router.post("/configs/:adapterId/validate", requireAdmin, async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;

  const adapter = getAdapter(adapterId);
  if (!adapter) {
    return res.status(400).json(apiError({ code: "UNKNOWN_ADAPTER", reason: `No adapter registered with id "${adapterId}"`, message: "Unknown adapter", requestId }));
  }

  const credentials = await (await import("../integrations/credential-manager.js")).getCredentials(clinicId, adapterId);
  if (!credentials) {
    return res.status(400).json(apiError({ code: "CREDENTIALS_NOT_SET", reason: "No credentials stored for this adapter", message: "Credentials not configured", requestId }));
  }

  const metaRow = await db
    .select({ metadata: integrationConfigs.metadata })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const toValidate = mergeCredentialsWithVendorMetadata(credentials, metaRow?.metadata);

  if (adapterId === VENDOR_X_ADAPTER_ID) {
    const redis = await getRedis();
    if (redis) {
      const result = await guardedAdapterCall(redis, clinicId, adapterId, () => adapter.validateCredentials(toValidate));
      res.json(result);
      return;
    }
  }

  const result = await adapter.validateCredentials(toValidate);
  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /configs/:adapterId/sync — trigger manual sync job
// ---------------------------------------------------------------------------
const syncTriggerSchema = z.object({
  syncType: z.enum(["patients", "inventory", "appointments", "billing"]),
  direction: z.enum(["inbound", "outbound"]),
  since: z.string().optional(),
  dryRun: z.boolean().optional(),
  correlationId: z.string().optional(),
});

router.post("/configs/:adapterId/sync", requireAdmin, validateBody(syncTriggerSchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;
  const body = req.body as z.infer<typeof syncTriggerSchema>;

  if (!isKnownAdapter(adapterId)) {
    return res.status(400).json(apiError({ code: "UNKNOWN_ADAPTER", reason: `No adapter registered with id "${adapterId}"`, message: "Unknown adapter", requestId }));
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

  if (adapterId === VENDOR_X_ADAPTER_ID) {
    const cfgRow = await db
      .select({ metadata: integrationConfigs.metadata })
      .from(integrationConfigs)
      .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
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

  try {
    const job = await integrationQueue.add({
      clinicId,
      adapterId,
      syncType: body.syncType as IntegrationSyncJobType,
      direction: body.direction as IntegrationSyncDirection,
      since: body.since,
      dryRun: body.dryRun,
      correlationId: body.correlationId,
    });
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

// ---------------------------------------------------------------------------
// POST /configs/:adapterId/rollback — Vendor X Phase C (disable safe stop)
// ---------------------------------------------------------------------------
router.post("/configs/:adapterId/rollback", requireAdmin, async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;

  if (adapterId !== VENDOR_X_ADAPTER_ID) {
    return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "Rollback supported for vendor-x-v1 only", message: "Not found", requestId }));
  }

  const existing = await db
    .select({ id: integrationConfigs.id })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!existing) {
    return res.status(404).json(apiError({ code: "CONFIG_NOT_FOUND", reason: "No config for this adapter", message: "Integration config not found", requestId }));
  }

  const [updated] = await db
    .update(integrationConfigs)
    .set({
      enabled: false,
      syncPatients: false,
      syncInventory: false,
      syncAppointments: false,
      exportBilling: false,
      updatedAt: new Date(),
    })
    .where(eq(integrationConfigs.id, existing.id))
    .returning();

  logAudit({
    actorRole: resolveAuditActorRole(req),
    clinicId,
    actionType: "integration_vendor_rollback",
    performedBy: req.authUser!.id,
    performedByEmail: req.authUser!.email ?? "",
    targetId: existing.id,
    targetType: "integration_config",
    metadata: { adapterId },
  });

  await invalidateIntegrationDashboardCache(clinicId);
  res.json({ ok: true, config: updated });
});

// ---------------------------------------------------------------------------
// POST /configs/:adapterId/promote — Vendor X Phase C (environment promotion)
// ---------------------------------------------------------------------------
const vendorPromoteSchema = z.object({
  environment: z.literal("production"),
  confirmEnvironment: z.literal("production"),
});

router.post("/configs/:adapterId/promote", requireAdmin, validateBody(vendorPromoteSchema), async (req, res) => {
  const requestId = randomUUID();
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;

  if (adapterId !== VENDOR_X_ADAPTER_ID) {
    return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "Promote supported for vendor-x-v1 only", message: "Not found", requestId }));
  }

  const existingRow = await db
    .select({ id: integrationConfigs.id, metadata: integrationConfigs.metadata })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!existingRow) {
    return res.status(404).json(apiError({ code: "CONFIG_NOT_FOUND", reason: "No config for this adapter", message: "Integration config not found", requestId }));
  }

  const mergedMetadata = mergeIntegrationMetadata(
    existingRow.metadata as Record<string, unknown> | undefined,
    parseIntegrationMetadataPatch({ environment: "production" }),
  );

  const [updated] = await db
    .update(integrationConfigs)
    .set({ metadata: mergedMetadata, updatedAt: new Date() })
    .where(eq(integrationConfigs.id, existingRow.id))
    .returning();

  logAudit({
    actorRole: resolveAuditActorRole(req),
    clinicId,
    actionType: "integration_vendor_promoted",
    performedBy: req.authUser!.id,
    performedByEmail: req.authUser!.email ?? "",
    targetId: existingRow.id,
    targetType: "integration_config",
    metadata: { adapterId, environment: "production" },
  });

  await invalidateIntegrationDashboardCache(clinicId);
  res.json({ ok: true, config: updated });
});

// ---------------------------------------------------------------------------
// GET /configs/:adapterId/logs — fetch sync log
// ---------------------------------------------------------------------------
router.get("/configs/:adapterId/logs", requireAdmin, async (req, res) => {
  const clinicId = req.clinicId!;
  const { adapterId } = req.params;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);

  const logs = await db
    .select()
    .from(integrationSyncLog)
    .where(and(eq(integrationSyncLog.clinicId, clinicId), eq(integrationSyncLog.adapterId, adapterId)))
    .orderBy(desc(integrationSyncLog.startedAt))
    .limit(limit);

  res.json({ logs });
});

export default router;
