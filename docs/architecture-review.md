# VetTrack Phase 0 — Architecture Review

**Status:** Read-only analysis. No code, migrations, or runtime changes.
**Source documents reviewed:** `docs/authority-model.md`, `docs/task-product-model.md`, `docs/operational-modes.md`, `docs/endpoint-authority-matrix.md`.
**Purpose:** Surface contradictions, ambiguities, hidden coupling, concurrency risks, workflow dead-ends, and rollout exposure **before Phase 1 implementation begins**.

**This document has been updated to reflect:**
1. The clarified Vet operational-role model (`AM §4` — manual check-in, V1 operational roles, `allowedOperationalRoles`).
2. The confirmed EZShift mapping for Techs / Senior Techs (`AM §3.5`).
3. The narrowed ER Mode toggle authority (active-shift Senior Vet only, gated via `canToggleErMode` helper).
4. The broadened **Phase 2.5 — Clinical Check-in & Active Authority Infrastructure** (renamed from "Vet Check-in & Operational-Role Infrastructure") between Phase 2A and Phase 4 (§3.11 of this review). Phase 2.5 now covers **both** Vet check-in (with operational-role selection) and Tech / Senior-Tech check-in confirmation (presence-only).
5. The **schedule + check-in** composition for Tech / Senior-Tech active authority (`AM §3.2`): EZShift alone is now scheduled eligibility, not active authority. Tech check-in is the binding event.
6. The **six-layer authority separation** (`AM §4.8`) that decouples clinical capability from organizational policy via named decision helpers (`canManageCodeBlue`, `canToggleErMode`, etc.). Endpoint code must never hardcode clinic-specific rules; helpers consume `(userAuthority, clinicPolicy)`.
7. **Offline-safe operation as a core architectural requirement** (`AM §2 rule 7`, `docs/offline-operational-architecture.md`, `docs/ownership-lifecycle.md`). V1 is online-first, offline-tolerant, backend-authoritative on reconcile. No CRDTs, event sourcing, or distributed sync. Per-workflow offline behaviour is enumerated in `offline-operational-architecture.md §3`.
8. **Ownership semantics formalised** in `docs/ownership-lifecycle.md`: four-concept separation (workflow ownership / authority to act / operational assignment / historical responsibility); per-workflow lifecycle for all nine V1 workflow types; disconnect / reconnect / shift-end behaviour codified.

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

### 1.5 PDN-11 — RESOLVED / SUBSUMED by the EZShift mapping layer

PDN-11 originally asked: if a `vt_shifts` row exists with `role = null`, does the user have any clinical authority? **This is now resolved.** Per `docs/authority-model.md §3`, `vt_shifts` rows are populated by the EZShift import; the mapping table in §3.5 deterministically translates labels to `shiftRole`. Rows whose labels cannot be mapped produce `shiftRole = null` and (proposed default) confer **no** clinical authority.

The narrower question — what is the default for an **unrecognised** EZShift label — is the active-shift-series successor **PDN-A2**. Phase 2A unblocks the original PDN-11; only PDN-A2 remains a precondition for the resolver.

Two corollary resolutions follow:

- The "fall back to `clinicalRole`" option is explicitly **rejected** by the override rule in `AM §2`. EZShift mapping is the source; no clinical authority is inferred from `clinicalRole` alone.
- `vt_shift_sessions` is **not** consulted for authority resolution under the current model; `vt_shifts` (EZShift-populated) is canonical.

### 1.6 Phase 1 PR 1.5 uses `clinicalRole === "vet"` data that may not exist post-split

PR 1.5 is described as relying on "the current `clinicalRole === 'vet'` data." But §1.1 above shows that "current clinicalRole" is not a discrete value today — it is part of an overloaded enum. Once the column split lands (Phase 2A), the predicate "is this user a Vet?" may evaluate differently for users currently typed as `role = "admin"`.

Therefore PR 1.5 has a *latent* dependency on the column-strategy decision. Shipping PR 1.5 before §1.1 is resolved means PR 1.5 may need to be re-asserted (or re-tested) the day the split lands.

### 1.7 Manager picker contract is changing during Phase 4 PR 4.6 with no migration path

`GET /api/users/managers` exists today (users.ts:923). Phase 4 PR 4.6 will introduce `GET /api/users/active-shift-vets` and re-filter. `EAM` does not say whether:

- The legacy path stays as an alias for one release.
- The response shape (field names, additional metadata) changes.
- FE callers that currently rely on `/managers` are migrated in the same PR.

Code Blue start flow depends on this endpoint; a wrong sequence is a clinical-flow regression. **The picker must also annotate Senior Vets distinctly so the FE can surface them first per `OM §2.4`** — this requires Phase 2.5 (Vet check-in subsystem) to exist.

### 1.8 NEW BLOCKER — Plan v2 has no phase for Clinical check-in infrastructure (renamed & broadened)

The combined model (`AM §3.2` Tech check-in + `AM §4` Vet check-in + `AM §4.8` layered separation) requires:

- a **Tech / Senior-Tech check-in subsystem** confirming presence for EZShift-scheduled-eligible users (PDN-V13..V15);
- a **Vet check-in subsystem** with operational-role selection (PDN-V1);
- an `allowedOperationalRoles` configuration per user (PDN-V2, V3);
- a resolver extension that combines EZShift-derived eligibility + Tech check-in for `Technician` / `Senior Technician`, and check-in-derived operational role for `Vet`, into a single authority decision (`AM §4.6`);
- **decision-helper boundaries** (`canManageCodeBlue`, `canToggleErMode`, `canCreateErIntake`, `canCreateMedicationTask`) consuming `(userAuthority, clinicPolicy)` — `AM §4.8`;
- audit of check-in / check-out events for both Techs and Vets (PDN-V4, broadened).

