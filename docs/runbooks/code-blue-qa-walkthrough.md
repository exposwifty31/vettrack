# Runbook G5 — Code Blue QA Walkthrough (multi-account)

**Purpose:** make the Code Blue (emergency resuscitation) flow **fully
testable** in the VetTrack RN app by standing up the two personas the flow
actually needs and walking every control end-to-end. Code Blue is inherently
**multi-account**: a **vet** starts and ends the session (and is the
resuscitation *manager*); a **technician on shift** is a second responder who
can log entries and mark presence but **cannot** end the session. A single-role
account cannot exercise the whole flow — and a vet with no clinical authority
gets a silent **403 at the first Log entry** even though Start succeeded.

**Status:** Code (the `scripts/seed-reviewer-demo.ts` `REVIEWER_DEMO_ROLE=vet`
path + `tests/seed-reviewer-demo.integration.test.ts` vet cases) is committed on
`feat/g5-assetlinks-runbooks`. Nothing has been run against production. The steps
below are the owner's to execute against the real Clerk instance and the target
backend `DATABASE_URL`.

**What the code does vs. what you must do:**

| | Owned by |
|---|---|
| Create the two Clerk identities (email + password, **not** OAuth) | **Owner** — Clerk dashboard or `clerk-cli` |
| Create/refresh the `vt_users` rows, the technician shift roster, **and the vet's open clinical check-in** | `scripts/seed-reviewer-demo.ts` |
| Ensure the target backend enables the check-in authority path (`AUTHORITY_USE_CHECKIN_PATH=true`) | **Owner** — backend env (see the caveat below) |
| Point the reviewer/QA build at the right build / API origin | **Owner** — App Store Connect / Play Console listing notes or the QA build config |

---

## ⚠️ Load-bearing caveat — `AUTHORITY_USE_CHECKIN_PATH`

The vet's authority to **Log** during a Code Blue comes from an **open
`vt_clinical_check_ins` row**, which the seed creates. But `resolveAuthority`
(`server/lib/authority.ts`) **only consults that row when the request-time env
flag `AUTHORITY_USE_CHECKIN_PATH === "true"`** on the backend
(`isCheckInPathEnabled()`, authority.ts ~123).

- **Flag ON** → the open check-in resolves `effectiveClinicalRole = "vet"`
  (`source: "check_in"`) → the vet can Log. ✅
- **Flag OFF** → the check-in row is **ignored**. Authority falls through to the
  legacy **Strategy A** shift-derived path. A vet has **no roster shift** (vet is
  not a `vt_shift_role` enum value), so Strategy A returns `EZSHIFT_NONE`
  (`effectiveClinicalRole: null`) → the vet is **403-blocked at Log**, exactly as
  if the seed had never run. ❌

**If the RN/QA build points at a backend where this flag is OFF, the seeded
check-in does nothing and Code Blue Log is untestable for the vet.** Confirm the
flag is `true` on the *same* backend the QA build's API origin targets, before
you start. (The technician-on-shift persona is unaffected — it gets authority
from its shift via Strategy A, independent of the flag.)

### Check-in freshness (a second, quieter way Log can 403)

The seeded check-in is **not auto-expired**: the `staleCheckInSweepWorker`
(`server/workers/staleCheckInSweepWorker.ts`) is **shadow-only / read-only** — it
classifies open check-ins into age buckets for telemetry but **never writes
`checkedOutAt`**, so it can't silently check the vet out mid-session.

However, authority resolution runs a *pure* staleness evaluator
(`evaluateStaleEnforcement`, `server/lib/authority/enforcement/stale.evaluator.ts`)
that is **age-based, not shift-based**: a check-in older than the ceiling —
**24h** default (36h for night operational roles; tunable via
`AUTHORITY_STALE_CEILING_HOURS`) — counts as stale. That evaluator only *denies*
(reason `CHECKED_IN_STALE`) when the clinic's `stale` enforcement mode is
**`enforce`**; the default is **`off`** (→ always allow), so a normal QA/demo
clinic is unaffected. Two practical rules:

- **Do not** put the QA/demo clinic's `stale` evaluator into `enforce` mode.
- If it ever is, seed close to the QA window. A seed **re-run reuses the existing
  open row** (it does not refresh `checkedInAt`), so to reset the check-in's age
  you must check out or delete the stale open row first, then re-run Step 2a to
  insert a fresh one.

