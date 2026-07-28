/**
 * VetTrack 2.0, Task 1.1 §5 — `CrashCartDriftReader` port.
 *
 * Two independent drift signals, both computed from the SAME most-recent
 * `vt_crash_cart_checks` row (per clinic — there is one cart per clinic, no
 * `cartId` dimension) plus the clinic's active `vt_crash_cart_items` rows:
 *
 * 1. **Missing-item drift** — the most recent check's `allPassed === false`.
 *    Its `itemsChecked` entries with `checked: false` are matched back to
 *    ACTIVE `vt_crash_cart_items` rows by `key` (an inactive item's key is
 *    never matched, even if it still appears in an old check's JSON blob).
 * 2. **Staleness drift** — no check within a resolved threshold. Default
 *    {@link CRASH_CART_CHECK_STALE_AFTER_HOURS_DEFAULT} (24h — a daily-check
 *    floor consistent with AAHA/RECOVER-aligned crash-cart-readiness
 *    practice; busier hospitals check per-shift and can tighten this via the
 *    per-clinic override), overridable per clinic via the
 *    `vt_server_config` key `autopilot.crash_cart_stale_hours.<clinicId>`
 *    (read with the same raw-SQL `SELECT value FROM vt_server_config WHERE
 *    key = $1` shape as `server/lib/queue.ts`'s billing-webhook config read),
 *    parsed as a positive integer and clamped to
 *    [{@link CRASH_CART_STALE_HOURS_MIN}, {@link CRASH_CART_STALE_HOURS_MAX}].
 *    When NO check has ever been performed, staleness is flagged with
 *    `hasNeverBeenChecked: true` — there is no check row to cite as a fact
 *    in that case, so the reader returns the clinic's active
 *    `vt_crash_cart_items` rows as the only citable facts (documented
 *    citation choice: an absence has no row of its own; the items the check
 *    should have covered are the closest available ground truth).
 *
 * `expiryWarnDays` (`crashCartItems.expiryWarnDays`) is NOT wired into
 * either signal — there is no per-unit expiry-date field anywhere in
 * `server/schema/er.ts` to compute an "this specific unit expires on date X"
 * signal against. Real, disclosed gap (Task 1.1 plan §5 step 4), not a
 * silent omission — expiry-based drift needs its own schema addition,
 * tracked as a follow-up, out of scope here.
 *
 * Every query is `clinicId`-scoped (CLAUDE.md multi-tenancy rule) — a
 * lookup under the wrong clinic sees no check row and no item rows, and
 * (correctly, per the "no check ever" rule) reports a never-checked
 * staleness signal, never a cross-tenant leak of another clinic's data.
 *
 * This file is READ-ONLY with respect to `server/routes/crash-cart.ts` — it
 * never modifies that route; it only reads the same two tables the route
 * already writes.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, crashCartChecks, crashCartItems, pool } from "../../db.js";

export const CRASH_CART_CHECK_STALE_AFTER_HOURS_DEFAULT = 24;
export const CRASH_CART_STALE_HOURS_MIN = 1;
export const CRASH_CART_STALE_HOURS_MAX = 168;

const HOUR_MS = 60 * 60 * 1000;

export function crashCartStaleHoursConfigKey(clinicId: string): string {
  return `autopilot.crash_cart_stale_hours.${clinicId}`;
}

/** Clamps a raw hours value into [{@link CRASH_CART_STALE_HOURS_MIN}, {@link CRASH_CART_STALE_HOURS_MAX}]. */
export function clampCrashCartStaleHours(hours: number): number {
  return Math.min(CRASH_CART_STALE_HOURS_MAX, Math.max(CRASH_CART_STALE_HOURS_MIN, hours));
}

/** Parses+clamps a raw `vt_server_config` value; returns `null` for missing/non-positive/non-numeric input (falls back to the default). */
export function parseCrashCartStaleHoursOverride(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return clampCrashCartStaleHours(parsed);
}

export interface CrashCartStaleHoursConfigReader {
  read(clinicId: string): Promise<number | null>;
}

/** Real config read — mirrors `server/lib/queue.ts:403-410`'s per-clinic `vt_server_config` raw-SQL read shape. Never throws (fails safe to the default). */
export class DrizzleCrashCartStaleHoursConfigReader implements CrashCartStaleHoursConfigReader {
  async read(clinicId: string): Promise<number | null> {
    try {
      const result = await pool.query<{ value: string }>(
        "SELECT value FROM vt_server_config WHERE key = $1",
        [crashCartStaleHoursConfigKey(clinicId)],
      );
      return parseCrashCartStaleHoursOverride(result.rows[0]?.value ?? null);
    } catch (err) {
      console.error("[crash-cart-drift-reader] stale-hours config read failed:", (err as Error).message);
      return null;
    }
  }
}

/** Test fake — no DB access; unit tests inject this instead of hitting `vt_server_config`. */
export class InMemoryCrashCartStaleHoursConfigReader implements CrashCartStaleHoursConfigReader {
  constructor(private readonly overrides: Record<string, number> = {}) {}

  async read(clinicId: string): Promise<number | null> {
    const raw = this.overrides[clinicId];
    return raw == null ? null : clampCrashCartStaleHours(raw);
  }
}

export interface CrashCartActiveItemRow {
  id: string;
  key: string;
  label: string;
}

export interface CrashCartFailedItem {
  key: string;
  label: string;
  itemRowId: string;
}

export interface CrashCartLastCheck {
  id: string;
  performedAt: Date;
  allPassed: boolean;
  itemsChecked: Array<{ key: string; label: string; checked: boolean }>;
}

