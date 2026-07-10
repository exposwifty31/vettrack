import { useLocation } from "wouter";
import { GraduationCap, ShoppingCart } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useExperience } from "@/hooks/use-experience";
import { useEnterOnce } from "@/hooks/use-enter-once";
import { ErrorCard } from "@/components/ui/error-card";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { t } from "@/lib/i18n";
import { QuickScanCard } from "../QuickScanCard";
import { HomeShell, HomeChrome } from "./HomeShell";
import { HomeGreeting } from "./HomeGreeting";
import { OnShiftHero } from "./OnShiftHero";
import { useFloorHome } from "./floor/use-floor-home";
import { MyEquipmentCard } from "./floor/MyEquipmentCard";

/**
 * Student home — CUSTODY ONLY (owner scope, 2026-07). A student is a supervised
 * final-year vet trainee whose entire system footprint is equipment custody +
 * inventory: check equipment out/in (Scan), return what they hold (My Equipment),
 * and dispense/restock inventory. Everything else (tasks, alerts, rooms, Code Blue)
 * is deliberately absent — the server stays the enforcement boundary; this surface
 * is the client shaping. See [[student-role-meaning]].
 */
export function StudentHomeSurface({ isTablet }: { isTablet: boolean }) {
  const { name } = useAuth();
  const { can } = useExperience();
  const [, navigate] = useLocation();
  const home = useFloorHome();
  const rise = useEnterOnce("home") ? "vt-pro-rise" : "";
  const showError = home.equipmentError && !home.equipment;
  // The supervised banner shows precisely BECAUSE standing authority is withheld
  // from the student archetype. A shift-elevated viewer that earns the cap drops
  // back to the plain read.
  const guided = !can("codeBlue.manage");

  return (
    <HomeShell bare={isTablet}>
      <div className="vt-enter-stagger mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 pb-nav-safe pt-3 sm:gap-5 sm:px-6">
        <HomeChrome />
        <HomeGreeting name={name} size="large" className={rise} />

        {guided && (
          <section
            aria-label={t.homeSurface.guidedTitle}
            className="flex items-start gap-3 rounded-2xl border border-ivory-border bg-ivory-surface p-4 shadow-card"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-ivory-text3">
              <GraduationCap className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 text-start">
              <p className="text-[15px] font-bold text-ivory-text">{t.homeSurface.guidedTitle}</p>
              <p className="mt-0.5 text-sm text-ivory-text3">{t.homeSurface.guidedBody}</p>
            </div>
          </section>
        )}

        {showError ? (
          <ErrorCard message={t.equipmentList.errors.loadFailed} onRetry={() => home.refetch()} />
        ) : (
          <>
            <OnShiftHero
              pulse={home.pulse}
              itemsOut={home.itemsOutCount}
              scansDone={home.scansToday}
              heroState={home.heroState}
              emphasis="primary"
              className={rise}
            />
            <QuickScanCard />
            <MyEquipmentCard items={home.myEquipment} isLoading={home.myEquipmentLoading} />
            <button
              type="button"
              onClick={() => navigate("/inventory")}
              className="flex min-h-[44px] items-center gap-3 rounded-2xl border border-ivory-border bg-ivory-surface p-4 text-start shadow-card transition-colors hover:bg-muted/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-ivory-text3">
                <ShoppingCart className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-ivory-text">{t.nav.inventory}</span>
                <span className="block text-sm text-ivory-text3">{t.homeSurface.inventoryActionHint}</span>
              </span>
              <ForwardChevron className="h-4 w-4 shrink-0 opacity-40" aria-hidden />
            </button>
          </>
        )}
      </div>
    </HomeShell>
  );
}
