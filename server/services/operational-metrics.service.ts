import { randomUUID } from "crypto";
import { db, operationalMetrics } from "../db.js";

export type OperationalMetricEvent =
  | "checkout_duration"
  | "dock_return_duration"
  | "bundle_failed"
  | "condition_stale"
  | "emergency_override"
  | "staging_requested"
  | "staging_expired"
  | "staging_fulfilled"
  | "custody_chain_broken"
  | "equipment_not_ready"
  | "workflow_abandoned"
  | "deployable_success";

// Validated at insert to prevent analytics pollution from typos
const VALID_METRIC_EVENTS = new Set<OperationalMetricEvent>([
  "checkout_duration",
  "dock_return_duration",
  "bundle_failed",
  "condition_stale",
  "emergency_override",
  "staging_requested",
  "staging_expired",
  "staging_fulfilled",
  "custody_chain_broken",
  "equipment_not_ready",
  "workflow_abandoned",
  "deployable_success",
]);

export interface MetricInput {
  clinicId: string;
  equipmentId?: string | null;
  roomId?: string | null;
  userId?: string | null;
  eventType: OperationalMetricEvent;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
}

function isMetricsEnabled(): boolean {
  const val = process.env.ENABLE_OPERATIONAL_METRICS;
  if (!val) return false;
  const n = val.trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes" || n === "on";
}

// Fire-and-forget — callers must use `void recordOperationalMetric(...)`, never await.
// All errors are caught internally; metrics must never affect business flow.
export async function recordOperationalMetric(input: MetricInput): Promise<void> {
  if (!isMetricsEnabled()) return;
  try {
    if (!VALID_METRIC_EVENTS.has(input.eventType)) {
      console.error("[operational-metrics] unknown eventType:", input.eventType);
      return;
    }
    await db.insert(operationalMetrics).values({
      id: randomUUID(),
      clinicId: input.clinicId,
      equipmentId: input.equipmentId ?? null,
      roomId: input.roomId ?? null,
      userId: input.userId ?? null,
      eventType: input.eventType,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[operational-metrics] insert failed (non-fatal):", err);
  }
}
