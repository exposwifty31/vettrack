import { statusToBadgeVariant } from "@/lib/design-tokens";
import { Badge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

type Props = {
  equipment: Equipment;
  onDone: () => void;
  onPassToColleague: () => void;
};

export function ScanResultCard({ equipment, onDone, onPassToColleague }: Props) {
  const location = equipment.roomName ?? equipment.location ?? equipment.checkedOutLocation ?? null;

  return (
    <div
      style={{
        background: "hsl(var(--card))",
        borderRadius: 16,
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxShadow: "0 2px 16px rgba(0,0,0,0.10)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontSize: "var(--text-xl)",
              fontWeight: 700,
              color: "hsl(var(--foreground))",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {equipment.name}
          </h2>
          {equipment.serialNumber && (
            <p
              style={{
                fontFamily: "var(--font-num)",
                fontSize: "var(--text-xs)",
                color: "hsl(var(--muted-foreground))",
                margin: "4px 0 0",
              }}
            >
              {equipment.serialNumber}
            </p>
          )}
        </div>
        <Badge variant={statusToBadgeVariant(equipment.status)} style={{ flexShrink: 0 }}>
          {equipment.status}
        </Badge>
      </div>

      {location && (
        <p style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))", margin: 0 }}>
          📍 {location}
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "color-mix(in srgb, var(--action) 10%, transparent)",
          borderRadius: 8,
          border: "1px solid color-mix(in srgb, var(--action) 25%, transparent)",
        }}
      >
        <span style={{ color: "var(--action)", fontSize: 16 }}>✓</span>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--action)" }}>
          {t.scan.checkedInTo}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={onPassToColleague}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {t.scan.passToColleague}
        </button>
        <button
          type="button"
          onClick={onDone}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            border: "none",
            background: "var(--brand)",
            color: "#fff",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {t.scan.done}
        </button>
      </div>
    </div>
  );
}
