import { useRef, useState } from "react";
import { useAlertsFeed } from "./hooks/use-alerts-feed";
import { AlertRow } from "./AlertRow";
import { LoadingSection } from "@/components/ui/loading-section";
import { ErrorCard } from "@/components/ui/error-card";
import { t } from "@/lib/i18n";

const PULL_THRESHOLD = 72;

export function AlertsScreen() {
  const { alerts, isLoading, isError, refetch } = useAlertsFeed();
  const [pullDelta, setPullDelta] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

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
        refetch();
      } finally {
        setRefreshing(false);
      }
    }
    startY.current = null;
    setPullDelta(0);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {pullDelta > 0 && (
        <div
          aria-hidden
          style={{
            height: Math.min(pullDelta, PULL_THRESHOLD),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted-foreground)",
            fontSize: "var(--text-xs)",
            transition: pullDelta === 0 ? "height 200ms ease" : undefined,
          }}
        >
          {refreshing ? "…" : "↓"}
        </div>
      )}

      <div style={{ padding: "20px 16px 8px" }}>
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 800,
            color: "var(--foreground)",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          {t.nav.alerts}
        </h1>
      </div>

      {isLoading ? (
        <LoadingSection rows={5} />
      ) : isError ? (
        <ErrorCard message={t.alerts.errors.loadFailed} onRetry={refetch} />
      ) : alerts.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "32px 16px",
            color: "var(--muted-foreground)",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>
            {t.alerts.empty.message}
          </p>
          <p style={{ fontSize: "var(--text-sm)", margin: 0 }}>
            {t.alerts.empty.subMessage}
          </p>
        </div>
      ) : (
        <div role="list" style={{ flex: 1 }}>
          {alerts.map((alert) => (
            <AlertRow key={`${alert.equipmentId}:${alert.type}`} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
