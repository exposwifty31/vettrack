import { formatRelativeTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { ScanLog } from "@/types";

type Props = {
  logs: ScanLog[] | undefined;
};

export function EquipmentAccountabilityTimeline({ logs }: Props) {
  if (!logs || logs.length === 0) return null;

  const recent = logs.slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <p
        style={{
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          color: "hsl(var(--muted-foreground))",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          margin: "0 0 12px",
        }}
      >
        {t.equipmentDetail.accountability.title}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {recent.map((log, i) => (
          <div
            key={log.id}
            style={{
              display: "flex",
              gap: 12,
              position: "relative",
            }}
          >
            {/* Timeline line */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flexShrink: 0,
                width: 20,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--brand)",
                  marginTop: 4,
                  flexShrink: 0,
                }}
              />
              {i < recent.length - 1 && (
                <div
                  style={{
                    width: 1,
                    flex: 1,
                    background: "hsl(var(--border))",
                    marginTop: 4,
                    marginBottom: 4,
                  }}
                />
              )}
            </div>

            <div style={{ paddingBottom: i < recent.length - 1 ? 16 : 0, minWidth: 0, flex: 1 }}>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "hsl(var(--foreground))",
                  margin: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {log.staffName ?? log.userEmail}
              </p>
              {log.note && (
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "hsl(var(--muted-foreground))",
                    margin: "2px 0 0",
                  }}
                >
                  {log.note}
                </p>
              )}
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "hsl(var(--muted-foreground))",
                  margin: "2px 0 0",
                }}
              >
                {formatRelativeTime(log.timestamp)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
