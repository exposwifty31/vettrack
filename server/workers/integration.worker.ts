/**
 * Integration sync worker.
 *
 * Processes jobs from the integration-sync queue. Each job runs one sync
 * operation for one clinic/adapter/syncType/direction combination.
 *
 * The worker:
 *   1. Loads and validates the integration config + credentials
 *   2. Delegates to the appropriate adapter method
 *   3. Upserts results into VetTrack tables (inbound) or pushes to external (outbound)
 *   4. Writes an immutable audit row to vt_integration_sync_log
 *   5. Updates last_*_sync_at on the config row
 */

import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  db,
  integrationConfigs,
  integrationSyncLog,
  animals,
  appointments,
  billingLedger,
  billingItems,
  inventoryItems,
} from "../db.js";
import { getAdapter } from "../integrations/index.js";
import { getCredentials } from "../integrations/credential-manager.js";
import { evaluateIntegrationGloballyKill } from "../integrations/feature-flags.js";
import {
  extractPatientConflictPolicy,
  patientRowsDiffer,
  resolvePatientInboundConflict,
  type LocalPatientRow,
} from "../integrations/conflicts/conflict-engine.js";
import { insertPatientConflict } from "../integrations/conflicts/repository.js";
import { markWebhookEventTerminal } from "../integrations/webhooks/repository.js";
import { recordSyncFailureAnomaly } from "../integrations/anomaly/sync-failure-hooks.js";
import {
  evaluateVendorXSyncRollout,
  getVendorXDeploymentEnvironment,
  isVendorXAdapter,
  mergeCredentialsWithVendorMetadata,
} from "../integrations/vendor-x-rollout.js";
import { VENDOR_X_ADAPTER_ID } from "../integrations/adapters/vendor-x.js";
import {
  guardedAdapterCall,
  IntegrationCircuitOpenError,
  IntegrationCircuitProbePendingError,
  IntegrationRateLimitedError,
} from "../integrations/resilience/guarded-call.js";
import { createRedisConnection } from "../lib/redis.js";
import { listIntegrationWorkerQueueNames } from "../queues/integration-shards.js";
import { type IntegrationSyncJobData } from "../queues/integration.queue.js";
import type {
  ExternalPatient,
  ExternalInventoryItem,
  ExternalAppointment,
  VetTrackBillingEntry,
} from "../integrations/types.js";

let workerInitialized = false;

/** Redis connection shared with BullMQ worker — used for circuit breaker / rate limits. */
let integrationWorkerRedis: Redis | null = null;

function resilienceLogMetadata(err: unknown): Record<string, unknown> {
  if (err instanceof IntegrationRateLimitedError) {
    return { rateLimited: true, retryAfterMs: err.retryAfterMs, retryable: true };
  }
  if (err instanceof IntegrationCircuitOpenError) {
    return { circuitOpen: true, retryable: true };
  }
  if (err instanceof IntegrationCircuitProbePendingError) {
    return { circuitHalfOpenBusy: true, retryable: true };
  }
  return {};
}

function jobLogMeta(data: IntegrationSyncJobData): Record<string, unknown> | null {
  const m: Record<string, unknown> = {};
  if (data.correlationId) m.correlationId = data.correlationId;
  if (data.dryRun) m.dryRun = true;
  if (data.since) m.since = data.since;
  if (data.until) m.until = data.until;
  if (data.webhookEventId) m.webhookEventId = data.webhookEventId;
  if (data.scheduled) m.scheduled = true;
  return Object.keys(m).length ? m : null;
}

function assertBillingExportIdempotency(entry: VetTrackBillingEntry): void {
  const key = entry.idempotencyKey?.trim();
  if (!key) {
    throw new Error("billing export: ledger row missing idempotencyKey — refusing export (§14)");
  }
}

