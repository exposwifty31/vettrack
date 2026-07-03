// src/components/alerts/AlertCard.tsx
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type AlertTone = "err" | "warn" | "ok";

interface AlertCardProps {
  icon: LucideIcon;
  title: string;
  tone: AlertTone;
}

const TONE_STYLES: Record<AlertTone, string> = {
  err:  "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)] border-[var(--status-issue-border)]",
  warn: "bg-[var(--status-maint-bg)] text-[var(--status-maint-fg)] border-[var(--status-maint-border)]",
  ok:   "bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] border-[var(--status-ok-border)]",
};

export function AlertCard({ icon: Icon, title, tone }: AlertCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-sm border",
        "text-[12.5px] font-semibold",
        TONE_STYLES[tone]
      )}
    >
      <Icon size={16} strokeWidth={2.2} aria-hidden className="shrink-0" />
      <span>{title}</span>
    </div>
  );
}
