import { getServerConfigValue, setServerConfigValue } from "../server-config.js";

const PER_CLINIC_TTL_MS = 10_000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const ingestEnabledCache = new Map<string, CacheEntry>();

function configKey(clinicId: string): string {
  return `rfid.ingest_enabled.${clinicId.trim()}`;
}

function readCache(clinicId: string): boolean | null {
  const entry = ingestEnabledCache.get(clinicId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ingestEnabledCache.delete(clinicId);
    return null;
  }
  return entry.value;
}

function writeCache(clinicId: string, value: boolean): void {
  ingestEnabledCache.set(clinicId, { value, expiresAt: Date.now() + PER_CLINIC_TTL_MS });
}

/** Whether RFID doorway ingest is enabled for this clinic (default false). */
export async function isRfidIngestEnabled(clinicId: string): Promise<boolean> {
  const id = clinicId.trim();
  if (!id) return false;

  const cached = readCache(id);
  if (cached !== null) return cached;

  const raw = await getServerConfigValue(id, configKey(id));
  const enabled = raw?.trim().toLowerCase() === "true";
  writeCache(id, enabled);
  return enabled;
}

/**
 * Enable/disable RFID doorway ingest for a clinic from the admin UI (R-M1.1c) — replaces the
 * manual hand-flip of the `rfid.ingest_enabled.<clinicId>` config key. Busts the per-clinic TTL
 * cache so the change takes effect immediately rather than after the 10s window.
 */
export async function setRfidIngestEnabled(clinicId: string, enabled: boolean): Promise<void> {
  const id = clinicId.trim();
  if (!id) return;
  await setServerConfigValue(id, configKey(id), enabled ? "true" : "false");
  writeCache(id, enabled);
}

/** Test-only: flush in-process TTL cache. */
export function __resetRfidConfigCacheForTests(): void {
  ingestEnabledCache.clear();
}
