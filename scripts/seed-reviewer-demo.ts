/**
 * G3C-1 — App Store / Play reviewer demo account + synthetic live-shift seed.
 *
 * CODE ONLY. Does not touch production by itself — the owner runs this
 * against a target DATABASE_URL (see docs/runbooks/reviewer-demo-account.md).
 *
 * Produces, idempotently:
 *   1. A dedicated demo clinic.
 *   2. A least-privilege `vt_users` row (role "technician", status "active")
 *      keyed by `clerkId` — the same unique key the Clerk JIT-provisioning
 *      upsert in server/middleware/auth.ts targets, so this seed's
 *      role/status/clinicId values stay authoritative across the reviewer's
 *      first real sign-in (that upsert's `set` clause never touches role,
 *      status, or clinicId — see server/middleware/auth.ts).
 *   3. A run of full-day `vt_shifts` rows (today .. today+N-1) whose
 *      `employee_name` matches the user's `displayName` — the roster row
 *      `resolveCurrentRole` / `resolveAuthority` (server/lib/authority.ts,
 *      server/lib/role-resolution.ts — "Strategy A") match against to decide
 *      whether an account is "on shift". `vt_shifts` has no recurring
 *      concept, so this must be re-run to extend coverage past N days.
 *   4. Clinic furniture (rooms, docks, a folder) + equipment + tasks scoped
 *      to the demo clinic, so equipment/docking/task screens are non-empty.
 *
 * Every insert is clinicId-scoped (multi-tenancy rule) and every write is
 * `onConflictDoNothing` / `onConflictDoUpdate` — safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=... pnpm seed:reviewer-demo
 *   DATABASE_URL=... REVIEWER_DEMO_CLERK_ID=user_xxx pnpm seed:reviewer-demo
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  appointments,
  clinicalCheckIns,
  clinics,
  db,
  docks,
  equipment,
  folders,
  pool,
  rooms,
  shifts,
  users,
} from "../server/db.js";
import { isForbiddenProductionClinicId } from "../server/middleware/auth.js";

const DEFAULT_CLINIC_ID = "reviewer-demo-clinic";
const DEFAULT_CLERK_ID = "reviewer-demo-clerk-dev";
const DEFAULT_EMAIL = "reviewer-demo@vettrack.app";
const DEFAULT_DISPLAY_NAME = "App Review Demo";
const DEFAULT_SHIFT_SPAN_DAYS = 14;
/** Documented sane upper bound for shiftSpanDays — generous enough to cover
 * any realistic App Review cycle (see run-book Step 3) while keeping the
 * roster-row batch insert bounded. Number.isSafeInteger also rejects
 * Infinity/NaN/non-integers, which would otherwise loop forever building
 * shiftRows (see G3C-1 CodeRabbit PR #175 finding #3). */
const MAX_SHIFT_SPAN_DAYS = 90;
/** Guards against a typo'd/stale REVIEWER_DEMO_CLINIC_ID silently writing a
 * fake technician + roster + equipment into a REAL clinic (see G3C-1 review:
 * onConflictDoNothing on the clinic insert means a real clinicId would not
 * error, just get polluted). Override with { allowAnyClinicId: true } only
 * for a deliberate non-"demo"-named clinic. */
const DEMO_CLINIC_ID_PATTERN = /demo/i;

/** Roles accepted for `vt_users.role` (varchar) — the full permanent-role
 * vocabulary (server/lib/authority.ts ROLE_HIERARCHY). */
const VALID_USER_ROLES = new Set([
  "admin",
  "vet",
  "senior_technician",
  "lead_technician",
  "vet_tech",
  "technician",
  "student",
]);

/** Roles the `vt_shift_role` pgEnum can hold (server/schema/ops.ts) — the EZShift
 * roster vocabulary. A demo user whose target role is one of these gets a
 * matching active shift, so resolveCurrentRole derives effectiveRole FROM the
 * shift (role-resolution.ts:333). Roles OUTSIDE this set (vet, student, …) can
 * NOT be a roster shift role, and a shift with a "compatible" enum role would
 * silently override the displayed role downward — so those users get NO shift
 * and their effectiveRole correctly falls through to `vt_users.role`
 * (roleSource "permanent"), which is exactly how such a role appears in prod. */
