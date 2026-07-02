import { t, formatDateByLocale } from "@/lib/i18n";
import type { Equipment } from "@/types";

type Props = {
  equipment: Equipment;
};

const DAY_MS = 86_400_000;

/**
 * Stage 6 service-schedule card. Renders only when the equipment carries real
 * maintenance data (`lastMaintenanceDate` + `maintenanceIntervalDays`); the
 * progress bar and due dates are derived from those fields — nothing invented.
 */
export function EquipmentServiceCard({ equipment }: Props) {
  const { lastMaintenanceDate, maintenanceIntervalDays } = equipment;
  if (!lastMaintenanceDate || !maintenanceIntervalDays) return null;

  const last = new Date(lastMaintenanceDate).getTime();
  if (Number.isNaN(last)) return null;
  const intervalMs = maintenanceIntervalDays * DAY_MS;
  const next = last + intervalMs;
  const now = Date.now();

  const pct = Math.max(0, Math.min(100, ((now - last) / intervalMs) * 100));
  const overdue = now > next;
  const barToken = overdue ? "issue" : pct >= 80 ? "stale" : "ok";

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        borderRadius: 16,
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h2
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 700,
            color: "hsl(var(--foreground))",
            margin: 0,
          }}
        >
          {t.equipmentDetail.serviceSchedule}
        </h2>
        {overdue && (
          <span
            style={{
              fontSize: "var(--text-2xs)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--status-issue-fg)",
              background: "var(--status-issue-bg)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {t.equipmentDetail.serviceOverdue}
          </span>
        )}
      </div>

      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "hsl(var(--muted))",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: `hsl(var(--status-${barToken}))`,
            transition: "width 200ms ease",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <ServiceStat label={t.equipmentDetail.lastServiced} value={formatDateByLocale(lastMaintenanceDate)} />
        <ServiceStat
          label={t.equipmentDetail.nextService}
          value={formatDateByLocale(new Date(next))}
          align="end"
        />
      </div>
    </section>
  );
}

function ServiceStat({ label, value, align = "start" }: { label: string; value: string; align?: "start" | "end" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: align, minWidth: 0 }}>
      <span
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          fontFamily: "var(--font-num)",
          color: "hsl(var(--foreground))",
        }}
      >
        {value}
      </span>
    </div>
  );
}
