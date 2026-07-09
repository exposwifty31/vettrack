import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Equipment } from "@/types";
import { formatDate, formatDateTime, getExpiryBadgeState } from "@/lib/utils";
import { t } from "@/lib/i18n";
import {
  Hash,
  Package,
  Calendar,
  MapPin,
  Clock,
  Wrench,
  Droplets,
  CalendarX,
  CalendarClock,
  CalendarCheck,
} from "lucide-react";

interface EquipmentDetailDetailsTabProps {
  equipment: Equipment;
}

/**
 * Details tab for the equipment detail page (Phase 7S extraction). Presentational:
 * renders the equipment's static spec rows + an expiry badge. Extracted from the
 * equipment-detail.tsx god-file; the previously-hardcoded English labels (expiry
 * date, "days", the expiry badge states) were moved onto the `t` accessor per review.
 */
export function EquipmentDetailDetailsTab({ equipment }: EquipmentDetailDetailsTabProps) {
  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardContent className="p-4 flex flex-col gap-3">
        {[
          { icon: Hash, label: t.equipmentDetail.serialNumber, value: equipment.serialNumber },
          { icon: Package, label: t.equipmentDetail.model, value: equipment.model },
          { icon: Package, label: t.equipmentDetail.manufacturer, value: equipment.manufacturer },
          { icon: Calendar, label: t.equipmentDetail.purchaseDate, value: formatDate(equipment.purchaseDate) },
          { icon: Calendar, label: t.equipmentDetail.expiryDateLabel, value: formatDate(equipment.expiryDate) },
          { icon: MapPin, label: t.equipmentDetail.location, value: equipment.location },
          {
            icon: Clock,
            label: t.equipmentDetail.maintenanceInterval,
            value: equipment.maintenanceIntervalDays
              ? `${equipment.maintenanceIntervalDays} ${t.equipmentDetail.daysUnit}`
              : undefined,
          },
          {
            icon: Wrench,
            label: t.equipmentDetail.lastMaintenance,
            value: formatDateTime(equipment.lastMaintenanceDate?.toString()),
          },
          {
            icon: Droplets,
            label: t.equipmentDetail.lastSterilization,
            value: formatDateTime(equipment.lastSterilizationDate?.toString()),
          },
        ]
          .filter((r) => r.value && r.value !== "—")
          .map((row, i) => (
            <div key={i} className="flex items-start gap-3">
              <row.icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{row.label}</p>
                <p className="text-sm font-medium">{row.value}</p>
              </div>
            </div>
          ))}
        {(() => {
          const expiryState = getExpiryBadgeState(equipment.expiryDate);
          if (!expiryState) return null;
          if (expiryState === "expired") {
            return (
              <Badge variant="issue" className="mt-1 text-xs font-medium">
                <CalendarX className="w-3.5 h-3.5" />
                {t.equipmentDetail.expiryExpired}
              </Badge>
            );
          }
          if (expiryState === "expiring_soon") {
            return (
              <Badge variant="maintenance" className="mt-1 text-xs font-medium">
                <CalendarClock className="w-3.5 h-3.5" />
                {t.equipmentDetail.expirySoon}
              </Badge>
            );
          }
          return (
            <Badge variant="ok" className="mt-1 text-xs font-medium">
              <CalendarCheck className="w-3.5 h-3.5" />
              {t.equipmentDetail.expiryValid}
            </Badge>
          );
        })()}
      </CardContent>
    </Card>
  );
}