type ShiftRole = "technician" | "senior_technician" | "admin";
function toShiftRole(role: string): ShiftRole | null {
  return role === "technician" || role === "senior_technician" || role === "admin" ? role : null;
}

/** Roles that resolve clinical authority via an OPEN vt_clinical_check_ins row
 * rather than a roster shift. Only `vet` qualifies today: it is an allow-listed
 * clinical-authority role (server/middleware/authority.ts VALID_ALLOW_ROLES =
 * {vet, senior_technician, technician}) that gets NO roster shift
 * (toShiftRole('vet') === null). senior_technician/technician already gain
 * authority from their seeded shift (Strategy A); `student` is a hard stop
 * (STUDENT_NEVER_ELEVATED) and admin/lead_technician/vet_tech are not Code Blue
 * clinical-authority roles — so none of them need, or get, a seeded check-in. */
function toClinicalCheckInRole(role: string): "vet" | null {
  return role === "vet" ? "vet" : null;
}

export interface SeedReviewerDemoOptions {
  clinicId?: string;
  clerkId?: string;
  email?: string;
  displayName?: string;
  now?: Date;
  /** Effective role to provision (default "technician"). Roster roles
   * (technician/senior_technician/admin) get a matching active shift so the
   * app resolves effectiveRole from the shift; vet/student/others are seeded
   * as permanent-only (no shift) — see ShiftRole above. */
  role?: string;
  /** How many consecutive full-day roster rows to lay down. Default 14. */
  shiftSpanDays?: number;
  /** Bypass the "clinicId must look like a demo clinic" guard. Default false. */
  allowAnyClinicId?: boolean;
}

