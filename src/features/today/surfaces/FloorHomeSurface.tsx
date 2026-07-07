import { useAuth } from "@/hooks/use-auth";
import { useEnterOnce } from "@/hooks/use-enter-once";
import { ErrorCard } from "@/components/ui/error-card";
import { t } from "@/lib/i18n";
import { QuickScanCard } from "../QuickScanCard";
import { UrgentCountChips } from "../UrgentCountChips";
import { HomeShell, HomeChrome } from "./HomeShell";
import { HomeGreeting } from "./HomeGreeting";
import { OnShiftHero } from "./OnShiftHero";
import { GetStartedCard } from "./GetStartedCard";
import { useFloorHome } from "./floor/use-floor-home";
import { TasksPreviewCard } from "./floor/TasksPreviewCard";
import { MyEquipmentCard } from "./floor/MyEquipmentCard";

/**
 * Floor home (vet / tech / student). The ACTION read: shift identity anchor →
 * scan (persistent affordance) → tasks → my-equipment, exceptions secondary. One
 * responsive component serves phone-web, desktop-web, and iPad-native floor
 * (`bare` inside NativeShell). This is the in-fence delivery of the "tech/student
 * scan/tasks emphasis" nav delta (NativeTabBar is frozen this phase).
 */
export function FloorHomeSurface({ isTablet }: { isTablet: boolean }) {
  const { name } = useAuth();
  const home = useFloorHome();
  const rise = useEnterOnce("home") ? "vt-pro-rise" : "";
  // Full-content error keys on the equipment query alone (pre-split parity) — a
  // pulse/tasks failure degrades within the content region, it does not blank the page.
  const showError = home.equipmentError && !home.equipment;

  return (
    <HomeShell bare={isTablet}>
      <div className="vt-enter-stagger mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 pb-nav-safe pt-3 sm:gap-5 sm:px-6">
        <HomeChrome />
        <HomeGreeting name={name} size="large" className={rise} />

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
            <TasksPreviewCard dashboard={home.taskDashboard} isLoading={home.isLoading} />
            <MyEquipmentCard items={home.myEquipment} isLoading={home.myEquipmentLoading} />
            <UrgentCountChips criticalCount={home.criticalCount} overdueCount={home.overdueCount} />
            <GetStartedCard visible={!home.isLoading && home.totalCount === 0} />
          </>
        )}
      </div>
    </HomeShell>
  );
}