**None of this is in Plan v2.** Phases 2A–2C migrate authority gates without it; Phase 3A enforces task creation without it; Phase 4 hardens ER/Code Blue with explicit operational-role dependencies. Every Phase 4 PR that mentions "active-shift" anything depends on a subsystem that does not exist in any current phase. **The schedule+check-in change for Techs (since the previous review) widens this dependency from "Vet endpoints only" to "every clinical endpoint."**

**Recommendation:** insert a new **Phase 2.5 — Clinical Check-in & Active Authority Infrastructure** (renamed from "Vet Check-in & Operational-Role Infrastructure" in the previous review) between Phase 2A (authority-model introduction) and Phase 4 (ER/Code Blue hardening). Phase 2.5 owns:

- new schema for **both** Tech / Senior-Tech and Vet check-in sessions (PDN-V1, PDN-V3 — likely a single `vt_clinical_shift_sessions` table with a `check_in_kind` discriminator);
- new endpoints `POST /api/shift-sessions/check-in`, `POST /api/shift-sessions/check-out`, `GET /api/shift-sessions/me`;
- `allowedOperationalRoles` configuration surface for Vets (admin UI is Phase 5);
- resolver extension to consult check-in for **both** clinical-role branches;
- FE check-in flow on session start — Vet picker selects operational role; Tech picker confirms presence (operational role is already determined by EZShift);
- **decision-helper boundaries** as thin pass-throughs that return the layer-5 capability for V1 (no clinic policy lookup yet);
- audit on every check-in / check-out / role-change (PDN-V4, broadened);
- in-flight responsibility handling on check-out (PDN-V8 — active Code Blue manager, in-progress tasks).

Phase 2.5 must land **before** Phase 4. Phase 3A's clinical-typed task creation matrix (`TPM §2.2`) also depends on Phase 2.5; Phase 3A may need to ship in two parts — generic non-medication first (no Phase 2.5 dependency) and clinical-typed (after Phase 2.5).

**Operational impact.** Without Phase 2.5, Phase 4 either ships with coarser `clin(vet)` gates (no Senior Vet specificity) and coarser `clin(tech+)` gates (EZShift-only, no check-in) or does not ship at all. Coarser gates are recoverable but produce *visible authority regressions* relative to product intent. **Migration impact:** adding Phase 2.5 is additive (new tables, new endpoints, no breaking change). Rolling out check-in to Techs is the *operational* migration that needs care — see §3.11 sequencing notes and the new risks in §X. **Safety impact:** ER Mode toggle authority is the most safety-relevant gate; the schedule+check-in composition raises the bar for who can toggle, which is a clinical safety improvement once Phase 2.5 lands. Pre-Phase-2.5 the gate is coarser and weaker than product intent.

### 1.9 NEW BLOCKER — Decision-helper boundaries are not in any current PR

`AM §4.8` and `OM §2.4` introduce the architectural requirement that endpoint code routes Code Blue manager eligibility (and similar clinic-variable gates) through named decision helpers consuming `(userAuthority, clinicPolicy)`. **No Plan v2 PR explicitly creates these helpers.** Phase 4 PR 4.6 and 4.7 currently assume direct endpoint-level gate checks.

**Recommendation:** the Phase 2.5 PR that ships the resolver extension should also ship the helper boundaries as thin pass-throughs:

- `canManageCodeBlue(userAuthority, clinicPolicy = { allowAllActiveShiftVets: true }) -> boolean`
- `canToggleErMode(userAuthority, clinicPolicy = { seniorVetOnly: true }) -> boolean`
- `canCreateErIntake(userAuthority, clinicPolicy = { receivingVetPrimary: true }) -> boolean`
- `canCreateMedicationTask(userAuthority, clinicPolicy = { anyVetOperationalRole: true }) -> boolean`

Phase 4 PRs then call the helpers instead of inline-checking operational roles. This is critical to preserve VetTrack's evolution path from single-clinic to multi-clinic operational platform.

**Impact of skipping this.** If Phase 4 ships with inline gates (e.g., `if (caller.operationalRole === "senior_vet")` in the toggle handler), every subsequent clinic-policy variation requires re-coding the endpoint. The decoupling cost rises geometrically with each clinic added.

---

## 2. High-risk ambiguities

### 2.1 What counts as "active shift" — PARTIALLY RESOLVED, REVISED

`docs/authority-model.md §3` and `§4` define active-shift authority as **scheduled/configured eligibility PLUS check-in confirmation** — both required for ALL clinical roles. Recent revision: **Techs / Senior Techs now also require check-in** (EZShift alone is scheduled eligibility, not active authority).

Resolved:

- **Source of eligibility (Techs)** — `vt_shifts` populated by EZShift import.
- **Source of eligibility (Vets)** — `allowedOperationalRoles` configuration.
- **`vt_shifts.role` semantics** — derived deterministically from the EZShift label via `AM §3.5`.
- **EZShift label → role mapping** for `בכיר`, `טכנאי בכיר`, `טכנאי קבלה`, `טכנאי חירום`, `טכנאי אשפוז`, `טכנאי אסופיים`, `תמך בוקר`, `תמך ערב`, any `תמך …`, `התלמדות`, and standalone area labels — RESOLVED in `AM §3.5`.
- **Activation mechanism** — RESOLVED: check-in for all clinical roles (Tech check-in PDN-V13..V15; Vet check-in PDN-V1).
- **`vt_shift_sessions` vs `vt_shifts`** — RESOLVED: `vt_shifts` is the eligibility source; the new `vt_clinical_shift_sessions` (or equivalent) introduced by Phase 2.5 will record check-in events.
- **Schedule != physical attendance** — still explicitly accepted. Clock-in via attendance device, late-arrival / early-departure detection, absence handling, last-minute substitutions outside EZShift remain explicitly deferred.

