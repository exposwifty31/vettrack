# VetTrack Phase 0 — Architecture Review

**Status:** Read-only analysis. No code, migrations, or document changes.
**Source documents reviewed:** `docs/authority-model.md`, `docs/task-product-model.md`, `docs/operational-modes.md`, `docs/endpoint-authority-matrix.md`.
**Purpose:** Surface contradictions, ambiguities, hidden coupling, concurrency risks, workflow dead-ends, and rollout exposure **before Phase 1 implementation begins**.

References use the shorthand:
- `AM` = `authority-model.md`
- `TPM` = `task-product-model.md`
- `OM` = `operational-modes.md`
- `EAM` = `endpoint-authority-matrix.md`
- `PR n.n` = the corresponding PR in Plan v2.

---

## 1. Critical blockers

These must be resolved before any Phase 1 PR lands. Several appear to be Phase 2A concerns but transitively block Phase 1 because Phase 1 reads from the same data and column.

### 1.1 `vt_users.role` column is overloaded; the new model splits it; Phase 0 does not commit to a column strategy

The legacy hierarchy in `server/middleware/auth.ts:43-52` mixes `admin` (system) with `vet`, `senior_technician`, `technician`, `student` (clinical) in **one column**. `AM §1` declares two orthogonal dimensions (`systemRole`, `clinicalRole`). Phase 0 does not say whether:

- `vt_users.role` becomes `systemRole`, and a new `clinicalRole` column is added;
- `vt_users.role` keeps clinical semantics, and a new `systemRole` column is added;
- both stay in one column with parsing logic.

Every Phase 2A resolver test depends on the answer. Phase 1 PR 1.5 also depends on it (see 1.5 below).

### 1.2 `requireAdmin` semantics under the new model are not normalized

Legacy `requireAdmin` matches `role === "admin"` (or hierarchy ≥ 40). New `requireSystemAdmin` is documented in `AM §4` as `systemRole === "Admin"`. If today's data has users with `role = "admin"` who are also clinical Vets, a naive split that maps `role === "admin"` → `systemRole = Admin` and `clinicalRole = null` will silently strip clinical authority from current Admins.

### 1.3 `secondaryRole` column has no defined fate

`PATCH /api/users/:id/secondary-role` (users.ts:356) is documented in `EAM` as "legacy; behaviour to be reconciled." `server/lib/role-resolution.ts` uses `secondaryRole` in a max-of with shiftRole. The new model **replaces** secondaryRole semantics with shiftRole. Phase 0 does not say whether the column is dropped, deprecated, remapped, or kept for a non-authority purpose. During Phase 2A–2C, admins continuing to set secondaryRole could:

- Believe they are elevating a user when nothing happens (silent drift), or
- Cause inconsistent gate behavior depending on which code path reads which model.

### 1.4 Code Blue mid-event shift transition is unspecified

`OM §2.2`, `§2.4`, `§2.8` require active-shift Vet for manager actions. Neither doc states what happens when a manager's shift ends mid-Code-Blue. Phase 4 PR 4.7 cannot pick between:

- Block end at shift boundary → abandoned sessions, clinical risk.
- Grandfather the manager for the duration → violates the active-shift rule.

A product answer is required before Phase 4 PR 4.7. Phase 1 PR 1.5 inherits the same ambiguity (see 1.6).

### 1.5 PDN-11 (null `vt_shifts.role`) blocks the Phase 2A resolver

The resolver returns `activeShiftRole = vt_shifts.role`. If `vt_shifts.role` is null on an otherwise-matching row, the resolver must choose:

- Treat as no active shift → drops clinical authority entirely for that user.
- Fall back to `clinicalRole` → violates the override rule.

Phase 2A cannot ship without this answer. `AM §6` flags it as PDN-11 but does not propose a default. **The resolver's unit-test matrix in Phase 2A is undefined without it.**

### 1.6 Phase 1 PR 1.5 uses `clinicalRole === "vet"` data that may not exist post-split

