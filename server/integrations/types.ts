/**
 * Shared types for VetTrack's external integration layer.
 *
 * These types define the data shapes that cross the boundary between VetTrack
 * and any external veterinary software system. Adapters translate between
 * these canonical shapes and vendor-specific payloads.
 *
 * Design principles:
 *   - All shapes are minimal; adapters may ignore fields they don't support.
 *   - externalId is the vendor's identifier; VetTrack id is our identifier.
 *   - Dates are ISO-8601 strings at the boundary (adapters convert to Date).
 *   - No vendor-specific field names appear in this file.
 */

// ---------------------------------------------------------------------------
// Sync parameters
// ---------------------------------------------------------------------------

export interface SyncParams {
  /** VetTrack clinic ID for tenant isolation. */
  clinicId: string;
  /** Only fetch records modified since this ISO date (for incremental sync). */
  since?: string;
  /** Maximum records to return per call (adapter may ignore). */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Sync result
// ---------------------------------------------------------------------------

export type SyncStatus = "success" | "partial" | "failed" | "skipped";

export interface ExternalSyncResult {
  status: SyncStatus;
  externalId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// External patient (inbound — from external system to VetTrack)
// ---------------------------------------------------------------------------

export interface ExternalPatient {
  externalId: string;
  name: string;
  species?: string;
  breed?: string;
  sex?: string;
  weightKg?: number;
  color?: string;
  ownerName?: string;
  ownerPhone?: string;
  recordNumber?: string;
  externalUpdatedAt?: string;
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// VetTrack patient (outbound — from VetTrack to external system)
// ---------------------------------------------------------------------------

export interface VetTrackPatient {
  id: string;
  name: string;
  species?: string | null;
  breed?: string | null;
  sex?: string | null;
  weightKg?: string | null;
  color?: string | null;
  recordNumber?: string | null;
  externalId?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
}

// ---------------------------------------------------------------------------
// External inventory item (inbound)
// ---------------------------------------------------------------------------

export interface ExternalInventoryItem {
  externalId: string;
  name: string;
  code?: string;
  category?: string;
  currentQuantity?: number;
  unit?: string;
  externalUpdatedAt?: string;
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// External appointment (inbound)
// ---------------------------------------------------------------------------

export interface ExternalAppointment {
  externalId: string;
  startTime: string;
  endTime: string;
  patientExternalId?: string;
  patientName?: string;
  ownerName?: string;
  vetName?: string;
  status?: string;
  notes?: string;
  externalUpdatedAt?: string;
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// VetTrack appointment (outbound)
// ---------------------------------------------------------------------------

export interface VetTrackAppointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  patientName?: string | null;
  ownerName?: string | null;
  vetName?: string | null;
  externalId?: string | null;
}

// ---------------------------------------------------------------------------
// VetTrack billing entry (outbound)
// ---------------------------------------------------------------------------

export interface VetTrackBillingEntry {
  id: string;
  clinicId: string;
  patientName?: string | null;
  itemLabel: string;
  quantity: number;
  unitCostCents: number;
  totalCents: number;
  billedAt: string;
  status: string;
  idempotencyKey: string;
  externalId?: string | null;
}

// ---------------------------------------------------------------------------
// Credential shape
// ---------------------------------------------------------------------------

/**
 * Credentials are stored as a flat key-value map in vt_server_config
 * (encrypted). Adapters declare which keys they require via requiredCredentials.
 * The integration framework validates presence before any sync is triggered.
 */
export type IntegrationCredentials = Record<string, string>;

/** The `[start, end)` window the port pulls an end-of-shift worklist for. */
export interface PatientWorklistWindow {
  start: Date;
  end: Date;
}

/**
 * A single raw worklist entry returned by an adapter through the port.
 * `externalId` / `display` are the external PMS animal id + label; `byTechId` is
 * the INTERNAL VetTrack `vt_users.id` of the technician who worked that animal
 * (validated to be in-clinic by `serializePatientWorklist` before persistence).
 */
export interface PatientWorklistProviderEntry {
  externalId: string;
  display: string;
  byTechId: string;
}

// ---------------------------------------------------------------------------
// Integration configuration (mirrors vt_integration_configs row)
// ---------------------------------------------------------------------------

export interface IntegrationConfig {
  id: string;
  clinicId: string;
  adapterId: string;
  enabled: boolean;
  syncPatients: boolean;
  syncInventory: boolean;
  syncAppointments: boolean;
  exportBilling: boolean;
  /** Control-plane JSON — validated partially via `config-metadata.ts`. */
  metadata?: Record<string, unknown> | null;
  lastPatientSyncAt: Date | null;
  lastInventorySyncAt: Date | null;
  lastAppointmentSyncAt: Date | null;
  lastBillingExportAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Sync log entry (mirrors vt_integration_sync_log row)
// ---------------------------------------------------------------------------

export type SyncDirection = "inbound" | "outbound";
export type SyncType = "patients" | "inventory" | "appointments" | "billing";

export interface IntegrationSyncLogEntry {
  id: string;
  clinicId: string;
  adapterId: string;
  syncType: SyncType;
  direction: SyncDirection;
  status: SyncStatus;
  recordsAttempted: number;
  recordsSucceeded: number;
  recordsFailed: number;
  error?: string | null;
  jobId?: string | null;
  startedAt: Date;
  completedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Adapter capability flags
// ---------------------------------------------------------------------------

export interface AdapterCapabilities {
  canImportPatients: boolean;
  canExportPatients: boolean;
  canImportInventory: boolean;
  canImportAppointments: boolean;
  canExportAppointments: boolean;
  canExportBilling: boolean;
}
