/**
 * VetTrack 2.0, Task 1.1 §3 — `CoordinatorRosterReader` port.
 *
 * Detects "off-roster" drift: a persisted `vt_shift_equipment_coordinator`
 * row whose `coordinatorUserId` is no longer present in the FRESHLY
 * re-derived roster candidate set. This is a genuinely different signal
 * from `server/workers/sweep-escalation.worker.ts`'s escalation ladder
 * (which answers "sweep isn't done, who's on the hook now") — this port
 * answers "the assigned coordinator appears to have left roster, should
 * someone else be assigned." The two are not conflated; neither file is
 * modified by this port (read-only reuse of `resolveShiftCoordinator`).
 *
 * Off-roster signal (Task 1.1 plan §3, step 3 / spike-plan phrasing):
 *   persisted.coordinatorUserId NOT IN freshCandidates
 *   AND (persisted.escalationStage < 3 OR persisted.coordinatorUserId !== persisted.currentResponsibleUserId)
 * No persisted row, or the persisted coordinator is still a fresh
 * candidate → no signal. The second conjunct exists so a coordinator id
 * that escalation has ALREADY transferred to (stage 3, source
 * `fallback_senior`, `coordinatorUserId` rewritten to the responsible
 * senior — see `sweep-escalation.worker.ts`'s `fireEscalationStage`) is not
 * re-flagged as a *separate* off-roster problem; escalation already handled
 * it. If stage 3 was reached but the stored `coordinatorUserId` still
 * differs from `currentResponsibleUserId`, the drift is still real and is
 * still flagged.
 *
 * Every query is `clinicId`-scoped (CLAUDE.md multi-tenancy rule) — a
 * lookup under the wrong clinic returns no persisted row and no signal,
 * never a cross-tenant leak.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, shifts, shiftEquipmentCoordinator } from "../../db.js";
import { resolveShiftCoordinator, type CoordinatorCandidate } from "../../services/equipment-coordinator.service.js";
import type { ShiftEquipmentCoordinatorRow } from "../../schema/ops.js";

export interface CoordinatorRosterRow {
  id: string;
  employeeName: string;
}

export interface CoordinatorRosterReadResult {
  offRoster: boolean;
  persistedRow: ShiftEquipmentCoordinatorRow | null;
  candidates: CoordinatorCandidate[];
  seniorTechUserId: string | null;
  rosterRows: CoordinatorRosterRow[];
}

export interface CoordinatorRosterReader {
  read(clinicId: string, shiftDate: string): Promise<CoordinatorRosterReadResult>;
}

function computeOffRoster(
  persistedRow: ShiftEquipmentCoordinatorRow | null,
  candidates: readonly CoordinatorCandidate[],
): boolean {
  if (!persistedRow) return false;

  const stillCandidate = candidates.some((c) => c.userId === persistedRow.coordinatorUserId);
  if (stillCandidate) return false;

  const alreadyTransferredToSamePerson =
    persistedRow.escalationStage >= 3 && persistedRow.coordinatorUserId === persistedRow.currentResponsibleUserId;
  return !alreadyTransferredToSamePerson;
}

export class DrizzleCoordinatorRosterReader implements CoordinatorRosterReader {
  async read(clinicId: string, shiftDate: string): Promise<CoordinatorRosterReadResult> {
    const [persistedRows, rosterRows, resolution] = await Promise.all([
      db
        .select()
        .from(shiftEquipmentCoordinator)
        .where(and(eq(shiftEquipmentCoordinator.clinicId, clinicId), eq(shiftEquipmentCoordinator.shiftDate, shiftDate)))
        .limit(1),
      db
        .select({ id: shifts.id, employeeName: shifts.employeeName })
        .from(shifts)
        .where(and(eq(shifts.clinicId, clinicId), eq(shifts.date, shiftDate)))
        .orderBy(asc(shifts.startTime)),
      resolveShiftCoordinator(clinicId, shiftDate),
    ]);

    const persistedRow = persistedRows[0] ?? null;

    return {
      offRoster: computeOffRoster(persistedRow, resolution.candidates),
      persistedRow,
      candidates: resolution.candidates,
      seniorTechUserId: resolution.seniorTechUserId,
      rosterRows,
    };
  }
}

export interface InMemoryCoordinatorRosterReaderSeed {
  persistedRows?: ShiftEquipmentCoordinatorRow[];
  /** Keyed `${clinicId}::${shiftDate}`. */
  rosterRows?: Record<string, CoordinatorRosterRow[]>;
  /** Keyed `${clinicId}::${shiftDate}` — stands in for a real `resolveShiftCoordinator` call. */
  resolutions?: Record<string, { candidates: CoordinatorCandidate[]; seniorTechUserId: string | null }>;
}

/** Test fake — mirrors the real reader's `clinicId`-scoping: a row seeded under a different clinic is never returned. */
export class InMemoryCoordinatorRosterReader implements CoordinatorRosterReader {
  constructor(private readonly seed: InMemoryCoordinatorRosterReaderSeed = {}) {}

  async read(clinicId: string, shiftDate: string): Promise<CoordinatorRosterReadResult> {
    const key = `${clinicId}::${shiftDate}`;
    const persistedRow =
      (this.seed.persistedRows ?? []).find((r) => r.clinicId === clinicId && r.shiftDate === shiftDate) ?? null;
    const rosterRows = this.seed.rosterRows?.[key] ?? [];
    const resolution = this.seed.resolutions?.[key] ?? { candidates: [], seniorTechUserId: null };

    return {
      offRoster: computeOffRoster(persistedRow, resolution.candidates),
      persistedRow,
      candidates: resolution.candidates,
      seniorTechUserId: resolution.seniorTechUserId,
      rosterRows,
    };
  }
}