PR 1.5 is described as relying on "the current `clinicalRole === 'vet'` data." But §1.1 above shows that "current clinicalRole" is not a discrete value today — it is part of an overloaded enum. Once the column split lands (Phase 2A), the predicate "is this user a Vet?" may evaluate differently for users currently typed as `role = "admin"`.

Therefore PR 1.5 has a *latent* dependency on the column-strategy decision. Shipping PR 1.5 before §1.1 is resolved means PR 1.5 may need to be re-asserted (or re-tested) the day the split lands.

### 1.7 Manager picker contract is changing during Phase 4 PR 4.6 with no migration path

`GET /api/users/managers` exists today (users.ts:923). Phase 4 PR 4.6 will introduce `GET /api/users/active-shift-vets` and re-filter. `EAM` does not say whether:

- The legacy path stays as an alias for one release.
- The response shape (field names, additional metadata) changes.
- FE callers that currently rely on `/managers` are migrated in the same PR.

Code Blue start flow depends on this endpoint; a wrong sequence is a clinical-flow regression.

---

## 2. High-risk ambiguities

### 2.1 What counts as "active shift" is not defined

`AM` references active shift without committing to:

- **Timezone** — are `vt_shifts.startTime` and `endTime` clinic-local or UTC? `NOW()` evaluation differs by ~hours between clinics.
- **Grace period** — is a shift "active" 5 min before its scheduled start or 5 min after its end? Clinical staff routinely arrive early / leave late.
- **Source of truth** — `vt_shifts` (schedule) or `vt_shift_sessions` (login-bound). Schema has both; `role-resolution.ts` uses `vt_shifts`; product behavior may diverge.
- **Multiple overlapping shifts** — tie-break is not specified.
- **Identity match** — `role-resolution.ts:98-136` matches shifts by `employeeName` (display name). Names are mutable, non-unique, and not authoritative; collisions and renames are silent. Phase 2A inherits this bug unless explicitly redesigned.

### 2.2 FE freshness of `activeShiftRole`

Phase 2A adds `activeShiftRole` to `useAuth()` (`AM §4`). `AM` does not specify how the FE invalidates it on shift start / end:

- Polling? At what interval?
- SSE event? Producer side undefined.
- Focus-refresh? Cross-tab consistency undefined.

During the lag window the FE either shows enabled buttons that 403, or shows disabled buttons that would actually work. Phase 2B endpoints will hit this gap immediately.

### 2.3 PDN-10 (per-task-type escalation matrix) is the foundation of Phase 3B/3C

`TPM §5.4` proposes a recipient table but explicitly defers it. Phase 3B fan-out and Phase 3C scheduler both consume this matrix on every escalation. Plan v2 does not block Phase 3B/3C on PDN-10. **It should.**

### 2.4 PDN-8 (ER Mode allowlist) is mapped per page, but enforcement is per endpoint prefix

`OM §1.4` translates product pages to API prefixes. A page typically depends on **several** endpoints. Adding `/code-blue` to the allowlist without `/equipment` (consulted when a Code Blue log entry references equipment) means the page partially works and partially 403s.

The mapping in `OM §1.4` is conservative; the complete dependency graph per page is not produced. Phase 4 PR 4.2 will inherit holes.

### 2.5 Code Blue trigger authority vs the off-shift rule

`OM §2.2`: "Anyone may trigger. Trigger need not be on shift."
`AM §2`: "no active shift ⇒ no clinical authority."

This is reconcilable only if trigger is **not** classified as a clinical action. Neither doc states this. A future reviewer treating trigger as clinical re-introduces the contradiction.

### 2.6 Student behavior with a `vt_shifts.role` assigned

`AM §2.4`: Student is fixed and never elevated. `TPM` does not say whether a `vt_shifts.role = "technician"` row attached to a Student-clinical-role user is rejected, ignored, or treated as "Student on shift as Student."

### 2.7 Legacy aliases `lead_technician` and `vet_tech`

