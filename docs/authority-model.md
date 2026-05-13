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
| `shiftRole` | same enum as `clinicalRole`, plus the Vet **operational-role** set (§4), or `null` | **Source differs by clinicalRole.** Technicians / Senior Technicians: derived from imported EZShift schedule (§3); materialised in `vt_shifts`. **Vets: derived from manual check-in (§4) — Vets are NOT in EZShift.** Students: manually configured in VetTrack (no EZShift, no check-in). | The role the user is **actually operating as** during the current shift. For Techs the value is one of `vet`, `senior_technician`, `technician`, `student`, `null`. For Vets the value is one of the operational-role names in §4.2 (e.g., `senior_vet`, `er_icu_vet`). **Initial model is scheduled / explicit-check-in authority; physical attendance is not observed.** |

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
4. **`Student` is fixed.** A user whose `clinicalRole` is `Student` is never elevated by any shift assignment, never receives a secondary role, and never gains clinical authority above `Student`. The matrix in §5 lists everything Student can do. **Students are not represented in the EZShift import** (see §3.5); a user's Student role is configured manually in VetTrack.
6. **`Vet` clinical authority requires explicit check-in.** A user whose `clinicalRole` is `Vet` has no active authority on the basis of `clinicalRole` alone. They must perform a manual check-in (§4), selecting an **operational role** for the shift from their configured `allowedOperationalRoles`. Without a current check-in, a Vet has no clinical authority — symmetric to the off-shift rule for Technicians.
5. **Roles are always read from the database**, never from JWT claims.

---

## 3. Active Shift Derivation — Technicians & Senior Technicians (EZShift)

> **Scope of this section.** Active-shift authority for **Technicians and Senior Technicians** is derived from the imported EZShift schedule. Vets are **NOT** in EZShift; their active-shift model is §4 (manual check-in). Students are not in EZShift either; see §3.5 decomposition rules and PDN-A7.

### 3.1 Source of truth

For Technicians and Senior Technicians, the initial product model derives `activeShiftRole` from the **imported EZShift schedule file**. EZShift is the clinic's external scheduling system. Imports populate `vt_shifts` rows; each row corresponds to a scheduled shift block carrying:

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

## 4. Vet Active Shift & Operational Roles (manual check-in)

> **Scope of this section.** Active-shift authority for **Vets** is derived from explicit per-shift **manual check-in**, not from EZShift. Each Vet check-in carries an **operational role** chosen from the user's pre-configured `allowedOperationalRoles`. The composite definition of "active clinical authority" that combines §3 (Techs) and §4 (Vets) is in §4.6.

### 4.1 Source of truth for Vet active-shift authority

Vet active-shift authority is **not** derived from EZShift. Vets are not represented in the EZShift import. Instead, Vet active-shift authority is established by **explicit manual check-in** at the start of the shift.

At check-in, the Vet:

1. Confirms the start of their shift.
2. Selects an **operational role** for the shift from their `allowedOperationalRoles` set (see §4.4).
3. Creates an active Vet shift session.

The check-in produces a per-shift assignment with at least these conceptual fields:

- `userId` (Vet)
- `operationalRole` (one of the values in §4.2)
- `startedAt`
- `endedAt` (null while active)
- `clinicId`

A Vet has active clinical authority when an active (non-ended) check-in exists for them in the current clinic. Without an active check-in, a user whose `clinicalRole` is `Vet` has **no clinical authority** — identical to the off-shift rule for Technicians in §3.

**The Vet check-in subsystem does not exist in code today.** Storage, endpoints, and FE flow are out of scope for Phase 0–1. The earliest plausible landing is a new **Phase 2.5 (Vet Check-in & Operational-Role Infrastructure)** inserted between Phase 2A and Phase 4 — see `docs/architecture-review.md`. Documentation here defines the behavioural target only.

### 4.2 Vet operational roles — V1 enumeration

The following operational roles are the V1 set. Each is a value of the per-check-in `operationalRole`. They are **not** `clinicalRole` values in the §1 sense; for all five, the user's `clinicalRole` remains `Vet`.

1. **Senior Vet** (`senior_vet` · "רופא בכיר") — operational clinical lead for the shift. Supervises ER/ICU Vets, Hospitalization Vets, Receiving Vets. Acts as escalation authority and high-level workflow authority. Receives unresolved escalations.

2. **ER / ICU Vet** (`er_icu_vet` · "רופא חירום / ICU") — manages ER and ICU patients. Creates ER/ICU clinical tasks and medication tasks. Participates in Code Blue logging.

