// Lands at: src/components/general/leaderboard.tsx
// §21-D3 — genuinely new; no real equivalent (Stage 7 Shift Leaderboard).
import * as React from "react";
import { cn } from "@/lib/utils";
import { PODIUM_RANK_VAR, type PodiumRank } from "@/core/entities/design-tokens";

export interface PodiumEntry {
  rank: PodiumRank;
  name: string;
  points: number;
  initials: string;
}

export interface PodiumProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Exactly 3 entries, any input order — rendered visually as 2nd/1st/3rd. */
  entries: PodiumEntry[];
}

const VISUAL_ORDER: Record<PodiumRank, number> = { 2: 1, 1: 2, 3: 3 };
const MEDAL: Record<PodiumRank, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function Podium({ entries, className, ...props }: PodiumProps) {
  return (
    <div className={cn("flex items-end justify-center gap-5", className)} {...props}>
      {entries.map((e) => {
        const isFirst = e.rank === 1;
        return (
          <div
            key={e.rank}
            className="flex flex-col items-center gap-2"
            style={{ order: VISUAL_ORDER[e.rank] }}
          >
            <span className="text-xl" aria-hidden="true">{MEDAL[e.rank]}</span>
            <div
              className={cn(
                "flex items-center justify-center rounded-full border-2 font-bold",
                isFirst ? "h-14 w-14 text-base" : "h-11 w-11 text-sm",
              )}
              style={{
                background: isFirst ? "hsl(var(--primary))" : "hsl(var(--muted))",
                color: isFirst ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                borderColor: PODIUM_RANK_VAR[e.rank],
              }}
            >
              {e.initials}
            </div>
            <p className="max-w-[90px] truncate text-sm font-semibold text-foreground" title={e.name}>
              {e.name}
            </p>
            <div
              className="flex items-start justify-center rounded-t-xl pt-2"
              style={{
                width: isFirst ? 84 : 64,
                height: isFirst ? 84 : e.rank === 2 ? 64 : 48,
                background: "var(--brand-ink)",
              }}
            >
              <span className="font-num text-sm font-bold text-primary-foreground">
                {e.points}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface RankedRow {
  rank: number;
  name: string;
  initials: string;
  meta: string;
  points: number;
}

export interface RankedListProps extends React.HTMLAttributes<HTMLDivElement> {
  rows: RankedRow[];
}

export function RankedList({ rows, className, ...props }: RankedListProps) {
  return (
    <div
      className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}
      {...props}
    >
      {rows.map((r, i) => (
        <div
          key={r.rank}
          className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}
        >
          <span className="font-num w-6 flex-shrink-0 text-sm font-bold text-muted-foreground">
            {r.rank}
          </span>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">
            {r.initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground" title={r.name}>
              {r.name}
            </p>
            <p className="truncate text-xs font-medium text-muted-foreground">{r.meta}</p>
          </div>
          <span className="font-num flex-shrink-0 text-sm font-bold text-foreground">
            {r.points}
          </span>
        </div>
      ))}
    </div>
  );
}