export interface SeedReviewerDemoResult {
  clinicId: string;
  userId: string;
  clerkId: string;
  role: string;
  /** Id of the OPEN vt_clinical_check_ins row seeded for a `vet` persona (its
   * only path to clinical authority), or null for roster/permanent-role users. */
  checkInId: string | null;
  shiftIds: string[];
  roomIds: string[];
  dockIds: string[];
  equipmentIds: string[];
  taskIds: string[];
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function seedReviewerDemo(
  opts: SeedReviewerDemoOptions = {},
): Promise<SeedReviewerDemoResult> {
  const clinicId =
    opts.clinicId?.trim() || process.env.REVIEWER_DEMO_CLINIC_ID?.trim() || DEFAULT_CLINIC_ID;
  if (isForbiddenProductionClinicId(clinicId)) {
    throw new Error(
      `seedReviewerDemo: clinicId "${clinicId}" is reserved/blocked (see isForbiddenProductionClinicId).`,
    );
  }
  const allowAnyClinicId = opts.allowAnyClinicId ?? false;
  if (!allowAnyClinicId && !DEMO_CLINIC_ID_PATTERN.test(clinicId)) {
    throw new Error(
      `seedReviewerDemo: clinicId "${clinicId}" doesn't look like a demo clinic (expected it to ` +
        `contain "demo") — refusing to write a synthetic account/roster/equipment into what may be ` +
        `a real clinic. Pass { allowAnyClinicId: true } to override deliberately.`,
    );
  }
  const clerkId =
    opts.clerkId?.trim() || process.env.REVIEWER_DEMO_CLERK_ID?.trim() || DEFAULT_CLERK_ID;
  const email = opts.email?.trim() || process.env.REVIEWER_DEMO_EMAIL?.trim() || DEFAULT_EMAIL;
  const displayName =
    opts.displayName?.trim() || process.env.REVIEWER_DEMO_DISPLAY_NAME?.trim() || DEFAULT_DISPLAY_NAME;
  const role = opts.role?.trim() || process.env.REVIEWER_DEMO_ROLE?.trim() || "technician";
  if (!VALID_USER_ROLES.has(role)) {
    throw new Error(
      `seedReviewerDemo: role "${role}" is not a valid vt_users role ` +
        `(expected one of ${[...VALID_USER_ROLES].join(", ")}).`,
    );
  }
  const shiftRole = toShiftRole(role);
  const now = opts.now ?? new Date();
  const shiftSpanDays = opts.shiftSpanDays ?? DEFAULT_SHIFT_SPAN_DAYS;
  if (
    !Number.isSafeInteger(shiftSpanDays) ||
    shiftSpanDays <= 0 ||
    shiftSpanDays > MAX_SHIFT_SPAN_DAYS
  ) {
    throw new Error(
      `seedReviewerDemo: shiftSpanDays must be a positive safe integer <= ${MAX_SHIFT_SPAN_DAYS} ` +
        `(received ${shiftSpanDays}).`,
    );
  }

  // 1. Clinic.
  await db.insert(clinics).values({ id: clinicId }).onConflictDoNothing();

  // 2. Least-privilege demo user, keyed by clerkId (the JIT-upsert target).
  //    `id` is derived from `clerkId`, not `clinicId` — it MUST agree with
  //    the onConflictDoUpdate arbiter below (users.clerkId is the unique
  //    constraint). Deriving it from clinicId instead would let a re-run
  //    with a corrected/different clerkId for the same demo clinic collide
  //    on the vt_users primary key via the literal INSERT path (the
  //    ON CONFLICT target wouldn't match, so Postgres falls through to the
  //    insert, which then hits the id PK) instead of routing through the
  //    update — see G3C-1 database-reviewer finding.
  //
  //    HIJACK GUARD (CodeRabbit PR #175 Major #1): `users.clerkId` is
  //    globally unique, so a blind onConflictDoUpdate on clerkId would
  //    silently reassign an EXISTING operator's account into the demo
  //    clinic and downgrade role/status to technician/active if this seed
  //    is ever run with a clerkId that collides with a real user (typo,
  //    stale env var, copy-paste error). Read the existing row first and
  //    refuse to write unless it's absent or already the demo account for
  //    THIS clinic.
  const [existingByClerkId] = await db
    .select({ id: users.id, clinicId: users.clinicId })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (existingByClerkId && existingByClerkId.clinicId !== clinicId) {
    throw new Error(
      `seedReviewerDemo: clerkId "${clerkId}" is already assigned to clinic ` +
        `"${existingByClerkId.clinicId}" (user id ${existingByClerkId.id}) — refusing to hijack an ` +
        `existing account into "${clinicId}". If this really is the demo account being reassigned, ` +
        `update its clinicId manually first.`,
    );
  }

  const userId = `reviewer-demo-user-${clerkId}`;
  const [userRow] = await db
    .insert(users)
    .values({
      id: userId,
      clinicId,
      clerkId,
      email,
      name: displayName,
      displayName,
      role,
      status: "active",
      isEquipmentCoordinator: false,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        clinicId,
        email,
        name: displayName,
        displayName,
        role,
        status: "active",
      },
    })
    .returning({ id: users.id });
  const resolvedUserId = userRow?.id ?? userId;

  // 3. Synthetic live shift roster — full-day rows so the account resolves
  //    "on shift" via resolveAuthority regardless of time-of-day.
  //
  //    LOAD-BEARING COUPLING: `employeeName` below must normalized-match the
  //    user's `displayName` (role-resolution.ts prefers displayName || name,
  //    normalizeNameKey strips case/punctuation/whitespace). Do NOT switch
  //    this to match on `name` instead — a real Clerk sign-in overwrites
  //    `name` to the Clerk profile's name but the JIT upsert's CASE clause
  //    (server/middleware/auth.ts) preserves an already-set `displayName`,
  //    and this seed's own re-run re-asserts it — so `displayName` is the
  //    only field guaranteed stable across the reviewer's first real login.
  //    Dormant risk: shift rows are keyed on clinicId+date only, so
  //    FIXED (CodeRabbit PR #175 Major #2): shift rows are keyed on
  //    clinicId+date, so a plain onConflictDoNothing would leave an
  //    already-seeded day's `employeeName` stale if `displayName` changes on
  //    a later run — desyncing the roster-name match resolveAuthority relies
  //    on. Upsert on conflict instead so employeeName/role stay in sync.
  //    ROLE GATE: only roster roles (shiftRole !== null) get shift rows. A
  //    vet/student demo user is left off the roster on purpose so its
  //    effectiveRole resolves to the permanent `vt_users.role` instead of an
  //    enum-constrained shift role — see toShiftRole above.
  const shiftIds: string[] = [];
  if (shiftRole) {
    const shiftRows: (typeof shifts.$inferInsert)[] = [];
    for (let i = 0; i < shiftSpanDays; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const dateStr = toLocalDateString(d);
      const id = `reviewer-demo-shift-${clinicId}-${dateStr}`;
      shiftIds.push(id);
      shiftRows.push({
        id,
        clinicId,
        date: dateStr,
        startTime: "00:00:00",
        endTime: "23:59:59",
        employeeName: displayName,
        role: shiftRole,
      });
    }
    await db
      .insert(shifts)
      .values(shiftRows)
      .onConflictDoUpdate({
        target: shifts.id,
        set: { employeeName: displayName, role: shiftRole },
      });
  }

