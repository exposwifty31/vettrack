import { t } from "@/lib/i18n";
import { INACTIVE_THRESHOLD_DAYS } from "../../../shared/constants";

type Props = {
  title: string;
  count: number;
  /** null while loading or when nothing matches — renders a placeholder, never a fake 0%. */
  availabilityPct: number | null;
  isLoading: boolean;
  verifiedCount: number | null;
  notVerifiedCount: number | null;
};

export function EquipmentLargeTitle({
  title,
  count,
  availabilityPct,
  isLoading,
  verifiedCount,
  notVerifiedCount,
}: Props) {
  const showPct = !isLoading && availabilityPct !== null;
  const showVerifiedSplit =
    !isLoading && verifiedCount !== null && notVerifiedCount !== null && notVerifiedCount > 0;

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
          {isLoading ? "—" : count}
        </p>
        {showVerifiedSplit && (
          <p
            data-testid="equipment-verified-split"
            style={{
              fontSize: "var(--text-2xs)",
              color: "rgba(255,255,255,0.72)",
              margin: "4px 0 0",
            }}
          >
            {t.equipmentList.verifiedSplit(verifiedCount, notVerifiedCount, INACTIVE_THRESHOLD_DAYS)}
          </p>
        )}
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
          data-testid="equipment-availability"
          style={{
            fontFamily: "var(--font-num)",
            fontSize: "var(--text-2xl)",
            fontWeight: 700,
            color: showPct
              ? availabilityPct >= 80
                ? "var(--action)"
                : "#f59e0b"
              : "rgba(255,255,255,0.45)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {showPct ? `${availabilityPct}%` : "—"}
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
