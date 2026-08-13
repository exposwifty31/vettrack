# Doctor Shift Gate + Board Responsibles — vettrack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vet-role users self-declare "on shift" with a team (ICU / admission / internal medicine) and optional senior status via the existing clinical check-in mechanism, and the ward board's `/api/display/snapshot` gains a `responsibles` section (doctor teams + senior technician + equipment coordinator).

**Architecture:** Four additive migrations (users eligibility flag, check-ins `is_senior`, open-senior partial unique index, check-ins `check_in_source` provenance), extension of the existing `openCheckIn` vet branch (three new universally-allowed doctor team roles + server-validated senior semantics with per-team replace), a doctor-only 14 h auto-expiry sweep keyed on `check_in_source='doctor_gate'` (migration 184 — the sweep's targeting column), an additive `responsibles` key on the display snapshot, and client work (gate popup in NativeShell, admin checkbox, board panel). Provenance for the ambiguous `admission` role is request-declared: the gate client sends `source: "doctor_gate"` (zod literal on the check-in/switch body), classified once at insert; requests without it stamp `legacy` and are never auto-expired. Spec: `docs/superpowers/specs/2026-08-13-doctor-shift-gate-design.md`.

**Tech Stack:** Express + Drizzle + PostgreSQL, hand-authored SQL migrations, vitest (mocked-db unit tests + db-integration config), React 18 + TanStack Query + shadcn primitives, typed i18n (he/en).

## Global Constraints

- Every DB query filters by `clinicId`. No exceptions.
- Additive only: no behavior change for technicians' check-ins, no authority-envelope change, no new realtime events, snapshot stays never-cached. Phase B (off-shift permission demotion) is OUT of scope.
- Doctor team role values (exact strings): `icu`, `admission`, `internal_medicine`. `admission` already exists in `OPERATIONAL_ROLES` — it becomes universally-allowed for vets; legacy values (`ward`, `senior_lead`, `night_*`) keep allowlist semantics.
- Auto-expiry: doctor check-ins only, threshold **14 hours**, `checkOutReason='auto_expired'`.
- All user-facing copy via typed `t.*`; keys added to BOTH `locales/he.json` and `locales/en.json` AND to `buildTranslations` in `src/lib/i18n.ts` (hand-built accessor — JSON alone does nothing).
- New audit kinds must be added to the `AuditActionType` union in `server/lib/audit.ts` — never log a string outside the union.
- Migrations are hand-authored (drizzle-kit snapshot is drifted), numbered `181_…`, `182_…`, `183_…`, `184_…`, idempotent (`ADD COLUMN IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`). Migration `183_vt_clinical_check_ins_open_senior_unique.sql` (partial unique index `ux_vt_clinical_check_ins_open_senior_per_team` on `(clinic_id, operational_role) WHERE is_senior AND checked_out_at IS NULL`) is the DB backstop for one-open-senior-per-team — the service's check-then-act SELECT cannot stop two concurrent `isSenior` claims, so the service maps the index's 23505 to `SENIOR_ALREADY_ASSIGNED`. Verify with: `psql "$DATABASE_URL" -c "\di ux_vt_clinical_check_ins_open_senior_per_team"` → index listed as partial unique. Migration `184_vt_clinical_check_ins_check_in_source.sql` (`check_in_source varchar(20) NOT NULL DEFAULT 'legacy'`, backfilling pre-existing `icu`/`internal_medicine` rows to `'doctor_gate'`) is the expiry worker's targeting column — `sweepExpiredDoctorCheckIns` closes only `check_in_source = 'doctor_gate'` rows, so `legacy` rows (technicians, legacy-role vets, and `admission` check-ins opened without the gate's `source: "doctor_gate"` declaration) are untouchable by construction. Verify with: `psql "$DATABASE_URL" -c "\d vt_clinical_check_ins" | grep check_in_source` → column listed, `not null`, `default 'legacy'`.
- Commit after every task. `pnpm typecheck` must be clean before every commit.

---

### Task 1: Migration 181 + schema — `vt_users.senior_doctor_eligible`

**Files:**
- Create: `migrations/181_vt_users_senior_doctor_eligible.sql`
- Modify: `server/schema/core.ts` (after `isEquipmentCoordinator`, ~L50)

**Interfaces:**
- Produces: `users.seniorDoctorEligible: boolean NOT NULL DEFAULT false` — consumed by Tasks 3, 6.

- [ ] **Step 1: Write the migration**

