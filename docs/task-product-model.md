# VetTrack Task Product Model

**Status:** Phase 0 alignment document.
**Source:** Revised Implementation Plan v2 (Confirmed Product Logic) + user product-logic statement of record.
**Audience:** Engineers, reviewers, product. Read this before changing task creation, completion, or escalation behaviour.

---

## 1. Terminology

The product concept is **Tasks**. Storage today uses `vt_appointments`. The route is currently `/api/appointments` and the page file is `appointments.tsx`. **Internal naming is frozen at Phase 0 and Phase 1**; user-facing copy may shift to "Tasks" in Phase 3A, structural rename is at minimum deferred to Phase 5 and only by separate proposal.

A **task** has the following meaningful properties for authority decisions:

- `creator` — the user who created it.
- `assignee` — the user the task is for (may equal creator for self-tasks).
- `taskType` — non-medication vs medication. Medication is the only currently distinguished special type for authority purposes.
- `status` — `pending` → `assigned` → `scheduled` → `arrived` → `approved` (medication only) → `in_progress` → `completed` (plus `cancelled`, `issue_raised` from Phase 4, `escalated` from Phase 3B).
- `escalationState` — `none` | `escalated` (introduced in Phase 3B; storage TBD: column or metadata JSON).
- `metadata.acknowledgedBy` — used by medication tasks to track which technician acknowledged the task during start.

---

## 2. Creation matrix

The following is the **target** matrix. Phase 3A enforces it on the server. Phase 0 documents it only.

**Important — "active shift" requires check-in for ALL clinical roles.** Per `authority-model.md §2 rule 6` and `§3.2`:

- For **Vets**, "active shift" = `allowedOperationalRoles`-eligible AND checked in (selecting an operational role). Without an active check-in, a user with `clinicalRole = Vet` is treated identically to "off-shift Vet" below.
- For **Technicians / Senior Technicians**, "active shift" = EZShift-scheduled-eligible AND checked in. EZShift alone is no longer sufficient — Tech / Senior-Tech check-in is required to pass any `active-shift` gate in this matrix. Pre-Phase-2.5, the coarser "EZShift-eligible only" semantics apply (downstream PRs note the relaxation explicitly).

### 2.1 Non-medication, non-clinical-typed task creation

| Creator (effective clinical role) | Self-task | Task for Technician | Task for Senior Tech | Task for Vet | Task for Student | Medication task |
|---|---|---|---|---|---|---|
| **Student** | Self-reminder only (no clinical content) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Technician** (active shift) | ✅ self | ❌ (others) | ❌ | ❌ | ❌ | ❌ |
| **Senior Technician** (active shift) | ✅ self | ✅ | assume ❌ — **PDN-T1** | ❌ explicitly forbidden | **PDN-T3** | ❌ |
| **Senior Vet** (checked-in) | ✅ self | ✅ | assume ✅ — **PDN-T2** | assume ✅ — **PDN-T2** | **PDN-T3** | ✅ |
| **ER / ICU Vet** (checked-in) | ✅ self | ✅ | **PDN-T2** | **PDN-T2** | **PDN-T3** | ✅ |
| **Hospitalization Vet** (checked-in) | ✅ self | ✅ | **PDN-T2** | **PDN-T2** | **PDN-T3** | ✅ |
| **Receiving Vet** (checked-in) | ✅ self | ✅ | **PDN-T2** | **PDN-T2** | **PDN-T3** | ✅ when clinically needed |
| **On-call Vet** (no check-in) | ❌ default — **PDN-V5** | ❌ | ❌ | ❌ | ❌ | ❌ default — **PDN-V5** |
| **Admin without active shift / check-in** | ❌ (no clinical authority) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Off-shift / not checked-in clinical user** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 2.2 Clinical-typed task creation (new, follows Vet operational-role split)

| Task type | Authority required |
|---|---|
| **ER intake** | active-shift Receiving Vet (primary); Senior Vet, ER/ICU Vet also permitted. See `operational-modes.md §3`. |
| **ER / ICU clinical task** | active-shift ER/ICU Vet (primary); Senior Vet always permitted. |
| **Hospitalization clinical task** | active-shift Hospitalization Vet (primary); Senior Vet always permitted. |
| **Medication task** | active-shift Vet of any operational role (Senior, ER/ICU, Hospitalization, Receiving-when-clinically-needed). On-call Vet excluded by default (PDN-V5). |
| **Generic clinical task** (no type specified) | matrix in §2.1; any active-shift Vet operational role + active-shift Senior Tech (for Tech-recipient creation). |

Notes:

- **Medication task creation requires active-shift Vet (any operational role).** This is the strictest rule in the matrix and must remain a literal `Vet`-on-check-in match (no hierarchy bypass, no on-call Vet without check-in).
- **Self-task creation requires active shift** for any clinical content. A Student's "self-reminder" is the only carve-out; its scope and audit treatment are tracked under PDN-12.
- "Not addressed" / "assume" rows above are flagged as **PDN-T1..T5**; see §8.
- **PDN-V** series (Vet operational-role mechanics) blocks Phase 3A for clinical-typed tasks because the resolver must distinguish operational roles before this matrix can be enforced.

---

## 3. Eligible-assignees endpoint (Phase 3A)

To populate task-creation UIs, a single-purpose endpoint `GET /api/tasks/eligible-assignees?taskType=…` will return the set of users the **current** caller is permitted to assign **this specific** taskType to. The endpoint is not a generic UserSelector backend.

Inputs:
- caller's `(systemRole, clinicalRole, activeShiftRole)` — where `activeShiftRole` is EZShift-derived for Techs and check-in-derived `operationalRole` for Vets per `authority-model.md §4.6`.
- `taskType` query param

Output (Phase 3A target):
- `assignees: { id, displayName, clinicalRole, activeShiftRole, operationalRole? }[]` — filtered to the matrix row plus active-shift requirement on the assignee. `operationalRole` is populated for Vet assignees once Phase 2.5 infrastructure exists; until then it is omitted and Vets appear under their generic `clinicalRole = vet`.
- Empty list when no eligible assignees exist (UI shows actionable empty state).
- **For clinical-typed tasks** (ER intake, ER/ICU, hospitalization), the assignee list is restricted by operational role per §2.2. Until Phase 2.5 lands, the endpoint MUST return an explicit "operational-role filter unavailable" signal rather than silently widening the result; the client SHOULD surface this as "Phase 2.5 infrastructure required" rather than show all Vets.

Caller authority for the endpoint:
- Anyone with an active shift, returning at minimum themselves if they may self-task that taskType.
- Off-shift returns empty (or 403 — choice locked in Phase 3A).

---

## 4. Task lifecycle and state transitions

```
            ┌──────────────┐
created →   │   pending    │
            └──────┬───────┘
                   │ assigned / scheduled / arrived
                   ▼
           (medication only)
            ┌──────────────┐
            │   approved   │  ← Vet approval (active-shift Vet)
            └──────┬───────┘
                   │ start
                   ▼
            ┌──────────────┐
            │ in_progress  │
            └──────┬───────┘
                   │ complete                 │ report issue (medication)
                   ▼                          ▼
            ┌──────────────┐         ┌──────────────────┐
            │  completed   │         │  issue_raised    │  (Phase 4)
            └──────────────┘         └──────────────────┘
```

In parallel, `escalationState` can move `none` → `escalated` (Phase 3B). Acceptance from `escalated` reassigns the task to the acceptor and clears `escalationState`. Refusal leaves the task in `escalated` and is audit-logged.

### 4.1 Start rules

- Caller must have active-shift clinical authority of the assignee's level **or** Vet / Senior Tech / Admin override.
- For medication tasks, status must be `approved` before start; metadata records `acknowledgedBy = caller`.
- Idempotent (existing `idempotencyMiddleware`).

### 4.2 Complete rules

- Caller must be the assigned user **or** carry override (`Vet`, `Senior Technician`, or `systemRole = Admin` per current code; the override list is finalised in Phase 2C/4).
- For medication tasks, the completer must match `metadata.acknowledgedBy` unless overriding.
- **Student cannot complete** — hard rule.
- Completion is atomic with billing-ledger insertion (existing transaction); inventory deduction enqueue is post-commit and failures surface to the user as a non-blocking warning (Phase 1 PR 1.7).

### 4.3 Medication "report issue" path (Phase 4)

- Available to the executing user (active-shift Tech / Senior Tech / Vet of any operational role) while the task is `in_progress`.
- Transitions task to `issue_raised`. No further execution is accepted.
- Sends a push notification to the **creating Vet** (the prescriber), identified by `userId` regardless of operational role. If the creating Vet is currently checked out, the notification fires but the Vet cannot act until they check in (or per **PDN-V5** for on-call escalation), creating a documented stall point — see `architecture-review.md`.
- If the creating Vet has been off-shift / checked out for longer than a threshold (TBD by product), the task SHOULD escalate to the active-shift Senior Vet (**PDN-V5**); if no Senior Vet is checked in, **PDN-V10** applies.
- Audit entry includes structured `issueReason`, the reporting user's `userId` and operational role at report time, and the creating Vet's `userId`.
- **No dose change by Technician.** This path is the only avenue available to the executing Technician other than acknowledge / administer.

---

## 5. Escalation

### 5.1 State (Phase 3B)

