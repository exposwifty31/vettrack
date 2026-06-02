import { eq } from "drizzle-orm";
import { db, pool, serverConfig } from "../db.js";
import type { OutcomeKpiRoiMetric, OutcomeKpiRoiResponse } from "../../shared/er-types.js";

/** Default: 14 days of pre-activation baseline and a trailing 14-day post-activation period. */
const BASELINE_DAYS = 14;
const CURRENT_TRAILING_DAYS = 14;

/** Per-clinic ISO 8601 activation instant in `vt_server_config` (hospital go-live for outcome KPIs). */
export const OUTCOME_KPI_ACTIVATION_KEY = (clinicId: string) =>
  `outcome_kpi_activation_at:${clinicId}`;

async function readActivationAt(clinicId: string): Promise<Date | null> {
  const key = OUTCOME_KPI_ACTIVATION_KEY(clinicId);
  const [row] = await db.select({ value: serverConfig.value }).from(serverConfig).where(eq(serverConfig.key, key)).limit(1);
  const raw = row?.value?.trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Consumable billing leakage: (dispensed qty − billed qty) / dispensed qty in the window.
 */
async function computeBillingLeakageGapPercent(
  clinicId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<number | null> {
  const result = await pool.query<{ gap: string | null }>(
    `WITH dispensed AS (
       SELECT COALESCE(SUM(ABS(il.quantity_added)), 0)::numeric AS total_dispensed
       FROM vt_inventory_logs il
       JOIN vt_containers c ON c.id = il.container_id
       WHERE il.clinic_id = $1
         AND il.quantity_added < 0
         AND il.created_at >= $2::timestamptz AND il.created_at < $3::timestamptz
         AND c.billing_item_id IS NOT NULL
     ),
     billed AS (
       SELECT COALESCE(SUM(quantity), 0)::numeric AS total_billed
       FROM vt_billing_ledger
       WHERE clinic_id = $1
         AND item_type = 'CONSUMABLE'
         AND status != 'voided'
         AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
     )
     SELECT CASE WHEN d.total_dispensed > 0
          THEN ROUND(((d.total_dispensed - COALESCE(b.total_billed, 0)) / d.total_dispensed * 100)::numeric, 4)
          ELSE NULL END AS gap
     FROM dispensed d
     CROSS JOIN billed b`,
    [clinicId, windowStart, windowEnd],
  );
  const g = result.rows[0]?.gap;
  if (g === null || g === undefined) return null;
  const n = Number(g);
  return Number.isFinite(n) ? n : null;
}

async function computeAvgDailyBillingRevenueCents(
  clinicId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<number | null> {
  const result = await pool.query<{ avgCents: string | null }>(
    `SELECT ROUND(AVG(daily_cents))::bigint AS "avgCents"
     FROM (
       SELECT DATE(created_at AT TIME ZONE 'UTC') AS day,
              COALESCE(SUM(amount_cents), 0)::bigint AS daily_cents
       FROM vt_billing_ledger
       WHERE clinic_id = $1
         AND status != 'voided'
         AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
       GROUP BY 1
     ) d`,
    [clinicId, windowStart, windowEnd],
  );
  const raw = result.rows[0]?.avgCents;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function revenueRecoveryScoreFromGap(leakageGapPercent: number | null): number | null {
  if (leakageGapPercent === null) return null;
  return Math.max(0, Math.min(100, Math.round((100 - leakageGapPercent) * 100) / 100));
}

function improvementPercentHigherIsBetter(baseline: number | null, current: number | null): number | null {
  if (baseline === null || current === null) return null;
  if (baseline === 0) return current > 0 ? 100 : null;
  return Math.round(((current - baseline) / baseline) * 10000) / 100;
}

function buildMetric(params: {
  baseline: number | null;
  current: number | null;
  improvementPercent: number | null;
  baselineSampleSize: number;
  currentSampleSize: number;
}): OutcomeKpiRoiMetric {
  return {
    baseline: params.baseline,
    current: params.current,
    improvementPercent: params.improvementPercent,
    baselineSampleSize: params.baselineSampleSize,
    currentSampleSize: params.currentSampleSize,
  };
}

const stubMetric = (): OutcomeKpiRoiMetric =>
  buildMetric({
    baseline: null,
    current: null,
    improvementPercent: null,
    baselineSampleSize: 0,
    currentSampleSize: 0,
  });

/**
 * Outcome KPI dashboard — ER/handoff metrics stubbed after patient module removal.
 * Billing leakage and avg daily revenue still computed when activation is set.
 */
export async function getOutcomeKpiRoiDashboard(clinicId: string): Promise<OutcomeKpiRoiResponse> {
  const generatedAt = new Date();
  const activationAt = await readActivationAt(clinicId);

  if (!activationAt || activationAt.getTime() > generatedAt.getTime()) {
    return {
      clinicId,
      hasActivation: false,
      activationAt: null,
      baselineWindow: null,
      currentWindow: null,
      generatedAt: generatedAt.toISOString(),
      timeToTriageMinutesP50: stubMetric(),
      handoffIntegrityDirectAckPercent: stubMetric(),
      revenueRecoveryScore: stubMetric(),
      avgDailyBillingCents: stubMetric(),
    };
  }

  const baselineStart = new Date(activationAt.getTime() - BASELINE_DAYS * 86_400_000);
  const baselineEnd = activationAt;
  const currentEnd = generatedAt;
  const currentStart = new Date(
    Math.max(activationAt.getTime(), generatedAt.getTime() - CURRENT_TRAILING_DAYS * 86_400_000),
  );

  const [baseLeak, curLeak, baseAvgBill, curAvgBill] = await Promise.all([
    computeBillingLeakageGapPercent(clinicId, baselineStart, baselineEnd),
    computeBillingLeakageGapPercent(clinicId, currentStart, currentEnd),
    computeAvgDailyBillingRevenueCents(clinicId, baselineStart, baselineEnd),
    computeAvgDailyBillingRevenueCents(clinicId, currentStart, currentEnd),
  ]);

  const baseRecovery = revenueRecoveryScoreFromGap(baseLeak);
  const curRecovery = revenueRecoveryScoreFromGap(curLeak);

  return {
    clinicId,
    hasActivation: true,
    activationAt: activationAt.toISOString(),
    baselineWindow: {
      start: baselineStart.toISOString(),
      end: baselineEnd.toISOString(),
      days: BASELINE_DAYS,
      label: "pre_activation_14d",
    },
    currentWindow: {
      start: currentStart.toISOString(),
      end: currentEnd.toISOString(),
      days: Math.max(
        1,
        Math.round((currentEnd.getTime() - currentStart.getTime()) / 86_400_000),
      ),
      label: "trailing_post_activation_14d",
    },
    generatedAt: generatedAt.toISOString(),
    timeToTriageMinutesP50: stubMetric(),
    handoffIntegrityDirectAckPercent: stubMetric(),
    revenueRecoveryScore: buildMetric({
      baseline: baseRecovery,
      current: curRecovery,
      improvementPercent: improvementPercentHigherIsBetter(baseRecovery, curRecovery),
      baselineSampleSize: 0,
      currentSampleSize: 0,
    }),
    avgDailyBillingCents: buildMetric({
      baseline: baseAvgBill,
      current: curAvgBill,
      improvementPercent: improvementPercentHigherIsBetter(baseAvgBill, curAvgBill),
      baselineSampleSize: 0,
      currentSampleSize: 0,
    }),
  };
}
