/** Outcome KPI ROI dashboard types (ER tables removed; billing-only metrics remain). */

export type OutcomeKpiRoiMetric = {
  baseline: number | null;
  current: number | null;
  improvementPercent: number | null;
  baselineSampleSize: number;
  currentSampleSize: number;
};

export type OutcomeKpiRoiResponse = {
  clinicId: string;
  hasActivation: boolean;
  activationAt: string | null;
  baselineWindow: { start: string; end: string; days: number; label: string } | null;
  currentWindow: { start: string; end: string; days: number; label: string } | null;
  generatedAt: string;
  timeToTriageMinutesP50: OutcomeKpiRoiMetric;
  handoffIntegrityDirectAckPercent: OutcomeKpiRoiMetric;
  revenueRecoveryScore: OutcomeKpiRoiMetric;
  avgDailyBillingCents: OutcomeKpiRoiMetric;
};
