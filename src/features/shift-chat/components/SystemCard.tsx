import { cn } from "@/lib/utils";
import type { ShiftMessage } from "../types";

interface SystemCardProps {
  message: ShiftMessage;
}

const EVENT_CONFIG: Record<
  string,
  { icon: string; colorClass: string; render: (p: Record<string, unknown>) => string }
> = {
  code_blue_start: {
    icon: "🚨",
    colorClass: "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)] text-[var(--status-issue-fg)]",
    render: (p) => `Code Blue הופעל — ${p.startedBy ?? ""}`,
  },
  code_blue_end: {
    icon: "✅",
    colorClass: "bg-[var(--status-ok-bg)] border-[var(--status-ok-border)] text-[var(--status-ok-fg)]",
    render: (p) => `Code Blue הסתיים — ${p.outcome ?? ""} · ${p.endedAt ? new Date(p.endedAt as string).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : ""}`,
  },
  med_critical: {
    icon: "💊",
    colorClass: "bg-purple-950 border-purple-800 text-purple-200",
    render: (p) => `תרופה קריטית — ${p.drugId ?? ""}`,
  },
  hosp_critical: {
    icon: "🏥",
    colorClass: "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)] text-[var(--status-issue-fg)]",
    render: (_p) => `חולה עבר לסטטוס קריטי`,
  },
  hosp_discharged: {
    icon: "🏥",
    colorClass: "bg-[var(--status-ok-bg)] border-[var(--status-ok-border)] text-[var(--status-ok-fg)]",
    render: (_p) => `חולה שוחרר`,
  },
  hosp_deceased: {
    icon: "🕊️",
    colorClass: "bg-slate-900 border-slate-700 text-slate-300",
    render: (_p) => `חולה נפטר`,
  },
  equipment_overdue: {
    icon: "🔧",
    colorClass: "bg-[var(--status-stale-bg)] border-[var(--status-stale-border)] text-[var(--status-stale-fg)]",
    render: (p) => `ציוד לא הוחזר — ${p.equipmentName ?? ""} (${p.minutesOverdue ?? 60} דק׳)`,
  },
  low_stock: {
    icon: "📦",
    colorClass: "bg-purple-950 border-purple-800 text-purple-200",
    render: (p) => `מלאי אזל: פריט ${p.itemId ?? ""}`,
  },
  shift_summary: {
    icon: "📋",
    colorClass: "bg-slate-900 border-slate-700 text-slate-400",
    render: (p) => `סיום משמרת · ${p.endedAt ? new Date(p.endedAt as string).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : ""}`,
  },
};

export function SystemCard({ message }: SystemCardProps) {
  const eventType = message.systemEventType ?? "";
  const payload   = (message.systemEventPayload ?? {}) as Record<string, unknown>;
  const config    = EVENT_CONFIG[eventType];

  if (!config) return null;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-[12px] text-center flex items-center justify-center gap-2",
        config.colorClass,
      )}
    >
      <span>{config.icon}</span>
      <span>{config.render(payload)}</span>
    </div>
  );
}