---

## Why the flow needs both personas — the click-path audit

Each control was traced through its full authorization + state sequence. The
non-obvious bug this flow hides: **Start succeeds for a shiftless vet via an
emergency break-glass, so the vet *looks* authorized — but the very next control,
Log, has no break-glass and silently 403s** unless the vet also holds an open
check-in. Individually every button "works"; the Start → Log sequence breaks on a
shared prerequisite (clinical authority) that Start faked.

| Control (RN → API) | Who can press it | State change it triggers | Expected server response | What breaks if the prerequisite is missing |
|---|---|---|---|---|
| **Start** — `POST /api/code-blue/sessions` (RN also gates the button to `canStartCodeBlue(role)==='vet'`) | Any clinical identity (`vt_users.role ∈ {vet, senior_technician, technician}`, never `student`/system-admin). **Emergency break-glass** (`allowPermanentClinicalRoleForEmergency`) lets a **shiftless vet with no check-in** start. The nominated `managerUserId` must be an **active vet or admin** in the clinic. | Advisory-locked single-active-session guard → `INSERT vt_code_blue_sessions` (status `active`, `managerUserId`, `startedAt`) → optional primary-equipment log at elapsed 0 → push fan-out → `code_blue_*` "started" audit → SSE session-started event. | **201** with the created session. Second concurrent start for the clinic is blocked by the advisory lock / active-session guard. | Not a clinical role → **403** `INSUFFICIENT_ROLE` (`requireClinicalUser`). `student` → **403** `INSUFFICIENT_CLINICAL_AUTHORITY` (`STUDENT_NEVER_ELEVATED`). `managerUserId` not an active vet/admin → **400** `INVALID_MANAGER`. **Note: Start does *not* need the check-in** — break-glass covers a shiftless vet, which is why the gap only surfaces at Log. |
| **Log entry** — `POST /api/code-blue/sessions/:id/logs` | An actor with a **real** `effectiveClinicalRole ∈ {vet, senior_technician, technician}`: a **technician on shift** (Strategy A), **or** a **vet holding an open clinical check-in** (only when `AUTHORITY_USE_CHECKIN_PATH=true`). **No break-glass here.** | Idempotency check on `(sessionId, idempotencyKey)` → `INSERT vt_code_blue_log_entries` → `code_blue_log_entry_created` audit → fire-and-forget shadow manager-drift detection → SSE. | **201** `{id, duplicate:false}`; **200** `{id, duplicate:true}` on idempotent replay; **404** `SESSION_NOT_FOUND`. | **Shiftless vet with no open check-in → 403 `INSUFFICIENT_CLINICAL_AUTHORITY` (`EZSHIFT_NONE`)** — the headline failure. Check-in exists **but the flag is OFF** → row ignored → Strategy A → **403** again. This is the Start-worked-but-Log-fails trap. |
| **Presence** — `PATCH /api/code-blue/sessions/:id/presence` | **Any authenticated user** whose clinic owns the session (`requireAuth` only — **no** clinical-authority gate). Both the vet and the technician heartbeat here. | `UPSERT vt_code_blue_presence` on `(sessionId, userId)` → bump `lastSeenAt` → `code_blue_presence_heartbeat` audit. | **200** `{ok:true}`. | Session not in the caller's clinic / bad id → **404** `SESSION_NOT_FOUND`. No role/shift/check-in prerequisite — presence never 403s on authority. |
| **End** — `PATCH /api/code-blue/sessions/:id/end` | **Only the persisted resuscitation manager** (`session.managerUserId === req.authUser.id`). Deliberately **not** re-gated on fresh clinical authority, so a manager whose shift expired mid-resus can still close out. Manager must still be **vet/admin** and **active**. | Validate `outcome ∈ {rosc,died,transferred,ongoing}` + `earlyStopReason` (≥3 chars if given) → manager-only gate → manager still-vet/admin + still-active checks → set session ended/outcome/`endedAt` → audit → **server-confirmed** SSE ended event (the UI never optimistically ends). | **200** with the ended session. | A **technician (not the manager) presses End → 403 `MANAGER_ONLY`** — the reason the flow needs the vet. Manager no longer vet/admin → **422** `NO_VET_MANAGER`; manager deactivated → **403** `MANAGER_INACTIVE`; missing `earlyStopReason` where required → **400** `EARLY_STOP_REASON_REQUIRED`. |

