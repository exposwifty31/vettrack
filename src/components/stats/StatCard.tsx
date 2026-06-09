// src/components/stats/StatCard.tsx
import { cn } from "@/lib/utils";

export type StatTone = "ok" | "warn" | "err" | "info";
export type DeltaDir = "up" | "down" | "same";

interface StatCardProps {
  title: string;
  value: string;
  sub: string;
  delta?: string;
  deltaDir?: DeltaDir;
  tone?: StatTone;
}

const BORDER: Record<StatTone, string> = {
  ok:   "border-s-ivory-ok",
  warn: "border-s-ivory-warn",
  err:  "border-s-ivory-err",
  info: "border-s-ivory-info",
};

const VALUE_COLOR: Record<StatTone, string> = {
  ok:   "text-ivory-text",
  warn: "text-ivory-warn",
  err:  "text-ivory-err",
  info: "text-ivory-text",
};

const DELTA_STYLE: Record<DeltaDir, string> = {
  up:   "bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]",
  down: "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)]",
  same: "bg-ivory-bg text-ivory-text3",
};

export function StatCard({
  title,
  value,
  sub,
  delta,
  deltaDir = "same",
  tone = "info",
}: StatCardProps) {
  return (
    <div
      className={cn(
        "bg-ivory-surface border border-ivory-border rounded-sm",
        "border-s-[3px]",
        BORDER[tone],
        "px-3 py-[10px]"
      )}
    >
      <p className="text-[10.5px] uppercase font-semibold tracking-[0.07em] text-ivory-text3 mb-1">
        {title}
      </p>

      <h3 className={cn("text-[28px] leading-none font-bold mb-[5px]", VALUE_COLOR[tone])}>
        {value}
      </h3>

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ivory-text3 truncate">
          {sub}
        </span>
        {delta && (
          <span
            className={cn(
              "text-[10.5px] font-semibold px-[5px] py-px rounded-[4px] shrink-0",
              DELTA_STYLE[deltaDir]
            )}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
