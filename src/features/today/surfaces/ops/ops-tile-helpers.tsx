import type { ReactNode } from "react";
import { Link } from "wouter";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { Skeleton } from "@/components/ui/skeleton";
import type { Alert, Room } from "@/types";
import type { ActionProposal, ActionProposalKind } from "@/types/action-proposals";

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

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable F) — the autopilot queue tile's
 * "mostly {kind}" hint: the most frequent `kind` among staged proposals,
 * ties broken deterministically by this fixed declared order (not
 * insertion order, which would be non-deterministic against the API's own
 * `ORDER BY createdAt DESC`).
 */
const AUTOPILOT_QUEUE_KIND_ORDER: ActionProposalKind[] = [
  "shift_handover_draft",
  "coordinator_reassign_off_roster",
  "restock_po_on_burn",
  "crash_cart_drift",
];

export function topStagedKind(proposals: ActionProposal[]): ActionProposalKind | null {
  if (proposals.length === 0) return null;
  const counts = new Map<ActionProposalKind, number>();
  for (const p of proposals) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);

  let best: ActionProposalKind | null = null;
  let bestCount = 0;
  for (const kind of AUTOPILOT_QUEUE_KIND_ORDER) {
    const count = counts.get(kind) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = kind;
    }
  }
  return best;
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