```sql
-- 181_vt_users_senior_doctor_eligible.sql
-- Doctor shift gate (spec 2026-08-13): admin-set eligibility to claim the
-- per-team "senior" tag at check-in. Mirrors is_equipment_coordinator.
ALTER TABLE vt_users
  ADD COLUMN IF NOT EXISTS senior_doctor_eligible boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Add the Drizzle column** in `server/schema/core.ts`, directly after `isEquipmentCoordinator` (mirror its JSDoc style):

```ts
  /**
   * Doctor shift gate: static, admin-set eligibility to mark oneself as the
   * responsible senior of a doctor team at check-in. Which team a senior
   * leads is chosen per check-in, never stored here. Distinct from
   * `secondaryRole` (account RBAC — never consulted by the clinical path).
   */
  seniorDoctorEligible: boolean("senior_doctor_eligible").notNull().default(false),
```

- [ ] **Step 3: Apply + verify**

Run: `pnpm db:migrate && psql "$DATABASE_URL" -c "\d vt_users" | grep senior_doctor_eligible`
Expected: column listed, `not null`, `default false`. Then `pnpm typecheck` → clean.

- [ ] **Step 4: Commit** — `git add migrations/181_* server/schema/core.ts && git commit -m "feat(db): senior_doctor_eligible flag on vt_users (doctor shift gate)"`

---

### Task 2: Migration 182 + schema — `vt_clinical_check_ins.is_senior`

**Files:**
- Create: `migrations/182_vt_clinical_check_ins_is_senior.sql`
- Modify: `server/schema/ops.ts` (clinicalCheckIns table, after `operationalRole` ~L431)

**Interfaces:**
- Produces: `clinicalCheckIns.isSenior: boolean NOT NULL DEFAULT false` — consumed by Tasks 3, 5, 7, 8.

- [ ] **Step 1: Write the migration**

```sql
-- 182_vt_clinical_check_ins_is_senior.sql
-- Doctor shift gate: per-check-in senior tag. "Senior of ICU now" =
-- open check-in with operational_role='icu' AND is_senior=true.
ALTER TABLE vt_clinical_check_ins
  ADD COLUMN IF NOT EXISTS is_senior boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Add the Drizzle column** in `server/schema/ops.ts` after `operationalRole`:

```ts
    isSenior: boolean("is_senior").notNull().default(false),
```

(`boolean` is already imported in ops.ts; verify, add to the pg-core import if not.)

- [ ] **Step 3: Apply + verify** — `pnpm db:migrate`, `\d vt_clinical_check_ins` shows the column; `pnpm typecheck` clean.

- [ ] **Step 4: Commit** — `git commit -m "feat(db): is_senior on vt_clinical_check_ins (doctor shift gate)"`

---

### Task 3: Service — doctor team roles + senior validation + replace semantics

**Files:**
- Modify: `server/services/clinical-check-in.ts`
- Test: `tests/clinical-check-in.service.test.ts` (existing mocked-db suite — extend)

**Interfaces:**
- Consumes: Task 1–2 columns.
- Produces (exact):
  - `export const DOCTOR_TEAM_ROLES = ["icu", "admission", "internal_medicine"] as const;`
  - `export type DoctorTeamRole = (typeof DOCTOR_TEAM_ROLES)[number];`
  - `export function isDoctorTeamRole(v: string): v is DoctorTeamRole`
  - `CheckInInput` gains `isSenior?: unknown; replaceSenior?: unknown;`
  - New `ClinicalCheckInError` codes: `SENIOR_NOT_ELIGIBLE` (403), `SENIOR_REQUIRES_TEAM_ROLE` (422), `SENIOR_ALREADY_ASSIGNED` (409).

Behavioral contract (from the spec): a vet may open a check-in with any of the three team roles **without** `allowedOperationalRoles` membership (zero admin upkeep); legacy roles keep the existing allowlist path byte-for-byte. `isSenior=true` requires `users.seniorDoctorEligible` (server-checked) AND a team role. If the team already has an open senior: without `replaceSenior=true` → 409 `SENIOR_ALREADY_ASSIGNED` with `{ currentSeniorName }` metadata; with it → clear `isSenior` on the previous row (row stays open), audit `doctor_senior_replaced`, insert the new row.

- [ ] **Step 1: Write failing unit tests** (extend the existing `vi.mock("../server/db.js", …)` + `chainable()` pattern in `tests/clinical-check-in.service.test.ts`):

