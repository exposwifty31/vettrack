import { t } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/utils";
import type { LocationInference, LocationConfidence } from "./hooks/use-equipment-detail";

// iOS system palette per the Stage 6 confidence ladder (medium = blue, not amber).
const CONFIDENCE_DOT: Record<LocationConfidence, string> = {
  high: "rgb(var(--sys-green))",
  medium: "rgb(var(--sys-blue))",
  low: "rgb(var(--sys-gray))",
  unknown: "rgb(var(--sys-red))",
};

const CONFIDENCE_LABEL: Record<LocationConfidence, string> = {
  high: t.equipmentDetail.locationCard.confidence.high,
  medium: t.equipmentDetail.locationCard.confidence.medium,
  low: t.equipmentDetail.locationCard.confidence.low,
  unknown: t.equipmentDetail.locationCard.confidence.unknown,
};

type Props = {
  inference: LocationInference;
};

// The server's `reasoning` string is English prose; rebuild it here from the
// structured fields so the card follows the app locale (M1).
function localizedReasoning(inference: LocationInference): string {
  const r = t.equipmentDetail.locationCard.reasoning;
  const person = inference.accountablePerson?.name ?? "";
  switch (inference.signalSource) {
    case "checkout":
      return r.checkedOut(person);
    case "dock":
      return r.dock(inference.inferredLocation ?? "");
    case "scan":
      return r.scan(person);
    case "rfid":
      return r.rfid(inference.inferredLocation ?? "");
    case "none":
      return inference.inferredLocation ? r.lastKnown(inference.inferredLocation) : r.none;
  }
}

export function EquipmentLocationCard({ inference }: Props) {
  const dotColor = CONFIDENCE_DOT[inference.confidence];
  const confidenceLabel = CONFIDENCE_LABEL[inference.confidence];
  const reasoningText =
    inference.lastConfirmedAt && !inference.accountablePerson
      ? `${localizedReasoning(inference)} · ${formatRelativeTime(inference.lastConfirmedAt)}`
      : localizedReasoning(inference);
  const locationLabel =
    inference.confidence === "unknown"
      ? t.equipmentDetail.locationCard.unknown
      : inference.signalSource === "none" && !inference.inferredLocation
        ? t.equipmentDetail.locationCard.lastKnown
        : null;

  return (
    <div
      style={{
        borderRadius: 20,
        background: "var(--brand-ink)",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}
        >
          {t.equipmentDetail.locationCard.title}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dotColor,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              color: dotColor,
            }}
          >
            {confidenceLabel}
          </span>
        </div>
      </div>

      <div>
        <p
          style={{
            fontSize: "var(--text-lg)",
            fontWeight: 700,
            color: "#fff",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {locationLabel ?? inference.inferredLocation ?? t.equipmentDetail.locationCard.unknown}
        </p>
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "rgba(255,255,255,0.55)",
            margin: "4px 0 0",
            lineHeight: 1.4,
          }}
        >
          {reasoningText}
        </p>
      </div>

      {inference.accountablePerson && (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: "rgba(255,255,255,0.7)",
              flexShrink: 0,
            }}
          >
            {inference.accountablePerson.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "#fff",
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {inference.accountablePerson.name}
            </p>
            {inference.accountablePerson.currentRoom && (
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "rgba(255,255,255,0.5)",
                  margin: 0,
                }}
              >
                {inference.accountablePerson.currentRoom}
              </p>
            )}
          </div>
          {inference.lastConfirmedAt && (
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "rgba(255,255,255,0.4)",
                marginInlineStart: "auto",
                flexShrink: 0,
              }}
            >
              {formatRelativeTime(inference.lastConfirmedAt)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