3. **Hospitalization Vet** (`hospitalization_vet` · "רופא אשפוז") — manages hospitalized patients. Creates hospitalization clinical tasks and medication tasks. Participates in Code Blue logging.

4. **Receiving Vet** (`receiving_vet` · "רופא קבלה") — creates ER intake and initial patient intake records. Creates medication tasks when clinically needed. Transfers patient responsibility (handoff) to ER/ICU Vet, Hospitalization Vet, or Technician.

5. **On-call Vet** (`on_call_vet` · "רופא כונן") — appears as escalation contact for active-shift workflows. May receive notifications (escalation, Code Blue start, etc.). May be called into a workflow. **Does NOT automatically receive full clinical workflow authority on the basis of being on-call alone.** To gain full clinical authority during an actual incident, the On-call Vet must either explicitly check in (transitioning to one of the other four roles) or be explicitly assigned per workflow rules. Exact mechanism is **PDN-V5**.

### 4.3 Capability summary by operational role

| Capability | Senior Vet | ER/ICU Vet | Hospitalization Vet | Receiving Vet | On-call Vet |
|---|---|---|---|---|---|
| Enable / disable ER Mode | ✅ | ❌ | ❌ | ❌ | ❌ |
| Be Code Blue event manager | ✅ (preferred) | ✅ if assigned per workflow | ✅ if assigned per workflow | ✅ if assigned per workflow | ❌ (on-call alone is not sufficient) |
| End Code Blue session | ✅ if assigned manager | ✅ if assigned manager | ✅ if assigned manager | ✅ if assigned manager | ❌ |
| Code Blue early closure (structured reason) | ✅ if assigned manager | ✅ if assigned manager | ✅ if assigned manager | ✅ if assigned manager | ❌ |
| High-level clinical override / escalation approval | ✅ | ❌ | ❌ | ❌ | ❌ |
| Receive unresolved escalations | ✅ | per task type | per task type | per task type | ✅ (escalation contact) |
| Create ER intake | ✅ | ✅ | ❌ default | ✅ (primary) | ❌ |
| Create ER / ICU clinical tasks | ✅ | ✅ (primary) | ❌ default | ❌ default | ❌ |
| Create hospitalization clinical tasks | ✅ | ❌ default | ✅ (primary) | ❌ default | ❌ |
| Create medication tasks | ✅ | ✅ | ✅ | ✅ when clinically needed | ❌ |
| Participate in Code Blue logging | ✅ | ✅ | ✅ | ✅ | ✅ if physically present |
| Patient handoff (transfer responsibility) | ✅ | receive | receive | ✅ (primary) | ❌ |

Notes:

- "❌ default" means the role does not have that capability under normal workflow; an explicit assignment per workflow rules may grant it (this is a Senior Vet override path — **PDN-V6**).
- "✅ if assigned manager" means the capability is unlocked only when the Vet is the assigned Code Blue manager for that session, regardless of operational role.
- The "preferred" marker on Senior Vet for Code Blue manager is a UX hint, **not** a hard gate. Any operational Vet role may be the manager when no Senior Vet is available; the FE picker MAY surface Senior Vets first.
- Anyone may **trigger** Code Blue (including Student — trigger-only). Only the assigned manager (any operational Vet role) may end it. See `docs/operational-modes.md §2`.
- The table covers V1. Additional operational roles or capabilities are future product work.

### 4.4 `allowedOperationalRoles` per user

To prevent any Vet from selecting "Senior Vet" or any other elevated role at will, each user has a **configured `allowedOperationalRoles`** set. At check-in, a Vet may select **only** from their `allowedOperationalRoles`. Backend remains authoritative; the FE filters the picker but never decides authority.

`allowedOperationalRoles` is a per-`vt_users` configuration:

- set by `systemRole = Admin` (via admin tooling; the management UI is out of scope of Phase 0).
- conceptually distinct from `clinicalRole`. A user must have `clinicalRole = Vet` AND a non-empty `allowedOperationalRoles` to use the check-in flow.
- defaults are out of scope; **PDN-V2** scopes the default behaviour for users with no explicit configuration.

Storage of `allowedOperationalRoles` is not designed today. The simplest option is a `vt_users` column carrying an array; the strictest is a separate row-per-role table. Either way, schema work is **PDN-V3** and out of scope of Phase 0.

### 4.5 Vet check-in vs Technician active-shift — semantic differences

