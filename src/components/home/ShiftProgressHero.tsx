import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

interface ShiftProgressHeroProps {
  progressPct: number;
  progressLabel: string;
  stats: { label: string; value: string }[];
  className?: string;
  animateRing?: boolean;
}

function ProgressRing({
  pct,
  size = 92,
  animate,
}: {
  pct: number;
  size?: number;
  animate: boolean;
}) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const [dash, setDash] = useState(animate ? 0 : c * clamped);

  useEffect(() => {
    if (!animate) {
      setDash(c * clamped);
      return;
    }
    const id = requestAnimationFrame(() => setDash(c * clamped));
    return () => cancelAnimationFrame(id);
  }, [animate, clamped, c]);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="shrink-0"
      aria-hidden
    >
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="8"
      />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--action)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        strokeDashoffset={c * 0.25}
        transform="rotate(-90 50 50)"
        className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-[1100ms] motion-safe:ease-reward"
      />
    </svg>
  );
}

/** V4 Pro glance hero — gradient card + progress ring. */
export function ShiftProgressHero({
  progressPct,
  progressLabel,
  stats,
  className,
  animateRing = true,
}: ShiftProgressHeroProps) {
  const pct = progressPct / 100;

  return (
    <section
      className={cn(
        "flex items-center gap-4 rounded-[18px] p-[18px] text-white shadow-card",
        "bg-gradient-to-br from-[var(--hero-a)] to-[var(--hero-b)]",
        className,
      )}
      aria-label={progressLabel}
    >
      <div className="relative grid h-[92px] w-[92px] shrink-0 place-items-center">
        <ProgressRing pct={pct} animate={animateRing} />
        <span className="absolute font-num text-[21px] font-bold tracking-tight">
          {progressPct}%
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.18em] text-white/50">
          {progressLabel}
        </p>
        <div className="flex flex-wrap gap-4">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-num text-lg font-bold leading-none">{s.value}</p>
              <p className="mt-0.5 text-[10px] font-medium text-white/55">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function shiftProgressStatsFromHome(args: {
  tasksDone: number;
  tasksTotal: number;
  scansDone: number;
  activePatients: number;
}): { label: string; value: string }[] {
  const { tasksDone, tasksTotal, scansDone, activePatients } = args;
  return [
    {
      label: t.homePage.ringTasks,
      value: tasksTotal > 0 ? `${tasksDone}/${tasksTotal}` : "—",
    },
    { label: t.homePage.ringScans, value: String(scansDone) },
    { label: t.homePage.ringPatients, value: String(activePatients) },
  ];
}
