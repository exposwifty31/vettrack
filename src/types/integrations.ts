/**
 * Integrations console types (Phase 6 / B2).
 *
 * Hand-typed against the real server shapes — `server/schema/integrations.ts`
 * (table rows) and `server/routes/integrations.ts` + `.../routes/ops.routes.ts`
 * (response envelopes + zod bodies). NOT imported from the server schema (that would
 * pull Drizzle into the client bundle). Wire-format rule: Postgres `timestamp`
 * columns serialize to ISO **strings** over JSON, so every date is `string`.
 */

/** `vt_integration_configs` row (credentials are never in this table). */
export interface IntegrationConfig {
  id: string;
  clinicId: string;
  adapterId: string;
  enabled: boolean;
  syncPatients: boolean;
  syncInventory: boolean;
  syncAppointments: boolean;
  exportBilling: boolean;
  lastPatientSyncAt: string | null;
  lastInventorySyncAt: string | null;
  lastAppointmentSyncAt: string | null;
  lastBillingExportAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `GET /adapters` element — registry metadata only, no credentials/clinic data. */
export interface IntegrationAdapter {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  requiredCredentials: string[];
}

/** `vt_integration_sync_log` row (returned by `GET /runs`). */
export interface IntegrationSyncRun {
  id: string;
  clinicId: string;
  adapterId: string;
  syncType: string;
  direction: string;
  status: string;
  recordsAttempted: number;
  recordsSucceeded: number;
  recordsFailed: number;
  error: string | null;
  jobId: string | null;
  startedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}

/** `GET /runs` pagination envelope. */
export interface IntegrationPagination {
  limit: number;
  offset: number;
  total: number;
  nextOffset: number | null;
}

export type MappingReviewStatus = "pending" | "approved" | "rejected";

/** `vt_integration_mapping_reviews` row (returned by `GET /mappings/review`). */
export interface IntegrationMappingReview {
  id: string;
  clinicId: string;
  adapterId: string;
  entityType: string;
  externalId: string;
  localId: string | null;
  confidence: number | null;
  snapshot: unknown;
  reviewStatus: MappingReviewStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * `/dashboard` and `/health` are rich server-owned aggregates
 * (`buildIntegrationDashboard` / `buildIntegrationsHealth`). Phase 6 treats them as
 * opaque summaries; Phase 7 refines these into concrete field types when the health
 * panel is skinned.
 */
export type IntegrationDashboardV1 = Record<string, unknown>;
export type IntegrationHealthV1 = Record<string, unknown>;

/** JSON error envelope (`apiError()`), distinct from the inbound-webhook envelope. */
export interface IntegrationApiError {
  code: string;
  reason: string;
  message: string;
  requestId: string;
  degraded?: boolean;
  retryAfterSeconds?: number;
}

// ── Request bodies (grounded in the route zod schemas) ─────────────────────────

/** `POST /configs` body (`createConfigSchema`). */
export interface UpsertIntegrationConfigRequest {
  adapterId: string;
  enabled?: boolean;
  syncPatients?: boolean;
  syncInventory?: boolean;
  syncAppointments?: boolean;
  exportBilling?: boolean;
  metadata?: Record<string, unknown>;
}

/** `PATCH /configs/:adapterId` body (`patchConfigSchema`) — flags only, adapterId is in the path. */
export type PatchIntegrationConfigRequest = Omit<UpsertIntegrationConfigRequest, "adapterId">;

/** `POST /configs/:adapterId/sync` body (`syncTriggerSchema`). */
export interface IntegrationSyncRequest {
  syncType: "patients" | "inventory" | "appointments" | "billing";
  direction: "inbound" | "outbound";
  since?: string;
  dryRun?: boolean;
  correlationId?: string;
}
