import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, formatDateTimeByLocale, getStoredLocale } from "@/lib/i18n";
import { ShiftAdjustmentControls } from "@/features/shift-adjustments/ShiftAdjustmentControls";
import type { HomeDashboardPulse } from "@/types/tasks";

/** Locale-aware "6:30 AM" / "6:30" clock — toLocaleDateString drops time parts. */
function formatClock(value: Date | string): string {
  const localeTag = getStoredLocale() === "he" ? "he-IL" : "en-US";
  return new Date(value).toLocaleTimeString(localeTag, { hour: "numeric", minute: "2-digit" });
}

/**
 * Elapsed shift time as `HH:MM`, degrading to `Nd HH:MM` past 24h so a long-open
 * (or stale) shift never overflows the hero timer.
 */
function formatElapsed(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const hh = String(Math.floor((m % 1440) / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  const days = Math.floor(m / 1440);
  return days > 0 ? `${t.homePage.elapsedDays(days)} ${hh}:${mm}` : `${hh}:${mm}`;
}

export type HeroState = "loading" | "noshift" | "active";

/**
 * Roster-derived hero state, shared by every home surface (ops / floor / tablet):
 * `active` iff inside a scheduled shift window, `loading` only until the pulse
 * resolves, else `noshift`. Single source of truth so the three surfaces can't drift.
 */
export function deriveHeroState(
  pulse: HomeDashboardPulse | undefined,
  pulseLoading: boolean,
): HeroState {
  if (!pulse) return pulseLoading ? "loading" : "noshift";
  return pulse.shift ? "active" : "noshift";
}

/**
 * The roster-derived on-shift hero (extracted from home.tsx). No clock-in/out
 * buttons — on-shift is roster-derived server-side (`pulse.shift` present iff the
 * caller is inside a scheduled window). Self-ticks its own minute clock. `emphasis`
 * lets the ops surface DEMOTE it below the coverage read (I.4: personal shift is
 * secondary for ops) while the floor surface keeps it as the primary identity anchor.
 */
export function OnShiftHero({
  pulse,
  itemsOut,
  scansDone,
  heroState,
  emphasis = "primary",
  className,
}: {
  pulse: HomeDashboardPulse | undefined;
  itemsOut: number;
  scansDone: number;
  heroState: HeroState;
  emphasis?: "primary" | "demoted";
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const demoted = emphasis === "demoted";

  let elapsed = "00:00";
  let startedLabel = "";
  if (pulse?.shift) {
    const shiftMins = Math.max(0, Math.round((now - new Date(pulse.shift.startedAt).getTime()) / 60_000));
    elapsed = formatElapsed(shiftMins);
    startedLabel = t.homePage.startedAt(formatClock(pulse.shift.startedAt));
  }

  return (
    <section
      className={cn(
        "relative w-full overflow-hidden shadow-hero",
        demoted ? "rounded-2xl p-4" : "rounded-[20px] p-[18px]",
        className,
      )}
      style={{
        background:
          "radial-gradient(130% 90% at 0% 0%, var(--ink-sheen), transparent 60%), var(--brand-ink)",
        color: "var(--on-ink)",
      }}
      aria-label={t.homePage.onShift}
    >
      {heroState === "loading" ? (
        <div className="space-y-4">
          <div className="h-3 w-24 rounded-md bg-white/15" />
          <div className="h-9 w-36 rounded-lg bg-white/15" />
          <div className="h-2.5 w-16 rounded bg-white/15" />
          <div className="flex gap-7 pt-2">
            <div className="h-8 w-16 rounded-md bg-white/15" />
            <div className="h-8 w-16 rounded-md bg-white/15" />
          </div>
          <div className="h-12 w-full rounded-[14px] bg-white/15" />
        </div>
      ) : heroState === "noshift" ? (
        <div className="flex flex-col items-start gap-2.5 py-2">
          <span
            className="flex h-[46px] w-[46px] items-center justify-center rounded-[13px]"
            style={{ background: "var(--ink-divider)" }}
          >
            <Clock className="h-6 w-6" aria-hidden />
          </span>
          <p className="mt-1.5 text-[20px] font-bold">{t.home.shift.noShift}</p>
          <p className="max-w-[38ch] text-sm leading-relaxed" style={{ color: "var(--on-ink-strong)" }}>
            {t.homePage.noShiftSub}
          </p>
          {pulse?.nextShift && (
            <p className="mt-1 text-sm font-semibold" style={{ color: "var(--on-ink-strong)" }}>
              {t.common.nextShiftLabel}:{" "}
              {formatDateTimeByLocale(pulse.nextShift.startsAt, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          <Link
            href="/equipment"
            className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-transform motion-safe:active:scale-[0.98]"
            style={{ background: "rgba(255,255,255,0.14)", color: "var(--on-ink-strong)" }}
          >
            {t.common.browseEquipment}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2.5">
            <span
              className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: "var(--on-ink-strong)" }}
            >
              <span className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inset-0 rounded-full" style={{ background: "rgb(var(--sys-green))" }} />
                <span
                  className="absolute inset-0 rounded-full motion-safe:animate-ping"
                  style={{ background: "rgb(var(--sys-green))" }}
                />
              </span>
              {t.homePage.onShift}
            </span>
            <span className="font-num text-xs" style={{ color: "var(--on-ink-muted)" }}>
              {startedLabel}
            </span>
          </div>

          <p
            dir="ltr"
            className={cn(
              "mt-3 font-num font-medium leading-none tracking-[-0.01em] tabular-nums rtl:text-end",
              demoted ? "text-[1.75rem]" : "text-[2.353rem]",
            )}
          >
            {elapsed}
          </p>
          <p
            className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: "var(--on-ink-muted)" }}
          >
            {t.homePage.elapsedLabel}
          </p>

          <div className="mt-5 flex items-stretch">
            <div className="flex-1">
              <p className="font-num text-[1.294rem] font-medium leading-none tabular-nums">{itemsOut}</p>
              <p
                className="mt-1 text-[11px] font-medium uppercase tracking-[0.04em]"
                style={{ color: "var(--on-ink-muted)" }}
              >
                {t.home.shift.itemsOut}
              </p>
            </div>
            <div className="mx-[18px] w-px self-stretch" style={{ background: "var(--ink-divider)" }} aria-hidden />
            <div className="flex-1">
              <p className="font-num text-[1.294rem] font-medium leading-none tabular-nums">{scansDone}</p>
              <p
                className="mt-1 text-[11px] font-medium uppercase tracking-[0.04em]"
                style={{ color: "var(--on-ink-muted)" }}
              >
                {t.home.shift.scansToday}
              </p>
            </div>
          </div>

          {pulse?.shift && !demoted && <ShiftAdjustmentControls endsAt={pulse.shift.endsAt} />}
        </>
      )}
    </section>
  );
}
