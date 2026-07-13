import { useAuth } from "@/hooks/use-auth";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { useEnterOnce } from "@/hooks/use-enter-once";
import { getCurrentUserId } from "@/lib/auth-store";
import { ErrorCard } from "@/components/ui/error-card";
import { t } from "@/lib/i18n";
import { UrgentCountChips } from "../UrgentCountChips";
import { HomeShell, HomeChrome } from "./HomeShell";
import { HomeGreeting } from "./HomeGreeting";
import { OnShiftHero } from "./OnShiftHero";
import { StartOfShiftCard } from "./StartOfShiftCard";
import { GetStartedCard } from "./GetStartedCard";
import { RecentActivityCard } from "./RecentActivityCard";
import { useOpsHome } from "./ops/use-ops-home";
import { CoverageCard } from "./ops/CoverageCard";
import { ExceptionsTile } from "./ops/ExceptionsTile";
import { ReadinessTile } from "./ops/ReadinessTile";

/**
 * Ops home (admin / lead) for phone-web + desktop-web. The ASSESSMENT read: fleet
 * coverage leads (command card), then exceptions + room readiness side-by-side on
 * desktop (asymmetric bento), the personal shift demoted below. iPad-native ops
 * renders the existing HomeTabletDashboard via the home fork — not this component.
 */
export function OpsHomeSurface() {
  const { name } = useAuth();
  const userId = getCurrentUserId();
  const isDesktop = useIsDesktop();
  const home = useOpsHome();
  const rise = useEnterOnce("home") ? "vt-pro-rise" : "";
  // Equipment-only error gate (pre-split parity) — see FloorHomeSurface.
  const showError = home.equipmentError && !home.equipment;

  return (
    <HomeShell>
      <div className="vt-enter-stagger mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pb-nav-safe pt-3 sm:px-6 lg:max-w-[1120px]">
        <HomeChrome />
        <HomeGreeting name={name} size="compact" className={rise} />

        {showError ? (
          <ErrorCard message={t.equipmentList.errors.loadFailed} onRetry={() => home.refetch()} />
        ) : (
          <>
            <CoverageCard
              availabilityPct={home.availabilityPct}
              ready={home.ready}
              notReady={home.notReady}
              itemsOut={home.itemsOut}
              inUse={home.inUse}
              isLoading={home.isLoading}
            />

            <StartOfShiftCard
              heroState={home.heroState}
              criticalCount={home.criticalCount}
              overdueCount={home.overdueCount}
              itemsOutCount={home.itemsOut}
              activeAlertCount={home.activeAlertCount}
              isTablet={isDesktop}
            />

            <UrgentCountChips criticalCount={home.criticalCount} overdueCount={home.overdueCount} />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <ExceptionsTile
                topExceptions={home.topExceptions}
                activeAlertCount={home.activeAlertCount}
                isLoading={home.alertsLoading}
              />
              <ReadinessTile worstRooms={home.worstRooms} isLoading={home.roomsLoading} />
            </div>

            <OnShiftHero
              pulse={home.pulse}
              itemsOut={home.itemsOut}
              scansDone={home.scansToday}
              heroState={home.heroState}
              emphasis="demoted"
              className={rise}
            />

            {isDesktop && home.heroState === "active" && (
              <RecentActivityCard
                items={home.recentItems}
                isLoading={home.activityLoading}
                currentUserId={userId}
              />
            )}

            <GetStartedCard visible={!home.isLoading && home.totalCount === 0} />
          </>
        )}
      </div>
    </HomeShell>
  );
}
