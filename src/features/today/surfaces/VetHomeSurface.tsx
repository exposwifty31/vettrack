import { useMemo } from "react";
import { Link } from "wouter";
import { Activity, MapPin, ShieldCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useExperience } from "@/hooks/use-experience";
import { useEnterOnce } from "@/hooks/use-enter-once";
import { ErrorCard } from "@/components/ui/error-card";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { equipmentTriageTier } from "@/lib/design-tokens";
import { t } from "@/lib/i18n";
import { UrgentCountChips } from "../UrgentCountChips";
import { HomeShell, HomeChrome } from "./HomeShell";
import { HomeGreeting } from "./HomeGreeting";
import { OnShiftHero } from "./OnShiftHero";
import { StartOfShiftCard } from "./StartOfShiftCard";
import { GetStartedCard } from "./GetStartedCard";
import { useFloorHome } from "./floor/use-floor-home";
import { TasksPreviewCard } from "./floor/TasksPreviewCard";
import { MyEquipmentCard } from "./floor/MyEquipmentCard";
import { OpsTile, TileHeader, SkeletonRows, pctColor } from "./ops/ops-tile-helpers";

/**
 * Vet home (clinical emphasis). Same cache-deduped floor engine as tech
 * (`use-floor-home`), recomposed to lead with the clinical read: the shift anchor,
 * then an equipment-readiness glance derived in-place from the already-cached
 * equipment list (no new fetch), then the standing clinical affordances GATED on
 * existing capabilities (`codeBlue.manage` / `equipment.vetActions`) — no new
 * capability, no server change. The Code Blue readiness banner rides in via the
 * shared {@link HomeChrome}. Tasks / my-equipment stay below, exceptions secondary.
 */
export function VetHomeSurface({ isTablet }: { isTablet: boolean }) {
  const { name } = useAuth();
  const { can } = useExperience();
  const home = useFloorHome();
  const rise = useEnterOnce("home") ? "vt-pro-rise" : "";
  const showError = home.equipmentError && !home.equipment;

  // Clinical readiness glance from the already-cached equipment list (same triage
  // tier the ops coverage card uses). Pure derivation — no new data-fetching.
  const clinical = useMemo(() => {
    const eq = home.equipment;
    if (!eq || eq.length === 0) return { pct: null as number | null, ready: 0, notReady: 0 };
    let notReady = 0;
    for (const e of eq) if (equipmentTriageTier(e) === "attention") notReady++;
    const total = eq.length;
    return { pct: Math.round(((total - notReady) / total) * 100), ready: total - notReady, notReady };
  }, [home.equipment]);

  const showActions = can("codeBlue.manage") || can("equipment.vetActions");

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

            <StartOfShiftCard
              heroState={home.heroState}
              pulse={home.pulse}
              criticalCount={home.criticalCount}
              overdueCount={home.overdueCount}
              itemsOutCount={home.itemsOutCount}
              isTablet={isTablet}
            />

            <OpsTile testId="vet-clinical-readiness">
              <TileHeader title={t.homeSurface.clinicalReadiness} href="/equipment" />
              {home.isLoading && !home.equipment ? (
                <SkeletonRows rows={2} />
              ) : clinical.pct === null ? (
                <p className="text-sm text-ivory-text3">{t.homeSurface.clinicalReadinessEmpty}</p>
              ) : (
                <div className="flex items-center gap-4">
                  <span
                    dir="ltr"
                    className="font-num text-[2rem] font-semibold leading-none tabular-nums"
                    style={{ color: pctColor(clinical.pct) }}
                  >
                    {clinical.pct}%
                  </span>
                  <div className="flex flex-col gap-0.5 text-start text-sm">
                    <span className="font-semibold text-ivory-text">
                      {clinical.ready} {t.homeSurface.ready}
                    </span>
                    <span className="text-ivory-text3">
                      {clinical.notReady} {t.homeSurface.notReady}
                    </span>
                  </div>
                </div>
              )}
            </OpsTile>

            {showActions && (
              <section
                aria-label={t.homeSurface.clinicalActions}
                className="flex flex-col gap-1 rounded-2xl border border-ivory-border bg-ivory-surface p-4 shadow-card"
              >
                <span className="mb-1 text-[15px] font-bold text-ivory-text">
                  {t.homeSurface.clinicalActions}
                </span>
                {can("codeBlue.manage") && (
                  <VetActionRow
                    href="/code-blue"
                    Icon={Activity}
                    label={t.nav.emergency}
                    hint={t.homeSurface.codeBlueReadinessHint}
                  />
                )}
                {can("codeBlue.manage") && (
                  <VetActionRow
                    href="/crash-cart"
                    Icon={ShieldCheck}
                    label={t.nav.criticalKitCheck}
                    hint={t.homeSurface.crashCartHint}
                  />
                )}
                {can("equipment.vetActions") && (
                  <VetActionRow
                    href="/rooms"
                    Icon={MapPin}
                    label={t.homeSurface.roomReadiness}
                    hint={t.homeSurface.roomReadinessHint}
                  />
                )}
              </section>
            )}

            <UrgentCountChips criticalCount={home.criticalCount} overdueCount={home.overdueCount} />
            <TasksPreviewCard dashboard={home.taskDashboard} isLoading={home.isLoading} />
            <MyEquipmentCard
              items={home.myEquipment}
              isLoading={home.myEquipmentLoading}
              isError={home.myEquipmentError}
              onRetry={() => void home.refetchMyEquipment()}
            />
            <GetStartedCard visible={!home.isLoading && home.totalCount === 0} />
          </>
        )}
      </div>
    </HomeShell>
  );
}

/** Gated clinical affordance row — a navigation link, never a mutation. RTL-safe. */
function VetActionRow({
  href,
  Icon,
  label,
  hint,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl px-1 py-2.5 transition-colors hover:bg-muted/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-ivory-text3">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-start">
        <span className="block text-sm font-semibold text-ivory-text">{label}</span>
        <span className="block text-xs text-ivory-text3">{hint}</span>
      </span>
      <ForwardChevron className="h-4 w-4 shrink-0 opacity-40" aria-hidden />
    </Link>
  );
}
