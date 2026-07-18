/**
 * R-PDF-1.4 — client-facing shape of the predictive-readiness forecast, served
 * by `GET /api/analytics/readiness-forecast`. Mirrors the redacted, clinicId-
 * scoped explainability DTO produced by server/lib/readiness-forecast-engine.ts:
 * source-row REFERENCES + counts only, never raw PII.
 */

export type ReadinessDemandKind = "equipment" | "consumable";

export interface ReadinessShortfallWarning {
  keyId: string;
  kind: ReadinessDemandKind;
  ref: string;
  unit: string;
  required: number;
  available: number;
  shortfall: number;
  sourceAppointmentIds: string[];
  sourceAppointmentCount: number;
  burnConsumedUnits: number | null;
  onHand: number | null;
  incomingUnits: number;
  incomingPurchaseOrderIds: string[];
}

/** READ-ONLY recommendation. Rendering it creates no PO; a PO is created only
 *  through the existing explicit confirm + authorization flow. */
export interface ReadinessPoRecommendation {
  itemId: string;
  unit: string;
  suggestedQuantity: number;
  shortfallKeyId: string;
}

export interface ReadinessForecast {
  clinicId: string;
  generatedAtMs: number;
  horizonHours: number;
  warnings: ReadinessShortfallWarning[];
  recommendations: ReadinessPoRecommendation[];
}
