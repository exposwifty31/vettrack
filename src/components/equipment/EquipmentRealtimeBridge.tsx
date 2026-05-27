import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectRealtime, disconnectRealtime, EventIngestor } from "@/lib/realtime";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { invalidateEquipmentCaches } from "@/lib/equipment-realtime";
import { getCurrentUserId } from "@/lib/auth-store";

/**
 * Keeps equipment list/detail caches fresh via clinic SSE (Phase B).
 * Mounted once in the app shell for all authenticated routes.
 */
export function EquipmentRealtimeBridge() {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();
  const ingestor = useMemo(() => new EventIngestor(queryClient), [queryClient]);

  useRealtimeReconciliation({
    queryClient,
    ingestor,
    extraRefetch: async () => {
      await invalidateEquipmentCaches(queryClient);
    },
  });

  useEffect(() => {
    if (!userId) return;

    void connectRealtime(() => {}, { queryClient, ingestor });

    return () => {
      disconnectRealtime({ ingestor });
    };
  }, [userId, queryClient, ingestor]);

  return null;
}