`server/middleware/auth.ts:43-52` includes these in the hierarchy. `AM §1` enumerates only four clinical roles. Users currently typed `lead_technician` or `vet_tech` have **undefined behavior** under the resolver until aliasing is documented.

### 2.8 Off-shift Vet remote workflows

Today a Vet checking the app from home can approve medication tasks, end Code Blues, toggle ER Mode. Under the new model, none of these are possible. Whether the operational team has accepted this regression is not flagged in `AM`. Phases 2B → 4 land it silently.

### 2.9 Code Blue manager assignment vs active-shift at assignment time

`OM §2.4`: "Event manager must be an active-shift Vet." Resolution: was the user active-shift at assignment-time, or is being active-shift a persistent requirement throughout the session? The doc reads as "persistent," which intersects 1.4.

### 2.10 What is `requireAuthAny` (users.ts:463)?

`PATCH /api/users/:id/display_name` uses `requireAuthAny`, distinct from `requireAuth`. Phase 0 does not enumerate or define this middleware. Likely supports offline-bypass sessions, but semantics are opaque. Phase 2C will need to migrate it without a clear target.

### 2.11 Cross-clinic users with overlapping shifts

A user with active shifts in two clinics simultaneously. `req.clinicId` scopes the resolver. The model handles this per-request, but the doc does not enumerate the case and there is no test plan for it in Phase 2A.

---

## 3. Migration-order risks

### 3.1 Legacy and new gates coexisting during Phase 2B–2C

Phase 2B migrates six endpoints to the new model while ~150 still use legacy. The two systems disagree on:

- Vet override semantics (legacy: hierarchy max-of; new: shiftRole-only).
- Admin behavior (legacy: hierarchy 40 beats Vet; new: orthogonal).
- Off-shift behavior (legacy: still allowed if role is set; new: 403).

If a Phase 2B endpoint calls into a service that runs legacy `requireEffectiveRole` checks via a helper, behavior is inconsistent at the service boundary.

### 3.2 Double-stacking gates

If a Phase 2B migration mistakenly leaves `requireEffectiveRole("technician")` on the route in addition to `requireClinicalAuthority({...})`, ordering matters. The Phase 2B PR template should mandate removal of the legacy middleware in the same PR; Phase 0 does not require this.

### 3.3 Phase 2A removes FE hierarchy maps before pages get new gating

`patient-detail.tsx:56-62` and `equipment-detail.tsx:115-121` duplicate the numeric hierarchy. Phase 2A says drop them. Phase 2A also says "no FE gating changes" and that `canPerformClinicalAction` is "not wired into UI gates." Net effect: between Phase 2A and the page's Phase 2C migration, these two pages lose all client-side gating or quietly regress to a different duplication.

### 3.4 Phase 3A and Phase 3B share the escalation-state representation

Plan v2 §3B leaves "column or metadata JSON" to engineering. Phase 3A's eligible-assignees endpoint may need to read escalation state. Phase 3C's scheduler must query it efficiently. The choice is not orthogonal across phases — Phase 3A should not lock in a query pattern that breaks Phase 3C's index plan.

### 3.5 Phase 1 PR 1.2 (FE+BE coordinated payload swap)