**Still open (the active-shift PDN-A series):**

- **PDN-A1** Identity matching between EZShift name and VetTrack user record (current display-name match is fragile).
- **PDN-A2** Unrecognised EZShift label default behaviour.
- **PDN-A3** Schedule freshness / staleness handling.
- **PDN-A4** Timezone normalisation + grace-period semantics.
- **PDN-A5** Tie-break for multiple overlapping rows.
- **PDN-A6** Audit policy on the import operation itself.
- **PDN-A7** How Students (manually configured in VetTrack, not in EZShift) receive an active-shift role, if at all.
- **PDN-A8** Whether Trainees (`התלמדות`) can be granted scoped clinical authority in a future phase.
- **PDN-A9** Department/area metadata surface in API responses.

PDN-A1, PDN-A2, PDN-A4, and PDN-A5 are precondition-grade for Phase 2A's resolver. PDN-A7 is precondition-grade for any endpoint that currently allows `requireEffectiveRole("student")` (equipment scan / checkout / return / per-equipment scan — see endpoint matrix).

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

A user with active shifts in two clinics simultaneously. `req.clinicId` scopes the resolver. The model handles this per-request, but the doc does not enumerate the case and there is no test plan for it in Phase 2A. For Vets specifically, **multi-clinic check-in (PDN-V7)** adds another dimension: a Vet might be checked in at clinic A and need authority for an action at clinic B.

### 2.12 Vet operational-role coverage gaps

`AM §4.3` enumerates V1 operational-role capabilities, but several rows resolve to "❌ default" or "if assigned per workflow", and the override mechanism is **PDN-V6**. Concretely:

- A Hospitalization Vet asked to start an ER intake mid-shift cannot do so under default rules. Either the patient is re-routed to a Receiving Vet, or a Senior Vet authorises an ad-hoc role override. The override mechanism is undefined.
- An ER/ICU Vet wanting to write a hospitalization clinical task during transfer is in the same position.
- A Receiving Vet who is the only Vet checked in when a Code Blue starts may be assigned manager (per `AM §4.3`) but the doc does not say whether they can perform high-level clinical overrides typically reserved for Senior Vet.

Phase 4 PRs will surface these gaps as 403s on real workflows unless PDN-V6 resolves first.

### 2.13 ER Mode dead-lock

ER Mode is `enforced`. The Senior Vet who toggled it checks out (or their shift ends). No other Senior Vet is currently checked in. **No one can disable ER Mode** under the strict `clin(senior_vet)` gate. This is **PDN-V10**. Without an escape-hatch (e.g., `systemRole = Admin` override, or auto-disable on absence of Senior Vet for N minutes), the system can enter a state requiring out-of-band intervention.

### 2.14 Code Blue manager auto-assignment when no Senior Vet is checked in

`OM §2.4` says "Senior Vet preferred; any other operational Vet role may be the manager when no Senior Vet is available." The doc does not say:

- Does the system auto-assign the next-eligible Vet?
- Does the FE just show a banner "no Senior Vet — pick any operational Vet"?
- Does the picker order Vets by some heuristic?

This is **PDN-V11**.

### 2.15 Senior Vet authority over Code Blue sessions started before their check-in

A Code Blue is in progress with manager = ER/ICU Vet. Senior Vet walks in and checks in. Does the Senior Vet automatically gain manager authority? Can they end the session in place of the assigned manager? `AM §4.3` says Senior Vet can do high-level clinical overrides; `OM §2.4` says only the assigned manager may end. These are not strictly contradictory but the boundary is undefined. **PDN-V12.**

### 2.16 Manager Vet checks out mid-Code Blue

The assigned manager checks out before the session is ended. Under strict active-shift rules, they lose authority — and the session has no Vet manager. Per `OM §2.4`, **end is blocked when no Vet manager exists**, so the session becomes un-endable until another Vet checks in and is reassigned manager. The reassignment mechanism is not defined; **PDN-V8** scopes check-out with in-flight responsibilities.

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

### 3.11 NEW — Phase 2.5 sequencing into Plan v2 (RENAMED & BROADENED)

The newly-required **Phase 2.5 — Clinical Check-in & Active Authority Infrastructure** (renamed from "Vet Check-in & Operational-Role Infrastructure") is not yet in Plan v2. It now covers **both** Tech / Senior-Tech check-in confirmation AND Vet operational-role check-in. The recommended sequencing is:

1. Phase 0 (docs, this work) — DONE.
2. Phase 1 (surgical fixes) — proceeds with current coarse role-string semantics.
3. Phase 2A (authority model alongside legacy) — no check-in or operational-role awareness yet. The resolver returns `null` for Vet `activeShiftRole` and returns the EZShift-eligibility-only `shiftRole` for Techs (no check-in confirmation gate).
4. Phase 2B (high-risk endpoint enforcement) — uses **coarse** gates: `clin(vet)` (any clinicalRole=vet) for ER intake (PR 2B.5) and ER Mode toggle (PR 2B.6); `clin(tech+) on EZShift schedule only` for inventory / equipment-return / crash-cart endpoints (PRs 2B.1–2B.3). Check-in-confirmed gating is **explicitly deferred to Phase 2.5 + Phase 4**.
5. Phase 2C (incremental migration) — same coarse semantics. Vet endpoints use `clin(vet)`; Tech / Senior-Tech endpoints use EZShift-eligibility-only.
6. **Phase 2.5 (NEW, RENAMED & BROADENED)** — Clinical Check-in & Active Authority Infrastructure. Owns BOTH Tech and Vet check-in subsystems, plus decision-helper boundaries.
7. Phase 3A (task creation matrix) — generic non-medication first, clinical-typed (ER intake / hospitalization / ER-ICU) **after Phase 2.5**.
8. Phase 3B / 3C (escalation) — depends on PDN-10 (per-task-type escalation matrix), which now interacts with operational-role-based per-task-type recipient lists.
9. Phase 4 (ER / Code Blue hardening) — uses operational-role gates from `AM §4` and decision helpers from `AM §4.8`. Senior Vet enforcement on ER Mode toggle (PR 4.1) lands here via `canToggleErMode`. Manager picker (PR 4.6) annotates Senior Vets distinctly; the gate flows through `canManageCodeBlue`.
10. Phase 5 (cleanup, tests, i18n, monitoring) — adds operational-role to audit-coverage tests; admin tooling for `allowedOperationalRoles` and clinic policy (PDN-V16, V17).

**Critical:** Phase 4 cannot ship if Phase 2.5 has not. Plan v2's Phase 4 PR 4.1 / 4.6 / 4.7 / 4.10 must explicitly declare "blocked by Phase 2.5" in their PR descriptions.

**Migration impact for Tech check-in (NEW concern):** Adding check-in for Techs is a **larger operational shift than adding it for Vets**. Techs are accustomed to "schedule = on duty." A check-in step at shift start changes daily workflow. UX must be near-zero-friction (single tap; possibly auto-prompt on login during an eligible shift); PDN-V13..V15 cover this. Rollback is removing the check-in requirement and falling back to EZShift-eligibility-only — a one-config-flag operation if Phase 2.5 ships behind a feature flag.

**Migration impact for decision helpers:** Phase 2.5 ships helpers as thin pass-throughs (V1 clinic policy hard-coded). Phase 4 wires them into endpoints. Future phases may introduce clinic-specific policy data and editing UIs. Rollback at the helper layer is removing the `clinicPolicy` parameter and using the layer-5 capability directly — non-breaking.

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

### 4.12 Vet without `allowedOperationalRoles`

A Vet user whose `allowedOperationalRoles` is empty cannot check in at all. Under the new model they have no clinical authority, identical to off-shift. **PDN-V2** must define whether the default is empty (fail-closed; safe but breaks existing Vets until admin tooling lands) or non-empty (e.g., `[er_icu_vet]`; permissive default; risk that all Vets gain ER/ICU authority on rollout). Phase 2.5 needs this answer.

### 4.13 Operational-role change mid-shift

A Vet checked in as `receiving_vet`. Mid-shift, ICU is overwhelmed and they need to act as ER/ICU Vet. Today they would have to check out (losing in-flight responsibilities — PDN-V8) and check in again. **PDN-V9** asks whether a mid-shift operational-role swap is allowed without a full cycle.

### 4.14 systemRole = Admin Vet check-in

A user with `systemRole = Admin` AND `clinicalRole = Vet` and `allowedOperationalRoles = [senior_vet]`. They check in as Senior Vet. They now have both system-admin (any orthogonal action) AND active-shift Senior Vet authority. Two authorities are evaluated independently per `AM §6`. Edge case: if they check out, system-admin remains; clinical authority disappears. Documented but worth surfacing in tests.

### 4.15 Multiple Senior Vets simultaneously checked in

Two Senior Vets are checked in. Each can independently toggle ER Mode. Race between two toggles produces "enabled, then disabled, then enabled" interleavings. Audit log makes the sequence visible but the *current state* may surprise users.

### 4.16 Vet check-out while assigned Code Blue manager

`OM §2.4` says "end is blocked when no Vet manager exists." If the manager checks out, the session is in a "manager-absent" state. Phase 4 must either auto-pop a banner ("reassign manager") or prevent the check-out itself. **PDN-V8.**

### 4.17 Vet check-in is itself an authority-granting event — needs audit

Per `AM §4.4` and `OM §4.2 PDN-V4`, every check-in / check-out is a mutation that grants / revokes clinical authority. Audit policy for this is open. Without per-session audit, "who was Senior Vet at 03:14 last night" is unanswerable.

### 4.18 Tech check-in adoption risk (NEW)

Phase 2.5 introduces a check-in requirement for Technicians and Senior Technicians. The current operational pattern at the founder's clinic is "scheduled = on duty"; an additional explicit action at shift start is a daily-workflow change. UX must be near-zero-friction:

- Single tap on shift start;
- Auto-prompt on login during an EZShift-eligible window;
- Possibly auto-check-in on first authenticated request (rejected per `AM §3.2.2` because it defeats the binding-event purpose; documented as a non-option).

Bad UX produces two failure modes:

1. **Scheduled-Tech-not-checked-in** — user is at the clinic but cannot perform clinical actions. They see 403s and assume the system is broken.
2. **Late check-in** — user starts work, the system rejects their first request, and they lose minutes of clinical time per shift.

**Mitigation owned by PDN-V13..V15 (UX) and PDN-V14 (granularity).** This is the largest operational risk introduced by the schedule+check-in change.

### 4.19 Helper-boundary regression risk (NEW)

`AM §4.8` requires endpoints to route Code Blue manager and ER Mode toggle eligibility through `canManageCodeBlue` and `canToggleErMode` helpers. Endpoint authors familiar with inline checks may bypass the helper "for clarity" and inline the V1 hardcoded policy. This is:

- syntactically tempting (the V1 policy is simple);
- silently correct for the founder's clinic;
- a **breaking regression** the moment a second clinic with different policy is added.

