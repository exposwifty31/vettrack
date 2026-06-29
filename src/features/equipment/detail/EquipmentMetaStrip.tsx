import { Badge } from "@/components/ui/badge";
import { statusToBadgeVariant } from "@/lib/design-tokens";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

type Props = {
  equipment: Equipment;
};

export function EquipmentMetaStrip({ equipment }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "16px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge variant={statusToBadgeVariant(equipment.status)}>
          {t.status[equipment.status as keyof typeof t.status] ?? equipment.status}
        </Badge>
        {equipment.serialNumber && (
          <span
            style={{
              fontFamily: "var(--font-num)",
              fontSize: "var(--text-xs)",
              color: "hsl(var(--muted-foreground))",
              background: "hsl(var(--muted))",
              borderRadius: 6,
              padding: "2px 8px",
            }}
          >
            {equipment.serialNumber}
          </span>
        )}
      </div>

      {(equipment.model || equipment.manufacturer) && (
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "hsl(var(--muted-foreground))",
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {[equipment.manufacturer, equipment.model].filter(Boolean).join(" · ")}
        </p>
      )}

      {equipment.roomName && (
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "hsl(var(--muted-foreground))",
            margin: 0,
          }}
        >
          {t.equipmentDetail.locationCard.title}: {equipment.roomName}
        </p>
      )}
    </div>
  );
}
