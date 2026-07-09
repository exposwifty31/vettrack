import { GraduationCap } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useExperience } from "@/hooks/use-experience";
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
 * Student home (guided, restricted-tech). The SAME cache-deduped floor engine and
 * the SAME tech pieces (scan / tasks / my-equipment) — all already read/navigate
 * only, so there is nothing authority-shaped to strip. The differentiation is a
 * guided framing: a prominent orientation banner leads, and it is gated on the
 * WITHHELD capability itself (`!can("codeBlue.manage")`) so this is literally
 * "tech minus withheld authority" expressed through an existing `can()` grant — a
 * separate SHELL is never introduced. No new capability, no server change.
 */
export function StudentHomeSurface({ isTablet }: { isTablet: boolean }) {
  const { name } = useAuth();
  const { can } = useExperience();
  const home = useFloorHome();
  const rise = useEnterOnce("home") ? "vt-pro-rise" : "";
  const showError = home.equipmentError && !home.equipment;
  // Guided framing shows precisely BECAUSE standing authority is withheld from the
  // student archetype (student = tech − WITHHELD_FROM_STUDENT). A shift-elevated or
  // secondary-admin viewer that earns the cap drops back to the plain tech read.
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
