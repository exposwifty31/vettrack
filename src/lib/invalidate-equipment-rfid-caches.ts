import type { QueryClient } from "@tanstack/react-query";

/**
 * Narrow React Query invalidation for RFID doorway advisory updates only.
 *
 * **Allowlist:** equipment list, paginated list, optional detail + RFID-scoped keys.
 *
 * **Denylist (must never invalidate from RFID):**
 * - `["equipment-waitlist", id]` — Phase B waitlist owner
 * - `["staging-queue", id]` — dock staging owner
 * - `["deployability", id]`
 * - `["/api/equipment/my"]` — checkout/return driven
 * - ER board, display snapshot, containers, or other domains
 *
 * Do not call `invalidateEquipmentCaches()` from RFID paths — it also hits the denylist keys above.
 */
export async function invalidateEquipmentRfidCaches(
  client: QueryClient,
  equipmentId?: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["/api/equipment"] }),
    client.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "/api/equipment" &&
        q.queryKey[1] === "paginated",
    }),
    ...(equipmentId
      ? [
          client.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}`] }),
          client.invalidateQueries({ queryKey: ["equipment-rfid", equipmentId] }),
        ]
      : []),
  ]);
}
