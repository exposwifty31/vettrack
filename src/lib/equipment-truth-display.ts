import { t } from "@/lib/i18n";

/** Human-readable label for resolver location summary tokens. */
export function formatTruthLocationSummary(summary: string): string {
  const colon = summary.indexOf(":");
  if (colon === -1) {
    if (summary === "unknown") return t.equipmentTruth.locationUnknown;
    return summary;
  }
  const kind = summary.slice(0, colon);
  const value = summary.slice(colon + 1);
  switch (kind) {
    case "checked_out":
      return t.equipmentTruth.locationCheckedOut(value);
    case "rfid_room":
      return t.equipmentTruth.locationRfidRoom(value);
    case "room":
      return t.equipmentTruth.locationRoom(value);
    case "location":
      return value;
    default:
      return summary;
  }
}

/** Maps resolver unknown codes to user-facing copy when defined. */
export function formatTruthUnknown(code: string): string {
  const unknowns = t.equipmentTruth.unknowns as Record<string, string>;
  return unknowns[code] ?? code.replace(/_/g, " ");
}

export function formatCitationObservedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Maps a bundleGate reason code to localized user-facing copy. */
export function formatBundleGateReason(reason: string | null | undefined): string {
  if (!reason) return "";
  const reasons = t.operationalState.bundleGateReason as Record<string, string>;
  return reasons[reason] ?? reason.replace(/_/g, " ").toLowerCase();
}

/** Maps a citation type token to a localized label. */
export function formatCitationType(type: string): string {
  const types = t.equipmentTruth.citationTypes as Record<string, string>;
  return types[type] ?? type;
}
