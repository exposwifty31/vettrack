# VetTrack Authority Model

**Status:** Phase 0 alignment document.
**Source:** Revised Implementation Plan v2 (Confirmed Product Logic) + user product-logic statement of record.
**Audience:** Engineers, reviewers, product. Read this before changing any authority check.

This document is normative for the authority model that Phase 2A will introduce. It does **not** describe the model that exists in code today (the legacy model uses a numeric role hierarchy via `requireEffectiveRole`); that legacy model is being replaced incrementally per Phase 2A → 2B → 2C.

---

## 1. The three dimensions

VetTrack authority is **not** a single hierarchy. It is a triple:

| Dimension | Values | Where it lives | What it grants |
|---|---|---|---|
| `systemRole` | `Admin` \| `User` | DB column on `vt_users` (current `role` field semantically; final naming decided in Phase 2A) | Application/system management only. Does **not** grant clinical authority. |
| `clinicalRole` | `Vet` \| `Senior Technician` \| `Technician` \| `Student` | DB column on `vt_users` | Professional identity. **Dormant by itself.** |
| `shiftRole` | same enum as `clinicalRole`, or `null` | derived from the imported EZShift schedule (see §3) and materialised in `vt_shifts` rows | The role the user is **scheduled to be working** in the currently active shift block. **Initial product model uses scheduled assignment as the source of authority; physical attendance is not yet observed (see §3).** |

The composed value used by clinical-action gates is the **effective clinical role**:

```
effectiveClinicalRole(authority) = authority.shiftRole ?? null
```

If `shiftRole` is `null` (no active shift), `effectiveClinicalRole` is `null` and the user has **no clinical authority**.

---

## 2. Core rules

1. **No active shift ⇒ no clinical authority.** Even a user whose `clinicalRole` is `Vet` cannot perform a clinical action if they are not currently on shift.
2. **`shiftRole` overrides `clinicalRole`.** This is an override, **not** a max-of. A user whose `clinicalRole` is `Senior Technician` who is staffing a shift as `Technician` operates as `Technician` for the duration of that shift.
3. **`systemRole` is orthogonal to clinical authority.** A user with `systemRole = Admin` can manage admin pages and admin-only operations (user management, integrations, audit log, billing void, etc.) but **cannot** perform a clinical action without an active clinical shift role.
4. **`Student` is fixed.** A user whose `clinicalRole` is `Student` is never elevated by any shift assignment, never receives a secondary role, and never gains clinical authority above `Student`. The matrix in §4 lists everything Student can do. **Students are not represented in the EZShift import** (see §3.5); a user's Student role is configured manually in VetTrack.
5. **Roles are always read from the database**, never from JWT claims.

---

## 3. Active Shift Derivation (initial scope: EZShift-scheduled)

### 3.1 Source of truth

The initial product model derives `activeShiftRole` from the **imported EZShift schedule file**. EZShift is the clinic's external scheduling system. Imports populate `vt_shifts` rows; each row corresponds to a scheduled shift block carrying:

- staff name (Hebrew display name)
- date
- start time / end time
- department / area context
- one or more operational labels (e.g., `בכיר`, `טכנאי קבלה`, `תמך בוקר`, `תמך ערב`, `חירום`, `אישפוז`, `אסופיים`, `התלמדות`)

A user has **active clinical authority** if **all** of the following hold:

1. they are matched to an imported EZShift assignment;
2. the assignment's scheduled window covers `NOW()`;
3. the assignment's labels map to a recognised VetTrack `shiftRole` (see §3.5);
4. the assignment belongs to the relevant clinic / department context;
5. the assignment was not manually disabled or overridden.

Condition 5 is documented as a **future hook**. No manual-override mechanism exists today; the condition is named in the model so downstream consumers do not bake in "schedule is final, no exceptions" assumptions.

### 3.2 Scheduled active authority — NOT attendance-confirmed

This is **scheduled active authority**, not attendance-confirmed authority. The system does **not** observe whether the user:

- has physically arrived at the clinic;
- has clocked in;
- has logged into a clinic device.

Scheduled ≡ active for clinical-authority purposes. A scheduled user who is absent, late, sick, or substituted is still treated as authorised. Conversely, a user covering a shift not yet reflected in EZShift has no authority until the import catches up.

The following are **explicitly out of scope** of the Phase 0 model and any phase up to and including Phase 5:

- clock-in events;
- presence / attendance confirmation;
- manual override of the schedule (e.g., admin marks user "absent today");
- late-arrival / early-departure handling;
- last-minute substitutions outside EZShift;
- absence handling.

