/**
 * Detect and recover from stale PWA / service-worker caches after deploy.
 * Safari: "Importing a module script failed"
 * Chrome: "Failed to fetch dynamically imported module"
 */

const CHUNK_LOAD_ERROR_PATTERNS = [
  "importing a module script failed",
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing binding",
  "does not provide an export",
  "loading chunk",
  "chunkloaderror",
  "dynamically imported module",
] as const;

export const CHUNK_RECOVERY_GUARD_KEY = "vt_chunk_recovery_guard";

export function isChunkLoadError(message: string): boolean {
  const lower = message.toLowerCase();
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function chunkLoadErrorFromReason(reason: unknown): string | null {
  if (reason instanceof Error && reason.message) {
    return isChunkLoadError(reason.message) ? reason.message : null;
  }
  if (typeof reason === "string" && isChunkLoadError(reason)) return reason;
  return null;
}

async function clearVettrackCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith("vettrack-")).map((k) => caches.delete(k)),
  );
}

async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
}

/**
 * Clears vettrack-* caches (and SW registrations when requested), then reloads
 * once per session. Returns true when a reload was scheduled.
 *
 * The sessionStorage guard intentionally survives successful reloads so a
 * persistent chunk failure cannot trigger repeated automatic reloads from
 * `main.tsx`. It clears when the browser tab/session ends.
 *
 * Pass `force: true` for user-initiated retries (e.g. an explicit "Try again"
 * tap) — the user is asking for a hard reload and the loop guard should not
 * silently turn the button into a no-op.
 */
export async function recoverFromChunkLoadFailure(options?: {
  unregisterServiceWorkers?: boolean;
  force?: boolean;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    if (!options?.force && sessionStorage.getItem(CHUNK_RECOVERY_GUARD_KEY) === "1") {
      return false;
    }
    sessionStorage.setItem(CHUNK_RECOVERY_GUARD_KEY, "1");
  } catch {
    return false;
  }

  try {
    if (options?.unregisterServiceWorkers) {
      await unregisterServiceWorkers();
    }
    await clearVettrackCaches();
  } catch {
    // Best-effort — still attempt reload.
  }

  window.location.reload();
  return true;
}
