/**
 * Docking P3 T3.4-i-a — Equipment Coordinator per-shift derivation.
 *
 * Three separated concerns (design, owner-confirmed):
 *  - Eligibility (who's qualified): the static `vt_users.is_equipment_coordinator`
 *    flag, manager-set.
 *  - Assignment (which qualified tech THIS shift): derived here from
 *    roster ∩ eligibility.
 *  - Escalation (what happens when nobody confirms) is a LATER task
 *    (T3.4-ii) — not built here.
 *
 * Roster↔user mapping reuses role-resolution.ts's exact normalized-name
 * match (`normalizeName`/`normalizeNameKey`) — `vt_shifts` rows carry only
 * `employeeName` text, no `userId`, and this is the one mechanism the app
 * already uses to bridge that gap (`resolveCurrentRole`'s shift-match).
 */
import { randomUUID } from "crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, shifts, users, shiftEquipmentCoordinator } from "../db.js";
import { normalizeName, normalizeNameKey } from "../lib/role-resolution.js";
import { mapLegacyRoleToClinicalRole } from "../lib/authority-roles.js";

export type CoordinatorStatus = "auto" | "confirmed" | "fallback_senior" | "needs_confirmation" | "unresolved";

export interface CoordinatorCandidate {
  userId: string;
  name: string;
}

export interface CoordinatorResolution {
  coordinatorUserId: string | null;
  status: CoordinatorStatus;
  candidates: CoordinatorCandidate[];
  seniorTechUserId: string | null;
}

interface MatchedOnShift {
  userId: string;
  name: string;
  shiftRole: string;
  permanentRole: string;
  isEquipmentCoordinator: boolean;
}

/**
 * Matches this shift-date's roster rows to `vt_users` by normalized name,
 * deduping to one entry per matched user (first shift row wins, in
 * start-time order, for determinism when someone is double-booked).
 */
async function matchOnShiftUsers(clinicId: string, shiftDate: string): Promise<MatchedOnShift[]> {
  const [shiftRows, clinicUsers] = await Promise.all([
    db
      .select({ employeeName: shifts.employeeName, role: shifts.role })
      .from(shifts)
      .where(and(eq(shifts.clinicId, clinicId), eq(shifts.date, shiftDate)))
      .orderBy(asc(shifts.startTime)),
    db
      .select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        role: users.role,
        isEquipmentCoordinator: users.isEquipmentCoordinator,
      })
      .from(users)
      .where(and(eq(users.clinicId, clinicId), isNull(users.deletedAt))),
  ]);

  const usersByKey = new Map<string, (typeof clinicUsers)[number]>();
  for (const u of clinicUsers) {
    const key = normalizeNameKey(normalizeName(u.displayName || u.name || ""));
    if (key) usersByKey.set(key, u);
  }

  const matchedById = new Map<string, MatchedOnShift>();
  for (const shift of shiftRows) {
    const key = normalizeNameKey(normalizeName(shift.employeeName));
    if (!key) continue;
    const user = usersByKey.get(key);
    if (!user || matchedById.has(user.id)) continue;
    matchedById.set(user.id, {
      userId: user.id,
      name: user.displayName || user.name,
      shiftRole: shift.role,
      permanentRole: user.role,
      isEquipmentCoordinator: user.isEquipmentCoordinator,
    });
  }

  return Array.from(matchedById.values());
}

/** `lead_technician` aliases to `senior_technician` (server/lib/authority-roles.ts). */
function isSeniorTech(u: MatchedOnShift): boolean {
  return u.shiftRole === "senior_technician" || mapLegacyRoleToClinicalRole(u.permanentRole) === "senior_technician";
}

/**
 * Derives this shift's Equipment Coordinator (clinic-scoped, read-mostly —
 * only reads `vt_shift_equipment_coordinator`, never writes it).
 *
 * 1. Match roster rows for (clinicId, shiftDate) to users by normalized name.
 * 2. eligible = matched on-shift users with isEquipmentCoordinator === true.
 *    seniorTech = the matched on-shift senior-tech-or-equivalent (alphabetical
 *    tie-break for determinism when more than one is on shift).
 * 3. A stored confirmation wins outright → "confirmed".
 * 4. Exactly one eligible → "auto".
 * 5. Zero eligible → "fallback_senior" (or "unresolved" if no senior either).
 * 6. More than one eligible, nothing stored → "needs_confirmation".
 */