**Mitigation:** Phase 2.5 PR template MUST include a checklist item "this endpoint routes clinic-variable gates through a named helper (or none are present)." Code review must enforce.

### 4.20 ClinicPolicy data shape is unspecified (PDN-V16)

`AM §4.8` and `OM §2.4` reference `clinicPolicy` as a parameter to helpers but do not specify where it lives. Three plausible storage shapes:

1. **JSON field on `vt_clinics`** — simplest; loads with the clinic record; survives migrations easily.
2. **Separate `vt_clinic_policies` table** — one row per (clinic, policy-key); more queryable; allows audit of policy changes.
3. **Env-keyed config file** — no DB at all; fast; cannot be edited at runtime.

For V1, all three are equivalent because the policy is static. The choice matters for Phase 5 (clinic-editable admin UI) and for PDN-V17 (edit authority).

### 4.21 Tech check-in granularity vs EZShift block boundaries (PDN-V14)

EZShift blocks are scheduled time windows. A Tech check-in is a per-block event. What happens at block boundaries?

- **Strict per-block:** check-out auto-fires at block end; the Tech must re-check-in for the next block (high friction).
- **Auto-extend on same-day overlap:** if two consecutive blocks for the same user are contiguous, treat as one session.
- **Per-login:** check-in lasts until logout; no block awareness.

Each choice has different implications for audit trail granularity, fairness in time-tracking, and authority lapse at boundary moments. **PDN-V14.**

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

### 6.2 `vt_shift_sessions` vs `vt_shifts` — RESOLVED

`vt_shifts` is the source of truth for active-shift authority; `vt_shift_sessions` is not consulted by the resolver. Confirmed in `AM §3`. No remaining debt here.

### 6.3 EZShift identity matching (was: "shift match by display name")

`role-resolution.ts` matches EZShift staff names against VetTrack user display names. Display names are mutable, non-unique, and prone to transliteration drift. The same physical staff member may be named differently in the EZShift export and the VetTrack user record. The match is silently fragile. Tracked as **PDN-A1**; needs resolution before Phase 2A's resolver hardens around it.

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

### 8.1 Resolved by the EZShift mapping decision

- **PDN-11** (null `vt_shifts.role`) — RESOLVED. Subsumed by `AM §3.5` and PDN-A2.
- **Source of truth `vt_shifts` vs `vt_shift_sessions`** — RESOLVED. `vt_shifts` (EZShift-populated).
- **EZShift label → role mapping for `בכיר`, `טכנאי …`, `תמך …`, `התלמדות`, standalone area labels** — RESOLVED in `AM §3.5`.
- **Schedule != attendance** — explicit acceptance; clock-in / late-arrival / early-departure / absence / manual override / last-minute substitution are explicitly deferred.

### 8.2 Still required before Phase 2A's resolver compiles

1. **Resolve the `vt_users.role` column shape** (see §1.1, §1.2, §1.3). Commit to a migration plan or to keeping the column overloaded during Phase 2A and resolving in Phase 5.
2. **PDN-A1** — EZShift identity-matching strategy. Display-name match is the current fragile default; commit to it explicitly, or design an employee-ID join or admin-curated mapping table before the resolver hardens.
3. **PDN-A2** — Unrecognised EZShift label default. Proposed: `shiftRole = null` + admin alert. Confirm or counter.
4. **PDN-A4** — Timezone normalisation of `vt_shifts.startTime/endTime` AND grace-period semantics. The current DB-session-timezone comparison may not match clinic-local time across deployments.
5. **PDN-A5** — Tie-break for multiple overlapping EZShift rows for the same user.
6. **Decide the fate of `secondaryRole`** — drop, deprecate, remap. The EZShift model does not consult secondaryRole; explicit retirement is needed.
7. **Map `lead_technician` and `vet_tech` to canonical roles** or declare them data errors to be cleaned up before Phase 2A.
8. **Specify FE refresh behavior on shift transitions** — poll, SSE event, focus-refresh. Applies symmetrically to Vet check-in / check-out events (Phase 2.5).
9. **Specify idempotency behavior across shift transitions** — re-evaluate authority or return cached.
10. **Carve out read-only ward TV / Display page** from the active-shift requirement (or confirm service accounts get an "always-active virtual shift").
11. **Specify cross-clinic user behavior** — explicit per-request scoping (already implicit in code) and an acknowledged test case.
12. **Decide whether off-shift Admin retains any clinical-override** for operational unstuck-task flows.
13. **PDN-A7** — Student authority under the new model: Students are not in EZShift. Without resolution, the four `equipment.ts` endpoints currently gated `requireEffectiveRole("student")` will lose their Student callers when Phase 2C migrates them.

### 8.3 Required before Phase 2.5 (NEW — RENAMED & BROADENED)

These do not block Phase 2A but block the new **Phase 2.5 — Clinical Check-in & Active Authority Infrastructure** (covers both Tech and Vet check-in). Phase 4 transitively depends on these.

