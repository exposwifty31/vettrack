import { useEffect, useRef, useState } from "react";
import { useTodayShift } from "./hooks/use-today-shift";
import { ShiftHero } from "./ShiftHero";
import { UrgentCountChips } from "./UrgentCountChips";
import { QuickScanCard } from "./QuickScanCard";
import { LoadingSection } from "@/components/ui/loading-section";
import { t } from "@/lib/i18n";

const PULL_THRESHOLD = 64;

export function TodayScreen() {
  const { isLoading, criticalCount, overdueCount, itemsOutCount, scansToday, shift, refetch } =
    useTodayShift();

  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const [pullDelta, setPullDelta] = useState(0);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" && !navigator.onLine,
  );

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

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
      await Promise.resolve(refetch());
      setTimeout(() => setRefreshing(false), 600);
    }
    startY.current = null;
    setPullDelta(0);
  }

  const pullProgress = Math.min(pullDelta / PULL_THRESHOLD, 1);

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
        minHeight: "100%",
      }}
    >
      {/* Pull-to-refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div
          aria-hidden
          style={{
            display: "flex",
            justifyContent: "center",
            overflow: "hidden",
            height: refreshing ? 28 : pullProgress * 28,
            transition: refreshing ? "none" : "height 80ms ease",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{
              transform: `rotate(${refreshing ? 0 : pullProgress * 180}deg)`,
              animation: refreshing ? "spin 0.7s linear infinite" : "none",
            }}
          >
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </div>
      )}

      {/* Offline banner */}
      {isOffline && (
        <div
          role="alert"
          style={{
            borderRadius: 12,
            background: "rgb(var(--offline-bg))",
            border: "1px solid rgb(var(--offline-border))",
            color: "rgb(var(--offline-text))",
            padding: "10px 14px",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
          }}
        >
          {t.home.offline}
        </div>
      )}

      {isLoading ? (
        <LoadingSection rows={4} />
      ) : (
        <>
          <ShiftHero
            shift={shift}
            itemsOut={itemsOutCount}
            scansToday={scansToday}
            isLoading={false}
          />

          <UrgentCountChips criticalCount={criticalCount} overdueCount={overdueCount} />

          <QuickScanCard />
        </>
      )}
    </div>
  );
}
