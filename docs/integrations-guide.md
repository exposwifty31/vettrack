# VetTrack Integrations Guide

This guide covers the external veterinary software integration layer added in Phase 4. It is designed for developers connecting VetTrack to an external PMS, LIMS, or billing system.

---

## Architecture Overview

```
VetTrack
  └── server/integrations/
        ├── types.ts           — Canonical data shapes (boundary types)
        ├── index.ts           — Adapter registry
        ├── credential-manager.ts — Encrypted credential storage
        └── adapters/
              ├── base.ts      — IntegrationAdapter interface
              └── generic-pms.ts — Reference REST/JSON adapter
```

**Integration configs** live in `vt_integration_configs` (one row per clinic per adapter).  
**Sync history** lives in `vt_integration_sync_log` (append-only audit trail).  
**Synced records** have `external_id`, `external_source`, `external_synced_at` columns on `vt_appointments`, `vt_billing_ledger`, and `vt_items`.

> **June 2026 scope change:** Patient/animal (ER) tables — `vt_animals`, `vt_hospitalizations`, and related medication/drug-formulary tables — were removed in migrations 142–143. The `vt_animals` column family no longer exists. Do not reference patient-level sync surfaces in new adapters; see [`docs/scope-change-2026.md`](../scope-change-2026.md).

---

## Adding a New Adapter

1. Create `server/integrations/adapters/<vendor-id>.ts`
2. Implement the `IntegrationAdapter` interface from `./base.ts`
3. Register it in `server/integrations/index.ts`:

```ts
import { myVendorAdapter } from "./adapters/my-vendor.js";

const ADAPTERS = new Map<string, IntegrationAdapter>([
  [genericPmsAdapter.id, genericPmsAdapter],
  [myVendorAdapter.id, myVendorAdapter],  // ← add here
]);
```

No other file needs to change. The adapter is immediately available via the API.

---

## Adapter Interface

```ts
interface IntegrationAdapter {
  id: string;              // e.g. "my-vendor-v1"
  name: string;            // Human-readable
  version: string;         // SemVer
  capabilities: AdapterCapabilities;
  requiredCredentials: string[];  // Keys that must be present before sync

  validateCredentials(credentials): Promise<{ valid: boolean; error?: string }>;

  // Optional — implement only what the vendor supports.
  // Note: fetchPatients / pushPatient were removed (June 2026 scope change — migrations 142–143).
  fetchInventory?(credentials, params: SyncParams): Promise<ExternalInventoryItem[]>;
  fetchAppointments?(credentials, params: SyncParams): Promise<ExternalAppointment[]>;
  pushAppointment?(credentials, appt: VetTrackAppointment): Promise<ExternalSyncResult>;
  exportBillingEntry?(credentials, entry: VetTrackBillingEntry): Promise<ExternalSyncResult>;
}
```

---

## API Reference

All integration endpoints require admin authentication.

### Adapter discovery

```
GET  /api/integrations/adapters
```
Returns all registered adapters (id, name, version, capabilities, requiredCredentials).

### Config management

```
GET    /api/integrations/configs                    — list all clinic configs
POST   /api/integrations/configs                    — create or update a config
GET    /api/integrations/configs/:adapterId         — get one config
PATCH  /api/integrations/configs/:adapterId         — update flags (enabled, sync*)
DELETE /api/integrations/configs/:adapterId         — remove config + credentials
```

### Credentials (write-only)

```
POST /api/integrations/configs/:adapterId/credentials
Body: { "credentials": { "base_url": "...", "api_key": "..." } }
```

Credentials are encrypted with AES-256-GCM before storage. They are **never returned** in GET responses.

### Validation

```
POST /api/integrations/configs/:adapterId/validate
```

Calls the adapter's `validateCredentials` against the stored credentials. Returns `{ valid: boolean, error?: string }`.

### Manual sync trigger

```
POST /api/integrations/configs/:adapterId/sync
Body: { "syncType": "inventory", "direction": "inbound", "since": "2026-01-01T00:00:00Z" }
```

Enqueues a BullMQ sync job. Returns `202 { ok: true, jobId: "..." }`.

**Supported combinations:**

| syncType | direction | Status |
|----------|-----------|--------|
| inventory | inbound | ✅ Implemented |
| appointments | inbound | ✅ Implemented |
| appointments | outbound | Queued (future) |
| billing | outbound | Queued (future) |

> **Removed (June 2026):** `patients` sync (`inbound` and `outbound`) was removed with the ER/animal module in migrations 142–143. Do not submit `syncType: "patients"`.

### Sync log

```
GET /api/integrations/configs/:adapterId/logs?limit=50
```

Returns recent sync log entries for this adapter + clinic.

---

## Credential Security

- Credentials are stored in `vt_server_config` under key `{clinicId}:integration:{adapterId}:credentials`
- Encrypted with AES-256-GCM using `DB_CONFIG_ENCRYPTION_KEY` env var
- If `DB_CONFIG_ENCRYPTION_KEY` is not set, credentials are stored unencrypted with a warning — this blocks production startup

---

## Generic PMS Adapter

The built-in `generic-pms-v1` adapter works with any REST/JSON PMS that:
- Uses Bearer token auth (`Authorization: Bearer <api_key>`)
- Returns paginated results via `?since=` and `?limit=` params
- Wraps records in `{ data: [...] }`
- Exposes `GET /health` for connectivity checks

**Required credentials:** `base_url`, `api_key`  
**Optional:** `timeout_ms` (default 10000)

All outbound requests include:
- `X-VetTrack-Source: vettrack/1.0.0`
- `X-VetTrack-Clinic: <clinicId>`
- `X-VetTrack-Signature: sha256=<hmac>` (HMAC-SHA256 of body keyed on api_key)

---

## Sync Log (Audit Trail)

Every sync job writes an immutable row to `vt_integration_sync_log`. The table has a PostgreSQL RULE that prevents UPDATE — it is append-only.

Fields: `clinic_id`, `adapter_id`, `sync_type`, `direction`, `status` (`success`/`partial`/`failed`/`skipped`), `records_attempted`, `records_succeeded`, `records_failed`, `error`, `job_id`, `started_at`, `completed_at`, `metadata`.