1. **PDN-V1** — Check-in subsystem design covering BOTH Vet (with operational-role selection) and Tech / Senior-Tech (presence-only). Storage shape (single `vt_clinical_shift_sessions` table with discriminator vs two tables); endpoint contracts; FE flows.
2. **PDN-V2** — Default `allowedOperationalRoles` for Vet users with no explicit configuration. Fail-closed (empty) is safest but breaks all existing Vets until admin tooling lands. Confirm or counter.
3. **PDN-V3** — Storage shape for `allowedOperationalRoles` (column-on-vt_users array vs separate row-per-role table).
4. **PDN-V4** — Audit policy for check-in / check-out / operational-role change (Vets) and check-in / check-out (Techs).
5. **PDN-V5** — On-call Vet → full-authority transition mechanism. Cannot ship Phase 4 manager-picker handling without this.
6. **PDN-V6** — Senior Vet operational override for "❌ default" capabilities.
7. **PDN-V7** — Multi-clinic check-in (Vet AND Tech).
8. **PDN-V8** — Check-out with in-flight responsibilities (active Code Blue manager, in-progress tasks). Force handoff, auto-close, or block check-out? Applies to both Tech and Vet.
9. **PDN-V9** — Mid-shift operational-role change for Vets without full check-out / check-in cycle.
10. **PDN-V13** (NEW) — Tech / Senior-Tech check-in UX flow (mobile-only? shared-device kiosk? badge swipe?).
11. **PDN-V14** (NEW) — Tech check-in granularity (per EZShift block? per login? auto-extend on overlap?).
12. **PDN-V15** (NEW) — UI affordance for scheduled-but-not-checked-in Tech (banner, force-modal, none).
13. **PDN-V16** (NEW) — Clinic-policy data shape. Even though V1 is static, Phase 2.5 ships the helpers; the parameter shape needs to be decided.
14. **PDN-V17** (NEW) — Clinic-policy edit authority (deferred to Phase 5+).

### 8.4 Required before Phase 4 (over and above 8.2 / 8.3)

1. **PDN-V10** — ER Mode dead-lock policy. When ER Mode is `enforced` and no Senior Vet is checked in, who can disable? Phase 4 PR 4.1 must ship with an escape-hatch.
2. **PDN-V11** — Code Blue manager auto-assignment when no Senior Vet checked in. Phase 4 PR 4.6 manager picker.
3. **PDN-V12** — Senior Vet authority over Code Blue sessions started before their check-in.
4. **PDN-CB1, CB2, CB3** — Code Blue follow-ups already in `OM §4`.

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
| Concern | Doc location | Plan v2 phase | Hard dependency |
|---|---|---|---|
| Column strategy for `role` | `AM §1`, `EAM` summary | Phase 2A | §1.1 (this review) |
| `requireAdmin` mapping | `AM §4.5` | Phase 2A → 2C sweep | §1.2 (this review) |
| `secondaryRole` fate | `EAM` (legacy note) | Phase 2A or Phase 5 | §1.3 (this review) |
| Code Blue mid-shift end | `OM §2.4`, `§2.8` | Phase 4 PR 4.7 | §1.4 (this review) |
| PDN-11 (null shiftRole) | `AM §7.1` | RESOLVED — subsumed by `AM §3.5` + PDN-A2 | §1.5 (this review) |
| Active shift definition | `AM §3` | partially resolved: EZShift; PDN-A series remain | §2.1 (this review) |
| EZShift identity matching (PDN-A1) | `AM §3.6` | Phase 2A | §6.3 (this review) |
| Unrecognised EZShift label default (PDN-A2) | `AM §3.5` | Phase 2A | §1.5 (this review) |
| Schedule staleness (PDN-A3) | `AM §3.7` | Phase 2A or later | §2.1 (this review) |
| Timezone + grace period (PDN-A4) | `AM §3.8` | Phase 2A | §2.1 (this review) |
| Overlapping rows tie-break (PDN-A5) | `AM §3.9` | Phase 2A | §2.1 (this review) |
| Import audit policy (PDN-A6) | `AM §3.4` | Phase 5 | §2.1 (this review) |
| Student under new model (PDN-A7) | `AM §3.5` decomposition rules | Phase 2C (per-endpoint) | §2.1 (this review) |
| Trainee future authority (PDN-A8) | `AM §3.5` | DEFERRED | §2.1 (this review) |
| Department metadata surface (PDN-A9) | `AM §3.10` | Phase 3A / Phase 4 | §2.1 (this review) |
| FE freshness on shift transition | `AM §3.3` | Phase 2A | §2.2 (this review) |
| PDN-10 escalation matrix | `TPM §5.4` | Phase 3B/3C | §2.3 (this review) |
| PDN-8 ER allowlist | `OM §1.4` | Phase 4 PR 4.2 | §2.4 (this review) |
| Manager picker rename | `OM §2.4` | Phase 4 PR 4.6 | §1.7 (this review) |
| PR 1.6 Code Blue equipment | `OM §2.7` | Phase 1 PR 1.6 | §3.6 (this review) |
| PR 1.2 deploy ordering | (none) | Phase 1 PR 1.2 | §3.5 (this review) |
| Audit gaps on patients / restock / crash cart | `EAM` | Phase 5 (PDN-5 dependent) | §5.7–§5.11 (this review) |
| **NEW — Vet check-in subsystem (PDN-V1)** | `AM §4.1`, `OM §0` | **Phase 2.5 (new, renamed)** | §1.8 (this review) |
| **NEW — Tech / Senior-Tech check-in confirmation (broadened §3.2 + PDN-V13..V15)** | `AM §3.2`, `OM §0` | **Phase 2.5 (renamed & broadened)** | §1.8, §4.18 (this review) |
| **NEW — Decision-helper boundaries (`canManageCodeBlue` etc.)** | `AM §4.8`, `OM §2.4` | **Phase 2.5 (helpers as pass-through) + Phase 4 (wired in)** | §1.9, §4.19 (this review) |
| **NEW — Vet operational roles V1 (`AM §4.2`)** | `AM §4.2` | Phase 2.5 + Phase 4 | §1.8, §2.12 (this review) |
| **NEW — `allowedOperationalRoles` config (PDN-V2/V3)** | `AM §4.4` | Phase 2.5 | §4.12 (this review) |
| **NEW — Check-in audit (PDN-V4 broadened: Vet + Tech)** | `AM §8.3` | Phase 2.5 | §4.17 (this review) |
| **NEW — On-call → full-authority transition (PDN-V5)** | `AM §4.2`, `OM §2.5.1` | Phase 4 | §2.12, §4.13 (this review) |
| **NEW — Senior Vet override of role defaults (PDN-V6)** | `AM §4.3` notes | Phase 4 + Phase 2.5 | §2.12 (this review) |
| **NEW — ER Mode = Senior Vet only, via `canToggleErMode`** | `AM §5.3`, `OM §1.2` | Phase 4 PR 4.1 (after Phase 2.5) | §1.8, §1.9 (this review) |
| **NEW — ER Mode dead-lock (PDN-V10)** | `OM §1.2`, `AM §8.3` | Phase 4 PR 4.1 | §2.13 (this review) |
| **NEW — Code Blue auto-assign manager (PDN-V11)** | `OM §2.4`, `AM §8.3` | Phase 4 PR 4.6 | §2.14 (this review) |
| **NEW — Senior Vet authority over in-flight Code Blue (PDN-V12)** | `OM §2.4`, `AM §8.3` | Phase 4 PR 4.6/4.7 | §2.15 (this review) |
| **NEW — Manager Vet checkout mid-Code Blue (PDN-V8)** | `OM §2.4`, `AM §8.3` | Phase 4 PR 4.7 | §2.16, §4.16 (this review) |
| **NEW — Mid-shift role change (PDN-V9)** | `AM §8.3` | Phase 2.5 | §4.13 (this review) |
| **NEW — Tech check-in UX (PDN-V13)** | `AM §8.3` | Phase 2.5 | §4.18 (this review) |
| **NEW — Tech check-in granularity (PDN-V14)** | `AM §8.3` | Phase 2.5 | §4.21 (this review) |
| **NEW — Scheduled-not-checked-in UI affordance (PDN-V15)** | `AM §8.3` | Phase 2.5 | §4.18 (this review) |
| **NEW — ClinicPolicy data shape (PDN-V16)** | `AM §4.8`, §8.3 | Phase 2.5 (parameter shape) + Phase 5 (admin UI) | §4.20 (this review) |
| **NEW — ClinicPolicy edit authority (PDN-V17)** | `AM §8.3` | Phase 5+ | §4.20 (this review) |
| **NEW — ER intake = Receiving Vet target** | `AM §5.3`, `TPM §2.2` | Phase 4 PR 4.3 (after Phase 2.5); Phase 2B.5 ships coarser `clin(vet)` first | §3.11 (this review) |
| **NEW — Medication-task creator = any Vet operational role except on-call** | `TPM §2.2` | Phase 3A (coarse) → tightened after Phase 2.5 | §3.11 (this review) |
| **REVISED — Tech / Senior-Tech endpoints now also require Phase 2.5 for full enforcement** | `EAM` Conventions | Phase 2C (coarse EZShift-eligibility-only) → tightened after Phase 2.5 | §1.8, §3.11 (this review) |

