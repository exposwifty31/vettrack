/**
 * ICU pharmacy forecast types (Slice 6g).
 * Mirrors server `server/lib/forecast/types.ts`. No imports from ./index.ts.
 */

export interface PharmacyForecastExclusion {
  id: string;
  clinicId: string;
  matchSubstring: string;
  note?: string | null;
  createdAt: string;
}

export type ForecastDrugType = "regular" | "cri" | "prn" | "ld";

export type ForecastFlagReason =
  | "DOSE_HIGH"
  | "DOSE_LOW"
  | "FREQ_MISSING"
  | "DRUG_UNKNOWN"
  | "PRN_MANUAL"
  | "PATIENT_UNKNOWN"
  | "LOW_CONFIDENCE"
  | "LINE_AMBIGUOUS"
  | "FLUID_VS_DRUG_UNCLEAR"
  | "WEIGHT_UNKNOWN"
  | "WEIGHT_UNCERTAIN"
  | "DUPLICATE_LINE"
  | "ALL_DRUGS_EXCLUDED";

export interface ForecastDrugEntry {
  drugName: string;
  concentration: string;
  packDescription: string;
  route: string;
  type: ForecastDrugType;
  quantityUnits: number | null;
  unitLabel: string;
  flags: ForecastFlagReason[];
  /** Administrations per 24h used for quantity (parsed or inferred). */
  administrationsPer24h: number | null;
  /** Total administrations in the selected order window (24 or 72h). */
  administrationsInWindow: number | null;
}

export interface ForecastPatientEntry {
  recordNumber: string;
  name: string;
  species: string;
  breed: string;
  sex: string;
  age: string;
  color: string;
  weightKg: number;
  ownerName: string;
  ownerId: string;
  ownerPhone: string;
  drugs: ForecastDrugEntry[];
  flags: ForecastFlagReason[];
}

export interface ForecastResult {
  windowHours: 24 | 72;
  weekendMode: boolean;
  pdfSourceFormat?: "smartflow" | "generic";
  patients: ForecastPatientEntry[];
  totalFlags: number;
  parsedAt: string;
  parseFailures?: Array<{
    fileName: string;
    message: string;
  }>;
}

/** Response shape from POST /api/forecast/parse */
export type ForecastParseResponse = ForecastResult & { parseId: string };

export interface ForecastApproveResponse {
  orderId: string;
  deliveryMethod: "smtp" | "mailto";
  mailtoUrl?: string;
  /** True when the mailto body was truncated to keep the URL under client limits. */
  mailtoBodyTruncated?: boolean;
  /**
   * Short, sanitized summary of the SMTP failure when the server attempted SMTP and
   * fell back to mailto. Safe to show in UI (contains no credentials).
   */
  smtpFallbackReason?: string;
}

export interface ForecastKeepaliveResponse {
  parseId: string;
  expiresAt: string;
}

export interface DrugAuditEntry {
  forecastedQty: number | null;
  onHandQty: number;
  orderQty: number;
  confirmed: boolean;
}

export interface PatientAuditState {
  recordNumber: string;
  warningAcknowledgements: Record<string, boolean>;
  weightOverride: number | null;
  patientNameOverride: string | null;
  /** keyed by drug.drugName */
  drugs: Record<string, DrugAuditEntry>;
}

export interface AuditState {
  forecastRunId: string;
  patients: Record<string, PatientAuditState>;
}

export interface ForecastApprovePayload {
  parseId: string;
  manualQuantities: Record<string, number>;
  pharmacistDoseAcks: string[];
  auditTrace?: Record<string, { forecastedQty: number | null; onHandQty: number }>;
  patientWeightOverrides?: Record<string, number>;
}
