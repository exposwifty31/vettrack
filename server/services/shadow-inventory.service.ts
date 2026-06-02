/**
 * Shadow inventory — billing ledger removed; orphan-stock scan is a no-op.
 */
import type { AuditDbExecutor } from "../lib/audit.js";

/** Hours after cabinet dispense charge to expect TASK_COMPLETED (medication given). */
export const CHARGE_TO_ADMIN_WINDOW_HOURS = 2;

/** Rolling window for suspected-orphan-stock scheduler (avoid scanning entire history). */
export const SUSPECT_SCAN_LOOKBACK_DAYS = 14;

/** Hours before task completion to search for a matching cabinet dispense log. */
export const DISPENSE_LOOKBACK_BEFORE_ADMIN_HOURS = 72;

export async function hasRecentDispenseForAnimalItem(
  _tx: AuditDbExecutor,
  _params: {
    clinicId: string;
    animalId: string;
    inventoryItemId: string;
    completedAt: Date;
  },
): Promise<boolean> {
  return false;
}

export type SuspectedOrphanStockCandidate = {
  inventoryLogId: string;
  clinicId: string;
  inventoryItemId: string;
  dispensedAt: Date;
};

export async function loadSuspectedOrphanStockCandidates(): Promise<SuspectedOrphanStockCandidate[]> {
  return [];
}

export async function emitSuspectedOrphanStockEvents(_candidates: SuspectedOrphanStockCandidate[]): Promise<number> {
  return 0;
}

export async function scanSuspectedOrphanStockOnce(): Promise<{ candidates: number; inserted: number }> {
  return { candidates: 0, inserted: 0 };
}

const SCAN_INTERVAL_MS = 10 * 60 * 1000;
let schedulerStarted = false;

export function startShadowInventoryScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => {
    void scanSuspectedOrphanStockOnce().catch((err) => {
      console.error("[shadow-inventory] scan failed:", err);
    });
  }, SCAN_INTERVAL_MS);
}