---

## Prerequisites — two accounts, one clinic

1. **Vet, with an open clinical check-in** — starts/ends the session, is the
   resuscitation manager, and can Log (via the check-in). Provisioned by the seed
   with `REVIEWER_DEMO_ROLE=vet`, which **also inserts an open
   `vt_clinical_check_ins` row** (`clinicalRoleAtCheckIn='vet'`,
   `operationalRole='vet'`, `checkedOutAt=null`).
2. **Technician, on shift** — a second responder who can Log and mark presence,
   but **cannot** end the session. Provisioned by the seed's default role
   (`technician`), which lays down a full-day shift roster so the account resolves
   "on shift" (Strategy A).

Both accounts must be in the **same clinic** (they share one Code Blue session)
and must have **separate Clerk user IDs**. The demo clinic id must contain
`"demo"` (the seed's anti-footgun guard).

Also required: the backend the QA build talks to has **`AUTHORITY_USE_CHECKIN_PATH=true`**
(see the caveat above).

## Step 1 — Create the two Clerk identities (owner, once)

Email + password (Apple/Google review devices can't complete OAuth unattended).
Using `clerk-cli` (see `.claude/skills/clerk-cli`) or the Clerk dashboard, create
two users, e.g. `codeblue-vet-qa@vettrack.app` and
`codeblue-tech-qa@vettrack.app`. **Record each returned Clerk user ID
(`user_xxxxxxxx`)** — Step 2 needs them.

## Step 2 — Run the seed for both personas (owner)

Both commands are idempotent and safe to re-run. Use the **same**
`REVIEWER_DEMO_CLINIC_ID` for both.

```sh
# 2a — Vet persona (initiator + manager). Seeds the vt_users row AND the open
#      clinical check-in that grants Log authority.
DATABASE_URL='<target DATABASE_URL>' \
REVIEWER_DEMO_ROLE=vet \
REVIEWER_DEMO_CLERK_ID='user_<vet clerk id>' \
REVIEWER_DEMO_CLINIC_ID='code-blue-demo-clinic' \
REVIEWER_DEMO_EMAIL='codeblue-vet-qa@vettrack.app' \
REVIEWER_DEMO_DISPLAY_NAME='QA Vet' \
pnpm seed:reviewer-demo

# 2b — Technician-on-shift persona (second responder). Default role → shift roster.
DATABASE_URL='<target DATABASE_URL>' \
REVIEWER_DEMO_CLERK_ID='user_<technician clerk id>' \
REVIEWER_DEMO_CLINIC_ID='code-blue-demo-clinic' \
REVIEWER_DEMO_EMAIL='codeblue-tech-qa@vettrack.app' \
REVIEWER_DEMO_DISPLAY_NAME='QA Technician' \
pnpm seed:reviewer-demo
```

The vet run prints `check-in : open (id=…)`; the technician run prints
`check-in : none (roster/permanent-role account)` and `shifts : N day(s)`.

A re-run is **not** a no-op: `vt_users` role/status/clinic are re-asserted, the
technician roster is upserted, and the vet's open check-in is restored to exactly
one open row (the seed reads the open row first and only inserts when none
exists). Clinic furniture/equipment/tasks seed once and are then left alone. Like
the reviewer-demo seed, `vt_shifts` has no recurring concept, so re-run to extend
the technician's shift coverage past the seeded window.

## Step 3 — Sign-in + point the build at the right backend

- Sign into the RN/QA build as **`codeblue-vet-qa@vettrack.app`** on one device
  and **`codeblue-tech-qa@vettrack.app`** on a second (or sign out/in between
  roles on one device).
- The submitted/QA build's API origin (`EXPO_PUBLIC_API_ORIGIN`) must point at the
  **same** backend as the `DATABASE_URL` in Step 2 **and** that backend must have
  `AUTHORITY_USE_CHECKIN_PATH=true`. Otherwise the client talks to a backend the
  seed didn't populate, or one that ignores the vet's check-in.

## Step 4 — Walk the click-path: Start → Log → Presence → End

Perform as the persona named in each step; expected result in the right column.

| # | Persona | Action | Expected result |
|---|---|---|---|
| 1 | **Vet** | Open a patient / Code Blue surface and press **Start Code Blue** (RN only shows this to a vet). Nominate the vet (self) as manager. | Session becomes `active`; timer starts; **201**. If the vet had no check-in this still succeeds (break-glass) — do not mistake it for full authorization. |
| 2 | **Vet** | Add a **log entry** (e.g. a note or an equipment/med event). | **201** `{duplicate:false}`; the entry appears in the live log. **This is the step that proves the check-in works.** If you get **403 `INSUFFICIENT_CLINICAL_AUTHORITY`**, the check-in path is off (flag) or the check-in wasn't seeded — see the caveat. |
| 3 | **Technician** | On the second device, the same active session is visible. Add a **log entry**. | **201** — the technician-on-shift can Log via Strategy A (no check-in needed). Confirms multi-responder logging. |
| 4 | **Technician** | Stay on the session so the client sends **presence** heartbeats (or toggle the "I'm here"/presence control). | **200** `{ok:true}`; the technician shows as present to the vet. |
| 5 | **Technician** | Attempt to **End** the session. | **403 `MANAGER_ONLY`** — a non-manager cannot end. This is the intended multi-account guard, not a bug. |
| 6 | **Vet** | Press **End**, choose an `outcome` (rosc/died/transferred/ongoing; supply `earlyStopReason` if prompted). | **200**; session transitions to ended **after server confirmation** (SSE), never optimistically. Both devices reflect the ended state. |

If step 2 returns 403 but step 3 (technician) succeeds, the failure is
vet-authority-specific: the seed's check-in isn't being honoured — re-check
`AUTHORITY_USE_CHECKIN_PATH` and that Step 2a ran against this backend.

## Verification (local, before touching production)

```sh
DATABASE_URL='postgres://vettrack:vettrack@localhost:5432/vettrack' \
  pnpm exec vitest run --config vitest.db-integration.config.ts \
  tests/seed-reviewer-demo.integration.test.ts
```

The vet cases seed a throwaway clinic (`reviewer-demo-vet-clinic-test`) against
your local dev DB and assert, **entirely at the Drizzle/data-access layer**: the
seed produces exactly one **open** `vt_clinical_check_ins` row
(`clinicalRoleAtCheckIn='vet'`, `operationalRole='vet'`, `checkedOutAt=null`);
that with `AUTHORITY_USE_CHECKIN_PATH=true` the real `resolveAuthority()` returns
`effectiveClinicalRole='vet'` / `source='check_in'`; that with the flag **off**
the same vet resolves `EZSHIFT_NONE` (no authority) — encoding the caveat as an
executable assertion; and that the vet path is idempotent (one open row across
re-runs).

**What this proves vs. what it doesn't.** The test proves the **resolver** grants
the vet clinical authority from the seeded check-in, and that the row exists in
the shape the Code Blue Log gate reads. The route-guard behaviour itself
(`requireClinicalUser` is a role-only identity check — `CLINICAL_ROLES = {admin,
vet, senior_technician, technician}`, no shift required; `requireClinicalAuthority`
admits `effectiveClinicalRole ∈ {vet, senior_technician, technician}`; Log carries
**no** break-glass whereas Start does) is established by **reading**
`server/middleware/authority.ts`, `server/middleware/auth.ts`, and
`server/routes/code-blue.ts` — **not** by executing them over HTTP. This runbook
and its test stop at the server authority boundary; how the RN client renders the
Code Blue screens once it receives 201/403 is out of scope (separate repo).

## Rollback

The demo clinic and its rows are namespaced (`code-blue-demo-clinic`,
`reviewer-demo-*` / random check-in IDs) and never referenced by real clinic
data. The seed writes to nine tables, all `ON DELETE RESTRICT`, so removal must
delete every dependent row before its parent — children first:

1. `vt_clinical_check_ins` (references users + clinic)
2. `vt_appointments` (references users + equipment)
3. `vt_equipment` (references folders/docks/rooms)
4. `vt_docks`, then `vt_folders`, then `vt_rooms`
5. `vt_shifts` (references users)
6. `vt_users` (the two demo `clerkId`s)
7. `vt_clinics` (the demo clinic row)

All deletes filter by the demo `clinicId`. Or just leave the clinic in place; it
costs nothing and is unreachable by any real user. (Note: if anything has since
written `vt_audit_logs` rows for this clinic, the clinic row itself is
effectively undeletable — audit logs are append-only by design — so
leave-in-place is then the only option.)