PR 1.2 changes FE to send `observedQuantity`. Adding `.strict()` to the BE zod schema rejects unknown keys with 400. If FE deploys before BE accepts the new shape, **all restock scans 400 in that window**. Plan v2 says "deploy in same release"; Phase 0 does not specify the deploy mechanism. Operational risk: if FE deploys independently (common in this repo's history), restocks break.

### 3.6 Phase 1 PR 1.6 removes auto-checkout without a replacement reconciliation path

Today an equipment-category Code Blue log entry mutates `vt_equipment` to mark it checked out. PR 1.6 removes this mutation; the log entry persists, but equipment state is no longer updated. There is no manual workflow in scope to mark Code Blue equipment as in-use, nor a post-event equipment-reconciliation page (the existing Code Blue Reconciliation page handles dispenses, not equipment).

The product implication — "Code Blue equipment is not tracked at the equipment-state level" — is not stated in `OM §2.7`. It must be confirmed before PR 1.6 ships.

### 3.7 Phase 1 PR 1.4 (`requireAuth` only on dispense) widens the authenticated surface

Before: unauthenticated POST possible (security hole).
After PR 1.4: every authenticated user — including off-shift Vets, Students, off-shift Techs — can call dispense endpoints. The window between PR 1.4 and Phase 2B.4 is wider than "bug to fix"; it is "wider surface of authenticated callers than the product allows." Acceptable, but it should be explicit in the PR.

### 3.8 Phase 1 PR 1.7 and Phase 2B.1 interact

PR 1.7 changes the inventory-deduction failure UX under the current `requireEffectiveRole("technician")` gate. Phase 2B.1 tightens that gate. If PR 1.7's FE logic assumes "the user who completed the task sees the toast," and Phase 2B.1 changes who that is (off-shift Techs no longer complete), the toast logic may need re-validation.

### 3.9 Recovery scheduler in PR 1.3 must coexist with the existing worker without double-processing

PR 1.3 wires `recoverPendingInventoryJobs()` on a 10-minute interval. The existing worker also processes jobs. Without DB-level row-locking, a job claimed by the worker and re-enqueued by the recovery scheduler can be processed twice. Phase 0 does not specify the locking strategy.

### 3.10 `secondaryRole` admin endpoint remains active during Phase 2A–2C

`PATCH /api/users/:id/secondary-role` (users.ts:356) is not on any phase's removal list. During the transition, setting secondaryRole has no effect under the new model. This is a hidden surface for admin error and confusion.

---

## 4. Authority-model edge cases

### 4.1 Off-shift Admin cannot perform clinical override

Today an Admin (hierarchy 40) can complete any task. Under the new model, off-shift Admin has null effective clinical role and cannot. There is no documented "Admin clinical override" mechanism for operational cleanup of stuck tasks. PDN-T5 asks about Vet/Senior-Tech override survival; the equivalent question for Admin is not in the PDN list.

### 4.2 Manager who goes off-shift mid-Code-Blue

See §1.4. Two equally-defensible answers; doc does not pick one.

### 4.3 SeniorTech-as-Tech downgrade affects shift-chat pin

`shift-chat.ts:405`: `POST /messages/:id/pin` requires Senior Tech. Under shiftRole override, a Senior Tech shifted as Tech cannot pin. Behavioral regression for that role-shift combination; not flagged in `AM`.

### 4.4 Vet-as-Technician loses medication-create authority

Vet pulling a Tech shift cannot create medication tasks during that shift. Operationally meaningful: short-staffed clinics where a Vet covers a Tech shift may need a per-action elevation mechanism. Not in scope of any current phase.

### 4.5 `clinicalRole = null`

`AM` does not enumerate this case. Phone-number-only Admin accounts may have null clinical roles. The resolver, matrix, and FE helper all need a documented behavior.

### 4.6 `shiftRole = student`

Can `vt_shifts.role` be `student`? If yes, a Senior-Tech-shifted-as-Student is barred from completing tasks. The model permits this; the doc doesn't say whether the product allows it.

### 4.7 Free-text `vt_shifts.role` from CSV imports

`shifts.ts` CSV import normalizes some fields but may admit unknown role strings. The resolver behavior for unknown values is undefined.

### 4.8 Idempotent retry under different shift

A request issued at t=0 with shiftRole=technician; retried at t=2 min after shift ended. Idempotency middleware may return the cached t=0 response. Should the t=2 retry "succeed" via cache, even though the user now has no authority? The new model says no; idempotency middleware says yes. No phase addresses this interaction.

### 4.9 Two clinical actions in one request

A handler performing a clinical mutation **and** a system-admin action needs both authorities. The matrix evaluates them independently. Phase 0 does not enumerate composite gates.

### 4.10 Soft-deleted user mid-shift

`vt_users.deletedAt` is checked in auth. If a user is soft-deleted mid-shift, in-progress requests with cached auth may still succeed. Not addressed.

### 4.11 Forward-dated tasks (PDN-T4)

If Phase 3A allows scheduling a task for a future shift, the assignee is off-shift at task creation time but on-shift at task start time. Eligible-assignees must handle "off-shift now, on-shift at task time." Schema today has no clean way to query "user with an upcoming shift covering datetime X."

---

## 5. Workflow contradictions

### 5.1 Pending Emergencies page in ER Mode

`OM §1.4` lists `/shift-handover/pending-emergencies` as IN-target but leaves the rest of `/shift-handover/*` as PDN-8. The page also calls `/animals/active` (also PDN-8). Page-level allowlisting is incomplete; Phase 4 PR 4.2 will surface this as visible breakage.

### 5.2 Medication Hub under ER Mode

If `/code-blue` and `/medication-tasks` are allowlisted but `/formulary` is not, dose calculators may degrade. The data-dependency graph per allowed page is not produced in `OM`.

### 5.3 Pharmacy Forecast under ER Mode

Forecast is not in Plan v2's stated allowlist intent. Pharmacist forecast approval during ER Mode is therefore disabled by default. Intentional or accidental — not stated.

### 5.4 Escalation acceptance with empty eligible-staff

A medication task escalates at 10 minutes. The escalation matrix (PDN-10) says "active-shift Vet ∪ Tech." If no one is on shift (overnight gap), notifications go to zero recipients and the task is silently stuck in `escalated`. No re-escalation, dead-letter, or operations alert is defined.

### 5.5 Refused-escalated task

`TPM §5.2`: refusal leaves the task in `escalated`. Staff who come on shift after the refusal will not be re-fanned-out to. The task silently stagnates.

### 5.6 Medication issue with off-shift creating Vet

`TPM §4.3`: report-issue notifies the **creating** Vet. If the creating Vet is off-shift, they receive the push but cannot act on it. The task stalls. No fallback rerouting is defined.

### 5.7 Patient discharge has no route-layer audit

`EAM` shows `PATCH /api/patients/:id/discharge` (patients.ts:635) with `Audit (route) = no` and `Audit (service) = n/a`. Discharge is a major clinical state change. `TPM §6` audit contract does not enumerate discharge. **Audit gap until Phase 5 audit-coverage test catches it — which itself depends on PDN-5.**

### 5.8 Patient status changes and pending-patient assignment lack audit

Same pattern for `PATCH /api/patients/:id/status` (patients.ts:585) and `PATCH /api/patients/:id/assign` (patients.ts:765). Phase 4 PR 4.5 adds audit on assign; status changes are not on any PR.

### 5.9 Patient-handoff route-layer audit unclear

All five handoff mutations in `patient-handoffs.ts` show `Audit (route) = no`. The service file `patient-handoff.service.ts` has 3 `logAudit` calls. Whether each mutation is covered is unverified — the audit-coverage matrix work belongs in Phase 5 but Phase 3A may surface gaps earlier when handoffs interact with eligible-assignees.

### 5.10 Restock has zero `logAudit` calls

`restock.ts` shows `Audit (route) = no` on all five endpoints, and there is no `restock.service.ts` audit either. Inventory state mutations are entirely unaudited today. Phase 5 retroactively fills, but **Phases 1, 2B, 2C, and 3 all ship mutations without audit for restock**.

### 5.11 Crash cart check submission lacks audit

`crash-cart.ts:196` no audit. `OM §1` and `§2` are silent on whether the check is auditable.

### 5.12 ER Mode toggle rejected attempts

`OM §1.6`: "blocked access attempts do not require audit log entries for now." But the toggle authority itself is moving to active-shift Vet (Phase 4 PR 4.1). A former-Vet-now-off-shift attempting to toggle would produce a silent 403. Operations may want visibility into denied toggle attempts. Not flagged.

---

## 6. Hidden technical debt likely to surface later

### 6.1 `requireAuthAny` variant (users.ts:463)

Undocumented middleware. Phase 2C will need to migrate it without a clear target. (Already in §2.10.)

### 6.2 `vt_shift_sessions` vs `vt_shifts`

Schema has both. Which is the source of truth for "active shift"? Plan v2 implies `vt_shifts`. If production behavior leans on `vt_shift_sessions`, the resolver semantics will need to flip.

### 6.3 `role-resolution.ts` shift match by display name

Display names are mutable and non-unique. Today's match is fragile. Phase 2A inherits this unless explicitly redesigned. (Already in §2.1.)

### 6.4 Legacy aliases `lead_technician`, `vet_tech`

Listed in hierarchy. Not in new model. (Already in §2.7.)

### 6.5 Idempotency vs audit

Idempotency middleware returns cached responses without re-executing the handler. Handlers are where audit fires. Idempotent retries therefore do not re-audit. Probably correct; Phase 5 audit-coverage test must explicitly whitelist this case.

### 6.6 Soft-delete mid-action

`vt_users.deletedAt` checked at auth. Mid-request transitions undefined.

### 6.7 Push fan-out filtering

`vt_push_subscriptions` has flags like `technicianReturnRemindersEnabled`, `adminHourlySummaryEnabled`. Plan v2 §3B and §4.8 say "fan-out to active-shift staff" but do not say whether the fan-out respects per-user preferences. If not respected, opt-outs are ignored.

### 6.8 SSE replay buffer during ER Mode toggle

`/api/er/stream` (allowlisted in ER Mode) continues to flow. Polling fallbacks against blocked paths abruptly fail. Reconnection logic needs to know which paths are still allowed under ER Mode.

### 6.9 Outbox semantics during ER Mode enforcement

Mutations rejected by the ER Mode middleware (Phase 4 PR 4.2) never reach `vt_event_outbox`. Replay on cold reload reconstructs only what was committed. A clinic that toggles enforce mid-flow has a discontinuity in the event stream; downstream consumers may notice gaps.

### 6.10 `vt_audit_logs` retention

Phase 5 adds indexes. No retention policy is defined. After several years, the table grows unbounded; indexes help reads, writes still slow.

### 6.11 Equipment scan currently gated at Student

`equipment.ts:978/1146/1292/1475` are the only endpoints that use `requireEffectiveRole("student")` — effectively "any authenticated user." Under the new model, Student must be on active shift. Shadowing students without shift rows lose scan capability — **a workflow regression** unless Student-scope decisions account for it.

### 6.12 ER intake POST currently has no role gate (er.ts:326)

Phase 2B.5 adds the gate. Until then, **any authenticated user** can create ER intakes. Phase 1 doesn't touch this. The exposure window is wider than the original audit's "no role gate" wording implied.

### 6.13 Phase 3B "column or metadata" choice impacts query plan

A `metadata.escalationState` JSONB lookup is slower than an indexed column for scheduler queries. Choosing under time pressure risks the wrong default.

### 6.14 i18n parity for new error messages

Every new authority error string ("no active shift," "manager not assigned," "early stop reason required") needs both `he.json` and `en.json`. The i18n CI test is scheduled for Phase 5, so missing keys ship through Phases 1–4.

### 6.15 Phase 1 PR 1.5's "Vet manager required" creates an in-flight migration

Sessions started without a manager **before** PR 1.5 land will become un-endable after PR 1.5. There is no documented in-flight session migration path.

---

## 7. Recommended clarifications before Phase 1

1. **State which column means what.** A one-paragraph product/eng note answering §1.1 (systemRole vs clinicalRole representation) — even an interim "today, `role` holds both" is sufficient to write Phase 1 tests against.
2. **Decide whether PR 1.6 has a replacement equipment-tracking path.** If not, label in PR description that "Code Blue equipment is no longer tracked at the equipment-state level until further notice."
3. **Confirm PR 1.5 grandfathers in-flight sessions.** Either accept that pre-existing sessions without a Vet manager become un-endable, or define a one-time migration that auto-assigns or auto-closes them.
4. **Specify the deploy procedure for PR 1.2.** FE+BE coordinated; either deploy atomically or BE-first.
5. **Document the inventory-recovery scheduler locking.** Confirm worker + scheduler use the same DB-level claim mechanism and never double-process. Add a regression test asserting no double-processing under fake-timer overlap.
6. **Acknowledge PR 1.4's widened auth surface in the PR body.** "Any authenticated user — including off-shift Vets, Students, off-shift Techs — can now reach dispense endpoints. Phase 2B.4 narrows this. This PR fixes a security hole; it does not establish the final gate."
7. **Confirm that no Phase 1 PR alters the legacy `requireEffectiveRole` middleware.** Phase 1 is about behavioral fixes and one removed side-effect; it is not the place to start an authority migration.

---

## 8. Recommended clarifications before Phase 2A

1. **Resolve PDN-11** (null `vt_shifts.role`) — pick a default.
2. **Resolve the `vt_users.role` column shape** (see §1.1, §1.2, §1.3). Commit to a migration plan or to keeping the column overloaded during Phase 2A and resolving in Phase 5.
3. **Define "active shift" formally:**
   - timezone of `vt_shifts.startTime/endTime`;
   - grace period;
   - source of truth (`vt_shifts` vs `vt_shift_sessions`);
   - tie-break for multiple overlapping shifts;
   - identity matching beyond `employeeName` if feasible.
4. **Decide the fate of `secondaryRole`** — drop, deprecate, remap.
5. **Map `lead_technician` and `vet_tech` to canonical roles** or declare them data errors to be cleaned up.
6. **Specify FE refresh behavior on shift transitions** — poll, SSE event, or focus-refresh.
7. **Specify idempotency behavior across shift transitions** — re-evaluate authority or return cached.
8. **Carve out read-only ward TV / Display page** from the active-shift requirement (or confirm service accounts get an "always-active virtual shift").
9. **Specify cross-clinic user behavior** — explicit per-request scoping (already implicit in code) and an acknowledged test case.
10. **Decide whether off-shift Admin retains any clinical-override** for operational unstuck-task flows.

---

## 9. Recommended clarifications before Phase 3

1. **PDN-10** — per-task-type escalation matrix. Must be locked before Phase 3B fan-out.
2. **PDN-T1 through PDN-T5** — five task-matrix follow-ups in `TPM §8`. Phase 3A creation matrix is authoritative-by-omission today; lock these before Phase 3A.
3. **Define escalation acceptance race resolution** — DB conditional update, optimistic version, or app-level lock. Document the chosen mechanism.
4. **Define escalation refusal re-fan-out policy** — re-notify newly-on-shift staff at intervals, or never. Without this, refused tasks silently die.
5. **Define empty-eligible-set behavior** — what happens when nobody is on shift to receive an escalation. Re-escalate? Dead-letter? Operations alert?
6. **Decide Phase 3B storage strategy** (column vs metadata JSON) considering Phase 3C scheduler query plan.
7. **Define medication-issue path fallback** — what happens when the creating Vet is off-shift. Re-route to active-shift Vet? Operations alert?
8. **Confirm Student behavior in escalation fan-out** — do Students ever receive escalation pushes? If not, they should be filtered.
9. **Decide forward-dated task semantics** (PDN-T4) — assignee may be off-shift at creation but on-shift at task time.
10. **Specify whether the eligible-assignees endpoint requires active-shift caller** or returns a degraded list off-shift.
11. **Decide what happens when a task's assignee shifts off mid-task** — must they finish, hand off, or get blocked?

---

## 10. Things intentionally left correct-as-is

These are well-formed in the current code and the Phase 0 docs do not propose to change them. They are noted here so future review does not disturb them.

1. **Multi-tenancy via `clinicId`.** Sampled queries consistently filter by `req.clinicId`. Preserve.
2. **Idempotency middleware on POST/PATCH mutations.** Correct pattern. (Note: behavior under shift transitions is §4.8 follow-up; the middleware itself is fine.)
3. **Roles always read from DB, never JWT claims.** `server/middleware/auth.ts:377` is the right defensive posture. Preserve.
4. **Atomic billing transaction in `completeTask`.** `appointments.service.ts:1319-1506` wraps appointment update + billing-ledger insert in a transaction with idempotency keys, then enqueues the inventory job after commit. Sound. Preserve.
5. **SSE catchup / replay-on-reconnect pattern.** `/api/realtime/stream` and `/api/er/stream` correctly reconstruct state on cold reload. Preserve.
6. **Intentionally unauthenticated endpoints**: `/health/*` (load balancer), `/webhooks/` (HMAC-verified), `/push/vapid-public-key` (public key). Correct.
7. **Audit policy: blocked attempts not logged.** Deliberate product choice. Preserve.
8. **Code Blue manual-logging model.** `OM §2.7` confirms manual-only is the current scope. PR 1.6 enforces it. Preserve.
9. **The `(systemRole, clinicalRole, shiftRole)` triple itself.** This review does not propose to expand or replace it. Preserve.
10. **`requireAuth` populating `req.authUser` from DB per request.** Preserve.
11. **ER allowlist data file `shared/er-mode-access.ts`.** The structural pattern (prefix list + helper functions) is correct. Phase 4 PR 4.2 adds the middleware that consumes it; the file's shape is sound. Only its contents need PDN-8 input.
12. **`shiftRole` override of `clinicalRole` (not max-of).** This is the load-bearing semantic of the new model; everything in §4 turns on it. Preserve.

---

## Cross-reference summary

| Concern | Doc location | Plan v2 phase that lands behavior | Hard dependency |
|---|---|---|---|
| Column strategy for `role` | `AM §1`, `EAM` summary | Phase 2A | §1.1 (this review) |
| `requireAdmin` mapping | `AM §3.5` | Phase 2A → 2C sweep | §1.2 (this review) |
| `secondaryRole` fate | `EAM` (legacy note) | Phase 2A or Phase 5 | §1.3 (this review) |
| Code Blue mid-shift end | `OM §2.4`, `§2.8` | Phase 4 PR 4.7 | §1.4 (this review) |
| PDN-11 (null shiftRole) | `AM §6` | Phase 2A | §1.5 (this review) |
| Active shift definition | `AM §1`, implicit | Phase 2A | §2.1 (this review) |
| FE freshness on shift transition | `AM §4` | Phase 2A | §2.2 (this review) |
| PDN-10 escalation matrix | `TPM §5.4` | Phase 3B/3C | §2.3 (this review) |
| PDN-8 ER allowlist | `OM §1.4` | Phase 4 PR 4.2 | §2.4 (this review) |
| Manager picker rename | `OM §2.4` | Phase 4 PR 4.6 | §1.7 (this review) |
| PR 1.6 Code Blue equipment | `OM §2.7` | Phase 1 PR 1.6 | §3.6 (this review) |
| PR 1.2 deploy ordering | (none) | Phase 1 PR 1.2 | §3.5 (this review) |
| Audit gaps on patients / restock / crash cart | `EAM` | Phase 5 (PDN-5 dependent) | §5.7–§5.11 (this review) |

---

## Notes on scope

- This review is **read-only**. It does not approve or block any specific PR; it identifies questions that should be answered before each PR is written.
- "Critical blocker" means "Phase 1 cannot land safely without a written decision," not "the codebase is broken today."
- Every "PDN" reference points to a tag already in the Phase 0 docs. This review does not invent new PDNs; it pulls them into a sequencing order tied to phase gates.
- Where this review flags a workflow regression (e.g., off-shift Vet remote work), it does so to elicit product confirmation; the regression may be intentional under Plan v2's model.
