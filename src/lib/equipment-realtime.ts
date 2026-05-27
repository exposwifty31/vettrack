import type { QueryClient } from "@tanstack/react-query";

/** React Query keys refreshed when equipment SSE events arrive. */
export async function invalidateEquipmentCaches(
  client: QueryClient,
  equipmentId?: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["/api/equipment"] }),
    client.invalidateQueries({ queryKey: ["/api/equipment/my"] }),
    client.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "/api/equipment" &&
        q.queryKey[1] === "paginated",
    }),
    client.invalidateQueries({ queryKey: ["/api/rooms"] }),
    ...(equipmentId
      ? [
          client.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}`] }),
          client.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}/logs`] }),
          client.invalidateQueries({ queryKey: ["equipment-waitlist", equipmentId] }),
          client.invalidateQueries({ queryKey: ["staging-queue", equipmentId] }),
          client.invalidateQueries({ queryKey: ["deployability", equipmentId] }),
        ]
      : []),
  ]);
}

export function isEquipmentRealtimeEventType(type: string): boolean {
  return (
    type.startsWith("EQUIPMENT_") ||
    type === "EQUIPMENT_CUSTODY_STATE_CHANGED" ||
    type === "EQUIPMENT_USAGE_STATE_CHANGED" ||
    type === "EQUIPMENT_READINESS_STATE_CHANGED" ||
    type === "EQUIPMENT_DOCK_RETURN" ||
    type === "EQUIPMENT_STAGED" ||
    type === "EQUIPMENT_STAGE_CANCELLED" ||
    type === "EQUIPMENT_EMERGENCY_CHECKOUT" ||
    type.startsWith("EQUIPMENT_WAITLIST_")
  );
}
