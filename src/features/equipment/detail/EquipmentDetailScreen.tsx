import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEquipmentDetail } from "./hooks/use-equipment-detail";
import { EquipmentLocationCard } from "./EquipmentLocationCard";
import { EquipmentMetaStrip } from "./EquipmentMetaStrip";
import { EquipmentAccountabilityTimeline } from "./EquipmentAccountabilityTimeline";
import { LoadingSection } from "@/components/ui/loading-section";
import { ErrorCard } from "@/components/ui/error-card";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { t } from "@/lib/i18n";
import { request } from "@/lib/api";
import type { ScanLog } from "@/types";

const PULL_THRESHOLD = 80;

type Props = {
  equipmentId: string;
};

export function EquipmentDetailScreen({ equipmentId }: Props) {
  const { equipment, locationInference, isLoading, isError, refetch } =
    useEquipmentDetail(equipmentId);

  const logsQuery = useQuery({
    queryKey: [`/api/equipment/${equipmentId}/logs`],
    queryFn: () => request<ScanLog[]>(`/api/equipment/${equipmentId}/logs`),
    enabled: !!equipmentId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const startY = useRef<number | null>(null);
  const [pullDelta, setPullDelta] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function onTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;
    startY.current = touch.clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    const delta = touch.clientY - startY.current;
    if (delta > 0) setPullDelta(Math.min(delta, PULL_THRESHOLD * 1.5));
  }

  async function onTouchEnd() {
    if (pullDelta >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      try {
        await refetch();
      } finally {
        setRefreshing(false);
      }
    }
    startY.current = null;
    setPullDelta(0);
  }

  const displayName = equipment ? getEquipmentDisplayName(equipment) : "";

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
        minHeight: "100%",
      }}
    >
      {pullDelta > 0 && (
        <div
          style={{
            height: pullDelta / 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "hsl(var(--muted-foreground))",
            fontSize: "var(--text-xs)",
            transition: "height 80ms ease",
          }}
        >
          {pullDelta >= PULL_THRESHOLD ? "↑ Release to refresh" : "↓ Pull to refresh"}
        </div>
      )}

      {isLoading ? (
        <LoadingSection rows={4} />
      ) : isError ? (
        <ErrorCard message={t.errorCard.defaultMessage} onRetry={refetch} />
      ) : equipment ? (
        <>
          <h1
            style={{
              fontSize: "var(--text-2xl)",
              fontWeight: 800,
              color: "hsl(var(--foreground))",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            {displayName}
          </h1>

          <EquipmentMetaStrip equipment={equipment} />

          {locationInference && (
            <EquipmentLocationCard inference={locationInference} />
          )}

          {logsQuery.data && logsQuery.data.length > 0 && (
            <EquipmentAccountabilityTimeline logs={logsQuery.data} />
          )}
        </>
      ) : null}
    </div>
  );
}