  // 3b. Open clinical check-in — the ONLY path to clinical authority for a
  //     `vet` demo persona. A vet is not a vt_shift_role enum value, so it gets
  //     no roster shift (toClinicalCheckInRole / toShiftRole above). Without an
  //     open vt_clinical_check_ins row, resolveAuthority returns EZSHIFT_NONE
  //     (effectiveClinicalRole = null) and the vet is 403-blocked at the Code
  //     Blue LOG gate (POST /api/code-blue/sessions/:id/logs) — which, unlike
  //     Start (POST /sessions), carries NO emergency break-glass. This row sets
  //     effectiveClinicalRole = "vet" via resolveAuthority's check-in branch.
  //
  //     CAVEAT (see docs/runbooks/code-blue-qa-walkthrough.md): resolveAuthority
  //     only consults this row when AUTHORITY_USE_CHECKIN_PATH=true on the target
  //     backend (server/lib/authority.ts isCheckInPathEnabled). With the flag
  //     off the row is ignored, Strategy A applies, and a shiftless vet is
  //     denied at Log again.
  //
  //     Guards: this runs only after the production-clinic + demo-name guards at
  //     the top of seedReviewerDemo have passed (they throw otherwise), and the
  //     row is clinicId+userId-scoped — so it inherits the same double-guard.
  //
  //     Idempotent: the partial unique index ux_vt_clinical_check_ins_open_per_user
  //     (clinicId, userId WHERE checked_out_at IS NULL) forbids two open rows per
  //     user. Read-then-insert with a fresh random id (so a historical checked-out
  //     row can never PK-collide) restores exactly one open row on re-run.
  let checkInId: string | null = null;
  const checkInRole = toClinicalCheckInRole(role);
  if (checkInRole) {
    const [existingOpen] = await db
      .select({ id: clinicalCheckIns.id })
      .from(clinicalCheckIns)
      .where(
        and(
          eq(clinicalCheckIns.clinicId, clinicId),
          eq(clinicalCheckIns.userId, resolvedUserId),
          isNull(clinicalCheckIns.checkedOutAt),
        ),
      )
      .limit(1);
    if (existingOpen) {
      checkInId = existingOpen.id;
    } else {
      checkInId = randomUUID();
      await db.insert(clinicalCheckIns).values({
        id: checkInId,
        clinicId,
        userId: resolvedUserId,
        clinicalRoleAtCheckIn: checkInRole,
        operationalRole: checkInRole,
        checkedOutAt: null,
      });
    }
  }

  // 4. Clinic furniture.
  const roomIds = [`${clinicId}-room-treatment`, `${clinicId}-room-surgery`];
  await db
    .insert(rooms)
    .values([
      { id: roomIds[0], clinicId, name: "Treatment Room 1" },
      { id: roomIds[1], clinicId, name: "Surgery Suite" },
    ])
    .onConflictDoNothing();

