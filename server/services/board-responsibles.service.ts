/**
 * Doctor shift gate (spec 2026-08-13) — board `responsibles` section.
 *
 * Read-only aggregation for the ward-board snapshot: doctor teams from open
 * clinical check-ins (Task 3's team roles + is_senior), the roster-derived
 * senior technician (pass-through from the snapshot's currentShift), and the
 * per-shift Equipment Coordinator via the existing resolver. Additive — the
 * snapshot handler wraps the call in withTimeout and degrades to `null` on
 * failure, never 500.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, clinicalCheckIns, users } from "../db.js";
import { DOCTOR_TEAM_ROLES, type DoctorTeamRole } from "./clinical-check-in.js";
import {
  resolveShiftCoordinator,
  type CoordinatorStatus,
} from "./equipment-coordinator.service.js";

export type ResponsibleEntry = { name: string; since: string };
export type DoctorTeamBlock = { senior: ResponsibleEntry | null; members: ResponsibleEntry[] };
export type BoardResponsibles = {
  doctors: { icu: DoctorTeamBlock; admission: DoctorTeamBlock; internal_medicine: DoctorTeamBlock };
  seniorTechnician: { name: string } | null;
  equipmentCoordinator: { name: string | null; status: CoordinatorStatus };
};

function emptyBlock(): DoctorTeamBlock {
  return { senior: null, members: [] };
}

export async function buildBoardResponsibles(args: {
  clinicId: string;
  todayDate: string; // YYYY-MM-DD, already computed in the snapshot handler
  currentShift: Array<{ employeeName: string; role: string }>;
}): Promise<BoardResponsibles> {
  const { clinicId, todayDate, currentShift } = args;

  // Doctors — open check-ins on the three team roles, oldest first so member
  // lists come out sorted by `since` without a client-side re-sort.
  const doctorRows = await db
    .select({
      operationalRole: clinicalCheckIns.operationalRole,
      isSenior: clinicalCheckIns.isSenior,
      checkedInAt: clinicalCheckIns.checkedInAt,
      userName: users.name,
      userDisplayName: users.displayName,
    })
    .from(clinicalCheckIns)
    .leftJoin(users, and(eq(clinicalCheckIns.userId, users.id), eq(users.clinicId, clinicId)))
    .where(
      and(
        eq(clinicalCheckIns.clinicId, clinicId),
        isNull(clinicalCheckIns.checkedOutAt),
        inArray(clinicalCheckIns.operationalRole, [...DOCTOR_TEAM_ROLES]),
      ),
    )
    .orderBy(asc(clinicalCheckIns.checkedInAt));

  const doctors: BoardResponsibles["doctors"] = {
    icu: emptyBlock(),
    admission: emptyBlock(),
    internal_medicine: emptyBlock(),
  };
  for (const row of doctorRows) {
    const role = row.operationalRole as DoctorTeamRole | null;
    if (!role || !(role in doctors)) continue;
    const name = row.userDisplayName?.trim() || row.userName?.trim() || "";
    const entry: ResponsibleEntry = { name, since: row.checkedInAt.toISOString() };
    const block = doctors[role];
    // Service-level replace semantics keep at most one open senior per team;
    // if data ever drifts, first (oldest) wins and the rest render as members.
    if (row.isSenior && !block.senior) {
      block.senior = entry;
    } else {
      block.members.push(entry);
    }
  }

  // Senior technician — roster-derived pass-through (same source the board
  // already renders as currentShift; no extra query).
  const seniorShiftRow = currentShift.find((s) => s.role === "senior_technician");
  const seniorTechnician = seniorShiftRow ? { name: seniorShiftRow.employeeName } : null;

  // Equipment coordinator — existing per-shift resolver; name resolution
  // mirrors server/routes/docking.ts (candidates first, clinic-scoped user
  // lookup as fallback).
  const resolution = await resolveShiftCoordinator(clinicId, todayDate);
  let coordinatorName: string | null = null;
  if (resolution.coordinatorUserId) {
    const fromCandidates = resolution.candidates.find(
      (c) => c.userId === resolution.coordinatorUserId,
    );
    if (fromCandidates) {
      coordinatorName = fromCandidates.name;
    } else {
      const [row] = await db
        .select({ name: users.name, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.clinicId, clinicId), eq(users.id, resolution.coordinatorUserId)))
        .limit(1);
      coordinatorName = row?.displayName || row?.name || null;
    }
  }

  return {
    doctors,
    seniorTechnician,
    equipmentCoordinator: { name: coordinatorName, status: resolution.status },
  };
}