- New value `escalationState = "escalated"` added either via column or `metadata` JSON (engineering choice, lowest blast radius).
- Default `none` for all existing rows.

### 5.2 Endpoints (Phase 3B)

- `POST /api/tasks/:id/escalate` — manual escalation. Authority: active-shift Senior Tech / Vet, or `systemRole = Admin` (final per PDN). Transitions `escalationState` to `escalated`. Fans out push notifications to the active-shift staff matching the **per-task-type escalation matrix** (see PDN-10).
- `POST /api/tasks/:id/accept` — claim escalated task. Authority: any active-shift staff member matching the task-type escalation matrix. Assigns the task to the acceptor and clears `escalationState`.
- `POST /api/tasks/:id/refuse` — refuse with structured reason. Authority: same as accept. Task remains in `escalated`. Audit entry with reason.

### 5.3 Automation (Phase 3C)

- Background worker scans tasks where:
  - `status` is `assigned` or `scheduled` (final list per Phase 0)
  - `escalationState === "none"`
  - age > configured threshold (default 10 minutes).
- Triggers the same transition as the manual `POST /escalate` endpoint.
- Threshold is configurable via env var or `vt_server_config` (decision in Phase 3C PR).
- Already-escalated, in-progress, and completed tasks are never auto-escalated.

### 5.4 Per-task-type escalation matrix — **PDN-10**

"Open to active-shift staff matching task type" requires a per-task-type definition. Examples not yet confirmed:

| Task type | Eligible escalation recipients (proposal — **PDN**) |
|---|---|
| Medication | active-shift Vet ∪ active-shift Technician / Senior Tech |
| Equipment-related | active-shift Tech / Senior Tech |
| General clinical | active-shift Tech / Senior Tech / Vet |

This matrix must be locked before Phase 3B notifications ship.

---

## 6. Audit log contract

Every task mutation produces an audit entry. Phase 0 documents the required fields; Phase 2A → 2C and Phase 3A → 3C wire them in.

Required audit entries (target state):

| Action | Audit fields beyond standard `{actor, timestamp, clinicId}` |
|---|---|
| Create task | `taskId`, `taskType`, `assignee`, `creator`, creation source (form / API) |
| Update task | `taskId`, diff summary (field-level optional) |
| Cancel task | `taskId`, `reason` (if provided) |
| Vet approve medication | `taskId`, `vetUserId` |
| Start task | `taskId`, `acknowledgedBy` if medication |
| Complete task | `taskId`, `medicationBillingRef` if medication, `inventoryJobId` if applicable |
| Report medication issue | `taskId`, `issueReason` |
| Escalate (manual or auto) | `taskId`, `trigger: "manual"\|"scheduler"`, notified recipient ids |
| Accept escalated | `taskId`, `acceptor` |
| Refuse escalated | `taskId`, `refuser`, `reason` |

Unauthorized attempts are **not** audit-logged for now (per product decision). Sensitive-reads audit policy = **PDN-5**.

---

## 7. Frozen scope

The following are **out of scope** until the corresponding phase or are explicitly deferred:

- Rename of `/appointments` route, `appointments.tsx` file, or `vt_appointments` table.
- Generic `<UserSelector>` component shared across pages.
- RECOVER cockpit / CPR cycle UX.
- Any change to `vt_appointments` columns beyond the minimum needed for escalation state in Phase 3B.
- Medication dosage recalculation refactor (FE/BE duplication noted; out of scope for this model).
- Auto-deduction or auto-checkout from Code Blue (covered in `operational-modes.md`).

---

## 8. Open product decisions for the task model

- **PDN-10** Per-task-type escalation matrix (blocks Phase 3B/3C).
- **PDN-12** Student self-task acknowledgement model — terminal vs requires-receipt; whether Student can mark "seen" on received tasks.
- **PDN-T1** Whether Senior Technician can create tasks for other Senior Technicians.
- **PDN-T2** Whether Vet can create tasks for Senior Technicians or Vets.
- **PDN-T3** Whether Vet / Senior Tech can create tasks targeting Students (apart from "delivered to Student to read"), and whether Students can ever "complete" their assigned tasks or only receive them.
- **PDN-T4** Whether off-shift Vets can be assignees for forward-dated tasks (i.e., a task created now but assigned for a future shift the Vet has scheduled).
- **PDN-T5** Override semantics for "Vet / Senior Tech can complete any in-progress task" — confirm this aligns with the new authority model and is not a hierarchy hangover.

---

## 9. Non-goals of this document

- It does not define ER intake flow (see `operational-modes.md`).
- It does not define Code Blue logging (see `operational-modes.md`).
- It does not specify push notification payload schemas.
- It does not approve any code change.