  const dockIds = [`${clinicId}-dock-1`, `${clinicId}-dock-2`];
  await db
    .insert(docks)
    .values([
      { id: dockIds[0], clinicId, name: "Dock A", roomId: roomIds[0] },
      { id: dockIds[1], clinicId, name: "Dock B", roomId: roomIds[1] },
    ])
    .onConflictDoNothing();

  const folderId = `${clinicId}-folder-general`;
  await db
    .insert(folders)
    .values({ id: folderId, clinicId, name: "General Equipment", type: "manual" })
    .onConflictDoNothing();

  // 5. Equipment.
  const equipmentSeeds = [
    { id: `${clinicId}-eq-monitor`, name: "Patient Monitor", status: "ok", roomId: roomIds[0] },
    { id: `${clinicId}-eq-pump`, name: "Infusion Pump", status: "ok", roomId: roomIds[0] },
    { id: `${clinicId}-eq-xray`, name: "Digital X-Ray", status: "ok", roomId: roomIds[1] },
    { id: `${clinicId}-eq-anesthesia`, name: "Anesthesia Machine", status: "maintenance", roomId: roomIds[1] },
  ];
  const equipmentIds = equipmentSeeds.map((e) => e.id);
  await db
    .insert(equipment)
    .values(
      equipmentSeeds.map((e) => ({
        id: e.id,
        clinicId,
        name: e.name,
        status: e.status,
        folderId,
        roomId: e.roomId,
        lastSeen: now,
        lastStatus: e.status,
        custodyState: "returned",
        custodyStateSince: now,
        readinessState: "ready",
        readinessStateSince: now,
      })),
    )
    .onConflictDoNothing();

  // 6. Tasks, assigned to the demo user so "my tasks" surfaces are populated too.
  const taskSeeds = [
    { id: `${clinicId}-task-1`, offsetMinutes: 30, notes: "Morning equipment check" },
    { id: `${clinicId}-task-2`, offsetMinutes: 90, notes: "Restock treatment room" },
  ];
  const taskIds = taskSeeds.map((t) => t.id);
  await db
    .insert(appointments)
    .values(
      taskSeeds.map((t) => {
        const start = new Date(now.getTime() + t.offsetMinutes * 60_000);
        const end = new Date(start.getTime() + 30 * 60_000);
        return {
          id: t.id,
          clinicId,
          vetId: resolvedUserId,
          startTime: start,
          endTime: end,
          scheduledAt: start,
          status: "scheduled",
          appointmentType: "maintenance",
          notes: t.notes,
          priority: "normal",
          taskType: "maintenance",
        };
      }),
    )
    .onConflictDoNothing();

  return {
    clinicId,
    userId: resolvedUserId,
    clerkId,
    role,
    checkInId,
    shiftIds,
    roomIds,
    dockIds,
    equipmentIds,
    taskIds,
  };
}

const isMainModule =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  seedReviewerDemo()
    .then((result) => {
      console.info("[seed-reviewer-demo] Done.");
      console.info(`  clinicId  : ${result.clinicId}`);
      console.info(`  userId    : ${result.userId} (clerkId=${result.clerkId})`);
      console.info(`  role      : ${result.role}`);
      console.info(
        `  shifts    : ${result.shiftIds.length} day(s) seeded` +
          (result.shiftIds.length === 0 ? " (permanent-role account — no roster shift)" : ""),
      );
      console.info(
        `  check-in  : ${
          result.checkInId
            ? `open (id=${result.checkInId}) — grants Code Blue Log authority when AUTHORITY_USE_CHECKIN_PATH=true`
            : "none (roster/permanent-role account)"
        }`,
      );
      console.info(`  rooms     : ${result.roomIds.length}, docks: ${result.dockIds.length}`);
      console.info(`  equipment : ${result.equipmentIds.length}`);
      console.info(`  tasks     : ${result.taskIds.length}`);
    })
    .catch((err) => {
      console.error("[seed-reviewer-demo] Failed:", err);
      process.exitCode = 1;
    })
    .finally(() => {
      pool.end().catch((err) => {
        console.error("[seed-reviewer-demo] pool shutdown failed:", err);
        process.exitCode = 1;
      });
    });
}