```ts
describe("doctor shift gate — openCheckIn vet branch", () => {
  it("allows a vet to open with 'icu' with EMPTY allowedOperationalRoles (team roles bypass the allowlist)", async () => {
    // arrange user row: role=vet, allowedOperationalRoles: [], seniorDoctorEligible: false
    const { row } = await openCheckIn({ actor: vetActor, operationalRole: "icu" });
    expect(row.operationalRole).toBe("icu");
    expect(row.isSenior).toBe(false);
  });

  it("still rejects legacy role 'ward' when not in the allowlist (legacy path unchanged)", async () => {
    await expect(openCheckIn({ actor: vetActor, operationalRole: "ward" }))
      .rejects.toMatchObject({ code: "OPERATIONAL_ROLE_NOT_ALLOWED" });
  });

  it("rejects isSenior=true when seniorDoctorEligible=false", async () => {
    await expect(openCheckIn({ actor: vetActor, operationalRole: "icu", isSenior: true }))
      .rejects.toMatchObject({ code: "SENIOR_NOT_ELIGIBLE", status: 403 });
  });

  it("rejects isSenior=true on a non-team role", async () => {
    // eligible vet, allowlisted 'ward'
    await expect(openCheckIn({ actor: vetActor, operationalRole: "ward", isSenior: true }))
      .rejects.toMatchObject({ code: "SENIOR_REQUIRES_TEAM_ROLE", status: 422 });
  });

  it("409s with SENIOR_ALREADY_ASSIGNED when the team has an open senior and replaceSenior is absent", async () => {
    // arrange: open row {operationalRole:'icu', isSenior:true, userId:'other'}
    await expect(openCheckIn({ actor: eligibleVetActor, operationalRole: "icu", isSenior: true }))
      .rejects.toMatchObject({ code: "SENIOR_ALREADY_ASSIGNED", status: 409 });
  });

  it("replaceSenior=true clears the previous senior's flag (row stays open) and audits doctor_senior_replaced", async () => {
    const { row } = await openCheckIn({ actor: eligibleVetActor, operationalRole: "icu", isSenior: true, replaceSenior: true });
    expect(row.isSenior).toBe(true);
    // assert update chain called with { isSenior: false } and NOT with checkedOutAt
    // assert mockLogAudit called with actionType "doctor_senior_replaced"
  });

  it("technician branch is untouched: operationalRole still rejected for non-vet", async () => {
    await expect(openCheckIn({ actor: techActor, operationalRole: "icu" }))
      .rejects.toMatchObject({ code: "OPERATIONAL_ROLE_NOT_ALLOWED_FOR_NON_VET" });
  });
});
```

- [ ] **Step 2: Run** `pnpm test -- tests/clinical-check-in.service.test.ts` — new tests FAIL (unknown role / missing fields).

- [ ] **Step 3: Implement** in `server/services/clinical-check-in.ts`:

```ts
export const DOCTOR_TEAM_ROLES = ["icu", "admission", "internal_medicine"] as const;
export type DoctorTeamRole = (typeof DOCTOR_TEAM_ROLES)[number];
const DOCTOR_TEAM_ROLE_SET = new Set<string>(DOCTOR_TEAM_ROLES);
export function isDoctorTeamRole(v: string): v is DoctorTeamRole {
  return DOCTOR_TEAM_ROLE_SET.has(v);
}
```

Widen `OPERATIONAL_ROLES` with `"icu"` and `"internal_medicine"` (keeps `getAllowedOperationalRoles` filtering valid). In the vet branch of `openCheckIn`: after the non-empty/known checks, skip the allowlist membership check when `isDoctorTeamRole(role)`; then resolve `isSenior`:

```ts
const wantsSenior = input.isSenior === true;
if (wantsSenior) {
  if (!isDoctorTeamRole(role)) throw new ClinicalCheckInError(422, "SENIOR_REQUIRES_TEAM_ROLE", ...);
  const [u] = await db.select({ eligible: users.seniorDoctorEligible }).from(users)
    .where(and(eq(users.id, actor.userId), eq(users.clinicId, actor.clinicId))).limit(1);
  if (!u?.eligible) throw new ClinicalCheckInError(403, "SENIOR_NOT_ELIGIBLE", ...);
  const [existing] = await db.select(...).from(clinicalCheckIns).leftJoin(users, ...)
    .where(and(eq(clinicalCheckIns.clinicId, actor.clinicId),
      eq(clinicalCheckIns.operationalRole, role), eq(clinicalCheckIns.isSenior, true),
      isNull(clinicalCheckIns.checkedOutAt))).limit(1);
  if (existing && input.replaceSenior !== true)
    throw new ClinicalCheckInError(409, "SENIOR_ALREADY_ASSIGNED", ..., { currentSeniorName });
  if (existing) {
    await db.update(clinicalCheckIns).set({ isSenior: false })
      .where(and(eq(clinicalCheckIns.id, existing.id), eq(clinicalCheckIns.clinicId, actor.clinicId)));
    logAudit({ clinicId: actor.clinicId, actionType: "doctor_senior_replaced", performedBy: actor.userId, performedByEmail: actor.email, targetId: existing.id, targetType: "clinical_check_in", metadata: { team: role } });
  }
}
```

