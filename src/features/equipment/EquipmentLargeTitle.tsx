import { t } from "@/lib/i18n";

type Props = {
  title: string;
  count: number;
  availabilityPct: number;
};

export function EquipmentLargeTitle({ title, count, availabilityPct }: Props) {
  return (
    <div
      style={{
        borderRadius: 20,
        background: "var(--brand-ink)",
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 800,
            color: "#fff",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            margin: 0,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-num)",
            fontSize: "var(--text-sm)",
            color: "rgba(255,255,255,0.6)",
            margin: "4px 0 0",
          }}
        >
          {count}
        </p>
      </div>
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 2,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-num)",
            fontSize: "var(--text-2xl)",
            fontWeight: 700,
            color: availabilityPct >= 80 ? "var(--action)" : "#f59e0b",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {availabilityPct}%
        </span>
        <span
          style={{
            fontSize: "var(--text-2xs)",
            color: "rgba(255,255,255,0.5)",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {t.equipmentList.uptimeLabel}
        </span>
      </div>
    </div>
  );
}