| Aspect | Technician / Senior Tech | Vet |
|---|---|---|
| Source of authority | EZShift import (schedule) | manual check-in (per-shift action) |
| Granularity | scheduled time window | session bounded by check-in / check-out |
| Operational role selection | derived from EZShift label (§3.5) | selected at check-in from `allowedOperationalRoles` |
| Default off-shift behaviour | no clinical authority | no clinical authority |
| Override path | not yet defined | future: explicit assignment in lieu of check-in (PDN-V5, PDN-V6) |
| Audit on grant / revoke | per-import (PDN-A6) | per check-in / check-out (PDN-V4) |
| FE freshness | poll / SSE / focus-refresh | poll / SSE / focus-refresh |
| Identity match | EZShift name → `vt_users.displayName` (PDN-A1) | direct: the checking-in user is the authenticated user |

### 4.6 Composite "active clinical authority" definition

Pulling together §3 (Techs / Senior Techs) and §4 (Vets):

> A user has **active clinical authority** if **all** of the following hold:
> 1. they have an active per-shift assignment for the current clinic;
>    - for **Technicians / Senior Technicians**, the assignment is an EZShift-derived `vt_shifts` row whose window covers `NOW()` and whose labels map to a recognised `shiftRole` (§3.5);
>    - for **Vets**, the assignment is an active Vet check-in carrying an `operationalRole` (§4.1);
>    - for **Students**, an active assignment exists only via manual VetTrack configuration (PDN-A7).
> 2. the assignment maps to (or carries) a recognised authority value;
> 3. the assignment is for the relevant clinic / department context;
> 4. the assignment was not manually disabled or overridden.

§1's `effectiveClinicalRole(authority)` returns either:

- the EZShift-derived `shiftRole` for Techs / Senior Techs, **or**
- the `operationalRole` of the active Vet check-in for Vets, **or**
- `null` for everybody else.

For the §5 action authority matrix, a Vet's operational role is consulted on top of `clinicalRole = vet`. Matrix rows for actions such as "Enable / disable ER Mode" reference the operational role directly (e.g., "active-shift Senior Vet"), not the generic `clinicalRole`.

### 4.7 What this section explicitly does NOT change today

- No schema change for Vet check-in is being made.
- No endpoint for Vet check-in / check-out is being added.
- No `vt_users.allowedOperationalRoles` column or sibling table is being added.
- The Phase 1 PR plan does not include Vet check-in or operational-role enforcement; gates that reference operational roles in §5 are **target gates** that depend on the new Phase 2.5 infrastructure (see `docs/architecture-review.md`).
- The legacy `server/lib/role-resolution.ts` does not consult operational roles in Phase 0.

---

## 5. Action authority matrix

The per-action gate is defined in terms of **effective clinical role** (which, for Vets, means an operational role per §4) and, where relevant, **systemRole**.

This matrix lists the *categories* of actions and the minimum authority required. The per-endpoint mapping is in `docs/endpoint-authority-matrix.md`. Several rows reference open Product Decisions Needed (PDN) — see §8 of this document for the list.

### 5.1 Clinical actions

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

### 5.2 Task actions

(See `docs/task-product-model.md` for the full task-creation matrix.)

| Action | Required authority |
|---|---|
| Create task — non-medication, self | active-shift caller of any clinical role (Student → self-reminder only). |
| Create task — non-medication, for another user | active-shift Senior Tech (for Technicians) or active-shift Vet of any operational role (for Technicians). |
| Create task — medication | active-shift Vet of any operational role (Senior, ER/ICU, Hospitalization, Receiving-when-clinically-needed). On-call Vet excluded by default (PDN-V5). |
| Create task — ER / ICU clinical | active-shift ER/ICU Vet (primary); Senior Vet always permitted. |
| Create task — hospitalization clinical | active-shift Hospitalization Vet (primary); Senior Vet always permitted. |
| Create task — ER intake | active-shift Receiving Vet (primary); Senior Vet, ER/ICU Vet also permitted. |
| Read tasks (own + clinic) | active-shift Tech / Senior Tech / Vet (any operational role). Student sees own only. |
| Start task | active-shift caller with task ownership, except where Senior Vet / Senior Tech override applies (see task model doc, PDN-T5). |
| Complete task | active-shift caller with task ownership. **Student cannot complete.** Senior Vet / Senior Tech override allowed per current rules. |
| Vet approve medication task | active-shift Vet (any operational role) — the approving Vet's identity is recorded; Senior Vet not strictly required. |
| Accept escalated task | active-shift staff matching task type (see PDN-10). |
| Refuse escalated task | active-shift staff matching task type (audit-logged). |
| Report medication issue | active-shift Tech / Senior Tech / Vet (executing user). |
| Receive unresolved escalation | active-shift Senior Vet; On-call Vet also receives as escalation contact (PDN-V5). |