Insert `isSenior: wantsSenior` in the row. Add `"doctor_senior_replaced"` to the `AuditActionType` union in `server/lib/audit.ts`.

- [ ] **Step 4: Run tests** — all green, including the pre-existing suite (no regressions).

- [ ] **Step 5: Commit** — `git commit -m "feat(check-in): doctor team roles + server-validated senior semantics with per-team replace"`

---

### Task 4: Route — accept `isSenior`/`replaceSenior`, serialize `isSenior`

**Files:**
- Modify: `server/routes/clinical-check-in.ts`
- Test: `tests/clinical-check-in.routes.test.ts` (existing — extend)

**Interfaces:**
- Produces: `POST /api/clinical-check-in/check-in` body `{ operationalRole?: string; isSenior?: boolean; replaceSenior?: boolean }` (strict); `serializeCheckIn` output gains `isSenior: boolean`.

- [ ] **Step 1: Failing route tests** — body with `isSenior:true` reaches the service (spy on `openCheckIn` args); response JSON includes `isSenior`; unknown body key still 400 (strict schema keeps rejecting extras).

- [ ] **Step 2: Implement** — extend `checkInBodySchema`:

```ts
const checkInBodySchema = z.object({
  operationalRole: z.string().min(1).optional(),
  isSenior: z.boolean().optional(),
  replaceSenior: z.boolean().optional(),
}).strict();
```

Pass both through to `openCheckIn`; add `isSenior: row.isSenior` to `serializeCheckIn`. Map the three new error codes in `handleServiceError` (they carry status already — verify passthrough).

- [ ] **Step 3: Tests green → Commit** — `git commit -m "feat(check-in): route accepts isSenior/replaceSenior"`

---

### Task 5: Service + route — atomic role switch (close+open, no board gap)

**Files:**
- Modify: `server/services/clinical-check-in.ts`, `server/routes/clinical-check-in.ts`
- Test: `tests/clinical-check-in.service.test.ts`

**Interfaces:**
- Produces: `export async function switchOperationalRole(input: CheckInInput): Promise<CheckInResult>` — inside one `db.transaction`: close the actor's open row (`checkOutReason:'role_switch'`) and insert the new one (same validation path as `openCheckIn`). Route: `POST /api/clinical-check-in/switch`, same body schema as check-in, `requireAuth, requireClinicalUser`.

- [ ] **Step 1: Failing tests** — switch closes old row and returns new row in one transaction; switch with no open row behaves like plain open; senior validation applies to the new role.
- [ ] **Step 2: Implement** (refactor the validation core of `openCheckIn` into an internal `validateAndBuildRow(input, tx?)` used by both paths; keep public signatures unchanged).
- [ ] **Step 3: Tests green (full file) → typecheck → Commit** — `git commit -m "feat(check-in): atomic role switch endpoint"`

---

### Task 6: Admin route + audit — set `senior_doctor_eligible`

**Files:**
- Modify: `server/routes/users.ts` (mirror the `PATCH /:id/equipment-coordinator` handler), `server/lib/audit.ts`
- Test: mirror the existing equipment-coordinator route test file's cases

**Interfaces:**
- Produces: `PATCH /api/users/:id/senior-doctor-eligible` body `{ seniorDoctorEligible: boolean }`, `requireAuth, requireAdmin`, clinic-scoped update, returns the updated `User`. New audit kind `"senior_doctor_eligible_set"`.