---

## Notes on scope

- This review is **read-only**. It does not approve or block any specific PR; it identifies questions that should be answered before each PR is written.
- "Critical blocker" means "Phase 1 cannot land safely without a written decision," not "the codebase is broken today."
- Every "PDN" reference points to a tag already in the Phase 0 docs. This review does not invent new PDNs; it pulls them into a sequencing order tied to phase gates.
- Where this review flags a workflow regression (e.g., off-shift Vet remote work), it does so to elicit product confirmation; the regression may be intentional under Plan v2's model.

---

## Final consistency review (freeze-readiness pass)

This section is the **last** architecture review before implementation. Its purpose is freeze, not exploration. Each item is concise and execution-oriented.

### F.1 Critical unresolved contradictions

| # | Contradiction | Resolution before freeze |
|---|---|---|
| F.1.1 | Phase 1 PR 1.5 relies on `clinicalRole === "vet"` data, but `vt_users.role` is overloaded (§1.1). | Confirm in writing that today's `role = "vet"` is the predicate, and that PR 1.5 will be re-asserted after the Phase 2A column-shape decision. |
| F.1.2 | Phase 2B.5 / 2B.6 ship coarse `clin(vet)` gates; Phase 4 PR 4.1 / 4.3 tighten via operational-role + helpers. **A small window exists where any Vet can toggle ER Mode.** | Acknowledge in PR descriptions; document in §3.11. Acceptable interim state. |
| F.1.3 | Code Blue manager check-out is BLOCKED (Phase 2.5 Decision 4), but no reassignment UI exists until Phase 4 PR 4.6. **A Vet with an active manager assignment cannot end their shift cleanly until Phase 4 ships.** | V1 product accepts this; document in Phase 2.5 PR 2.5.3 and Phase 4 PR 4.6. |
| F.1.4 | `secondaryRole` column remains writable during Phase 2A–2C with no semantic effect. | Phase 5 retires the endpoint; for Phase 2A–4, document as a no-op surface; admin tooling should hide it. |

No other contradictions block freeze.

### F.2 Offline-related authority risks