export async function resolveShiftCoordinator(
  clinicId: string,
  shiftDate: string,
  // Reserved for a future point-in-time / TTL read; unused today — every
  // signal this resolver reads (roster, eligibility, stored confirmation)
  // is already scoped to `shiftDate`, not to "now".
  now?: Date,
): Promise<CoordinatorResolution> {
  void now;

  const onShift = await matchOnShiftUsers(clinicId, shiftDate);

  const eligible = onShift.filter((u) => u.isEquipmentCoordinator);
  const candidates: CoordinatorCandidate[] = eligible.map((u) => ({ userId: u.userId, name: u.name }));

  const seniorCandidates = onShift.filter(isSeniorTech).sort((a, b) => a.name.localeCompare(b.name));
  const seniorTechUserId = seniorCandidates[0]?.userId ?? null;

  const [stored] = await db
    .select()
    .from(shiftEquipmentCoordinator)
    .where(and(eq(shiftEquipmentCoordinator.clinicId, clinicId), eq(shiftEquipmentCoordinator.shiftDate, shiftDate)))
    .limit(1);

  if (stored) {
    return { coordinatorUserId: stored.coordinatorUserId, status: "confirmed", candidates, seniorTechUserId };
  }

  if (eligible.length === 1) {
    return { coordinatorUserId: eligible[0].userId, status: "auto", candidates, seniorTechUserId };
  }

  if (eligible.length === 0) {
    return seniorTechUserId
      ? { coordinatorUserId: seniorTechUserId, status: "fallback_senior", candidates, seniorTechUserId }
      : { coordinatorUserId: null, status: "unresolved", candidates, seniorTechUserId: null };
  }

  return { coordinatorUserId: null, status: "needs_confirmation", candidates, seniorTechUserId };
}

export interface ConfirmCoordinatorInput {
  clinicId: string;
  shiftDate: string;
  coordinatorUserId: string;
  assignedByUserId: string;
}

export type ConfirmCoordinatorResult =
  | { ok: true; row: typeof shiftEquipmentCoordinator.$inferSelect }
  | { ok: false; reason: "not_eligible" };

/**
 * Confirms (or reassigns) this shift's coordinator. The caller must have
 * already authorized the request (senior tech on that shift, or admin) —
 * this function only re-validates that `coordinatorUserId` is in the
 * currently eligible-on-shift set, so a stale client can't pin an
 * ineligible or off-shift user. `resolution` may be passed in when the
 * caller already resolved it (e.g. for the authorization check) to avoid a
 * redundant derivation pass.
 */
export async function confirmShiftCoordinator(
  input: ConfirmCoordinatorInput,
  resolution?: CoordinatorResolution,
): Promise<ConfirmCoordinatorResult> {
  const resolved = resolution ?? (await resolveShiftCoordinator(input.clinicId, input.shiftDate));

  if (!resolved.candidates.some((c) => c.userId === input.coordinatorUserId)) {
    return { ok: false, reason: "not_eligible" };
  }

  const [row] = await db
    .insert(shiftEquipmentCoordinator)
    .values({
      id: randomUUID(),
      clinicId: input.clinicId,
      shiftDate: input.shiftDate,
      coordinatorUserId: input.coordinatorUserId,
      source: "confirmed",
      assignedByUserId: input.assignedByUserId,
    })
    .onConflictDoUpdate({
      target: [shiftEquipmentCoordinator.clinicId, shiftEquipmentCoordinator.shiftDate],
      set: {
        coordinatorUserId: input.coordinatorUserId,
        source: "confirmed",
        assignedByUserId: input.assignedByUserId,
      },
    })
    .returning();

  if (!row) throw new Error("confirmShiftCoordinator: insert returned no row");
  return { ok: true, row };
}