- [ ] **Step 1: Failing test** — admin sets flag true → row updated (clinic-scoped `WHERE`), audit called with `senior_doctor_eligible_set`; non-admin → 403; cross-clinic id → 404.
- [ ] **Step 2: Implement** by copying the equipment-coordinator handler shape verbatim (zod `{ seniorDoctorEligible: z.boolean() }` strict, `.where(and(eq(users.id, id), eq(users.clinicId, clinicId)))`). Add the union member.
- [ ] **Step 2b: `/api/users/me` must return `seniorDoctorEligible`** — the RN gate reads it from the identity payload. Check the `me` serializer in `server/routes/users.ts`; if it whitelists fields, add the flag (test: me response includes `seniorDoctorEligible: false` for a fresh vet).
- [ ] **Step 3: Tests green → Commit** — `git commit -m "feat(users): admin toggle for senior_doctor_eligible + audit"`

---

### Task 7: Doctor check-in auto-expiry (14 h, doctor rows ONLY)

**Files:**
- Create: `server/workers/doctorCheckInExpiryWorker.ts`
- Modify: `server/app/start-schedulers.ts` (register), `server/services/clinical-check-in.ts` (nothing — the worker updates directly)
- Test: `tests/doctor-checkin-expiry.test.ts` (new, mocked-db pattern from `tests/stale-checkin-sweep.test.ts`)

**Interfaces:**
- Produces: `export async function sweepExpiredDoctorCheckIns(now?: Date): Promise<{ closedCount: number }>` + `export function startDoctorCheckInExpiryWorker(): void` (interval scheduler, hourly). Constant `DOCTOR_CHECKIN_EXPIRY_HOURS = 14`.

**CRITICAL:** the existing `staleCheckInSweepWorker` is shadow/read-only — do NOT modify it. This is a separate worker whose `UPDATE` filters `check_in_source = 'doctor_gate'` (migration 184, stamped once at insert), so technician rows, legacy-role vet rows, and `admission` rows opened without the gate's `source: "doctor_gate"` declaration are untouchable by construction. (Filtering on the LIVE role/allowlist instead would drift when an admin later edits the allowlist — hence the persisted provenance column.)

- [ ] **Step 1: Failing tests** — a doctor row aged 15 h gets closed with `checkOutReason:'auto_expired'`; a technician row (operationalRole null) aged 48 h is NOT touched; a doctor row aged 13 h is NOT touched; `isSenior` rows close the same way.
- [ ] **Step 2: Implement**:

```ts
export const DOCTOR_CHECKIN_EXPIRY_HOURS = 14;

export async function sweepExpiredDoctorCheckIns(now: Date = new Date()): Promise<{ closedCount: number }> {
  const cutoff = new Date(now.getTime() - DOCTOR_CHECKIN_EXPIRY_HOURS * 3_600_000);
  const closed = await db.update(clinicalCheckIns)
    .set({ checkedOutAt: now, checkOutReason: "auto_expired" })
    .where(and(
      isNull(clinicalCheckIns.checkedOutAt),
      eq(clinicalCheckIns.checkInSource, "doctor_gate"),   // migration 184
      lt(clinicalCheckIns.checkedInAt, cutoff),
    ))
    .returning({ id: clinicalCheckIns.id, clinicId: clinicalCheckIns.clinicId });
  return { closedCount: closed.length };
}
```

(The sweep is cross-clinic by nature — the WHERE targets only doctor-role rows; per-row clinicId is preserved in the returned set for logging. Register `startDoctorCheckInExpiryWorker()` in `start-schedulers.ts` next to the other in-process schedulers, `setInterval` 60 min, guarded try/catch.)

- [ ] **Step 3: Tests green → Commit** — `git commit -m "feat(check-in): 14h auto-expiry for doctor check-ins (doctor rows only)"`

---

### Task 8: Snapshot — `responsibles` section

**Files:**
- Create: `server/services/board-responsibles.service.ts`
- Modify: `server/routes/display.ts` (compute before `res.json`, add key next to `currentShift`), `src/types/safety-surfaces.ts` (type — client side of the contract)
- Test: `tests/board-responsibles.service.test.ts` (mocked-db)

**Interfaces:**
- Produces:

```ts
export type ResponsibleEntry = { name: string; since: string };            // since = ISO checkedInAt
export type DoctorTeamBlock = { senior: ResponsibleEntry | null; members: ResponsibleEntry[] };
export type BoardResponsibles = {
  doctors: { icu: DoctorTeamBlock; admission: DoctorTeamBlock; internal_medicine: DoctorTeamBlock };
  seniorTechnician: { name: string } | null;
  equipmentCoordinator: { name: string | null; status: CoordinatorStatus };
};
export async function buildBoardResponsibles(args: {
  clinicId: string;
  todayDate: string;                                   // YYYY-MM-DD, already computed in the handler
  currentShift: Array<{ employeeName: string; role: string }>;
}): Promise<BoardResponsibles>
```