A future phase MAY layer some or all of the above on top of the schedule. Until then, the scheduled-active-authority model carries the entirety of "is this user authorised for clinical actions right now."

### 3.3 Backend is authoritative; frontend visibility is advisory UX

The backend re-resolves authority on every clinical request from the current schedule snapshot. The frontend's exposure of `activeShiftRole` via `useAuth()` is advisory UX only — it MAY be stale at any moment. A frontend that displays an enabled button does not imply the backend will accept the action. **403 responses remain the source of truth.**

### 3.4 EZShift import is itself a mutation that grants and revokes clinical authority

Each EZShift import effectively grants and revokes clinical-authority windows in bulk. The import surface lives in `server/routes/shifts.ts` (see `docs/endpoint-authority-matrix.md`). Per-row audit of which assignment added or removed authority is currently **PDN-A6**.

### 3.5 Mapping layer: EZShift label → VetTrack shiftRole / department / metadata

EZShift labels are free-form Hebrew strings. A deterministic mapping layer separates each row's labels into:

1. `shiftRole` — one of `vet`, `senior_technician`, `technician`, `student`, or `null`;
2. `department` / `area` — operational context, **does not affect authority**;
3. additional metadata flags (time-of-day, trainee-flag, etc.).

#### Confirmed mapping table (Phase 0)

| EZShift label / pattern | Maps to `shiftRole` | Department / metadata | Notes |
|---|---|---|---|
| `בכיר` | `senior_technician` | — | "senior" |
| `טכנאי בכיר` | `senior_technician` | — | "senior technician" |
| `טכנאי חירום` | `technician` | `emergency` | role from `טכנאי`, area from `חירום` |
| `טכנאי אשפוז` | `technician` | `inpatient` | role from `טכנאי`, area from `אישפוז` |
| `טכנאי קבלה` | `technician` | `reception` | role from `טכנאי`, area from `קבלה` |
| `טכנאי אסופיים` | `technician` | `strays` | role from `טכנאי`, area from `אסופיים` |
| `תמך בוקר` | `technician` | time-of-day: morning | `תמך` ("support") is a Technician pattern; `בוקר` is time-of-day, not a role |
| `תמך ערב` | `technician` | time-of-day: evening | `תמך` ("support") is a Technician pattern; `ערב` is time-of-day, not a role |
| Any other `תמך …` | `technician` | per-suffix metadata | Generic `תמך` pattern is Technician |
| `התלמדות` | **`null`** | trainee flag | **Not a clinical role.** Training / onboarding metadata only. A user appearing in EZShift with `התלמדות` only has **no clinical authority** under the current model. Whether Trainees can be granted scoped authority in future is **PDN-A8**. |
| `חירום` (standalone) | `null` (no role implied) | `emergency` | Area only. Does not grant authority. |
| `אישפוז` (standalone) | `null` | `inpatient` | Area only. |
| `קבלה` (standalone) | `null` | `reception` | Area only. |
| `אסופיים` (standalone) | `null` | `strays` | Area only. |
| Unknown / unrecognised label | `null` (proposed default) | preserved as raw text | Final default behaviour: **PDN-A2**. |

#### Decomposition rules

- A single EZShift row may carry multiple labels. The mapping decomposes them: role-implying components drive `shiftRole`; area / time-of-day components become metadata.
- A row with only area / metadata labels (e.g., `חירום` alone) produces `shiftRole = null`. The user has no clinical authority for that shift block regardless of their `clinicalRole`.
- A row with both a role label and an area label (e.g., `טכנאי חירום`) produces `shiftRole = technician` + `department = emergency`.
- `בוקר` and `ערב` are **time-of-day labels**, not roles. They are metadata only.
- `התלמדות` is **explicitly not** a clinical role. A user appearing in EZShift with only `התלמדות` has `shiftRole = null` and a `trainee` flag; they have **no clinical authority**.
- **Students are not represented in EZShift.** A user's `clinicalRole = student` is set manually inside VetTrack by an admin. Such a user has no shiftRole inferred from the import. Whether and how to grant Students any active-shift authority — by manual VetTrack assignment, by mapping `התלמדות`, or by a separate mechanism — is **PDN-A7**.

### 3.6 Identity matching (EZShift name → VetTrack user)

EZShift rows reference staff by Hebrew name. VetTrack users have `name` and `displayName` columns. The current `server/lib/role-resolution.ts` matches by `employeeName` against the user's display-name set. This match is fragile:

- display names are mutable and non-unique;
- transliteration variants are common;
- last-minute substitutions name a different person than the one logging in.

The initial product model accepts this fragility and tags it as **PDN-A1**.

### 3.7 Currency of the import (staleness)

`activeShiftRole` is only as fresh as the most recent EZShift import. If the import is stale:

- shifts modified after the last import are not represented;
- ad-hoc substitutions outside EZShift are invisible to the backend;
- shifts cancelled after the import remain "active" in `vt_shifts`.

The system does not currently expose schedule freshness, nor refuse to resolve authority on stale data. **PDN-A3.**

### 3.8 Time semantics (timezone + grace period)

EZShift exports schedules in clinic-local time. The translation to storage timezone, and the comparison against `NOW()`, must agree. Today's `server/lib/role-resolution.ts` performs the comparison in the database's session timezone. Whether authority extends a grace period (e.g., 5 minutes before/after the scheduled window) is undefined. Both questions are **PDN-A4**.

### 3.9 Multiple overlapping rows

A user may have two overlapping EZShift rows (split shift, double-booking, import error). The mapping may produce two `shiftRole` values for the same instant. Tie-break is **PDN-A5**.

### 3.10 Department metadata surface

The `department` / `area` field decoded from EZShift labels is metadata, not authority. Where this surfaces in API responses (e.g., `/api/users/me`, `/api/tasks/eligible-assignees`) is **PDN-A9**.

### 3.11 What this section explicitly does NOT change

- The `(systemRole, clinicalRole, shiftRole)` triple in §1 is unchanged.
- The override rule (§2 rule 2) is unchanged.
- The off-shift rule (§2 rule 1) is unchanged.
- The schema is unchanged.
- The legacy `server/lib/role-resolution.ts` is unchanged in Phase 0.
- No parser, mapping middleware, or import code is introduced by this document.

---

## 4. Action authority matrix

The per-action gate is defined in terms of **effective clinical role** and, where relevant, **systemRole**.

This matrix lists the *categories* of actions and the minimum authority required. The per-endpoint mapping is in `docs/endpoint-authority-matrix.md`. Several rows reference open Product Decisions Needed (PDN) — see §7 of this document for the list.

### 4.1 Clinical actions

| Action category | Required authority | Notes |
|---|---|---|
| Read patient list / patient detail | active-shift Tech / Senior Tech / Vet | Read access in current model is broader; tightening to active-shift is part of Phase 2C. |
| Admit / edit / discharge patient | active-shift Tech / Senior Tech / Vet | Discharge specifics to be confirmed against current flow. |
| Pending Patient assignment | active-shift Senior Tech or Vet (Technician assignment rights = **PDN**) | See PDN-3. |
| Equipment scan / checkout | active-shift Tech / Senior Tech / Vet / Student? — Student scope = **PDN** | Current code allows Student via `requireEffectiveRole("student")`; product status unclear. |
| Equipment return | active-shift Tech / Senior Tech / Vet AND `checkedOutById === actor.id`; non-owner return requires Senior Tech override flag | |
| Equipment create / edit | active-shift Tech / Senior Tech / Vet | |
| Equipment delete / bulk delete / bulk import | `systemRole = Admin` | Today gated as `requireAdmin`. |
| Equipment force-revert | active-shift Vet | Today `requireEffectiveRole("vet")`. |
| Crash cart check submission | active-shift Tech / Senior Tech | Vet does not submit. |
| Crash cart items CRUD | `systemRole = Admin` | |
| Inventory scan / restock / blind audit / dispense (non-emergency) | active-shift Tech / Senior Tech | **Vet does not update inventory.** |
| Inventory items CRUD | `systemRole = Admin` for now; future Senior Tech in scope (**PDN-7**). |
| Procurement view | active-shift Tech / Senior Tech / Vet (read) | |
| Procurement create / submit / cancel | `systemRole = Admin` for now; future Senior Tech (**PDN-7**). |
| Procurement receive | active-shift Tech / Senior Tech | |
| Container CRUD | `systemRole = Admin` (current code uses `requireEffectiveRole("admin")`, which today is equivalent). |
| Dispense draft / confirm / emergency | active-shift Tech / Senior Tech / Vet — final target gate per Phase 0 (Phase 1 adds only `requireAuth`). Medication-specific stricter rules **PDN-6**. |

### 4.2 Task actions

(See `docs/task-product-model.md` for the full task-creation matrix.)

