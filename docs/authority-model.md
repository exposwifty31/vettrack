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
| `shiftRole` | same enum as `clinicalRole`, or `null` | `vt_shifts.role` for an active shift matching the user | The role the user is **actually working** in the currently active shift. |

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
4. **`Student` is fixed.** A user whose `clinicalRole` is `Student` is never elevated by any shift assignment, never receives a secondary role, and never gains clinical authority above `Student`. The matrix in §3 lists everything Student can do.
5. **Roles are always read from the database**, never from JWT claims.

---

## 3. Action authority matrix

The per-action gate is defined in terms of **effective clinical role** and, where relevant, **systemRole**.

This matrix lists the *categories* of actions and the minimum authority required. The per-endpoint mapping is in `docs/endpoint-authority-matrix.md`. Several rows reference open Product Decisions Needed (PDN) — see §6 of this document for the list.

### 3.1 Clinical actions

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

### 3.2 Task actions

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

### 3.3 ER & Code Blue actions

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

### 3.4 Billing actions

| Action | Required authority |
|---|---|
| Read billing | active-shift Vet or above (current code `requireEffectiveRole("vet")`). |
| Create charge | active-shift Vet. |
| Void / reverse / bulk-sync charge | `systemRole = Admin`. |
| Inventory job retry | `systemRole = Admin` for now; retry permission for performing tech = **PDN-4**. |
| Leakage report read / export | active-shift Vet or above. |

### 3.5 Admin / system actions

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

## 4. Resolver semantics (Phase 2A target)

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

## 5. Legacy model — currently in code, being retired

For traceability, the current implementation uses:

- `server/middleware/auth.ts` — `requireAuth`, `requireAdmin`, `requireEffectiveRole(minRole)` with a numeric hierarchy `{admin:40, vet:30, senior_technician:25, lead_technician:22, vet_tech:20, technician:20, student:10}`.
- `server/lib/role-resolution.ts` — resolves effective role as a **max-of** primary, secondary, and shift role.

The legacy model treats `Admin` as the highest clinical authority. **This is wrong under the target model.** Replacement is incremental: Phase 2A introduces the new primitives alongside the legacy ones, Phase 2B migrates the highest-risk endpoints, Phase 2C migrates the remainder. Phase 0 only documents.

---

## 6. Open product decisions affecting this model

The following are unresolved and tagged in §3 as **PDN-n** for reference. They must be answered before the matrix is final:

- **PDN-3** Technician assignment rights for Pending Patients.
- **PDN-4** Inventory deduction retry permissions (performing tech vs Admin only).
- **PDN-6** Medication inventory stricter handling (chain-of-custody, dual sign-off, blind audit).
- **PDN-7** Senior Technician inventory/procurement scope and timing.
- **PDN-9** Display-page redaction policy.
- **PDN-10** Per-task-type escalation matrix definition.
- **PDN-11** Tie-break when a shift row exists but `vt_shifts.role` is null — does the user have any clinical authority for that shift?
- **PDN-12** Student self-task acknowledgement model.

PDN-1 (Code Blue ↔ patient association), PDN-2 (Pending Patient vs Pending Emergency relationship), PDN-5 (sensitive-reads audit policy), and PDN-8 (final ER Mode allowlist) are tracked in the other Phase 0 docs.

---

## 7. Non-goals of this document

- It does not redefine `clinicId` multi-tenant scoping (already enforced; unchanged).
- It does not address rate limiting, idempotency, or input validation (orthogonal middleware).
- It does not specify audit-log content; see `docs/operational-modes.md` and the audit-coverage matrix in `docs/endpoint-authority-matrix.md`.
- It does not approve any code change. Implementation begins at Phase 2A.