| # | Risk | Mitigation |
|---|---|---|
| F.2.1 | Cached authority used after shift end (within 60s window). Tab A continues to show enabled buttons while server has revoked auth. | First mutation returns 401/403, cache invalidates, FE banner appears. Acceptable for V1. |
| F.2.2 | Code Blue log entries queued offline for a manager whose shift ended mid-session. | Server validates session-active on replay; log entries STILL append (log entries don't require live manager authority — `OM §2.4`). End-session rejects → reassignment required. |
| F.2.3 | Equipment double-checkout race when two users scan the same item offline. | First-to-reconcile wins; second user sees `CONFLICT` UX. **PDN-O5** locks the wording. |
| F.2.4 | Emergency dispense reconciled without medication-safety attestation. | **PDN-O3** — product decision required: do we require a post-reconnect attestation? Defaults to "no" for V1; revisit in Phase 5. |
| F.2.5 | Code Blue log entries that fail to replay (server rejects with `STATE_MISMATCH`) silently disappear from the clinical record. | **PDN-O4** — V1 default: surface to clinical incident review; never silent. Confirm. |

### F.3 Ownership lifecycle gaps

| # | Gap | Status |
|---|---|---|
| F.3.1 | Auto-reassignment of Code Blue manager when manager's shift ends without explicit handoff. | **PDN-V11** — not built in V1; Phase 2.5 Decision 4 mitigates by blocking voluntary check-out. Involuntary disconnect uses banner + reassign UI in Phase 4. |
| F.3.2 | Handoff draft authoring while offline indefinitely. | **PDN-L3** — V1 default: no expiry; revisit in Phase 5. |
| F.3.3 | Inventory job retry permission. | **PDN-4 / PDN-L5** — V1: Admin only. Future Senior Tech (PDN-7). |
| F.3.4 | On-call Vet → full-authority transition mechanism. | **PDN-V5** — on-call hidden from V1 check-in picker (Phase 2.5 Decision 3); workflow deferred to Phase 4+. |

### F.4 Migration-order blockers

None new beyond what's already documented. The five Phase 2.5 PRs are sequenced in `phase-2.5-decision-brief.md`. Phase 4 depends on Phase 2.5 landing first.

### F.5 Rollout blockers

| # | Blocker | Status |
|---|---|---|
| F.5.1 | Per-clinic feature flag (`vt_clinics.phase_2_5_enabled`) must be wired through every authority-resolution path. | Phase 2.5 PR 2.5.2 owns this. |
| F.5.2 | One-time seed migration for the founder's clinic `allowed_operational_roles`. | Phase 2.5 PR 2.5.5; mapping provided by clinic admin pre-deploy. |
| F.5.3 | `vt_clinics.policy` seeded with V1 founder policy. | Phase 2.5 PR 2.5.5. |
| F.5.4 | Backup of `vt_users` and `vt_clinics` before seed migrations. | Standard ops; checklist in the Phase 2.5 implementation prompt. |

### F.6 Safety-critical unresolved decisions

| PDN | Decision | Owner | Required before |
|---|---|---|---|
| PDN-O1 | Authority cache TTL (proposed 60s) | Product | Phase 2.5 PR 2.5.2 |
| PDN-O3 | Emergency dispense post-reconnect attestation | Product + clinical | Phase 4 (deferrable; document V1 default explicitly) |
| PDN-O4 | Code Blue replay-rejection handling | Product + clinical | Phase 4 (deferrable; document V1 default explicitly) |
| PDN-V2 | `allowedOperationalRoles` default for unconfigured Vets | Product | Phase 2.5 PR 2.5.1 (migration schema choice) |
| PDN-V10 | ER Mode dead-lock escape (Decision 5: Admin disable) | Locked in `phase-2.5-decision-brief.md` Decision 5 | Phase 4 PR 4.1 |
| PDN-V11 | Code Blue manager auto-assignment when no Senior Vet | Product + clinical | Phase 4 PR 4.6 |

PDNs not listed above are deferrable to Phase 4 or Phase 5 per the existing review.

### F.7 Phase-plan changes required

**None.** The five-phase + Phase 2.5 sequence holds. The two new docs (`ownership-lifecycle.md`, `offline-operational-architecture.md`) are **read-only architectural references**; they do not introduce new phases.

The Phase 2.5 decision brief's five-PR sequence (2.5.1 → 2.5.5) remains correct. The offline behaviour and ownership semantics defined here are absorbed by existing Phase 2.5 / Phase 3 / Phase 4 PR scopes; no PR scope expands.

### F.8 PR-sequencing changes required

**None.** The Phase 2.5 PR scopes already include:

- 2.5.2 — resolver + decision helpers (now also documents offline cache TTL handling).
- 2.5.3 — check-in / check-out endpoints (now also documents check-in as offline-prohibited).
- 2.5.4 — FE check-in flow (now also implements the per-action offline-disabled tooltip pattern from `offline-operational-architecture.md §11`).

No new PRs. No re-sequencing.

### F.9 Freeze recommendation

**Architecture is recommended for freeze**, subject to product sign-off on the four small items below.

**Pre-freeze sign-off checklist (small, product-side):**

- [ ] **PDN-O1** — authority cache TTL (recommend 60 seconds).
- [ ] **PDN-V2** — `allowedOperationalRoles` default (recommend `['er_icu_vet']` for new Vet users + per-user seed for existing).
- [ ] Confirm F.1.3 (Code Blue manager cannot cleanly end their shift until Phase 4 PR 4.6 ships) is acceptable interim state.
- [ ] Confirm F.2.4 / F.2.5 V1 defaults (no emergency-dispense attestation; never silent-drop Code Blue log entries) are acceptable.

**Once the above four items are signed off, implementation may begin.** No further architecture work is required to start Phase 1.

The remaining open PDNs (V5, V6, V7, V8, V9, V11, V12, V13, V14, V15, V16, V17, L1–L5, O3, O4, O5, O6) are **deferrable** — they have documented V1 defaults or are out of scope until Phase 4 or Phase 5. Implementation can start in parallel with their resolution.

**Architecture freeze status: READY (pending 4-item product sign-off).**
