import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request, ApiError } from "@/lib/api";
import type { Equipment } from "@/types";
import { t } from "@/lib/i18n";
import { getRfidDirection, type RfidDirection } from "@/lib/equipment-rfid-display";

export type LocationConfidence = "high" | "medium" | "low" | "unknown";
export type SignalSource = "checkout" | "dock" | "scan" | "rfid" | "none";

export interface LocationInference {
  inferredLocation: string | null;
  confidence: LocationConfidence;
  signalSource: SignalSource;
  accountablePerson: {
    userId: string;
    name: string;
    currentRoom: string | null;
  } | null;
  lastConfirmedAt: string | null;
  reasoning: string;
  /**
   * R-M1.4 — directional RFID last-seen ("exited ER → Ward"), when a fresh
   * directional read resolved both an origin and a destination room. Display
   * only; never overrides the resolved location (R-M1.0 precedence).
   */
  rfidDirection?: RfidDirection | null;
}

function fallbackInference(equipment: Equipment): LocationInference {
  if (equipment.checkedOutById && equipment.checkedOutByEmail) {
    return {
      inferredLocation: equipment.checkedOutLocation ?? null,
      confidence: "medium",
      signalSource: "checkout",
      accountablePerson: {
        userId: equipment.checkedOutById,
        name: equipment.checkedOutByEmail,
        currentRoom: equipment.checkedOutLocation ?? null,
      },
      lastConfirmedAt: equipment.checkedOutAt ?? null,
      reasoning: t.equipmentDetail.locationCard.reasoning.checkedOut(equipment.checkedOutByEmail),
    };
  }
  if (equipment.lastRfidRoomName) {
    return {
      inferredLocation: equipment.lastRfidRoomName,
      confidence: "low",
      signalSource: "rfid",
      accountablePerson: null,
      lastConfirmedAt: equipment.lastRfidSeenAt ?? null,
      reasoning: t.equipmentDetail.locationCard.reasoning.rfid(equipment.lastRfidRoomName),
      rfidDirection: getRfidDirection(equipment),
    };
  }
  if (equipment.roomName) {
    return {
      inferredLocation: equipment.roomName,
      confidence: "low",
      signalSource: "none",
      accountablePerson: null,
      lastConfirmedAt: null,
      reasoning: t.equipmentDetail.locationCard.reasoning.lastKnown(equipment.roomName),
    };
  }
  return {
    inferredLocation: null,
    confidence: "unknown",
    signalSource: "none",
    accountablePerson: null,
    lastConfirmedAt: null,
    reasoning: t.equipmentDetail.locationCard.reasoning.none,
  };
}

export function useEquipmentDetail(equipmentId: string | undefined) {
  const queryClient = useQueryClient();

  const equipmentQuery = useQuery({
    queryKey: [`/api/equipment/${equipmentId}`],
    queryFn: () => api.equipment.get(equipmentId!),
    enabled: !!equipmentId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const inferenceQuery = useQuery({
    queryKey: [`/api/equipment/${equipmentId}/location-inference`],
    queryFn: async () => {
      try {
        return await request<LocationInference>(
          `/api/equipment/${equipmentId}/location-inference`,
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!equipmentId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const locationInference: LocationInference | null =
    inferenceQuery.data ??
    (equipmentQuery.data ? fallbackInference(equipmentQuery.data) : null);

  function refetch() {
    queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}`] });
    queryClient.invalidateQueries({
      queryKey: [`/api/equipment/${equipmentId}/location-inference`],
    });
  }

  return {
    equipment: equipmentQuery.data,
    locationInference,
    isLoading: equipmentQuery.isLoading,
    isError: equipmentQuery.isError,
    refetch,
  };
}