Data sources: doctors — `clinicalCheckIns` open rows with `inArray(operationalRole, DOCTOR_TEAM_ROLES)` joined to `users` for `displayName`/`name`, clinic-scoped; seniorTechnician — first `currentShift` entry with `role === "senior_technician"` (already roster-derived, pass-through); equipmentCoordinator — `resolveShiftCoordinator(clinicId, todayDate)` (existing service; name resolution mirrors `server/routes/docking.ts:709-720`). Wrap the whole build in the handler's existing `withTimeout` pattern; on failure return `null` for the key (board renders empty slots) — snapshot must never 500 because of the new section.

- [ ] **Step 1: Failing tests** — senior lands in `senior`, non-senior in `members`, sorted by `since`; empty clinic → all-null blocks; coordinator name passthrough; clinicId filter asserted on every query.
- [ ] **Step 2: Implement service.**
- [ ] **Step 3: Wire into `display.ts`** — compute `const responsibles = await withTimeout(buildBoardResponsibles({ clinicId, todayDate, currentShift }), …).catch(() => null);` and add `responsibles,` after `currentShift` in the response literal. Add to `DisplaySnapshot` in `src/types/safety-surfaces.ts`:

```ts
  responsibles?: BoardResponsibles | null;
```

(mirror the type shape locally in `src/types/safety-surfaces.ts` — the client type file cannot import server code; copy the three type aliases.)

- [ ] **Step 4: Tests green → typecheck (both configs) → Commit** — `git commit -m "feat(display): responsibles section on the board snapshot"`

**Clinical Safety Officer check (record in PR):** additive read-only key; never-cached list untouched; no Code Blue path change; failure degrades to `null`, never 500.

---

### Task 9: Client API + types

**Files:**
- Create: `src/types/check-in.ts`
- Modify: `src/lib/api.ts` (new `checkIn` namespace + `users.setSeniorDoctorEligible`), `src/types/index.ts` (barrel export)

**Interfaces:**
- Produces (exact — consumed by Tasks 11, 12):

```ts
// src/types/check-in.ts
export type DoctorTeamRole = "icu" | "admission" | "internal_medicine";
export interface CheckInRow {
  id: string; clinicId: string; userId: string;
  operationalRole: string | null; isSenior: boolean;
  clinicalRoleAtCheckIn: string; checkedInAt: string;
  checkedOutAt: string | null; checkOutReason: string | null;
}
```

```ts
// src/lib/api.ts — namespace `checkIn`
checkIn: {
  active: () => request<{ active: CheckInRow | null }>("/api/clinical-check-in/me/active"),
  open: (data: { operationalRole: DoctorTeamRole; isSenior?: boolean; replaceSenior?: boolean }) =>
    request<CheckInRow>("/api/clinical-check-in/check-in", { method: "POST", body: JSON.stringify(data) }),
  switch: (data: { operationalRole: DoctorTeamRole; isSenior?: boolean; replaceSenior?: boolean }) =>
    request<CheckInRow>("/api/clinical-check-in/switch", { method: "POST", body: JSON.stringify(data) }),
  close: () => request<CheckInRow>("/api/clinical-check-in/check-out", { method: "POST" }),
},
// users namespace addition (mirror setEquipmentCoordinator L506-510):
setSeniorDoctorEligible: (id: string, seniorDoctorEligible: boolean) =>
  request<User>(`/api/users/${id}/senior-doctor-eligible`, { method: "PATCH", body: JSON.stringify({ seniorDoctorEligible }) }),
```

- [ ] **Step 1: Add types + api functions.** `User` type in `src/types/users.ts` gains `seniorDoctorEligible: boolean`.
- [ ] **Step 2:** `pnpm typecheck` clean → **Commit** — `git commit -m "feat(api): checkIn client namespace + senior-doctor-eligible toggle"`

---

### Task 10: i18n — `doctorGate` namespace + board/admin keys

**Files:**
- Modify: `locales/he.json`, `locales/en.json`, `src/lib/i18n.ts` (buildTranslations — MANDATORY line)

Keys (he shown; en mirrors):