export interface CrashCartDriftReadResult {
  lastCheck: CrashCartLastCheck | null;
  activeItems: CrashCartActiveItemRow[];
  missingItemsFlagged: boolean;
  failedItems: CrashCartFailedItem[];
  staleFlagged: boolean;
  hasNeverBeenChecked: boolean;
  hoursSinceLastCheck: number | null;
  thresholdHours: number;
}

export interface CrashCartDriftReader {
  read(clinicId: string, now?: Date): Promise<CrashCartDriftReadResult>;
}

interface ComputeDriftParams {
  lastCheck: CrashCartLastCheck | null;
  activeItems: CrashCartActiveItemRow[];
  thresholdHours: number;
  now: Date;
}

type ComputedDrift = Pick<
  CrashCartDriftReadResult,
  "missingItemsFlagged" | "failedItems" | "staleFlagged" | "hasNeverBeenChecked" | "hoursSinceLastCheck"
>;

/** Pure — shared by the Drizzle and in-memory readers so the drift rule is defined exactly once. */
function computeDrift(params: ComputeDriftParams): ComputedDrift {
  const { lastCheck, activeItems, thresholdHours, now } = params;

  if (!lastCheck) {
    return { missingItemsFlagged: false, failedItems: [], staleFlagged: true, hasNeverBeenChecked: true, hoursSinceLastCheck: null };
  }

  const activeByKey = new Map(activeItems.map((item) => [item.key, item]));
  const missingItemsFlagged = lastCheck.allPassed === false;
  const failedItems: CrashCartFailedItem[] = missingItemsFlagged
    ? lastCheck.itemsChecked
        .filter((entry) => !entry.checked)
        .map((entry) => activeByKey.get(entry.key))
        .filter((item): item is CrashCartActiveItemRow => item != null)
        .map((item) => ({ key: item.key, label: item.label, itemRowId: item.id }))
    : [];

  const hoursSinceLastCheck = (now.getTime() - lastCheck.performedAt.getTime()) / HOUR_MS;
  const staleFlagged = hoursSinceLastCheck > thresholdHours;

  return { missingItemsFlagged, failedItems, staleFlagged, hasNeverBeenChecked: false, hoursSinceLastCheck };
}

export class DrizzleCrashCartDriftReader implements CrashCartDriftReader {
  constructor(
    private readonly staleHoursConfigReader: CrashCartStaleHoursConfigReader = new DrizzleCrashCartStaleHoursConfigReader(),
  ) {}

  async read(clinicId: string, now: Date = new Date()): Promise<CrashCartDriftReadResult> {
    const [lastCheckRows, activeItemRows, overrideHours] = await Promise.all([
      db
        .select()
        .from(crashCartChecks)
        .where(eq(crashCartChecks.clinicId, clinicId))
        .orderBy(desc(crashCartChecks.performedAt))
        .limit(1),
      db
        .select()
        .from(crashCartItems)
        .where(and(eq(crashCartItems.clinicId, clinicId), eq(crashCartItems.active, true))),
      this.staleHoursConfigReader.read(clinicId),
    ]);

    const lastCheckRow = lastCheckRows[0];
    const lastCheck: CrashCartLastCheck | null = lastCheckRow
      ? {
          id: lastCheckRow.id,
          performedAt: lastCheckRow.performedAt,
          allPassed: lastCheckRow.allPassed,
          itemsChecked: lastCheckRow.itemsChecked,
        }
      : null;
    const activeItems: CrashCartActiveItemRow[] = activeItemRows.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
    }));
    const thresholdHours = overrideHours ?? CRASH_CART_CHECK_STALE_AFTER_HOURS_DEFAULT;

    return { lastCheck, activeItems, thresholdHours, ...computeDrift({ lastCheck, activeItems, thresholdHours, now }) };
  }
}

export interface InMemoryCrashCartDriftReaderSeed {
  checks?: Array<{
    id: string;
    clinicId: string;
    performedAt: Date;
    allPassed: boolean;
    itemsChecked: Array<{ key: string; label: string; checked: boolean }>;
  }>;
  items?: Array<{ id: string; clinicId: string; key: string; label: string; active: boolean }>;
  /** Keyed by clinicId — mirrors `InMemoryCrashCartStaleHoursConfigReader`'s seed shape but inlined here for one-object test ergonomics. */
  staleHoursOverrides?: Record<string, number>;
}

/** Test fake — mirrors the real reader's `clinicId`-scoping: rows seeded under a different clinic are never returned. */
export class InMemoryCrashCartDriftReader implements CrashCartDriftReader {
  constructor(private readonly seed: InMemoryCrashCartDriftReaderSeed = {}) {}

  async read(clinicId: string, now: Date = new Date()): Promise<CrashCartDriftReadResult> {
    const clinicChecks = (this.seed.checks ?? []).filter((check) => check.clinicId === clinicId);
    const [mostRecent] = [...clinicChecks].sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime());
    const lastCheck: CrashCartLastCheck | null = mostRecent
      ? { id: mostRecent.id, performedAt: mostRecent.performedAt, allPassed: mostRecent.allPassed, itemsChecked: mostRecent.itemsChecked }
      : null;

    const activeItems: CrashCartActiveItemRow[] = (this.seed.items ?? [])
      .filter((item) => item.clinicId === clinicId && item.active)
      .map((item) => ({ id: item.id, key: item.key, label: item.label }));

    const overrideRaw = this.seed.staleHoursOverrides?.[clinicId];
    const thresholdHours =
      overrideRaw != null ? clampCrashCartStaleHours(overrideRaw) : CRASH_CART_CHECK_STALE_AFTER_HOURS_DEFAULT;

    return { lastCheck, activeItems, thresholdHours, ...computeDrift({ lastCheck, activeItems, thresholdHours, now }) };
  }
}
