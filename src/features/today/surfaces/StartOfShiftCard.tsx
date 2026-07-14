import { Link } from "wouter";
import { Activity, AlertTriangle, Clock, ListTodo, PackageCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExperience } from "@/hooks/use-experience";
import type { Capability } from "@/lib/roles/experience-model";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { t } from "@/lib/i18n";
import type { HeroState } from "./OnShiftHero";

export interface StartOfShiftCardProps {
  /** Roster-derived shift state — the shared contract with {@link OnShiftHero}. */
  heroState: HeroState;
  /** Equipment needing attention (same triage tier the ops coverage card / vet readiness glance use). */
  criticalCount: number;
  /** Overdue task count — `taskDashboard.counts.overdue`, shared across floor + ops home engines. */
  overdueCount: number;
  /** Equipment checked out to the current user. */
  itemsOutCount: number;
  /** Ops-only: unacknowledged alert feed count (`useAlertsController().activeAlertCount`). */
  activeAlertCount?: number;
  /** iPad-native → hero band (larger, bolder). Phone/desktop-web → compact card. */
  isTablet?: boolean;
  className?: string;
}

interface Focal {
  message: string;
  actionLabel: string;
  href: string;
  Icon: LucideIcon;
}

type FocalInput = Pick<StartOfShiftCardProps, "criticalCount" | "overdueCount" | "itemsOutCount" | "activeAlertCount">;

/**
 * Capability-gated "what needs me now" read — one line, one action. Branch
 * order mirrors the archetype → capability grants in experience-model.ts:
 * `management.web` (ops: admin/lead) → `equipment.vetActions` (vet) →
 * `codeBlue.manage` (tech/vet_tech, floor baseline) → else (student /
 * shift-unelevated custody-only). Every branch is a navigation link, never a
 * mutation — same doctrine as VetActionRow / TasksPreviewCard / MyEquipmentCard.
 */
function resolveFocal(input: FocalInput, can: (capability: Capability) => boolean): Focal {
  const s = t.homeSurface.startOfShift;

  if (can("management.web")) {
    const exceptions = input.activeAlertCount ?? input.criticalCount;
    return exceptions > 0
      ? { message: s.opsExceptions, actionLabel: s.opsExceptionsAction, href: "/alerts", Icon: AlertTriangle }
      : { message: s.opsAllClear, actionLabel: s.opsAllClearAction, href: "/equipment", Icon: PackageCheck };
  }

  if (can("equipment.vetActions")) {
    return input.criticalCount > 0
      ? { message: s.vetReview, actionLabel: s.vetReviewAction, href: "/equipment", Icon: AlertTriangle }
      : { message: s.vetReady, actionLabel: s.vetReadyAction, href: "/crash-cart", Icon: Activity };
  }

  if (can("codeBlue.manage")) {
    if (input.overdueCount > 0) {
      return {
        message: s.techOverdue,
        actionLabel: s.techOverdueAction,
        href: "/equipment/tasks?filter=overdue",
        Icon: ListTodo,
      };
    }
    if (input.itemsOutCount > 0) {
      return { message: s.itemsCheckedOut, actionLabel: s.itemsCheckedOutAction, href: "/my-equipment", Icon: PackageCheck };
    }
    return { message: s.techCaughtUp, actionLabel: s.techCaughtUpAction, href: "/scan", Icon: ListTodo };
  }

  // Custody-only (student, not shift-elevated into codeBlue.manage).
  if (input.itemsOutCount > 0) {
    return { message: s.itemsCheckedOut, actionLabel: s.itemsCheckedOutAction, href: "/my-equipment", Icon: PackageCheck };
  }
  return { message: s.studentReady, actionLabel: s.studentReadyAction, href: "/scan", Icon: PackageCheck };
}

/**
 * StartOfShiftCard (T-27a / R-SH-F2). ONE card, ONE focal "what needs me now"
 * line, ONE primary action — composed entirely from data the caller's
 * existing home engine (`useFloorHome` / `useOpsHome`) already has in cache,
 * gated by the capability union ({@link useExperience}). No new fetch, no new
 * capability. Off-shift renders a quiet idle variant with no action — the
 * on-shift hero already offers "browse equipment" when there is no shift (see
 * {@link OnShiftHero}), so this card stays silent rather than duplicating it.
 */
export function StartOfShiftCard({
  heroState,
  criticalCount,
  overdueCount,
  itemsOutCount,
  activeAlertCount,
  isTablet = false,
  className,
}: StartOfShiftCardProps) {
  const { can } = useExperience();

  if (heroState !== "active") {
    return (
      <section
        data-testid="start-of-shift-card"
        data-variant="idle"
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-ivory-border bg-ivory-surface/60 p-4 shadow-card",
          className,
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-ivory-text3">
          <Clock className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <p
          data-testid="start-of-shift-card-message"
          className="min-w-0 flex-1 text-start text-sm font-semibold text-ivory-text3"
        >
          {t.homeSurface.startOfShift.idleTitle}
        </p>
      </section>
    );
  }

  const focal = resolveFocal({ criticalCount, overdueCount, itemsOutCount, activeAlertCount }, can);
  const variant = isTablet ? "hero" : "compact";

  return (
    <Link
      href={focal.href}
      data-testid="start-of-shift-card"
      data-variant={variant}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-ivory-border bg-ivory-surface shadow-card transition-colors hover:bg-muted/40",
        isTablet ? "p-5" : "p-4",
        className,
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[10px] bg-muted text-ivory-text3",
          isTablet ? "h-11 w-11" : "h-9 w-9",
        )}
      >
        <focal.Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-start">
        <p
          data-testid="start-of-shift-card-message"
          className={cn("font-bold text-ivory-text text-start", isTablet ? "text-[1.05rem]" : "text-[15px]")}
        >
          {focal.message}
        </p>
        <span className="block text-sm text-ivory-text3">{focal.actionLabel}</span>
      </span>
      <ForwardChevron className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
    </Link>
  );
}