```json
"doctorGate": {
  "areYouOnShift": "האם אתה במשמרת?",
  "yes": "כן", "no": "לא",
  "pickTeam": "באיזה תפקיד?",
  "teamIcu": "ICU", "teamAdmission": "קבלה", "teamInternalMedicine": "פנימית",
  "iAmSenior": "אני הבכיר האחראי",
  "replaceSeniorTitle": "כבר יש בכיר",
  "replaceSeniorBody": "{name} כבר מסומן כבכיר {team} — להחליף אותו?",
  "replace": "החלף", "cancel": "ביטול",
  "onShiftStatus": "במשמרת — {team}", "onShiftSenior": "(בכיר)",
  "endShift": "סיום משמרת", "switchRole": "שינוי תפקיד",
  "checkInFailed": "הסימון נכשל — נסה שוב"
},
"board": { /* add inside existing namespace: */
  "responsiblesTitle": "אחראים",
  "seniorIcu": "בכיר ICU", "seniorAdmission": "בכיר קבלה", "seniorInternal": "בכיר פנימית",
  "seniorTechnician": "טכנאי בכיר", "equipmentCoordinator": "אחראי ציוד",
  "notMarked": "לא סומן", "noSeniorMarked": "אין בכיר מסומן", "sincePrefix": "מ-{time}"
},
"adminPage": { /* add: */ "seniorDoctorEligibleLabel": "רופא בכיר (זכאות)", "seniorDoctorEligibleUpdated": "עודכן", "seniorDoctorEligibleUpdateFailed": "העדכון נכשל" }
```

- [ ] **Step 1:** Add keys to BOTH locale files; add `doctorGate: { …tr(...) for interpolated keys }` block to `buildTranslations` in `src/lib/i18n.ts` (interpolated keys — `replaceSeniorBody`, `onShiftStatus`, `sincePrefix` — use the `tr(d.x.y, {...})` wrapper pattern; plain keys pass through).
- [ ] **Step 2:** `pnpm i18n:check` passes; `pnpm run i18n:generate-types`; `pnpm typecheck` clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(i18n): doctorGate + board responsibles copy (he/en)"`

---

### Task 11: Admin UI — eligibility checkbox

**Files:**
- Modify: `src/pages/admin/UsersSection.tsx`
- Test: `tests/users-section-senior-doctor.test.tsx` (mirror `tests/users-section-coordinator.test.tsx`)

- [ ] **Step 1: Failing test** — checkbox renders ONLY for `user.role === "vet"`; toggling calls `api.users.setSeniorDoctorEligible(id, true)`; `data-testid="checkbox-senior-doctor-eligible-${user.id}"`.
- [ ] **Step 2: Implement** by copying the `isEquipmentCoordinator` Checkbox block (~L309–324) + its mutation (~L185–193), gated `user.role === "vet"`, labels from `t.adminPage.seniorDoctorEligible*`.
- [ ] **Step 3: Test green → Commit** — `git commit -m "feat(admin): senior-doctor eligibility checkbox on user management"`

---

### Task 12: Gate popup (mobile shell)

**Files:**
- Create: `src/features/shift-gate/DoctorShiftGate.tsx`, `src/features/shift-gate/useDoctorGateState.ts`, `src/features/shift-gate/index.ts`
- Modify: `src/native/NativeShell.tsx` (mount as sibling, MoreSheet pattern — phone AND tablet branches)
- Test: `tests/doctor-shift-gate.test.tsx`

**Interfaces:**
- Consumes: `api.checkIn.*` (Task 9), `t.doctorGate.*` (Task 10), auth user from the existing auth hook (`useAuth`-equivalent used in NativeShell context — read role from the same source `UsersSection` uses).
- Produces: `<DoctorShiftGate />` — self-contained; renders `null` unless ALL: role === "vet", `api.checkIn.active()` returned `{active: null}`, and no un-expired snooze.

Snooze contract (exact): `localStorage` key `vt_doctor_gate_snooze_until` = epoch-ms string; set to `Date.now() + 8*3600_000` on "לא"; checked on mount.

