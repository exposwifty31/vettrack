import type { ReactNode } from "react";
import { Link } from "wouter";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { Skeleton } from "@/components/ui/skeleton";
import type { Alert, Room } from "@/types";

/**
 * Ops-tile helpers (Phase 3). Reimplemented from HomeTabletDashboard's inline,
 * un-exported internals — that file is out of the Phase-3 fence, so v1 duplicates
 * these deliberately (owner-confirmed; convergence tracked as a follow-up). The
 * shared react-query cache means the DATA is single-sourced even though the render
 * helpers are not.
 */

/** Worst-first ordering for the exceptions tile (mirrors HomeTabletDashboard). */
export const ALERT_ORDER: Alert["type"][] = ["issue", "overdue", "sterilization_due", "inactive"];

/** One coverage/readiness color scale used across the ops surface (semantic color). */
export function pctColor(pct: number): string {
  if (pct >= 80) return "rgb(var(--sys-green))";
  if (pct >= 40) return "rgb(var(--sys-orange))";
  return "rgb(var(--sys-red))";
}

/**
 * Room readiness % — present-vs-expected (design §6.4): at_home / expected_fill.
 * `expectedFill` is items homed to the room WITH a category; a room with
 * nothing homed has no readiness signal, so this returns null (not 0).
 * Capped at 100 — `atHomeCount` can transiently exceed `expectedFill` (e.g.
 * an item homed elsewhere mid-move) and readiness should never read >100%.
 */
export function roomPct(room: Room): number | null {
  const expectedFill = room.expectedFill ?? 0;
  if (expectedFill === 0) return null;
  return Math.min(100, Math.round(((room.atHomeCount ?? 0) / expectedFill) * 100));
}

/** Shared tile shell — border + surface + card shadow, RTL-safe. */
export function OpsTile({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <section
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-ivory-border bg-ivory-surface p-4 shadow-card"
    >
      {children}
    </section>
  );
}

export function TileHeader({ title, href, aside }: { title: string; href: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Link href={href} className="flex items-center gap-1 text-sm font-bold text-ivory-text hover:text-brand">
        {title}
        <ForwardChevron className="h-3.5 w-3.5 opacity-50" aria-hidden />
      </Link>
      {aside}
    </div>
  );
}

export function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-3.5 rounded" />
      ))}
    </div>
  );
}
