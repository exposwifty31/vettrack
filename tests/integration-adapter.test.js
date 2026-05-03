/**
 * Phase 4 — External Integration Preparation static-analysis tests.
 *
 * Verifies the integration layer is correctly structured:
 * 1. Types file defines all canonical shapes
 * 2. Base adapter interface has required contract fields
 * 3. Generic PMS adapter implements the full interface
 * 4. Credential manager encrypts — never stores plaintext
 * 5. Integration registry exposes correct API
 * 6. DB schema has new integration tables and sync columns
 * 7. Queue and worker are wired together correctly
 * 8. API routes are all admin-only; credentials are write-only
 * 9. Migrations are present and structurally correct
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. Types file
// ---------------------------------------------------------------------------
describe("integrations/types.ts", () => {
  const src = read("server/integrations/types.ts");

  it("exports SyncParams", () => {
    expect(src).toContain("export interface SyncParams");
  });
  it("exports ExternalSyncResult", () => {
    expect(src).toContain("export interface ExternalSyncResult");
  });
  it("exports ExternalPatient", () => {
    expect(src).toContain("export interface ExternalPatient");
  });
  it("exports VetTrackPatient", () => {
    expect(src).toContain("export interface VetTrackPatient");
  });
  it("exports ExternalInventoryItem", () => {
    expect(src).toContain("export interface ExternalInventoryItem");
  });
  it("exports ExternalAppointment", () => {
    expect(src).toContain("export interface ExternalAppointment");
  });
  it("exports VetTrackAppointment", () => {
    expect(src).toContain("export interface VetTrackAppointment");
  });
  it("exports VetTrackBillingEntry", () => {
    expect(src).toContain("export interface VetTrackBillingEntry");
  });
  it("exports IntegrationCredentials as Record<string, string>", () => {
    expect(src).toContain("export type IntegrationCredentials = Record<string, string>");
  });
  it("exports IntegrationConfig", () => {
    expect(src).toContain("export interface IntegrationConfig");
  });
  it("exports IntegrationSyncLogEntry", () => {
    expect(src).toContain("export interface IntegrationSyncLogEntry");
  });
  it("exports AdapterCapabilities", () => {
    expect(src).toContain("export interface AdapterCapabilities");
  });
});

// ---------------------------------------------------------------------------
// 2. Base adapter interface
// ---------------------------------------------------------------------------
describe("integrations/adapters/base.ts", () => {
  const src = read("server/integrations/adapters/base.ts");

  it("exports IntegrationAdapter interface", () => {
    expect(src).toContain("export interface IntegrationAdapter");
  });
  it("requires id, name, version fields", () => {
    expect(src).toContain("id:");
    expect(src).toContain("name:");
    expect(src).toContain("version:");
  });
  it("requires capabilities field", () => {
    expect(src).toContain("capabilities:");
  });
  it("requires requiredCredentials field", () => {
    expect(src).toContain("requiredCredentials:");
  });
  it("requires validateCredentials method", () => {
    expect(src).toContain("validateCredentials");
  });
  it("has optional fetchPatients method", () => {
    expect(src).toContain("fetchPatients?");
  });
  it("has optional fetchInventory method", () => {
    expect(src).toContain("fetchInventory?");
  });
  it("has optional fetchAppointments method", () => {
    expect(src).toContain("fetchAppointments?");
  });
  it("has optional exportBillingEntry method", () => {
    expect(src).toContain("exportBillingEntry?");
  });
});

// ---------------------------------------------------------------------------
// 3. Generic PMS adapter
// ---------------------------------------------------------------------------
describe("integrations/adapters/generic-pms.ts", () => {
  const src = read("server/integrations/adapters/generic-pms.ts");

  it("id is generic-pms-v1", () => {
    expect(src).toContain('"generic-pms-v1"');
  });
  it("requiredCredentials includes base_url and api_key", () => {
    expect(src).toContain("base_url");
    expect(src).toContain("api_key");
  });
  it("signs outbound requests with HMAC-SHA256", () => {
    expect(src).toContain("X-VetTrack-Signature");
    expect(src).toContain("sha256=");
    expect(src).toContain("createHmac");
  });
  it("uses Bearer token auth", () => {
    expect(src).toContain("Bearer");
  });
  it("has request timeout via AbortController", () => {
    expect(src).toContain("AbortController");
    expect(src).toContain("abort");
  });
  it("implements fetchPatients with since/limit params", () => {
    expect(src).toContain("fetchPatients");
    expect(src).toContain("since");
    expect(src).toContain("limit");
  });
  it("implements pushPatient with PUT for existing records", () => {
    expect(src).toContain("pushPatient");
    expect(src).toContain("externalId");
    expect(src).toContain('"PUT"');
  });
  it("implements fetchInventory", () => {
    expect(src).toContain("fetchInventory");
  });
  it("implements fetchAppointments", () => {
    expect(src).toContain("fetchAppointments");
  });
  it("implements pushAppointment", () => {
    expect(src).toContain("pushAppointment");
  });
  it("implements exportBillingEntry with idempotencyKey", () => {
    expect(src).toContain("exportBillingEntry");
    expect(src).toContain("idempotencyKey");
  });
  it("validateCredentials calls /health endpoint", () => {
    expect(src).toContain("validateCredentials");
    expect(src).toContain("/health");
  });
});

// ---------------------------------------------------------------------------
// 4. Credential manager — encryption, never plaintext
// ---------------------------------------------------------------------------
describe("integrations/credential-manager.ts", () => {
  const src = read("server/integrations/credential-manager.ts");

  it("imports encryptConfigValue and decryptConfigValue", () => {
    expect(src).toContain("encryptConfigValue");
    expect(src).toContain("decryptConfigValue");
  });
  it("storeCredentials encrypts before writing", () => {
    const fnStart = src.indexOf("export async function storeCredentials");
    const fnBody = src.slice(fnStart, fnStart + 800);
    expect(fnBody).toContain("encryptConfigValue");
    // Must not write raw JSON string without encrypting
    expect(fnBody).not.toMatch(/\.values\(\{.*JSON\.stringify/s);
  });
  it("getCredentials decrypts after reading", () => {
    const fnStart = src.indexOf("export async function getCredentials");
    const fnBody = src.slice(fnStart, fnStart + 600);
    expect(fnBody).toContain("decryptConfigValue");
    expect(fnBody).toContain("JSON.parse");
  });
  it("getCredentials returns null if row not found", () => {
    const fnStart = src.indexOf("export async function getCredentials");
    const fnBody = src.slice(fnStart, fnStart + 600);
    expect(fnBody).toContain("return null");
  });
  it("deleteCredentials removes the key from vt_server_config", () => {
    expect(src).toContain("export async function deleteCredentials");
    const fnStart = src.indexOf("export async function deleteCredentials");
    const fnBody = src.slice(fnStart, fnStart + 300);
    expect(fnBody).toContain("db.delete");
  });
  it("validateCredentialKeys checks all required keys are non-empty", () => {
    expect(src).toContain("export function validateCredentialKeys");
    const fnStart = src.indexOf("export function validateCredentialKeys");
    const fnBody = src.slice(fnStart, fnStart + 300);
    expect(fnBody).toContain("missing");
    expect(fnBody).toContain("valid");
  });
  it("config key includes clinicId and adapterId", () => {
    expect(src).toContain("clinicId");
    expect(src).toContain("adapterId");
    expect(src).toContain("integration");
    expect(src).toContain("credentials");
  });
});

// ---------------------------------------------------------------------------
// 5. Integration registry
// ---------------------------------------------------------------------------
describe("integrations/index.ts", () => {
  const src = read("server/integrations/index.ts");

  it("exports getAdapter", () => {
    expect(src).toContain("export function getAdapter");
  });
  it("exports listAdapters", () => {
    expect(src).toContain("export function listAdapters");
  });
  it("exports isKnownAdapter", () => {
    expect(src).toContain("export function isKnownAdapter");
  });
  it("registers generic-pms adapter", () => {
    expect(src).toContain("genericPmsAdapter");
  });
  it("uses a Map for O(1) lookup", () => {
    expect(src).toContain("new Map");
  });
});

// ---------------------------------------------------------------------------
// 6. DB schema — new tables and sync columns
// ---------------------------------------------------------------------------
describe("server/db.ts — integration tables and sync columns", () => {
  const src = read("server/db.ts");

  it("defines integrationConfigs table", () => {
    expect(src).toContain('export const integrationConfigs = pgTable("vt_integration_configs"');
  });
  it("integrationConfigs has adapterId and enabled fields", () => {
    const start = src.indexOf('export const integrationConfigs = pgTable');
    const body = src.slice(start, start + 800);
    expect(body).toContain("adapterId");
    expect(body).toContain("enabled");
  });
  it("defines integrationSyncLog table", () => {
    expect(src).toContain('export const integrationSyncLog = pgTable("vt_integration_sync_log"');
  });
  it("integrationSyncLog has syncType, direction, status fields", () => {
    const start = src.indexOf('export const integrationSyncLog = pgTable');
    const body = src.slice(start, start + 600);
    expect(body).toContain("syncType");
    expect(body).toContain("direction");
    expect(body).toContain("status");
  });
  it("defines integrationWebhookEvents table", () => {
    expect(src).toContain('export const integrationWebhookEvents = pgTable("vt_integration_webhook_events"');
    expect(src).toContain("signatureValid");
  });
  it("animals table has externalId, externalSource, externalSyncedAt", () => {
    const start = src.indexOf('export const animals = pgTable("vt_animals"');
    const body = src.slice(start, start + 1000);
    expect(body).toContain("externalId");
    expect(body).toContain("externalSource");
    expect(body).toContain("externalSyncedAt");
  });
  it("appointments table has external sync columns", () => {
    const start = src.indexOf('export const appointments = pgTable("vt_appointments"');
    const body = src.slice(start, start + 4000);
    expect(body).toContain("externalId");
    expect(body).toContain("externalSource");
    expect(body).toContain("externalSyncedAt");
  });
  it("billingLedger table has external sync columns", () => {
    const start = src.indexOf('export const billingLedger = pgTable("vt_billing_ledger"');
    const body = src.slice(start, start + 3000);
    expect(body).toContain("externalId");
    expect(body).toContain("externalSource");
    expect(body).toContain("externalSyncedAt");
  });
  it("inventoryItems table has external sync columns", () => {
    const start = src.indexOf('export const inventoryItems = pgTable(');
    const body = src.slice(start, start + 1500);
    expect(body).toContain("externalId");
    expect(body).toContain("externalSource");
    expect(body).toContain("externalSyncedAt");
  });
});

// ---------------------------------------------------------------------------
// 6b. Inbound webhooks (raw body) — server bootstrap
// ---------------------------------------------------------------------------
describe("server/index.ts — integration webhooks", () => {
  const src = read("server/index.ts");

  it("mounts raw body route before express.json for HMAC", () => {
    const jsonIdx = src.indexOf("app.use(express.json())");
    const whIdx = src.indexOf('"/api/integration-webhooks/:adapterId"');
    expect(whIdx).toBeGreaterThan(-1);
    expect(jsonIdx).toBeGreaterThan(whIdx);
  });
});

// ---------------------------------------------------------------------------
// 7. Queue and worker
// ---------------------------------------------------------------------------
describe("integration queue", () => {
  const src = read("server/queues/integration.queue.ts");
  const shards = read("server/queues/integration-shards.ts");

  it("exports integrationQueue.add", () => {
    expect(src).toContain("export const integrationQueue");
    expect(src).toContain("async add(");
  });
  it("defines legacy integration-sync queue name (single-shard compat)", () => {
    expect(shards).toContain('"integration-sync"');
    expect(src).toContain("INTEGRATION_QUEUE_LEGACY_NAME");
  });
  it("job data includes clinicId, adapterId, syncType, direction", () => {
    expect(src).toContain("clinicId");
    expect(src).toContain("adapterId");
    expect(src).toContain("syncType");
    expect(src).toContain("direction");
  });
  it("job data includes optional webhook hook fields", () => {
    expect(src).toContain("webhookEventId");
    expect(src).toContain("scheduled");
  });
  it("dedup key prevents duplicate clinic/adapter/type jobs", () => {
    expect(src).toContain("jobId");
  });
  it("has exponential backoff with 3 attempts", () => {
    expect(src).toContain("attempts: 3");
    expect(src).toContain("exponential");
  });
  it("gracefully handles missing REDIS_URL", () => {
    expect(src).toContain("REDIS_URL missing");
  });
});

describe("integration worker", () => {
  const src = read("server/workers/integration.worker.ts");

  it("exports startIntegrationWorker", () => {
    expect(src).toContain("export async function startIntegrationWorker");
  });
  it("writes an audit row to integrationSyncLog after every job", () => {
    expect(src).toContain("integrationSyncLog");
    expect(src).toContain("writeSyncLog");
  });
  it("writes skipped log when integration is not enabled", () => {
    expect(src).toContain('"skipped"');
  });
  it("updates last sync timestamp after successful inbound sync", () => {
    expect(src).toContain("lastPatientSyncAt");
    expect(src).toContain("lastInventorySyncAt");
    expect(src).toContain("lastAppointmentSyncAt");
  });
  it("handles Redis unavailability gracefully", () => {
    expect(src).toContain("Redis unavailable");
  });
  it("logs failed jobs", () => {
    expect(src).toContain('.on("failed"');
  });
});

describe("start-schedulers.ts registers integration worker", () => {
  const src = read("server/app/start-schedulers.ts");

  it("imports startIntegrationWorker", () => {
    expect(src).toContain("startIntegrationWorker");
  });
  it("calls startIntegrationWorker", () => {
    expect(src).toContain("await startIntegrationWorker()");
  });
});

// ---------------------------------------------------------------------------
// 8. API routes — auth and credential safety
// ---------------------------------------------------------------------------
describe("routes/integrations.ts", () => {
  const src = read("server/routes/integrations.ts");

  it("all routes use requireAdmin", () => {
    // Every router.get/post/patch/delete should have requireAdmin before the handler
    const routeLines = src.split("\n").filter((l) => l.match(/router\.(get|post|patch|delete)\(/));
    expect(routeLines.length).toBeGreaterThan(0);
    for (const line of routeLines) {
      expect(line).toContain("requireAdmin");
    }
  });
  it("GET /adapters route exists", () => {
    expect(src).toContain('router.get("/adapters"');
  });
  it("POST /configs route exists", () => {
    expect(src).toContain('router.post("/configs"');
  });
  it("DELETE /configs/:adapterId route exists", () => {
    expect(src).toContain('router.delete("/configs/:adapterId"');
  });
  it("POST /credentials route stores credentials", () => {
    expect(src).toContain("/credentials");
    expect(src).toContain("storeCredentials");
  });
  it("GET /logs route exists for sync log retrieval", () => {
    expect(src).toContain("/logs");
    expect(src).toContain("integrationSyncLog");
  });
  it("credentials are never returned in GET responses", () => {
    // The validate route calls getCredentials but only returns {valid, error} — not the credential values.
    // Verify the validate route does NOT pass credentials directly into res.json().
    const validateStart = src.indexOf("POST /configs/:adapterId/validate");
    const validateEnd = src.indexOf("POST /configs/:adapterId/sync");
    const validateBody = src.slice(validateStart, validateEnd);
    // The validate route should call adapter.validateCredentials and return its result (not the raw credentials)
    expect(validateBody).toMatch(/adapter\.validateCredentials\((credentials|toValidate)\)/);
    // The result from validateCredentials ({valid, error}) is what gets returned — not the credential map itself
    expect(validateBody).not.toContain("res.json(credentials)");
  });
  it("POST /sync triggers a queue job", () => {
    expect(src).toContain("integrationQueue.add");
    expect(src).toContain("202");
  });
  it("POST /validate calls adapter.validateCredentials", () => {
    expect(src).toContain("validateCredentials");
  });
  it("is registered at /api/integrations in routes.ts", () => {
    const routesSrc = read("server/app/routes.ts");
    expect(routesSrc).toContain('"/api/integrations"');
    expect(routesSrc).toContain("integrationsRoutes");
  });
});

// ---------------------------------------------------------------------------
// 9. Migrations
// ---------------------------------------------------------------------------
describe("migration 069 — integration framework tables", () => {
  const src = read("migrations/069_integration_configs.sql");

  it("creates vt_integration_configs table", () => {
    expect(src).toContain("CREATE TABLE IF NOT EXISTS vt_integration_configs");
  });
  it("vt_integration_configs has UNIQUE(clinic_id, adapter_id)", () => {
    expect(src).toContain("UNIQUE (clinic_id, adapter_id)");
  });
  it("creates vt_integration_sync_log table", () => {
    expect(src).toContain("CREATE TABLE IF NOT EXISTS vt_integration_sync_log");
  });
  it("sync log is append-only via PostgreSQL RULE", () => {
    expect(src).toContain("no_update_integration_sync_log");
    expect(src).toContain("DO INSTEAD NOTHING");
  });
  it("sync log has metadata JSONB column", () => {
    expect(src).toContain("metadata JSONB");
  });
});

describe("migration 070 — external sync columns", () => {
  const src = read("migrations/070_integration_sync_columns.sql");

  it("adds columns to vt_animals", () => {
    expect(src).toContain("ALTER TABLE vt_animals");
    expect(src).toContain("external_id");
    expect(src).toContain("external_source");
    expect(src).toContain("external_synced_at");
  });
  it("adds columns to vt_appointments", () => {
    expect(src).toContain("ALTER TABLE vt_appointments");
  });
  it("adds columns to vt_billing_ledger", () => {
    expect(src).toContain("ALTER TABLE vt_billing_ledger");
  });
  it("adds columns to vt_items", () => {
    expect(src).toContain("ALTER TABLE vt_items");
  });
  it("creates partial indexes WHERE external_id IS NOT NULL", () => {
    expect(src).toContain("WHERE external_id IS NOT NULL");
  });
  it("uses IF NOT EXISTS to be re-runnable", () => {
    expect(src).toContain("ADD COLUMN IF NOT EXISTS");
  });
});

describe("migration 079 — webhook event store", () => {
  const src = read("migrations/079_integration_webhook_events.sql");

  it("creates vt_integration_webhook_events", () => {
    expect(src).toContain("CREATE TABLE IF NOT EXISTS vt_integration_webhook_events");
    expect(src).toContain("signature_valid");
    expect(src).toContain("payload JSONB");
  });
});