Behavior: Step 1 dialog (shadcn `dialog.tsx`) with two chip buttons; "כן" → step 2 in the same dialog: three team buttons (large, `min-h-11`), senior toggle above them rendered only when the fetched user has `seniorDoctorEligible` (add the field to whatever `/users/me`-shaped query NativeShell's auth exposes — if absent, fetch via existing users API). Team tap → `api.checkIn.open({operationalRole, isSenior})`; on 409 `SENIOR_ALREADY_ASSIGNED` → confirm dialog with `t.doctorGate.replaceSeniorBody` → retry with `replaceSenior: true`. Success → invalidate `["/api/display/snapshot"]` query + close. Errors → toast `t.doctorGate.checkInFailed`, dialog stays.

- [ ] **Step 1: Failing tests** (React Testing Library, mirror an existing feature test):
  - renders nothing for technician role;
  - renders step 1 for vet with no active check-in and no snooze;
  - "לא" sets the snooze key and closes; remount within 8 h renders nothing;
  - "כן" → team tap posts `{operationalRole:"icu"}`;
  - senior toggle hidden when `seniorDoctorEligible=false`, shown+posted when true;
  - 409 path shows replace-confirm and retries with `replaceSenior:true`.
- [ ] **Step 2: Implement.** RTL: copy is Hebrew-first via `t.*`; no hardcoded strings (the i18n source test enforces).
- [ ] **Step 3: Mount** in both phone and tablet branches of `NativeShell.tsx` as a sibling (like `MoreSheet`).
- [ ] **Step 4: Tests green → typecheck → Commit** — `git commit -m "feat(gate): doctor shift gate popup in the native shell"`

**Click-path audit (run before commit, record result in PR):** trace the full state graph — כן→team, כן→toggle→team, לא→snooze, replace-confirm→כן/ביטול, mid-flow dismiss, offline failure — verify no path leaves a half-open state or a stale snooze.

---

### Task 13: Board — `ResponsiblesPanel`

**Files:**
- Modify: `src/features/command-board/components/board-panels.tsx` (new exported panel), `src/features/command-board/CommandBoard.tsx` (render it)
- Test: `tests/board-responsibles-panel.test.tsx`

**Interfaces:**
- Consumes: `snapshot.responsibles` (Task 8 type), `t.board.*` (Task 10).
- Produces: `export function ResponsiblesPanel({ responsibles }: { responsibles: BoardResponsibles | null | undefined })`.

Rendering contract (spec §3): five slots (בכיר ICU / בכיר קבלה / בכיר פנימית / טכנאי בכיר / אחראי ציוד). Senior name prominent; team members smaller beneath with `sincePrefix` times; empty slot → `t.board.notMarked` muted (`text-ivory-text3`, NO red/blink); members-without-senior → small `t.board.noSeniorMarked` label; `null`/`undefined` responsibles → all five slots in the notMarked state. Follow the `Panel` wrapper + `vt-text-*` + status-token conventions exactly (no literal colors).

- [ ] **Step 1: Failing tests** — five slots always render; senior + members layout; empty states per contract; no crash on `undefined`.
- [ ] **Step 2: Implement + wire** into `CommandBoard.tsx` next to the existing panels.
- [ ] **Step 3: Tests green → Commit** — `git commit -m "feat(board): responsibles panel (doctors/senior tech/equipment coordinator)"`

---

### Task 14: Integration test (real DB) — gate round-trip

**Files:**
- Create: `tests/doctor-shift-gate.integration.test.ts`
- Modify: `vitest.db-integration.config.ts` (add to the `include` array — REQUIRED, discovery is allowlist-only)

- [ ] **Step 1: Write the test** (throwaway clinic pattern from `tests/seed-reviewer-demo.integration.test.ts`, FK-safe teardown children-first): seed clinic + eligible vet + plain vet → plain vet opens `icu` (allowlist empty — passes) → eligible vet opens `icu` senior → plain-vet-senior attempt fails 403-shaped error → replace-senior works and previous row stays open non-senior → `buildBoardResponsibles` returns the expected block → `sweepExpiredDoctorCheckIns(now+15h)` closes both rows with `auto_expired` and leaves a seeded technician check-in open.
- [ ] **Step 2: Run** — `DATABASE_URL='postgres://vettrack:vettrack@localhost:5432/vettrack' pnpm exec vitest run --config vitest.db-integration.config.ts tests/doctor-shift-gate.integration.test.ts` → green.
- [ ] **Step 3: Commit** — `git commit -m "test(gate): DB round-trip — open/senior/replace/responsibles/expiry"`

---

### Task 15: Gates + PR

- [ ] `pnpm typecheck` · `pnpm test` · `pnpm i18n:check` · `pnpm architecture:gates` — all clean (fix anything that isn't).
- [ ] Proof-log entry in `docs/audit/PROOF_ALIGNMENT_LOG.md` (what was actually run + outputs).
- [ ] Push branch `feat/doctor-shift-gate`, open PR to `main` with the repo template (ADR: no trigger — additive columns + additive snapshot key; if reviewers disagree, escalate). PR body includes Skills-compliance + Clinical-Safety + click-path-audit results.
- [ ] Drive CodeRabbit to green (every comment investigated); do not merge without owner approval.
