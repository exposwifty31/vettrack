/**
 * R-PDF-1 — Predictive readiness engine ("will you be ready").
 *
 * Pure, DB-free forecasting core (mirrors the analytics-kpis.ts precedent so the
 * demand / supply / shortfall math is unit-testable without a database). All DB
 * reads live behind the ReadinessForecastReader port; the Drizzle adapter +
 * orchestrator wiring live in server/services/readiness-forecast.service.ts.
 *
 * Design invariants (pinned by the R-PDF-1 sub-spec):
 *  - Demand is SCHEDULE-ONLY in v1. Burn rate is a SEPARATE shortfall term, never
 *    folded into demand (consumption is counted exactly once).
 *  - readySupply is the INTERSECTION of available ∧ ready (never a sum).
 *  - Everything is computed per demand key in that key's canonical unit; equipment
 *    unit-counts and consumable quantities are never summed into one aggregate.
 *  - Conservative / precision-first: required rounds UP, available rounds DOWN.
 *  - v1 adds NO schema — existing fields/configuration only.
 */

import type { EquipmentReadinessRulesV1 } from "../../shared/equipment-readiness-rules.js";

// ---------------------------------------------------------------------------
// Demand model (R-PDF-1.1) — a single DemandSource interface. v1 = schedule-only.
// ---------------------------------------------------------------------------

export type DemandKind = "equipment" | "consumable";

/** A demand key. Identity is `kind:ref` — `unit` is display/conversion metadata
 *  only, so demand and supply keys join by ref even if their unit strings differ. */
export interface DemandKey {
  kind: DemandKind;
  ref: string; // assetTypeId (equipment) | itemId (consumable)
  unit: string; // canonical unit ("unit" for equipment; the item's stock unit for a consumable)
}

/** Stable key identity — deliberately excludes `unit`. */
export function demandKeyId(key: DemandKey): string {
  return `${key.kind}:${key.ref}`;
}

export interface DemandEntry {
  key: DemandKey;
  /** Required quantity across the forecast window, in `key.unit`. */
  requiredQuantity: number;
  /** Source appointment ids (explainability — ids only, never PII). */
  sourceAppointmentIds: string[];
}

export interface ForecastWindow {
  fromMs: number;
  toMs: number;
  horizonHours: number;
}

/**
 * A scheduled procedure with its required items ALREADY extracted from existing
 * appointment fields (metadata + inventoryItemId) by the reader adapter. The
 * schedule demand source only aggregates — it never re-parses raw rows, and it
 * never reads consumption. This keeps the DemandSource interface free of any
 * inference-only assumption (a template impl fills the same shape differently).
 */
export interface ScheduledProcedureRow {
  id: string;
  clinicId: string;
  startTimeMs: number;
  status: string;
  requiredEquipment?: Array<{ assetTypeId: string; quantity?: number; unit?: string }>;
  requiredConsumables?: Array<{ itemId: string; quantity: number; unit?: string }>;
}

/** Port: fetch scheduled procedures for a clinic + window (clinicId-filtered). */
export interface ScheduleReader {
  scheduledProcedures(clinicId: string, window: ForecastWindow): Promise<ScheduledProcedureRow[]>;
}

/** The R-PDF-1.1 seam. Both the v1 schedule impl and a future per-procedure
 *  template impl satisfy this exact contract, so templates arrive with no rewrite. */
export interface DemandSource {
  getDemand(clinicId: string, window: ForecastWindow): Promise<DemandEntry[]>;
}

const EQUIPMENT_UNIT = "unit";

/**
 * v1 DemandSource: required equipment/consumables inferred from scheduled
 * procedures only. Historical usage/burn rate is intentionally NOT read here —
 * it is a separate shortfall term (R-PDF-1.3), so consumption is counted once.
 */
export class ScheduleDemandSource implements DemandSource {
  constructor(private readonly reader: ScheduleReader) {}

  async getDemand(clinicId: string, window: ForecastWindow): Promise<DemandEntry[]> {
    const procedures = await this.reader.scheduledProcedures(clinicId, window);

    const byKey = new Map<string, DemandEntry>();
    const add = (key: DemandKey, quantity: number, appointmentId: string): void => {
      if (!(quantity > 0)) return;
      const id = demandKeyId(key);
      const existing = byKey.get(id);
      if (existing) {
        existing.requiredQuantity += quantity;
        if (!existing.sourceAppointmentIds.includes(appointmentId)) {
          existing.sourceAppointmentIds.push(appointmentId);
        }
        return;
      }
      byKey.set(id, {
        key,
        requiredQuantity: quantity,
        sourceAppointmentIds: [appointmentId],
      });
    };

    for (const p of procedures) {
      for (const eq of p.requiredEquipment ?? []) {
        add(
          { kind: "equipment", ref: eq.assetTypeId, unit: eq.unit ?? EQUIPMENT_UNIT },
          eq.quantity ?? 1,
          p.id,
        );
      }
      for (const c of p.requiredConsumables ?? []) {
        add(
          { kind: "consumable", ref: c.itemId, unit: c.unit ?? EQUIPMENT_UNIT },
          c.quantity,
          p.id,
        );
      }
    }

    return [...byKey.values()];
  }
}
