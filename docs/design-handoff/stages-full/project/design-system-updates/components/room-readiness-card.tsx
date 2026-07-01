// Lands at: src/components/equipment/room-readiness-card.tsx
// §21-D4 (Phase 2) + Phase 21 (review item 14, "Upgrade Room Cards").
// Was ring-only (readyPercent as a conic-gradient donut) + one count +
// conditional attention chip. Review asks for a status line + a linear
// utilization bar + a device/staff count line. Switched the ring to a bar
// deliberately, not just added one: this card's job is readiness-as-a-
// percent-of-capacity, and the REAL rooms-list.tsx (src/pages/rooms-list.tsx
// — a different, already-shipped room card for a different page) already
// renders exactly this kind of metric as a bar (h-1.5 rounded-full,
// confirmed by reading the file) — mirrored here for visual consistency
// across the app's two room-card surfaces, rather than inventing a third
// look. rooms-list.tsx's own HealthRing (a DIFFERENT metric — 24h scan
// freshness, not readiness) keeps its ring elsewhere in the app, so rings
// aren't lost, just not duplicated for the same percent-of-capacity meaning.
// staffCount is a new, optional, presentational-only prop — no real
// per-room staff-assignment field was found on the Room type (grepped);
// wiring real data is the caller's job, same posture as every other prop
// on this component.
import * as React from "react";
import { cn } from "@/lib/utils";

export interface RoomReadinessCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  roomName: string;
  /** 0-100 — % of the room's equipment that's ready right now. */
  readyPercent: number;
  trackedCount: number;
  /** Omit to hide the staff-count segment entirely (no real data source yet). */
  staffCount?: number;
  /** Items needing attention (issue/maintenance). Omit or 0 to hide the chip. */
  attentionCount?: number;
  /** Override the auto-derived status line (from readyPercent/attentionCount). */
  statusLabel?: string;
}

type Tone = "ok" | "stale" | "issue";

function readinessTone(pct: number, attentionCount: number): Tone {
  if (attentionCount > 0 || pct < 50) return "issue";
  if (pct < 85) return "stale";
  return "ok";
}

const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--status-ok-fg)",
  stale: "var(--status-stale-fg)",
  issue: "var(--status-issue-fg)",
};
const TONE_TRACK: Record<Tone, string> = {
  ok: "var(--status-ok-bg)",
  stale: "var(--status-stale-bg)",
  issue: "var(--status-issue-bg)",
};
const TONE_LABEL: Record<Tone, string> = {
  ok: "Ready for procedure",
  stale: "Partially ready",
  issue: "Needs attention",
};

export function RoomReadinessCard({
  roomName,
  readyPercent,
  trackedCount,
  staffCount,
  attentionCount = 0,
  statusLabel,
  className,
  ...props
}: RoomReadinessCardProps) {
  const tone = readinessTone(readyPercent, attentionCount);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4",
        attentionCount > 0 ? "border-[var(--status-issue-border)]" : "border-border",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-bold text-foreground" title={roomName}>
          {roomName}
        </span>
        {attentionCount > 0 ? (
          <span className="flex-shrink-0 rounded-full bg-[var(--status-issue-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--status-issue-fg)]">
            {attentionCount} need attention
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-xs font-medium text-muted-foreground">
        {statusLabel ?? TONE_LABEL[tone]}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: TONE_TRACK[tone] }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${readyPercent}%`, background: TONE_COLOR[tone] }}
          />
        </div>
        <span className="font-num flex-shrink-0 text-xs font-bold text-foreground">
          {readyPercent}%
        </span>
      </div>

      <p className="mt-2.5 text-xs font-medium text-muted-foreground">
        {trackedCount} devices{staffCount != null ? ` · ${staffCount} staff` : ""}
      </p>
    </div>
  );
}
