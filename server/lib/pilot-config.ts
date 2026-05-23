import { db, serverConfig } from "../db.js";
import { eq } from "drizzle-orm";

export const PILOT_STALE_MS_DEFAULT = 24 * 60 * 60 * 1000; // 24h
const PILOT_STALE_MS_KEY = "pilot_stale_ms";

/** Parses a stored config value; returns null when missing or invalid. */
export function parsePilotStaleMsValue(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const parsed = parseInt(raw, 10);
  if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  return null;
}

export async function getPilotStaleMs(): Promise<number> {
  try {
    const [row] = await db
      .select()
      .from(serverConfig)
      .where(eq(serverConfig.key, PILOT_STALE_MS_KEY))
      .limit(1);
    if (row) {
      const parsed = parsePilotStaleMsValue(row.value);
      if (parsed != null) return parsed;
    }
  } catch {}
  return PILOT_STALE_MS_DEFAULT;
}

export async function setPilotStaleMs(staleMs: number): Promise<void> {
  await db
    .insert(serverConfig)
    .values({ key: PILOT_STALE_MS_KEY, value: String(staleMs) })
    .onConflictDoUpdate({
      target: serverConfig.key,
      set: { value: String(staleMs), updatedAt: new Date() },
    });
}
