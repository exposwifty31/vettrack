import type { PendingSync } from "@/lib/offline-db";

export type LocalEntityState =
  | "synced"
  | "pending_sync"
  | "sync_failed"
  | "conflict";

const EQUIPMENT_ENDPOINT_RE = /^\/api\/equipment\/([^/]+)/;

/** Equipment id from `/api/equipment/:id` or subpaths; null when not equipment-scoped. */
export function extractEquipmentIdFromPendingSync(row: PendingSync): string | null {
  const match = row.endpoint.match(EQUIPMENT_ENDPOINT_RE);
  if (match) return match[1];
  try {
    const body = JSON.parse(row.body) as Record<string, unknown>;
    if (typeof body.equipmentId === "string" && body.equipmentId) {
      return body.equipmentId;
    }
    if (typeof body.id === "string" && row.endpoint.includes("/api/equipment")) {
      return body.id;
    }
  } catch {
    // ignore malformed body
  }
  return null;
}

export function filterPendingSyncRowsForEquipment(
  equipmentId: string,
  queueRows: PendingSync[],
): PendingSync[] {
  return queueRows.filter((row) => extractEquipmentIdFromPendingSync(row) === equipmentId);
}

/**
 * Derives per-equipment sync UX state from Dexie queue rows (Phase 6).
 * Priority: conflict → dead/legacy failed → pending/processing → synced.
 */
export function resolveLocalEntityState(
  equipmentId: string,
  queueRows: PendingSync[],
): LocalEntityState {
  const rows = filterPendingSyncRowsForEquipment(equipmentId, queueRows);
  if (rows.length === 0) return "synced";

  if (rows.some((r) => r.status === "conflict")) return "conflict";
  if (rows.some((r) => r.status === "dead")) return "sync_failed";
  if (rows.some((r) => r.status === "pending" || r.status === "processing")) {
    return "pending_sync";
  }
  if (rows.some((r) => r.status === "failed")) return "sync_failed";

  return "synced";
}

/** Map equipment id → LocalEntityState for list rows (Phase 6). */
export function buildLocalEntityStateByEquipmentId(
  queueRows: PendingSync[],
): Map<string, LocalEntityState> {
  const equipmentIds = new Set<string>();
  for (const row of queueRows) {
    const eqId = extractEquipmentIdFromPendingSync(row);
    if (eqId) equipmentIds.add(eqId);
  }
  const map = new Map<string, LocalEntityState>();
  for (const eqId of equipmentIds) {
    map.set(eqId, resolveLocalEntityState(eqId, queueRows));
  }
  return map;
}
