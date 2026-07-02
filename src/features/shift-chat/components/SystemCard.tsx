import { cn } from "@/lib/utils";
import type { ShiftMessage } from "../types";
import { t, formatDateByLocale } from "@/lib/i18n";

interface SystemCardProps {
  message: ShiftMessage;
}

type Tone = "issue" | "ok" | "stale" | "neutral";

// Pre-formed status tokens read the same declaration in both themes.
const TONE_CLASS: Record<Tone, string> = {
  issue: "bg-[var(--status-issue-bg)] border-[var(--status-issue-border)] text-[var(--status-issue-fg)]",
  ok: "bg-[var(--status-ok-bg)] border-[var(--status-ok-border)] text-[var(--status-ok-fg)]",
  stale: "bg-[var(--status-stale-bg)] border-[var(--status-stale-border)] text-[var(--status-stale-fg)]",
  neutral: "bg-muted border-border text-muted-foreground",
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const asTime = (v: unknown): string =>
  str(v) ? formatDateByLocale(str(v), { hour: "2-digit", minute: "2-digit" }) : "";

interface EventMeta {
  icon: string;
  tone: Tone;
  label: (p: Record<string, unknown>) => string;
}

// Every entry corresponds to an event the server actually emits via
// postSystemMessage() (verified against server/ 2026-07-02). Events for the
// ER/medication scope removed in migrations 142–143 were dropped.
const EVENT_CONFIG: Record<string, EventMeta> = {
  code_blue_start: {
    icon: "🚨",
    tone: "issue",
    label: (p) => {
      const by = str(p.startedBy);
      return by ? `${t.shiftChat.system.codeBlueStarted} — ${by}` : t.shiftChat.system.codeBlueStarted;
    },
  },
  code_blue_end: {
    icon: "✅",
    tone: "ok",
    label: (p) => {
      let out = t.shiftChat.system.codeBlueEnded;
      const outcome = str(p.outcome);
      if (outcome) out += ` — ${outcome}`;
      const time = asTime(p.endedAt);
      if (time) out += ` · ${time}`;
      return out;
    },
  },
  code_blue_unreconciled: {
    icon: "⚠️",
    tone: "stale",
    label: (p) => {
      const age = typeof p.ageMinutes === "number" ? p.ageMinutes : null;
      return age != null
        ? `${t.shiftChat.system.codeBlueUnreconciled} — ${age} ${t.shiftChat.system.minutesShort}`
        : t.shiftChat.system.codeBlueUnreconciled;
    },
  },
  equipment_overdue: {
    icon: "🔧",
    tone: "stale",
    label: (p) => {
      const name = str(p.equipmentName);
      const mins = typeof p.minutesOverdue === "number" ? p.minutesOverdue : 60;
      const head = name ? `${t.shiftChat.system.equipmentOverdue} — ${name}` : t.shiftChat.system.equipmentOverdue;
      return `${head} (${mins} ${t.shiftChat.system.minutesShort})`;
    },
  },
  alert_reopened: {
    icon: "🔔",
    tone: "issue",
    label: (p) => {
      const name = str(p.equipmentName);
      return name ? `${t.shiftChat.system.alertReopened} — ${name}` : t.shiftChat.system.alertReopened;
    },
  },
  emergency_dispense_unresolved: {
    icon: "💊",
    tone: "issue",
    label: (p) => {
      const age = typeof p.ageMinutes === "number" ? p.ageMinutes : null;
      return age != null
        ? `${t.shiftChat.system.emergencyDispenseUnresolved} — ${age} ${t.shiftChat.system.minutesShort}`
        : t.shiftChat.system.emergencyDispenseUnresolved;
    },
  },
  task_escalated: {
    icon: "⬆️",
    tone: "stale",
    label: () => t.shiftChat.system.taskEscalated,
  },
  critical_push_delivery_failed: {
    icon: "📵",
    tone: "issue",
    label: () => t.shiftChat.system.criticalPushFailed,
  },
  outbox_dlq_threshold_exceeded: {
    icon: "🛠️",
    tone: "issue",
    label: (p) => {
      const count = typeof p.deadLetterCount === "number" ? p.deadLetterCount : null;
      return count != null
        ? `${t.shiftChat.system.outboxDlqExceeded} (${count})`
        : t.shiftChat.system.outboxDlqExceeded;
    },
  },
};

export function SystemCard({ message }: SystemCardProps) {
  const eventType = message.systemEventType ?? "";
  const payload = (message.systemEventPayload ?? {}) as Record<string, unknown>;
  const config = EVENT_CONFIG[eventType];

  if (!config) return null;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-[12px] text-center flex items-center justify-center gap-2",
        TONE_CLASS[config.tone],
      )}
    >
      <span>{config.icon}</span>
      <span>{config.label(payload)}</span>
    </div>
  );
}