### 5.3 ER & Code Blue actions

| Action | Required authority |
|---|---|
| Trigger Code Blue | any authenticated user; Student is **trigger-only**. |
| Add Code Blue log entry | any authenticated user (clinical-action verification = **PDN-CB1**). |
| Code Blue presence heartbeat | any authenticated user. |
| Be Code Blue event manager | active-shift Vet (any operational role per §4.2); **Senior Vet preferred**. UX MAY surface Senior Vets first. Backend gate: active-shift Vet. |
| End Code Blue session | only the assigned manager (any active-shift Vet operational role). Blocked when no Vet manager assigned. 15-minute server gate with structured `earlyStopReason` override path. |
| Code Blue early closure | the assigned Vet manager + structured `earlyStopReason`. Senior Vet **preferred but not strictly required** for early closure (any assigned manager qualifies). |
| Code Blue history view | `systemRole = Admin`. |
| **ER Mode enable / disable** | **active-shift Senior Vet only.** Narrower than legacy "active-shift Vet". Phase 4 PR 4.1 enforces this; depends on the Phase 2.5 check-in subsystem to exist. |
| ER intake creation | active-shift Receiving Vet (primary), Senior Vet, or ER/ICU Vet per §4.3 (other operational Vet roles default-deny). |
| ER intake assign | per current `requireAssignableRole` — to be normalised in Phase 4 against operational roles. |
| ER handoff create | active-shift Receiving Vet (primary handoff source) — but ER/ICU Vet and Hospitalization Vet may also create handoffs per workflow rules (PDN-ER1). |
| ER handoff ack | active-shift Vet (any operational role) receiving the handoff, or active-shift Technician for tech-targeted handoffs. |

### 5.4 Billing actions

| Action | Required authority |
|---|---|
| Read billing | active-shift Vet or above (current code `requireEffectiveRole("vet")`). |
| Create charge | active-shift Vet. |
| Void / reverse / bulk-sync charge | `systemRole = Admin`. |
| Inventory job retry | `systemRole = Admin` for now; retry permission for performing tech = **PDN-4**. |
| Leakage report read / export | active-shift Vet or above. |

### 5.5 Admin / system actions

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

## 6. Resolver semantics (Phase 2A target)

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

## 7. Legacy model — currently in code, being retired

For traceability, the current implementation uses:

- `server/middleware/auth.ts` — `requireAuth`, `requireAdmin`, `requireEffectiveRole(minRole)` with a numeric hierarchy `{admin:40, vet:30, senior_technician:25, lead_technician:22, vet_tech:20, technician:20, student:10}`.
- `server/lib/role-resolution.ts` — resolves effective role as a **max-of** primary, secondary, and shift role.

The legacy model treats `Admin` as the highest clinical authority. **This is wrong under the target model.** Replacement is incremental: Phase 2A introduces the new primitives alongside the legacy ones, Phase 2B migrates the highest-risk endpoints, Phase 2C migrates the remainder. Phase 0 only documents.

---

## 8. Open product decisions affecting this model

### 8.1 Recently resolved (no longer open)

- **Source of `activeShiftRole`** — RESOLVED: imported EZShift schedule (see §3).
- **EZShift label → role mapping for "בכיר", "טכנאי בכיר"** — RESOLVED: Senior Technician.
- **EZShift label → role mapping for "טכנאי קבלה", "טכנאי חירום", "טכנאי אשפוז", "טכנאי אסופיים"** — RESOLVED: Technician + department/area metadata.
- **EZShift label → role mapping for "תמך בוקר", "תמך ערב", any "תמך ..."** — RESOLVED: Technician + time-of-day metadata.
- **EZShift label → role mapping for "התלמדות"** — RESOLVED: **not a clinical role**; training/onboarding metadata only. Trainees have no clinical authority under the current model.
- **EZShift label → role mapping for standalone "חירום", "אישפוז", "קבלה", "אסופיים"** — RESOLVED: area metadata only; no role granted.
- **Source-of-truth split between `vt_shifts` and `vt_shift_sessions`** — RESOLVED: `vt_shifts` (populated by EZShift import) is the current source. `vt_shift_sessions` is not consulted for authority resolution.
- **Phase 0 PDN-11** (null `vt_shifts.role` semantics) — SUBSUMED by §3.5 and PDN-A2. An imported row whose labels fail to map to a recognised role produces `shiftRole = null` and (proposed default) confers no clinical authority.

