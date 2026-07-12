import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Siren } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { QrScanner } from "@/components/qr-scanner";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { useRealtimeReconciliation } from "@/hooks/useRealtimeReconciliation";
import { useScanAffordance } from "@/lib/scan-affordance";
import { subscribeKeepalive } from "@/lib/realtime";
import { t } from "@/lib/i18n";
import { LocateSearch } from "@/features/equipment/LocateSearch";

/**
 * Shared host for the Phase-3 home surfaces (ops / floor). Owns the page-level
 * plumbing that must run exactly once regardless of which surface renders:
 *  - `useRealtimeReconciliation` (frozen realtime path — one subscription per mount)
 *  - keepalive → `activeCodeBlueId` (display-only, frozen-surface safe)
 *  - online/offline listeners → `isOffline`
 *  - the `?scan=1` deep-link → in-page `QrScanner` (web: ignored when no scan affordance)
 *  - `useEnterOnce("home")` → the `rise` enter-animation class
 *  - the `AppShell` (web) vs bare (iPad-native, NativeShell provides chrome) wrapper
 *  - `LocateSearch` (T-22c · R-EQ-F1) — a single floating entry point reachable
 *    from every archetype's home, so the read-only locate search doesn't need a
 *    per-surface mount
 *
 * Exactly one surface mounts at a time (the home fork is a component swap), so the
 * run-once contract holds. Banners are rendered by {@link HomeChrome} which each
 * surface places at the top of its own container (surfaces own their max-width).
 */
interface HomeShellContextValue {
  activeCodeBlueId: string | null;
  isOffline: boolean;
}

const HomeShellContext = createContext<HomeShellContextValue | null>(null);

function useHomeShellContext(): HomeShellContextValue {
  const ctx = useContext(HomeShellContext);
  if (!ctx) throw new Error("useHomeShellContext must be used within <HomeShell>");
  return ctx;
}

export function HomeShell({ bare = false, children }: { bare?: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeCodeBlueId, setActiveCodeBlueId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" && !navigator.onLine,
  );
  const searchStr = useSearch();
  const scanAffordance = useScanAffordance();

  useRealtimeReconciliation({ queryClient });

  useEffect(
    () =>
      subscribeKeepalive(({ activeCodeBlueSessionId }) => {
        setActiveCodeBlueId(activeCodeBlueSessionId);
      }),
    [],
  );

  // Display-only connectivity cue. Emergency mutations are never queued here.
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

  useEffect(() => {
    // No scan surface on web (BUG-016) — ignore the ?scan=1 deep-link there.
    if (scanAffordance === "none") return;
    const params = new URLSearchParams(searchStr);
    if (params.get("scan") === "1") setScannerOpen(true);
  }, [searchStr, scanAffordance]);

  const ctx = useMemo<HomeShellContextValue>(
    () => ({ activeCodeBlueId, isOffline }),
    [activeCodeBlueId, isOffline],
  );

  const body = (
    <HomeShellContext.Provider value={ctx}>
      <Helmet>
        <title>{t.layoutHebrew.dashboard} — VetTrack</title>
        <meta
          name="description"
          content="Real-time veterinary equipment dashboard. Track your shift at a glance, scan equipment, and triage critical and overdue items across your clinic."
        />
        <link rel="canonical" href="https://vettrack.replit.app/" />
      </Helmet>
      {children}
      {scannerOpen && <QrScanner onClose={() => setScannerOpen(false)} />}
      <LocateSearch />
    </HomeShellContext.Provider>
  );

  return bare ? body : <AppShell>{body}</AppShell>;
}

/**
 * Top-of-container chrome shared by both surfaces: the offline cue and the
 * safety-critical Code Blue banner. Reads {@link useHomeShellContext}; a surface
 * places this as the first child of its own max-width container so the banners
 * align with the surface body. Both are display-only (keepalive / connectivity).
 */
export function HomeChrome() {
  const { activeCodeBlueId, isOffline } = useHomeShellContext();
  return (
    <>
      {isOffline && (
        <div
          role="alert"
          className="rounded-xl px-3.5 py-2.5 text-sm font-semibold"
          style={{
            background: "rgb(var(--offline-bg))",
            border: "1px solid rgb(var(--offline-border))",
            color: "rgb(var(--offline-text))",
          }}
        >
          {t.home.offline}
        </div>
      )}

      {activeCodeBlueId && (
        <Link
          href="/code-blue"
          className="flex items-center gap-3 rounded-[14px] border px-4 py-3 shadow-card transition-transform motion-safe:active:scale-[0.99]"
          style={{
            borderColor: "rgb(var(--sys-red) / 0.3)",
            background: "rgb(var(--sys-red) / 0.12)",
          }}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white"
            style={{ background: "rgb(var(--sys-red))" }}
          >
            <Siren className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold" style={{ color: "rgb(var(--sys-red))" }}>
              {t.homePage.urgentCodeBlue}
            </span>
            <span className="block text-xs text-ivory-text3">
              {t.homePage.urgentCodeBlueHint}
            </span>
          </span>
          <ForwardChevron
            className="h-4 w-4 shrink-0 opacity-70"
            style={{ color: "rgb(var(--sys-red))" }}
            aria-hidden
          />
        </Link>
      )}
    </>
  );
}