| Action | Required authority |
|---|---|
| Create task — non-medication, self | active-shift caller of any clinical role (Student → self-reminder only) |
| Create task — non-medication, for another user | active-shift Senior Tech (for Technicians) or active-shift Vet (for Technicians) |
| Create task — medication | **active-shift Vet only** |
| Read tasks (own + clinic) | active-shift Tech / Senior Tech / Vet. Student sees own only. |
| Start task | active-shift caller with task ownership, except where Vet/Senior Tech override applies (see task model doc). |
| Complete task | active-shift caller with task ownership; **Student cannot complete**; Vet/Senior Tech override allowed per current rules. |
| Vet approve medication task | active-shift Vet |
| Accept escalated task | active-shift staff matching task type (see PDN-10). |
| Refuse escalated task | active-shift staff matching task type (audit-logged). |
| Report medication issue | active-shift Tech / Senior Tech / Vet (executing user). |

### 4.3 ER & Code Blue actions

| Action | Required authority |
|---|---|
| Trigger Code Blue | any authenticated user; Student is **trigger-only**. |
| Add Code Blue log entry | any authenticated user (clinical-action verification = **PDN**). |
| Code Blue presence heartbeat | any authenticated user. |
| Be Code Blue event manager | active-shift Vet only. |
| End Code Blue session | only the assigned manager; blocked when no Vet manager assigned; 15-minute server gate with structured `earlyStopReason` override path. |
| Code Blue history view | `systemRole = Admin`. |
| ER Mode toggle | active-shift Vet only. |
| ER intake creation | active-shift Vet only. |
| ER intake assign | per current `requireAssignableRole` — to be normalized in Phase 4. |
| ER handoff create / ack | active-shift Tech / Senior Tech / Vet (specific authority TBD in Phase 4). |

### 4.4 Billing actions

| Action | Required authority |
|---|---|
| Read billing | active-shift Vet or above (current code `requireEffectiveRole("vet")`). |
| Create charge | active-shift Vet. |
| Void / reverse / bulk-sync charge | `systemRole = Admin`. |
| Inventory job retry | `systemRole = Admin` for now; retry permission for performing tech = **PDN-4**. |
| Leakage report read / export | active-shift Vet or above. |

### 4.5 Admin / system actions

| Action | Required authority |
|---|---|
| Audit log read | `systemRole = Admin`. |
| Analytics / outcome KPI / shift completion | `systemRole = Admin`. |
| Metrics / queue / DLQ / outbox health | `systemRole = Admin`. |
| Integrations management | `systemRole = Admin`. |
| User role / status / secondary-role change | `systemRole = Admin`. |
| Shift CSV import | `systemRole = Admin`. |
| Stability tools | `systemRole = Admin`. |
| Settings (push subscriptions) | self only. |
| Display ward TV snapshot | any authenticated user; redaction policy = **PDN-9**. |

---

## 5. Resolver semantics (Phase 2A target)

The Phase 2A module will expose three primitives. **No code change is implied by this document.**

```
resolveAuthority(req) -> { systemRole, clinicalRole, activeShiftRole }
effectiveClinicalRole(authority) -> ClinicalRole | null
requireClinicalAuthority({ action }) -> Express middleware
```

`requireClinicalAuthority` returns 403 when:
- the caller has no active shift, **or**
- `effectiveClinicalRole` does not satisfy the action's matrix row.

`requireSystemAdmin()` is the orthogonal system-admin gate and **never** implies clinical authority.

Behavioural notes:
- `systemRole = Admin` **does not** bypass `requireClinicalAuthority`. Admin pages use `requireSystemAdmin`; clinical actions use `requireClinicalAuthority`.
- Off-shift caller, regardless of `clinicalRole`, fails every clinical gate.
- The matrix is the single source of truth; controllers do not inline-check role strings.

---

## 6. Legacy model — currently in code, being retired

For traceability, the current implementation uses:

- `server/middleware/auth.ts` — `requireAuth`, `requireAdmin`, `requireEffectiveRole(minRole)` with a numeric hierarchy `{admin:40, vet:30, senior_technician:25, lead_technician:22, vet_tech:20, technician:20, student:10}`.
- `server/lib/role-resolution.ts` — resolves effective role as a **max-of** primary, secondary, and shift role.

The legacy model treats `Admin` as the highest clinical authority. **This is wrong under the target model.** Replacement is incremental: Phase 2A introduces the new primitives alongside the legacy ones, Phase 2B migrates the highest-risk endpoints, Phase 2C migrates the remainder. Phase 0 only documents.

---

