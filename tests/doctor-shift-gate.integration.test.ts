/**
 * Doctor shift gate (spec 2026-08-13) — real-DB round-trip (Task 14).
 *
 * Exercises the whole gate against a live Postgres: a plain vet opens a
 * doctor team role with an EMPTY allowlist (team roles bypass it), an
 * eligible vet claims senior, a non-eligible vet is 403-blocked from senior,
 * replace-senior demotes the previous senior in place (row stays open),
 * `buildBoardResponsibles` aggregates the resulting board block, and the
 * 14 h `sweepExpiredDoctorCheckIns` closes ONLY doctor-team rows — a
 * technician check-in aged identically stays open.
 *
 * Requires DATABASE_URL + migrations applied (181/182/183/184); skips
 * cleanly otherwise. Registered in vitest.db-integration.config.ts
 * (allowlist-only discovery).
 *
 * Run: DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack \
 *   pnpm exec vitest run --config vitest.db-integration.config.ts \
 *   tests/doctor-shift-gate.integration.test.ts
 *
 * `logAudit` is mocked: vt_audit_logs is append-only with a RESTRICT FK to
 * vt_clinics — real audit rows would make the throwaway clinic undeletable
 * (see reference_audit_log_append_only).
 */
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { and, eq, isNull, inArray } from "drizzle-orm";

const logAuditMock = vi.fn();
vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return {
    ...actual,
    logAudit: (...args: unknown[]) => {
      logAuditMock(...args);
      return Promise.resolve();
    },
  };
});

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
  } catch (err) {
    console.warn(
      "[doctor-shift-gate.integration.test] DB probe failed — suite will skip:",
      err,
    );
    dbReachable = false;
  }
}

/** Deterministic checkedInAt ordering: rows land in distinct statements, but
 *  a short gap guarantees strictly increasing timestamps for the board sort. */
const tick = () => new Promise((r) => setTimeout(r, 15));

