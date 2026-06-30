import { useLocation } from "wouter";
import { AlertTriangle, Clock } from "lucide-react";
import { t } from "@/lib/i18n";

type Props = {
  criticalCount: number;
  overdueCount: number;
};

type ChipProps = {
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  kind: "issue" | "overdue";
};

function UrgentChip({ icon, label, count, onClick, kind }: ChipProps) {
  const bg     = kind === "issue" ? "var(--status-issue-bg)"   : "var(--status-overdue-bg)";
  const border = kind === "issue" ? "var(--status-issue-border)" : "var(--status-overdue-border)";
  const text   = kind === "issue" ? "var(--status-issue-fg)"  : "var(--status-overdue-fg)";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: bg,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        transition: "opacity 120ms ease",
        textAlign: "start",
      }}
      onPointerDown={(e) => (e.currentTarget.style.opacity = "0.7")}
      onPointerUp={(e) => (e.currentTarget.style.opacity = "1")}
      onPointerLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      <span style={{ color: text, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 700, color: text }}>
          {count}
        </span>
        <span style={{ display: "block", fontSize: "var(--text-2xs)", color: text, opacity: 0.75 }}>
          {label}
        </span>
      </span>
    </button>
  );
}

export function UrgentCountChips({ criticalCount, overdueCount }: Props) {
  const [, navigate] = useLocation();

  if (criticalCount === 0 && overdueCount === 0) return null;

  return (
    <div style={{ display: "flex", gap: 10 }}>
      {criticalCount > 0 && (
        <UrgentChip
          icon={<AlertTriangle size={16} aria-hidden />}
          label={t.home.urgent.critical}
          count={criticalCount}
          onClick={() => navigate("/alerts")}
          kind="issue"
        />
      )}
      {overdueCount > 0 && (
        <UrgentChip
          icon={<Clock size={16} aria-hidden />}
          label={t.home.urgent.overdue}
          count={overdueCount}
          onClick={() => navigate("/equipment/tasks?filter=overdue")}
          kind="overdue"
        />
      )}
    </div>
  );
}
