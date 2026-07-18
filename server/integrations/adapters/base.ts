/**
 * IntegrationAdapter — the contract every external-system adapter must fulfill.
 *
 * Adapters are stateless objects. All state (credentials, last-sync timestamps,
 * enabled flags) lives in the database. The adapter receives whatever context it
 * needs at call time — it never caches credentials in memory.
 *
 * Optional methods: adapters only implement the methods they support. The
 * framework checks `capabilities` before calling any optional method, so an
 * adapter that doesn't support billing export simply leaves exportBillingEntry
 * undefined.
 *
 * Adding a new adapter:
 *   1. Create a file in `server/integrations/adapters/<vendor-id>.ts`
 *   2. Export a class/object that implements IntegrationAdapter
 *   3. Register it in `server/integrations/index.ts`
 *   4. Add credential keys to `requiredCredentials`
 *   5. No other files need to change
 */

import type {
  AdapterCapabilities,
  ExternalAppointment,
  ExternalInventoryItem,
  ExternalPatient,
  ExternalSyncResult,
  IntegrationCredentials,
  SyncParams,
  VetTrackAppointment,
  VetTrackBillingEntry,
  VetTrackPatient,
  PatientWorklistProviderEntry,
  PatientWorklistWindow,
} from "../types.js";

export interface IntegrationAdapter {
  /**
   * Machine-readable identifier. Must be unique across all adapters.
   * Use kebab-case, e.g. "vet-pms-v1".
   * Stored in vt_integration_configs.adapter_id.
   */
  readonly id: string;

  /** Human-readable display name shown in the admin UI. */
  readonly name: string;

  /** Semantic version. Increment when the credential schema changes. */
  readonly version: string;

  /** Which operations this adapter supports. */
  readonly capabilities: AdapterCapabilities;

  /**
   * Keys this adapter requires in its credentials object.
   * The framework will refuse to run any sync job if any of these keys
   * are missing or empty in the stored credentials.
   */
  readonly requiredCredentials: string[];

  /**
   * Validate that the given credentials are correct and the remote system
   * is reachable. Should make a lightweight API call (e.g. "ping" or
   * "list with limit=1"). Must not persist any state.
   *
   * Returns { valid: true } on success.
   * Returns { valid: false, error: "human readable message" } on failure.
   */
  validateCredentials(credentials: IntegrationCredentials): Promise<{ valid: boolean; error?: string }>;

  // ------------------------------------------------------------------
  // Patient sync (optional)
  // ------------------------------------------------------------------

  /**
   * Fetch patients from the external system.
   * Called by the sync-patients job.
   */
  fetchPatients?(
    credentials: IntegrationCredentials,
    params: SyncParams,
  ): Promise<ExternalPatient[]>;

  /**
   * Push a VetTrack patient record to the external system.
   * Used for outbound sync / record creation on the external side.
   */
  pushPatient?(
    credentials: IntegrationCredentials,
    patient: VetTrackPatient,
  ): Promise<ExternalSyncResult>;

  /**
   * PatientWorklistProvider port (optional) — pull the end-of-shift patient/
   * animal worklist for a shift window (R-SH-F1.4). Returns external PMS ids +
   * display + the INTERNAL `byTechId` of the tech who worked each animal. Throw
   * a `PatientWorklistProviderError` (closed code) on failure — never leak a raw
   * PMS message. Called by the shift-handover generator through the port; the
   * framework resolves the adapter per-clinic from `vt_integration_configs`.
   */
  getPatientWorklist?(
    credentials: IntegrationCredentials,
    window: PatientWorklistWindow,
  ): Promise<PatientWorklistProviderEntry[]>;

  // ------------------------------------------------------------------
  // Inventory sync (optional)
  // ------------------------------------------------------------------

  /** Fetch inventory items from the external system. */
  fetchInventory?(
    credentials: IntegrationCredentials,
    params: SyncParams,
  ): Promise<ExternalInventoryItem[]>;

  // ------------------------------------------------------------------
  // Appointment sync (optional)
  // ------------------------------------------------------------------

  /** Fetch appointments from the external system. */
  fetchAppointments?(
    credentials: IntegrationCredentials,
    params: SyncParams,
  ): Promise<ExternalAppointment[]>;

  /** Push a VetTrack appointment to the external system. */
  pushAppointment?(
    credentials: IntegrationCredentials,
    appointment: VetTrackAppointment,
  ): Promise<ExternalSyncResult>;

  // ------------------------------------------------------------------
  // Billing export (optional)
  // ------------------------------------------------------------------

  /**
   * Export a single billing entry to the external system.
   * Called per-entry by the export-billing job.
   * Must be idempotent — the same entry may be sent more than once on retry.
   */
  exportBillingEntry?(
    credentials: IntegrationCredentials,
    entry: VetTrackBillingEntry,
  ): Promise<ExternalSyncResult>;
}