describe.skipIf(!dbReachable)("doctor shift gate integration (real DB)", () => {
  const CLINIC_ID = "doctor-gate-clinic-test";
  const PLAIN_VET_ID = "doctor-gate-plain-vet-test";
  const ELIGIBLE_VET_A_ID = "doctor-gate-eligible-vet-a-test";
  const ELIGIBLE_VET_B_ID = "doctor-gate-eligible-vet-b-test";
  const LEGACY_VET_ID = "doctor-gate-legacy-vet-test";
  const TECH_ID = "doctor-gate-tech-test";

  beforeEach(async () => {
    // Test independence: every test starts with NO open check-ins for the
    // fixture clinic — no test may rely on a prior test's sweep or close.
    await probePool?.query(
      `UPDATE vt_clinical_check_ins
       SET checked_out_at = now(), check_out_reason = 'self'
       WHERE clinic_id = $1 AND checked_out_at IS NULL`,
      [CLINIC_ID],
    );
  });

  afterAll(async () => {
    // FK-safe teardown, children first (vt_clinical_check_ins RESTRICTs both
    // vt_users and vt_clinics).
    try {
      await probePool?.query(`DELETE FROM vt_clinical_check_ins WHERE clinic_id = $1`, [CLINIC_ID]);
      await probePool?.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [CLINIC_ID]);
      await probePool?.query(`DELETE FROM vt_clinics WHERE id = $1`, [CLINIC_ID]);
    } catch (err) {
      console.warn(`[doctor-shift-gate.integration.test] cleanup failed for ${CLINIC_ID}`, err);
    }
    await probePool?.end();
  });

  it("round-trips open/senior/replace/responsibles/expiry against the real schema", async () => {
    const { db, clinics, users, clinicalCheckIns } = await import("../server/db.js");
    const { openCheckIn, ClinicalCheckInError } = await import(
      "../server/services/clinical-check-in.js"
    );
    const { buildBoardResponsibles } = await import(
      "../server/services/board-responsibles.service.js"
    );
    const { sweepExpiredDoctorCheckIns, DOCTOR_CHECKIN_EXPIRY_HOURS } = await import(
      "../server/workers/doctorCheckInExpiryWorker.js"
    );

    // ---- Seed: throwaway clinic + three vets (one plain, two senior-eligible) + a technician.
    await db.insert(clinics).values({ id: CLINIC_ID }).onConflictDoNothing();
    await db
      .insert(users)
      .values([
        {
          id: PLAIN_VET_ID,
          clinicId: CLINIC_ID,
          clerkId: `${PLAIN_VET_ID}-clerk`,
          email: "plain-vet@doctor-gate.test",
          name: "Plain Vet",
          displayName: "Plain Vet",
          role: "vet",
          status: "active",
          // allowedOperationalRoles stays the default [] — the team-role
          // bypass is exactly what this seed proves.
        },
        {
          id: ELIGIBLE_VET_A_ID,
          clinicId: CLINIC_ID,
          clerkId: `${ELIGIBLE_VET_A_ID}-clerk`,
          email: "eligible-vet-a@doctor-gate.test",
          name: "Eligible Vet A",
          displayName: "Eligible Vet A",
          role: "vet",
          status: "active",
          seniorDoctorEligible: true,
        },
        {
          id: ELIGIBLE_VET_B_ID,
          clinicId: CLINIC_ID,
          clerkId: `${ELIGIBLE_VET_B_ID}-clerk`,
          email: "eligible-vet-b@doctor-gate.test",
          name: "Eligible Vet B",
          displayName: "Eligible Vet B",
          role: "vet",
          status: "active",
          seniorDoctorEligible: true,
        },
        {
          id: LEGACY_VET_ID,
          clinicId: CLINIC_ID,
          clerkId: `${LEGACY_VET_ID}-clerk`,
          email: "legacy-vet@doctor-gate.test",
          name: "Legacy Vet",
          displayName: "Legacy Vet",
          role: "vet",
          status: "active",
          // Admin-allowlisted for 'admission' — the pre-feature legacy path.
          // The expiry sweep must treat this user's admission rows as
          // potentially-legacy and never auto-expire them.
          allowedOperationalRoles: ["admission"],
        },
        {
          id: TECH_ID,
          clinicId: CLINIC_ID,
          clerkId: `${TECH_ID}-clerk`,
          email: "tech@doctor-gate.test",
          name: "Gate Tech",
          displayName: "Gate Tech",
          role: "technician",
          status: "active",
        },
      ])
      .onConflictDoNothing();

    const plainVetActor = {
      userId: PLAIN_VET_ID,
      email: "plain-vet@doctor-gate.test",
      clinicId: CLINIC_ID,
      role: "vet" as const,
    };
    const vetAActor = {
      userId: ELIGIBLE_VET_A_ID,
      email: "eligible-vet-a@doctor-gate.test",
      clinicId: CLINIC_ID,
      role: "vet" as const,
    };
    const vetBActor = {
      userId: ELIGIBLE_VET_B_ID,
      email: "eligible-vet-b@doctor-gate.test",
      clinicId: CLINIC_ID,
      role: "vet" as const,
    };
    const techActor = {
      userId: TECH_ID,
      email: "tech@doctor-gate.test",
      clinicId: CLINIC_ID,
      role: "technician" as const,
    };

    // ---- 1. Plain vet opens 'icu' with an EMPTY allowlist — team roles bypass it.
    const plainOpen = await openCheckIn({ actor: plainVetActor, operationalRole: "icu" });
    expect(plainOpen.row.operationalRole).toBe("icu");
    expect(plainOpen.row.isSenior).toBe(false);
    expect(plainOpen.row.checkedOutAt).toBeNull();
    await tick();

    // ---- 2. Eligible vet A opens 'icu' as senior.
    const seniorOpenA = await openCheckIn({
      actor: vetAActor,
      operationalRole: "icu",
      isSenior: true,
    });
    expect(seniorOpenA.row.isSenior).toBe(true);
    expect(seniorOpenA.row.operationalRole).toBe("icu");
    await tick();

    // ---- 3. Plain vet's senior attempt is 403-blocked (server-checked eligibility).
    //         (Validation throws before any insert — the open-row unique index
    //         is never reached.)
    const notEligible = await openCheckIn({
      actor: plainVetActor,
      operationalRole: "icu",
      isSenior: true,
    }).then(
      () => null,
      (err) => err,
    );
    expect(notEligible).toBeInstanceOf(ClinicalCheckInError);
    expect(notEligible).toMatchObject({ status: 403, code: "SENIOR_NOT_ELIGIBLE" });

    // ---- 4a. Second eligible vet without replaceSenior → 409 with the current senior's name.
    const conflict = await openCheckIn({
      actor: vetBActor,
      operationalRole: "icu",
      isSenior: true,
    }).then(
      () => null,
      (err) => err,
    );
    expect(conflict).toMatchObject({
      status: 409,
      code: "SENIOR_ALREADY_ASSIGNED",
      metadata: { currentSeniorName: "Eligible Vet A" },
    });

    // ---- 4b. replaceSenior=true — vet A is demoted IN PLACE (row stays open), vet B is senior.
    const seniorOpenB = await openCheckIn({
      actor: vetBActor,
      operationalRole: "icu",
      isSenior: true,
      replaceSenior: true,
    });
    expect(seniorOpenB.row.isSenior).toBe(true);

    const [demotedA] = await db
      .select()
      .from(clinicalCheckIns)
      .where(
        and(
          eq(clinicalCheckIns.clinicId, CLINIC_ID),
          eq(clinicalCheckIns.id, seniorOpenA.row.id),
        ),
      )
      .limit(1);
    expect(demotedA?.isSenior).toBe(false);
    expect(demotedA?.checkedOutAt).toBeNull(); // stays open as a team member

    // The demotion audited doctor_senior_replaced (mocked sink).
    const replacedCalls = logAuditMock.mock.calls.filter(
      (c) => (c[0] as { actionType?: string })?.actionType === "doctor_senior_replaced",
    );
    expect(replacedCalls).toHaveLength(1);
    expect(replacedCalls[0][0]).toMatchObject({
      clinicId: CLINIC_ID,
      targetId: seniorOpenA.row.id,
    });

    // ---- 5. Board responsibles reflect the final state.
    const todayDate = new Date().toISOString().slice(0, 10);
    const responsibles = await buildBoardResponsibles({
      clinicId: CLINIC_ID,
      todayDate,
      currentShift: [{ employeeName: "Senior Tech Sara", role: "senior_technician" }],
    });
    expect(responsibles.doctors.icu.senior).toMatchObject({ name: "Eligible Vet B" });
    // Members sorted by since: plain vet checked in before the demoted vet A.
    expect(responsibles.doctors.icu.members.map((m) => m.name)).toEqual([
      "Plain Vet",
      "Eligible Vet A",
    ]);
    expect(responsibles.doctors.admission).toEqual({ senior: null, members: [] });
    expect(responsibles.doctors.internal_medicine).toEqual({ senior: null, members: [] });
    expect(responsibles.seniorTechnician).toEqual({ name: "Senior Tech Sara" });
    // Empty roster for the throwaway clinic → no coordinator, unresolved.
    expect(responsibles.equipmentCoordinator).toEqual({ name: null, status: "unresolved" });

    // ---- 6. Seed a technician check-in AND a legacy allowlisted-vet
    //         'admission' check-in, back-date ALL fixture rows past the 14h
    //         threshold, then sweep with the REAL clock: ONLY the three
    //         doctor-gate rows close (auto_expired); the technician row and
    //         the legacy admission row — aged identically — stay open.
    //         (No future-clock sweep: the clinic-agnostic UPDATE must not
    //         close every open check-in database-wide.)
    const techOpen = await openCheckIn({ actor: techActor });
    expect(techOpen.row.operationalRole).toBeNull();

    const legacyVetActor = {
      userId: LEGACY_VET_ID,
      email: "legacy-vet@doctor-gate.test",
      clinicId: CLINIC_ID,
      role: "vet" as const,
    };
    const legacyOpen = await openCheckIn({
      actor: legacyVetActor,
      operationalRole: "admission",
    });
    expect(legacyOpen.row.operationalRole).toBe("admission");
    // Immutable origin stamped at insert (migration 184): allowlisted vet's
    // admission row is 'legacy'; gate rows are 'doctor_gate'.
    expect(legacyOpen.row.checkInSource).toBe("legacy");
    expect(plainOpen.row.checkInSource).toBe("doctor_gate");
    expect(seniorOpenB.row.checkInSource).toBe("doctor_gate");

    // Back-date every fixture row past the threshold, then sweep at the real
    // now — only the intentionally-stale fixtures cross the 14h cutoff.
    const backdatedCheckIn = new Date(
      Date.now() - (DOCTOR_CHECKIN_EXPIRY_HOURS + 1) * 3_600_000,
    );
    await db
      .update(clinicalCheckIns)
      .set({ checkedInAt: backdatedCheckIn })
      .where(
        and(
          eq(clinicalCheckIns.clinicId, CLINIC_ID),
          inArray(clinicalCheckIns.id, [
            plainOpen.row.id,
            seniorOpenA.row.id,
            seniorOpenB.row.id,
            techOpen.row.id,
            legacyOpen.row.id,
          ]),
        ),
      );

    const { closedCount } = await sweepExpiredDoctorCheckIns();
    // The sweep is cross-clinic by design; other clinics in a shared dev DB
    // may contribute genuinely-stale rows — assert at-least on the global
    // count, exactly on ours.
    expect(closedCount).toBeGreaterThanOrEqual(3);

    const doctorRows = await db
      .select()
      .from(clinicalCheckIns)
      .where(
        and(
          eq(clinicalCheckIns.clinicId, CLINIC_ID),
          inArray(clinicalCheckIns.id, [
            plainOpen.row.id,
            seniorOpenA.row.id,
            seniorOpenB.row.id,
          ]),
        ),
      );
    expect(doctorRows).toHaveLength(3);
    for (const row of doctorRows) {
      expect(row.checkedOutAt).not.toBeNull();
      expect(row.checkOutReason).toBe("auto_expired");
    }

    const [techRow] = await db
      .select()
      .from(clinicalCheckIns)
      .where(
        and(
          eq(clinicalCheckIns.clinicId, CLINIC_ID),
          eq(clinicalCheckIns.userId, TECH_ID),
          isNull(clinicalCheckIns.checkedOutAt),
        ),
      )
      .limit(1);
    expect(techRow).toBeTruthy();
    expect(techRow?.id).toBe(techOpen.row.id);

    // Legacy-'admission' protection: the allowlisted vet's admission row was
    // stamped check_in_source='legacy' at insert — pre-feature semantics
    // could have produced it, so the clinic-agnostic sweep must never flip
    // its authority resolution (even though it is equally aged).
    const [legacyRow] = await db
      .select()
      .from(clinicalCheckIns)
      .where(
        and(
          eq(clinicalCheckIns.clinicId, CLINIC_ID),
          eq(clinicalCheckIns.id, legacyOpen.row.id),
        ),
      )
      .limit(1);
    expect(legacyRow?.checkedOutAt).toBeNull();

    // Per-row close side effects: every auto-expired row wrote a
    // clinical_check_out audit (system actor, source auto_expired).
    const expiryAudits = logAuditMock.mock.calls.filter(
      (c) =>
        (c[0] as { actionType?: string; metadata?: { source?: string } })?.actionType ===
          "clinical_check_out" &&
        (c[0] as { metadata?: { source?: string } })?.metadata?.source === "auto_expired",
    );
    expect(expiryAudits.length).toBeGreaterThanOrEqual(3);
    const auditedIds = expiryAudits.map((c) => (c[0] as { targetId?: string }).targetId);
    for (const id of [plainOpen.row.id, seniorOpenA.row.id, seniorOpenB.row.id]) {
      expect(auditedIds).toContain(id);
    }
  });

  it("adversarial review fixes: idempotent senior replay, atomic demote rollback, switch re-submit, DB senior backstop", async () => {
    const { db, clinicalCheckIns } = await import("../server/db.js");
    const { openCheckIn, switchOperationalRole } = await import(
      "../server/services/clinical-check-in.js"
    );

    const vetAActor = {
      userId: ELIGIBLE_VET_A_ID,
      email: "eligible-vet-a@doctor-gate.test",
      clinicId: CLINIC_ID,
      role: "vet" as const,
    };
    const vetBActor = {
      userId: ELIGIBLE_VET_B_ID,
      email: "eligible-vet-b@doctor-gate.test",
      clinicId: CLINIC_ID,
      role: "vet" as const,
    };

    // (beforeEach closed every open check-in for the clinic — vets start clean.)

    // ---- 1. Idempotent replay of a senior check-in: the retry must NOT
    //         self-409 (SENIOR_ALREADY_ASSIGNED naming the caller) and must
    //         NOT demote the caller's own just-inserted row.
    const first = await openCheckIn({
      actor: vetAActor,
      operationalRole: "icu",
      isSenior: true,
      idempotencyKey: "gate-retry-1",
    });
    expect(first.replayed).toBe(false);
    expect(first.row.isSenior).toBe(true);

    logAuditMock.mockClear();
    const retry = await openCheckIn({
      actor: vetAActor,
      operationalRole: "icu",
      isSenior: true,
      idempotencyKey: "gate-retry-1",
    });
    expect(retry.replayed).toBe(true);
    expect(retry.row.id).toBe(first.row.id);
    expect(retry.row.isSenior).toBe(true); // senior tag NOT silently stripped

    // Retry with replaceSenior=true (the designed 409-recovery path) must
    // also replay — not demote the caller's own row.
    const retryReplace = await openCheckIn({
      actor: vetAActor,
      operationalRole: "icu",
      isSenior: true,
      replaceSenior: true,
      idempotencyKey: "gate-retry-1",
    });
    expect(retryReplace.replayed).toBe(true);
    expect(retryReplace.row.isSenior).toBe(true);
    const bogusReplaceAudits = logAuditMock.mock.calls.filter(
      (c) => (c[0] as { actionType?: string })?.actionType === "doctor_senior_replaced",
    );
    expect(bogusReplaceAudits).toHaveLength(0);

    // ---- 2. Atomic demote: vet B already has an open check-in; a
    //         replace-senior attempt whose insert fails must roll the demote
    //         back — vet A stays senior, no false replacement.
    const bAdmission = await openCheckIn({ actor: vetBActor, operationalRole: "admission" });
    expect(bAdmission.row.checkedOutAt).toBeNull();

    logAuditMock.mockClear();
    const blocked = await openCheckIn({
      actor: vetBActor,
      operationalRole: "icu",
      isSenior: true,
      replaceSenior: true,
    }).then(
      () => null,
      (err) => err,
    );
    expect(blocked).toMatchObject({ status: 409, code: "ALREADY_CHECKED_IN" });

    const [aRow] = await db
      .select()
      .from(clinicalCheckIns)
      .where(
        and(eq(clinicalCheckIns.clinicId, CLINIC_ID), eq(clinicalCheckIns.id, first.row.id)),
      )
      .limit(1);
    expect(aRow?.isSenior).toBe(true); // demote rolled back with the failed insert
    expect(aRow?.checkedOutAt).toBeNull();
    const rolledBackAudits = logAuditMock.mock.calls.filter(
      (c) => (c[0] as { actionType?: string })?.actionType === "doctor_senior_replaced",
    );
    // The audit fired inside the rolled-back tx reached the (mocked) sink,
    // but the DB state above proves the demote itself did not survive.
    void rolledBackAudits;

    // ---- 3. Same-team senior re-submit through /switch must not 409 the
    //         caller against their own row.
    const switched = await switchOperationalRole({
      actor: vetAActor,
      operationalRole: "icu",
      isSenior: true,
    });
    expect(switched.row.isSenior).toBe(true);
    expect(switched.row.operationalRole).toBe("icu");
    const [oldRow] = await db
      .select()
      .from(clinicalCheckIns)
      .where(
        and(eq(clinicalCheckIns.clinicId, CLINIC_ID), eq(clinicalCheckIns.id, first.row.id)),
      )
      .limit(1);
    expect(oldRow?.checkOutReason).toBe("role_switch");

    // ---- 4. DB backstop: a second open senior row for the same team is
    //         rejected by ux_vt_clinical_check_ins_open_senior_per_team even
    //         when inserted outside the service path.
    const backstopErr = await db
      .insert(clinicalCheckIns)
      .values({
        id: "doctor-gate-backstop-row-test",
        clinicId: CLINIC_ID,
        userId: PLAIN_VET_ID,
        operationalRole: "icu",
        isSenior: true,
        clinicalRoleAtCheckIn: "vet",
        activeShiftId: null,
        shiftSessionId: null,
        clientId: null,
      })
      .then(
        () => null,
        (err) => err,
      );
    expect(backstopErr).not.toBeNull();
    const pgErr = backstopErr as {
      code?: string;
      constraint?: string;
      cause?: { code?: string; constraint?: string };
    };
    const code = pgErr.code ?? pgErr.cause?.code;
    const constraint = pgErr.constraint ?? pgErr.cause?.constraint;
    expect(code).toBe("23505");
    expect(constraint).toBe("ux_vt_clinical_check_ins_open_senior_per_team");
  });
});
