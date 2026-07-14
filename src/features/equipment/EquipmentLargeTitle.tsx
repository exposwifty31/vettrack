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
  // Availability (operational health) and verification (freshness) are two
  // different metrics against the same denominator. A high availability figure
  // must not read as an all-clear when the verification dimension confirms that
  // nothing has been validated (verifiedCount === 0) — otherwise a 100%
  // availability figure sits next to a "0 verified" readout as a false
  // celebration (T14). Both dimensions are required before the number is
  // painted celebratory green; a known-zero verification degrades it to the
  // existing caution tone. `null` verification is "unknown" (still loading),
  // not "nothing validated" — so it never suppresses. Availability computation
  // itself is unchanged.
  const nothingVerified = verifiedCount === 0;
  const availabilityCelebrated = showPct && availabilityPct >= 80 && !nothingVerified;
  const availabilityTone = showPct ? (availabilityCelebrated ? "ok" : "caution") : "idle";

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
          data-availability-tone={availabilityTone}
          style={{
            fontFamily: "var(--font-num)",
            fontSize: "var(--text-2xl)",
            fontWeight: 700,
            color: showPct
              ? availabilityCelebrated
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
