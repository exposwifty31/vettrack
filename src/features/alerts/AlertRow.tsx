import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Alert } from "@/types";

const SEVERITY_BORDER: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#6b7280",
};

type Props = {
  alert: Alert;
};

export function AlertRow({ alert }: Props) {
  const borderColor = SEVERITY_BORDER[alert.severity] ?? SEVERITY_BORDER.low;
  const typeLabel = t.alerts.types[alert.type as keyof typeof t.alerts.types]?.label ?? alert.type;

  return (
    <div
      role="listitem"
      style={{
        display: "flex",
        alignItems: "stretch",
        minHeight: 64,
        borderBottom: "1px solid var(--border)",
        paddingBlock: 12,
        paddingInlineEnd: 16,
        gap: 12,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 3,
          borderRadius: 2,
          flexShrink: 0,
          background: borderColor,
          alignSelf: "stretch",
          marginInlineStart: 16,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "hsl(var(--foreground))",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
          }}
        >
          {alert.equipmentName}
        </div>
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "hsl(var(--muted-foreground))",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {typeLabel}{alert.detail ? ` — ${alert.detail}` : ""}
        </div>
      </div>
    </div>
  );
}
