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

| Creator (effective clinical role) | Self-task | Task for Technician | Task for Senior Tech | Task for Vet | Task for Student | Medication task |
|---|---|---|---|---|---|---|
| **Student** | Self-reminder only (no clinical content) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Technician** | ✅ self | ❌ (others) | ❌ | ❌ | ❌ | ❌ |
| **Senior Technician** | ✅ self | ✅ | (not addressed by product — **assume ❌**) | ❌ explicitly forbidden | (not addressed — **PDN**) | ❌ |
| **Vet** | ✅ self | ✅ | (not addressed — **assume ✅** pending product confirmation) | (not addressed — **PDN**) | (not addressed — **PDN**) | ✅ |
| **Admin without active shift** | ❌ (no clinical authority) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Off-shift Vet / Tech / Senior Tech** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Notes:
- **Medication task creation requires active-shift Vet.** This is the strictest rule in the matrix and must remain a literal `Vet` string match (no hierarchy bypass).
- **Self-task creation requires active shift** for any clinical content. A Student's "self-reminder" is the only carve-out; its scope and audit treatment are tracked under PDN-12.
- "Not addressed by product" rows above are flagged as **Product Decision Needed** (see §8).

---

## 3. Eligible-assignees endpoint (Phase 3A)

To populate task-creation UIs, a single-purpose endpoint `GET /api/tasks/eligible-assignees?taskType=…` will return the set of users the **current** caller is permitted to assign **this specific** taskType to. The endpoint is not a generic UserSelector backend.

Inputs:
- caller's `(systemRole, clinicalRole, activeShiftRole)`
- `taskType` query param

Output (Phase 3A target):
- `assignees: { id, displayName, clinicalRole, activeShiftRole }[]` — filtered to the matrix row plus active-shift requirement on the assignee.
- Empty list when no eligible assignees exist (UI shows actionable empty state).

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

- Available to the executing user (active-shift Tech / Senior Tech / Vet) while the task is `in_progress`.
- Transitions task to `issue_raised`. No further execution is accepted.
- Sends a push notification to the **creating Vet** (the prescriber).
- Audit entry includes structured `issueReason`.
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
