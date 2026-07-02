import { t } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/utils";
import type { Equipment } from "@/types";
import type { LocationInference } from "./hooks/use-equipment-detail";

type Props = {
  equipment: Equipment;
  inference: LocationInference | null;
};

const EMPTY = "—";

/**
 * Stage 6 "At a glance" — a 2-up fact grid over real Equipment + inference
 * fields (Location / Assignee / Last scan / Due). Token-driven; no fabricated
 * data — each tile falls back to an em-dash when its source is absent.
 */
export function EquipmentGlanceGrid({ equipment, inference }: Props) {
  const location =
    inference?.inferredLocation ??
    equipment.checkedOutLocation ??
    equipment.roomName ??
    EMPTY;

  const assignee =
    inference?.accountablePerson?.name ??
    equipment.checkedOutByEmail ??
    t.equipmentDetail.unassigned;

  const lastScanIso =
    equipment.lastVerifiedAt ?? equipment.lastSeen ?? inference?.lastConfirmedAt ?? null;

  const dueIso =
    equipment.checkedOutAt && equipment.expectedReturnMinutes != null
      ? new Date(
          new Date(equipment.checkedOutAt).getTime() +
            equipment.expectedReturnMinutes * 60_000,
        ).toISOString()
      : null;

  const facts: Array<{ key: string; label: string; value: string }> = [
    { key: "loc", label: t.equipmentDetail.location, value: location },
    { key: "who", label: t.equipmentDetail.assignee, value: assignee },
    { key: "scan", label: t.equipmentDetail.lastScan, value: lastScanIso ? formatRelativeTime(lastScanIso) : EMPTY },
    { key: "due", label: t.equipmentDetail.due, value: dueIso ? formatRelativeTime(dueIso) : EMPTY },
  ];

  return (
    <section>
      <h2
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "hsl(var(--muted-foreground))",
          margin: "0 0 8px",
        }}
      >
        {t.equipmentDetail.atGlance}
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {facts.map((f) => (
          <div
            key={f.key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "12px 14px",
              borderRadius: 14,
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: "var(--text-2xs)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {f.label}
            </span>
            <span
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "hsl(var(--foreground))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
