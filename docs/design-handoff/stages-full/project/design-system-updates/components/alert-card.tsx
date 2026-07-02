// src/components/alerts/AlertCard.tsx
// Design System Alignment — §34-D2 (Phase 15): "instead of a standard alert
// box" — was a full 1px border on all 4 sides (rounded-sm border); now a
// left accent rail (border-s-4, no other sides), matching the Card
// criticality system's rail language (card.tsx, same phase). Same 3 tones,
// same real tokens — no new colors, just the shape of the container.
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type AlertTone = "err" | "warn" | "ok";

interface AlertCardProps {
  icon: LucideIcon;
  title: string;
  tone: AlertTone;
}

// "err" reads as Critical (§34): bolder weight + shadow-card-hover
// ("elevated"), matching Card's criticality="critical" treatment. "warn"/
// "ok" stay at the lighter Attention-equivalent weight — no shadow, just
// the rail + tint.
const TONE_STYLES: Record<AlertTone, string> = {
  err:  "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)] border-s-[var(--status-issue-border)] font-bold shadow-card-hover",
  warn: "bg-[var(--status-maint-bg)] text-[var(--status-maint-fg)] border-s-[var(--status-maint-border)] font-semibold",
  ok:   "bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] border-s-[var(--status-ok-border)] font-semibold",
};

export function AlertCard({ icon: Icon, title, tone }: AlertCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 rounded-md border-s-4",
        "text-sm",
        TONE_STYLES[tone]
      )}
    >
      <Icon size={16} strokeWidth={2.2} aria-hidden className="shrink-0" />
      <span>{title}</span>
    </div>
  );
}
