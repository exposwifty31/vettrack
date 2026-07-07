import { t } from "@/lib/i18n";
import { pctColor } from "./ops-tile-helpers";

/**
 * Ops command card — the surface hero. The dominant availability % numeral and the
 * top hairline both take the fleet's tier color (via {@link pctColor}), so the card
 * IS the fleet-health signal (semantic color as structure). ready/notReady and
 * items-out/in-use give the floor-load split. Fleet coverage, not staffing (v1 data).
 */
export function CoverageCard({
  availabilityPct,
  ready,
  notReady,
  itemsOut,
  inUse,
  isLoading,
}: {
  availabilityPct: number | null;
  ready: number;
  notReady: number;
  itemsOut: number;
  inUse: number;
  isLoading: boolean;
}) {
  const tier = availabilityPct === null ? "var(--ivory-text3)" : pctColor(availabilityPct);

  return (
    <section
      data-testid="ops-coverage-card"
      className="relative overflow-hidden rounded-[20px] border border-ivory-border bg-ivory-surface p-5 shadow-hero"
      aria-label={t.homeSurface.coverage}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: tier }} aria-hidden />

      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ivory-text3">
        {t.homeSurface.coverage}
      </p>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          dir="ltr"
          className="font-num text-[2.75rem] font-bold leading-none tracking-[-0.03em] tabular-nums"
          style={{ color: tier }}
        >
          {isLoading && availabilityPct === null ? "—" : availabilityPct === null ? "—" : `${availabilityPct}%`}
        </span>
        <span className="text-[13px] font-semibold text-ivory-text3">{t.homeSurface.available}</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat value={ready} label={t.homeSurface.ready} />
        <Stat value={notReady} label={t.homeSurface.notReady} tone={notReady > 0 ? "warn" : "neutral"} />
        <Stat value={itemsOut} label={t.home.shift.itemsOut} />
        <Stat value={inUse} label={t.homeSurface.inUse} />
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="min-w-0">
      <p
        className="font-num text-[1.375rem] font-semibold leading-none tabular-nums"
        style={{ color: tone === "warn" ? "rgb(var(--sys-orange))" : "var(--ivory-text)" }}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] font-medium uppercase tracking-[0.04em] text-ivory-text3">
        {label}
      </p>
    </div>
  );
}