### 8.2 Still unresolved — Active Shift series (EZShift, Techs / Senior Techs)

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

### 8.3 Still unresolved — Vet operational-role series (PDN-V, manual check-in)

These derive directly from §4 and must be answered before the Vet check-in subsystem (proposed new Phase 2.5) can land. None of them block Phase 1.

- **PDN-V1** Vet check-in subsystem design: storage (new `vt_vet_shift_sessions` vs reuse of `vt_shift_sessions` with an `operational_role` column), endpoints (`POST /api/vet-shifts/check-in`, `POST /api/vet-shifts/check-out`, `GET /api/vet-shifts/me`), and FE check-in flow.
- **PDN-V2** Default `allowedOperationalRoles` behaviour for users with no explicit configuration — fail-closed (no operational role selectable) vs default `[er_icu_vet]` vs other.
- **PDN-V3** Storage shape for `allowedOperationalRoles` — column on `vt_users` vs separate row-per-role table.
- **PDN-V4** Audit policy for check-in / check-out and operational-role selection (per session start / end, per role change).
- **PDN-V5** On-call Vet → full-authority transition mechanism. Three plausible models: (a) on-call must explicitly check in to act; (b) on-call gains scoped authority when assigned to a specific Code Blue / escalation; (c) on-call gains time-bounded authority on accept-of-escalation.
- **PDN-V6** Senior Vet operational override of "❌ default" capabilities (e.g., can a Senior Vet authorise a Receiving Vet to act as ER/ICU Vet ad-hoc?). If yes: how is the override audited? Time-bounded?
- **PDN-V7** Multi-clinic Vet check-in — can a Vet be checked in to two clinics simultaneously? Tie-break for cross-clinic authority resolution.
- **PDN-V8** Vet check-out behaviour for in-flight responsibilities (active Code Blue manager, in-progress tasks assigned to the Vet). Auto-close, force-handoff, or block check-out?
- **PDN-V9** Whether a Vet may **change** operational role mid-shift (e.g., Receiving Vet → ER/ICU Vet on a busy night) without a full check-out / check-in cycle.
- **PDN-V10** ER Mode dead-lock policy: when ER Mode is `enforced` and no Senior Vet is currently checked in, who can disable it? Fail-safe escape hatch?
- **PDN-V11** Code Blue manager auto-assignment policy when no Senior Vet is checked in. Does the system suggest the first checked-in Vet of any operational role? Notify all checked-in Vets?
- **PDN-V12** Whether Senior Vet authority extends across Code Blue sessions started before their check-in (i.e., they walk in, an event is in progress — can they end it?).

### 8.4 Still unresolved — original PDN series

These remain unchanged from earlier Phase 0 docs:

- **PDN-3** Technician assignment rights for Pending Patients.
- **PDN-4** Inventory deduction retry permissions (performing tech vs Admin only).
- **PDN-6** Medication inventory stricter handling (chain-of-custody, dual sign-off, blind audit).
- **PDN-7** Senior Technician inventory/procurement scope and timing.
- **PDN-9** Display-page redaction policy.
- **PDN-10** Per-task-type escalation matrix definition.
- **PDN-12** Student self-task acknowledgement model.

PDN-1 (Code Blue ↔ patient association), PDN-2 (Pending Patient vs Pending Emergency relationship), PDN-5 (sensitive-reads audit policy), and PDN-8 (final ER Mode allowlist) are tracked in the other Phase 0 docs.

### 8.5 Explicitly deferred (out of scope for Phase 0 → Phase 5)

The following are **not** open product questions; they are decisions to **postpone**. They will not be implemented during the phases covered by Plan v2:

- clock-in / attendance confirmation;
- manual override of EZShift schedule (admin marking a user absent);
- late-arrival / early-departure handling;
- absence handling;
- last-minute substitutions outside EZShift;
- automated reconciliation between EZShift and physical-presence signals.

Any of these may return as scoped product work in a future plan. They are explicitly out of scope here.

---

## 9. Non-goals of this document

- It does not redefine `clinicId` multi-tenant scoping (already enforced; unchanged).
- It does not address rate limiting, idempotency, or input validation (orthogonal middleware).
- It does not specify audit-log content; see `docs/operational-modes.md` and the audit-coverage matrix in `docs/endpoint-authority-matrix.md`.
- It does not approve any code change. Implementation begins at Phase 2A.