## 7. Open product decisions affecting this model

### 7.1 Recently resolved (no longer open)

- **Source of `activeShiftRole`** — RESOLVED: imported EZShift schedule (see §3).
- **EZShift label → role mapping for "בכיר", "טכנאי בכיר"** — RESOLVED: Senior Technician.
- **EZShift label → role mapping for "טכנאי קבלה", "טכנאי חירום", "טכנאי אשפוז", "טכנאי אסופיים"** — RESOLVED: Technician + department/area metadata.
- **EZShift label → role mapping for "תמך בוקר", "תמך ערב", any "תמך ..."** — RESOLVED: Technician + time-of-day metadata.
- **EZShift label → role mapping for "התלמדות"** — RESOLVED: **not a clinical role**; training/onboarding metadata only. Trainees have no clinical authority under the current model.
- **EZShift label → role mapping for standalone "חירום", "אישפוז", "קבלה", "אסופיים"** — RESOLVED: area metadata only; no role granted.
- **Source-of-truth split between `vt_shifts` and `vt_shift_sessions`** — RESOLVED: `vt_shifts` (populated by EZShift import) is the current source. `vt_shift_sessions` is not consulted for authority resolution.
- **Phase 0 PDN-11** (null `vt_shifts.role` semantics) — SUBSUMED by §3.5 and PDN-A2. An imported row whose labels fail to map to a recognised role produces `shiftRole = null` and (proposed default) confers no clinical authority.

### 7.2 Still unresolved — Active Shift series

These derive directly from §3 and must be answered before Phase 2A's resolver ships:

- **PDN-A1** Identity matching between EZShift staff name and VetTrack user record (display-name match — current, fragile; employee-ID match; admin-curated mapping table; or other).
- **PDN-A2** Behaviour for **unrecognised** EZShift labels — proposed default `shiftRole = null` + admin alert. Final default policy.
- **PDN-A3** Schedule freshness / staleness handling — should the resolver warn or refuse to resolve when the most recent import is older than N hours?
- **PDN-A4** Time semantics — timezone normalisation of `vt_shifts.startTime/endTime` AND grace-period semantics around shift boundaries.
- **PDN-A5** Tie-break for multiple overlapping EZShift rows for the same user.
- **PDN-A6** Audit policy for the EZShift import operation itself — per-row diff, per-row grant/revoke, or summary only.
- **PDN-A7** How Students (manually configured in VetTrack, not in EZShift) receive an active-shift role, if at all.
- **PDN-A8** Whether Trainees (`התלמדות` flag) can be granted scoped clinical authority in a future phase, and on what basis.
- **PDN-A9** Where the `department` / area metadata surfaces in API responses (`/api/users/me`, `/api/tasks/eligible-assignees`, etc.).

### 7.3 Still unresolved — original PDN series

These remain unchanged from earlier Phase 0 docs:

- **PDN-3** Technician assignment rights for Pending Patients.
- **PDN-4** Inventory deduction retry permissions (performing tech vs Admin only).
- **PDN-6** Medication inventory stricter handling (chain-of-custody, dual sign-off, blind audit).
- **PDN-7** Senior Technician inventory/procurement scope and timing.
- **PDN-9** Display-page redaction policy.
- **PDN-10** Per-task-type escalation matrix definition.
- **PDN-12** Student self-task acknowledgement model.

PDN-1 (Code Blue ↔ patient association), PDN-2 (Pending Patient vs Pending Emergency relationship), PDN-5 (sensitive-reads audit policy), and PDN-8 (final ER Mode allowlist) are tracked in the other Phase 0 docs.

### 7.4 Explicitly deferred (out of scope for Phase 0 → Phase 5)

The following are **not** open product questions; they are decisions to **postpone**. They will not be implemented during the phases covered by Plan v2:

- clock-in / attendance confirmation;
- manual override of EZShift schedule (admin marking a user absent);
- late-arrival / early-departure handling;
- absence handling;
- last-minute substitutions outside EZShift;
- automated reconciliation between EZShift and physical-presence signals.

Any of these may return as scoped product work in a future plan. They are explicitly out of scope here.

---

## 8. Non-goals of this document

- It does not redefine `clinicId` multi-tenant scoping (already enforced; unchanged).
- It does not address rate limiting, idempotency, or input validation (orthogonal middleware).
- It does not specify audit-log content; see `docs/operational-modes.md` and the audit-coverage matrix in `docs/endpoint-authority-matrix.md`.
- It does not approve any code change. Implementation begins at Phase 2A.
