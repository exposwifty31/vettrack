import type { Citation } from "../../shared/contracts/asset-copilot.v1.js";
import type { EquipmentTruthResponse } from "../../shared/equipment-truth.js";

export function getLatestRfidCitation(citations: Citation[]): Citation | null {
  const rfid = citations.filter((c) => c.type === "rfid");
  if (rfid.length === 0) return null;
  return rfid.reduce((latest, c) => {
    const t = new Date(c.evidence.observedAt).getTime();
    const lt = new Date(latest.evidence.observedAt).getTime();
    return t > lt ? c : latest;
  });
}

export function truthNeedsLocationConfirm(truth: EquipmentTruthResponse): boolean {
  if (truth.location.summary === "unknown") return true;
  return truth.location.unknowns.includes("no_authoritative_location");
}

export function truthHasPassiveRfidSignal(truth: EquipmentTruthResponse): boolean {
  const rfid = getLatestRfidCitation(truth.citations);
  if (!rfid) return false;
  const scan = truth.citations
    .filter((c) => c.type === "scan")
    .reduce<Date | null>((max, c) => {
      const t = new Date(c.evidence.observedAt);
      return !max || t > max ? t : max;
    }, null);
  if (!scan) return true;
  return new Date(rfid.evidence.observedAt) >= scan;
}