function toLocalPatientRow(row: (typeof animals)["$inferSelect"]): LocalPatientRow {
  return {
    id: row.id,
    name: row.name ?? "",
    species: row.species ?? null,
    breed: row.breed ?? null,
    sex: row.sex ?? null,
    color: row.color ?? null,
    recordNumber: row.recordNumber ?? null,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Sync handlers
// ---------------------------------------------------------------------------

async function handleInboundPatients(
  clinicId: string,
  adapterId: string,
  _jobId: string,
  data: IntegrationSyncJobData,
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const adapter = getAdapter(adapterId);
  if (!adapter?.fetchPatients) throw new Error(`${adapterId}: fetchPatients not supported`);

  const credentialsRaw = await getCredentials(clinicId, adapterId);
  if (!credentialsRaw) throw new Error(`${adapterId}: credentials not found`);

  const config = await db
    .select({
      lastPatientSyncAt: integrationConfigs.lastPatientSyncAt,
      metadata: integrationConfigs.metadata,
    })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const credentials = mergeCredentialsWithVendorMetadata(credentialsRaw, config?.metadata);

  const conflictPolicy = extractPatientConflictPolicy(config?.metadata);

  const since = data.since ?? config?.lastPatientSyncAt?.toISOString();
  const patients: ExternalPatient[] = await guardedAdapterCall(
    integrationWorkerRedis,
    clinicId,
    adapterId,
    () => adapter.fetchPatients!(credentials, { clinicId, since }),
  );

  if (data.dryRun) {
    return { attempted: patients.length, succeeded: patients.length, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const patient of patients) {
    try {
      const existing = await db
        .select()
        .from(animals)
        .where(and(eq(animals.clinicId, clinicId), eq(animals.externalSource, adapterId), eq(animals.externalId, patient.externalId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!existing) {
        await db.insert(animals).values({
          id: nanoid(),
          clinicId,
          name: patient.name,
          species: patient.species ?? null,
          breed: patient.breed ?? null,
          sex: patient.sex ?? null,
          color: patient.color ?? null,
          recordNumber: patient.recordNumber ?? null,
          externalId: patient.externalId,
          externalSource: adapterId,
          externalSyncedAt: new Date(),
        });
        succeeded++;
        continue;
      }

      const local = toLocalPatientRow(existing);

      if (!patientRowsDiffer(local, patient)) {
        await db
          .update(animals)
          .set({ externalSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(animals.id, existing.id));
        succeeded++;
        continue;
      }

      const resolution = resolvePatientInboundConflict(conflictPolicy, local, patient);

      // Fix B: log ALL conflicts regardless of resolution kind.
      // manual_conflict → severity HIGH (requires review).
      // auto-resolved → severity LOW (logged for visibility, not blocking).
      const diffFields = resolution.snapshot?.diffFields ?? [];
      const conflictResolution =
        resolution.kind === "manual_conflict" ? "pending_manual" :
        resolution.kind === "keep_local" ? "auto_vettrack_wins" :
        "auto_external_wins";
      const conflictSeverity = resolution.kind === "manual_conflict" ? "HIGH" as const : "LOW" as const;

      await insertPatientConflict({
        id: nanoid(),
        clinicId,
        adapterId,
        localId: local.id,
        externalId: patient.externalId,
        policyUsed: conflictPolicy,
        payloadSnapshot: resolution.snapshot ?? {
          entityType: "patient",
          policyUsed: conflictPolicy,
          diffFields,
          localUpdatedAtIso: local.updatedAt.toISOString(),
          externalUpdatedAtIso: patient.externalUpdatedAt ?? null,
        },
        severity: conflictSeverity,
        resolution: conflictResolution,
      }).catch(() => {});

      if (resolution.kind === "manual_conflict") {
        failed++;
        continue;
      }

      if (resolution.kind === "keep_local") {
        await db
          .update(animals)
          .set({ externalSyncedAt: new Date() })
          .where(eq(animals.id, existing.id));
        succeeded++;
        continue;
      }

      await db
        .update(animals)
        .set({
          name: patient.name,
          species: patient.species ?? null,
          breed: patient.breed ?? null,
          sex: patient.sex ?? null,
          color: patient.color ?? null,
          recordNumber: patient.recordNumber ?? null,
          externalSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(animals.id, existing.id));
      succeeded++;
    } catch {
      failed++;
    }
  }

  await db
    .update(integrationConfigs)
    .set({ lastPatientSyncAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)));

  return { attempted: patients.length, succeeded, failed };
}

async function handleInboundInventory(
  clinicId: string,
  adapterId: string,
  _jobId: string,
  data: IntegrationSyncJobData,
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const adapter = getAdapter(adapterId);
  if (!adapter?.fetchInventory) throw new Error(`${adapterId}: fetchInventory not supported`);

  const credentialsRaw = await getCredentials(clinicId, adapterId);
  if (!credentialsRaw) throw new Error(`${adapterId}: credentials not found`);

  const config = await db
    .select({
      lastInventorySyncAt: integrationConfigs.lastInventorySyncAt,
      metadata: integrationConfigs.metadata,
    })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const credentials = mergeCredentialsWithVendorMetadata(credentialsRaw, config?.metadata);

  const since = data.since ?? config?.lastInventorySyncAt?.toISOString();
  const items: ExternalInventoryItem[] = await guardedAdapterCall(
    integrationWorkerRedis,
    clinicId,
    adapterId,
    () => adapter.fetchInventory!(credentials, { clinicId, since }),
  );

  if (data.dryRun) {
    return { attempted: items.length, succeeded: items.length, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const existing = await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.externalSource, adapterId), eq(inventoryItems.externalId, item.externalId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (existing) {
        await db
          .update(inventoryItems)
          .set({
            label: item.name,
            category: item.category ?? null,
            externalSyncedAt: new Date(),
          })
          .where(eq(inventoryItems.id, existing.id));
      } else {
        await db.insert(inventoryItems).values({
          id: nanoid(),
          clinicId,
          code: item.code ?? item.externalId,
          label: item.name,
          category: item.category ?? null,
          externalId: item.externalId,
          externalSource: adapterId,
          externalSyncedAt: new Date(),
        });
      }
      succeeded++;
    } catch {
      failed++;
    }
  }

  await db
    .update(integrationConfigs)
    .set({ lastInventorySyncAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)));

  return { attempted: items.length, succeeded, failed };
}

async function handleInboundAppointments(
  clinicId: string,
  adapterId: string,
  _jobId: string,
  data: IntegrationSyncJobData,
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const adapter = getAdapter(adapterId);
  if (!adapter?.fetchAppointments) throw new Error(`${adapterId}: fetchAppointments not supported`);

  const credentialsRaw = await getCredentials(clinicId, adapterId);
  if (!credentialsRaw) throw new Error(`${adapterId}: credentials not found`);

  const config = await db
    .select({
      lastAppointmentSyncAt: integrationConfigs.lastAppointmentSyncAt,
      metadata: integrationConfigs.metadata,
    })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const credentials = mergeCredentialsWithVendorMetadata(credentialsRaw, config?.metadata);

  const since = data.since ?? config?.lastAppointmentSyncAt?.toISOString();
  const appts: ExternalAppointment[] = await guardedAdapterCall(
    integrationWorkerRedis,
    clinicId,
    adapterId,
    () => adapter.fetchAppointments!(credentials, { clinicId, since }),
  );

  if (data.dryRun) {
    return { attempted: appts.length, succeeded: appts.length, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const appt of appts) {
    try {
      const existing = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.clinicId, clinicId), eq(appointments.externalSource, adapterId), eq(appointments.externalId, appt.externalId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      const startTime = new Date(appt.startTime);
      const endTime = new Date(appt.endTime);

      if (existing) {
        await db
          .update(appointments)
          .set({
            startTime,
            endTime,
            status: appt.status ?? "scheduled",
            notes: appt.notes ?? null,
            externalSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(appointments.id, existing.id));
      } else {
        await db.insert(appointments).values({
          id: nanoid(),
          clinicId,
          startTime,
          endTime,
          status: appt.status ?? "scheduled",
          notes: appt.notes ?? null,
          externalId: appt.externalId,
          externalSource: adapterId,
          externalSyncedAt: new Date(),
        });
      }
      succeeded++;
    } catch {
      failed++;
    }
  }

  await db
    .update(integrationConfigs)
    .set({ lastAppointmentSyncAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)));

  return { attempted: appts.length, succeeded, failed };
}

async function handleOutboundBilling(
  clinicId: string,
  adapterId: string,
  data: IntegrationSyncJobData,
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const adapter = getAdapter(adapterId);
  if (!adapter?.exportBillingEntry) throw new Error(`${adapterId}: exportBillingEntry not supported`);

  const credentialsRaw = await getCredentials(clinicId, adapterId);
  if (!credentialsRaw) throw new Error(`${adapterId}: credentials not found`);

  const metaRow = await db
    .select({ metadata: integrationConfigs.metadata })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const credentials = mergeCredentialsWithVendorMetadata(credentialsRaw, metaRow?.metadata);

  const pendingRows = await db
    .select({
      ledger: billingLedger,
      description: billingItems.description,
    })
    .from(billingLedger)
    .leftJoin(billingItems, eq(billingLedger.itemId, billingItems.id))
    .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.status, "pending")))
    .limit(100);

  if (data.dryRun) {
    const n = pendingRows.length;
    return { attempted: n, succeeded: n, failed: 0 };
  }

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of pendingRows) {
    attempted++;
    const ledger = row.ledger;
    const qty = ledger.quantity > 0 ? ledger.quantity : 1;
    const unitCost = Math.round(ledger.totalAmountCents / qty);
    const entry: VetTrackBillingEntry = {
      id: ledger.id,
      clinicId: ledger.clinicId,
      patientName: null,
      itemLabel: row.description ?? ledger.itemId,
      quantity: ledger.quantity,
      unitCostCents: unitCost,
      totalCents: ledger.totalAmountCents,
      billedAt: ledger.createdAt.toISOString(),
      status: ledger.status,
      idempotencyKey: ledger.idempotencyKey,
      externalId: ledger.externalId ?? null,
    };

    assertBillingExportIdempotency(entry);

    try {
      const out = await guardedAdapterCall(integrationWorkerRedis, clinicId, adapterId, () =>
        adapter.exportBillingEntry!(credentials, entry),
      );
      if (out.status === "failed" || out.status === "skipped") {
        failed++;
        continue;
      }
      await db
        .update(billingLedger)
        .set({
          status: "synced",
          externalSyncedAt: new Date(),
          externalSource: adapterId,
          externalId: out.externalId ?? ledger.externalId,
        })
        .where(eq(billingLedger.id, ledger.id));
      succeeded++;
    } catch {
      failed++;
    }
  }

  await db
    .update(integrationConfigs)
    .set({ lastBillingExportAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)));

  return { attempted, succeeded, failed };
}

// ---------------------------------------------------------------------------
// Audit log writer
// ---------------------------------------------------------------------------

async function writeSyncLog(params: {
  clinicId: string;
  adapterId: string;
  syncType: IntegrationSyncJobData["syncType"];
  direction: IntegrationSyncJobData["direction"];
  jobId: string;
  startedAt: Date;
  status: "success" | "partial" | "failed" | "skipped";
  attempted: number;
  succeeded: number;
  failed: number;
  error?: string;
  logMetadata?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(integrationSyncLog).values({
    id: nanoid(),
    clinicId: params.clinicId,
    adapterId: params.adapterId,
    syncType: params.syncType,
    direction: params.direction,
    status: params.status,
    recordsAttempted: params.attempted,
    recordsSucceeded: params.succeeded,
    recordsFailed: params.failed,
    error: params.error ?? null,
    jobId: params.jobId,
    startedAt: params.startedAt,
    completedAt: new Date(),
    metadata: params.logMetadata ?? null,
  });
  const { invalidateIntegrationDashboardCache } = await import("../integrations/dashboard/dashboard-cache.js");
  void invalidateIntegrationDashboardCache(params.clinicId).catch(() => {});
}

// ---------------------------------------------------------------------------
// Worker entrypoint
// ---------------------------------------------------------------------------

export async function startIntegrationWorker(): Promise<void> {
  if (workerInitialized) return;

  const workerConnection = await createRedisConnection();
  if (!workerConnection) {
    console.warn("[integration-worker] disabled (Redis unavailable)");
    return;
  }

  integrationWorkerRedis = workerConnection;

  async function processIntegrationSyncJob(job: Job<IntegrationSyncJobData>): Promise<void> {
      const whId = job.data.webhookEventId;
      let whDone = false;
      const finalizeWebhook = async (terminal: "processed" | "failed") => {
        if (!whId || whDone) return;
        whDone = true;
        await markWebhookEventTerminal(whId, terminal);
      };

      try {
        const { clinicId, adapterId, syncType, direction } = job.data;
        const startedAt = new Date();
        const jobId = job.id ?? nanoid();
        const correlationId = job.data.correlationId ?? jobId;
        let meta: Record<string, unknown> = {
          ...(jobLogMeta(job.data) ?? {}),
          runId: jobId,
          clinicId,
          adapterId,
          syncType,
          direction,
          correlationId,
        };

        const kill = evaluateIntegrationGloballyKill();
        if (!kill.allowed) {
          await writeSyncLog({
            clinicId,
            adapterId,
            syncType,
            direction,
            jobId,
            startedAt,
            status: "skipped",
            attempted: 0,
            succeeded: 0,
            failed: 0,
            error: kill.message,
            logMetadata: meta,
          });
          await finalizeWebhook("failed");
          return;
        }

        const adapter = getAdapter(adapterId);
        if (!adapter) {
          await writeSyncLog({
            clinicId,
            adapterId,
            syncType,
            direction,
            jobId,
            startedAt,
            status: "failed",
            attempted: 0,
            succeeded: 0,
            failed: 0,
            error: `Unknown adapter: ${adapterId}`,
            logMetadata: meta,
          });
          await finalizeWebhook("failed");
          throw new Error(`Unknown adapter: ${adapterId}`);
        }

        const config = await db
          .select({
            enabled: integrationConfigs.enabled,
            syncPatients: integrationConfigs.syncPatients,
            syncInventory: integrationConfigs.syncInventory,
            syncAppointments: integrationConfigs.syncAppointments,
            exportBilling: integrationConfigs.exportBilling,
            metadata: integrationConfigs.metadata,
          })
          .from(integrationConfigs)
          .where(and(eq(integrationConfigs.clinicId, clinicId), eq(integrationConfigs.adapterId, adapterId)))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (adapterId === VENDOR_X_ADAPTER_ID) {
          meta = {
            ...meta,
            environment: getVendorXDeploymentEnvironment(config?.metadata),
          };
          console.info(
            `[integration] ${JSON.stringify({
              adapterId: VENDOR_X_ADAPTER_ID,
              correlationId,
              runId: jobId,
              environment: meta.environment,
            })}`,
          );
        }

        if (!config?.enabled) {
          await writeSyncLog({
            clinicId,
            adapterId,
            syncType,
            direction,
            jobId,
            startedAt,
            status: "skipped",
            attempted: 0,
            succeeded: 0,
            failed: 0,
            error: "Integration not enabled",
            logMetadata: meta,
          });
          await finalizeWebhook("failed");
          return;
        }

        if (isVendorXAdapter(adapterId)) {
          const rollout = evaluateVendorXSyncRollout(config.metadata);
          if (!rollout.allowed) {
            await writeSyncLog({
              clinicId,
              adapterId,
              syncType,
              direction,
              jobId,
              startedAt,
              status: "skipped",
              attempted: 0,
              succeeded: 0,
              failed: 0,
              error: rollout.message ?? rollout.reason ?? "Vendor X rollout blocked",
              logMetadata: { ...meta, rolloutBlocked: true, rolloutReason: rollout.reason },
            });
            await finalizeWebhook("failed");
            return;
          }
        }

        let result = { attempted: 0, succeeded: 0, failed: 0 };
        let syncError: string | undefined;

        try {
          if (direction === "inbound" && syncType === "patients") {
            if (!config.syncPatients) {
              await writeSyncLog({
                clinicId,
                adapterId,
                syncType,
                direction,
                jobId,
                startedAt,
                status: "skipped",
                attempted: 0,
                succeeded: 0,
                failed: 0,
                error: "Inbound patient sync disabled for this config",
                logMetadata: meta,
              });
              await finalizeWebhook("failed");
              return;
            }
            result = await handleInboundPatients(clinicId, adapterId, jobId, job.data);
          } else if (direction === "inbound" && syncType === "inventory") {
            if (!config.syncInventory) {
              await writeSyncLog({
                clinicId,
                adapterId,
                syncType,
                direction,
                jobId,
                startedAt,
                status: "skipped",
                attempted: 0,
                succeeded: 0,
                failed: 0,
                error: "Inbound inventory sync disabled for this config",
                logMetadata: meta,
              });
              await finalizeWebhook("failed");
              return;
            }
            result = await handleInboundInventory(clinicId, adapterId, jobId, job.data);
          } else if (direction === "inbound" && syncType === "appointments") {
            if (!config.syncAppointments) {
              await writeSyncLog({
                clinicId,
                adapterId,
                syncType,
                direction,
                jobId,
                startedAt,
                status: "skipped",
                attempted: 0,
                succeeded: 0,
                failed: 0,
                error: "Inbound appointment sync disabled for this config",
                logMetadata: meta,
              });
              await finalizeWebhook("failed");
              return;
            }
            result = await handleInboundAppointments(clinicId, adapterId, jobId, job.data);
          } else if (direction === "outbound" && syncType === "billing") {
            if (!config.exportBilling) {
              await writeSyncLog({
                clinicId,
                adapterId,
                syncType,
                direction,
                jobId,
                startedAt,
                status: "skipped",
                attempted: 0,
                succeeded: 0,
                failed: 0,
                error: "Outbound billing export disabled for this config",
                logMetadata: meta,
              });
              await finalizeWebhook("failed");
              return;
            }
            result = await handleOutboundBilling(clinicId, adapterId, job.data);
          } else {
            await writeSyncLog({
              clinicId,
              adapterId,
              syncType,
              direction,
              jobId,
              startedAt,
              status: "skipped",
              attempted: 0,
              succeeded: 0,
              failed: 0,
              error: `Batch ${direction} ${syncType} not supported`,
              logMetadata: meta,
            });
            await finalizeWebhook("failed");
            return;
          }
        } catch (err) {
          syncError = err instanceof Error ? err.message : String(err);
          recordSyncFailureAnomaly({
            err,
            correlationId,
            adapterId,
          });
          console.warn("[integration] sync handler error", {
            correlationId,
            clinicId,
            adapterId,
            syncType,
            runId: jobId,
            message: syncError,
          });
          await writeSyncLog({
            clinicId,
            adapterId,
            syncType,
            direction,
            jobId,
            startedAt,
            status: "failed",
            ...result,
            error: syncError,
            logMetadata: { ...meta, ...resilienceLogMetadata(err), resilience: true },
          });
          await finalizeWebhook("failed");
          throw err;
        }

        const status = result.failed === 0 ? "success" : result.succeeded > 0 ? "partial" : "failed";
        await writeSyncLog({
          clinicId,
          adapterId,
          syncType,
          direction,
          jobId,
          startedAt,
          status,
          ...result,
          logMetadata: meta,
        });
        await finalizeWebhook(status === "success" || status === "partial" ? "processed" : "failed");
      } finally {
        if (job.data.webhookEventId && !whDone) {
          whDone = true;
          await markWebhookEventTerminal(job.data.webhookEventId, "failed");
        }
      }
    }

  const queueNames = listIntegrationWorkerQueueNames();
  for (const queueName of queueNames) {
    const w = new Worker<IntegrationSyncJobData>(queueName, processIntegrationSyncJob, {
      connection: workerConnection,
      concurrency: 2,
    });
    w.on("failed", (failedJob, error) => {
      console.error("[integration-worker] job failed", {
        queueName,
        jobId: failedJob?.id,
        name: failedJob?.name,
        message: error.message,
      });
    });
  }

  workerInitialized = true;
  console.log("[integration-worker] started", { queues: queueNames.join(", ") });
}
