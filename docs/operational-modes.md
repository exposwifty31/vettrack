# VetTrack Operational Modes — ER Mode & Code Blue

**Status:** Phase 0 alignment document.
**Source:** Revised Implementation Plan v2 (Confirmed Product Logic) + user product-logic statement of record.
**Audience:** Engineers, reviewers, product. Read this before changing any ER Mode or Code Blue behaviour.

---

## 1. ER Mode

### 1.1 Definition

ER Mode is a **global**, clinic-wide operational flag with three persisted states:

- `disabled` — normal operation.
- `preview` — used by product/ops; behaviour identical to `disabled` for end users.
- `enforced` — UI and API are restricted to the ER-mode allowlist; non-allowlisted endpoints return 403; non-allowlisted SPA paths render 404 ("concealment 404 policy").

The state lives in the server config (`vt_server_config`) and is queryable via `GET /api/er/mode` and `GET /api/er/status` (both also wired to SSE at `/api/er/stream`).

### 1.2 Toggle authority (target)

- **Only an active-shift Vet** may toggle ER Mode.
- Phase 1 does not introduce this gate; the toggle endpoint currently uses `canManageErModeForUser` which references a product-owner allowlist (not the shift-aware model).
- Phase 2B PR 2B.6 introduces the active-shift Vet gate at the endpoint.
- Phase 4 PR 4.1 finalises the gate, audit detail, and SSE broadcast.

### 1.3 Backend enforcement (target)

The current implementation has SPA-side enforcement (`src/guards/ErModeGuard.tsx` + `isErSpaPathAllowlisted`) but **does not enforce the allowlist at the API layer**. Phase 4 PR 4.2 introduces an Express middleware that consults `shared/er-mode-access.ts::isErApiPathAllowlisted` and:

- Returns 403 on non-allowlisted requests when state is `enforced`.
- Exempts callers with `systemRole = Admin` accessing admin-page endpoints.
- Does **not** audit blocked attempts (per product decision).

### 1.4 API allowlist (current vs target)

Current allowlist (`shared/er-mode-access.ts:15-23`):

```
/er, /users, /session, /realtime, /push, /containers
```

Target allowlist per Confirmed Product Logic (Plan v2):

> Likely-allowlisted in current scope: Code Blue, Medication Hub, Equipment, Billing, ER Command Center, Pending Emergencies, Report Problem.

This maps to API prefixes (best inference — **PDN-8** for final confirmation):

| Product surface | API prefix(es) |
|---|---|
| Auth / session | `/users` (already in allowlist) |
| Realtime | `/realtime` (already in allowlist) |
| Push notifications | `/push` (already in allowlist) |
| ER Command Center, intake, handoffs | `/er` (already in allowlist) |
| Code Blue | `/code-blue` (**NOT in allowlist today**) |
| Medication Hub | `/medication-tasks`, `/tasks`, `/appointments` (**NOT in allowlist today**) |
| Equipment | `/equipment`, `/returns`, `/alert-acks`, `/rooms` (**NOT in allowlist today**) |
| Billing | `/billing` (**NOT in allowlist today**) |
| Pending Emergencies | `/shift-handover/pending-emergencies` + reconcile (**NOT in allowlist today**) |
| Cabinet / inventory | `/containers` (already in allowlist); `/restock`, `/inventory-items`, `/procurement`, `/dispense` (decision needed) |
| Report Problem | `/support` (**NOT in allowlist today**) |
| Crash cart | `/crash-cart` (decision needed) |
| Patients / animals / display | `/patients`, `/animals`, `/display` (decision needed) |
| Shift handover (non-emergency) | `/shift-handover` (decision needed) |
| Forecast | `/forecast` (decision needed) |
| Activity feed | `/activity` (decision needed) |
| Health checks | `/health` (always reachable for load balancers — confirm) |

**PDN-8 must resolve which of the "decision needed" rows above are added before Phase 4 PR 4.2 ships.**

### 1.5 Admin pages under ER Mode

Admin pages (audit log, integrations, ops dashboard, etc.) remain accessible to callers with `systemRole = Admin` even when state is `enforced`. The Phase 4 middleware uses this carve-out. Admin-page API prefixes are not added to the global allowlist; the carve-out is per-caller.

### 1.6 Audit

State changes (`disabled` ↔ `enforced`, including `preview` transitions) require an audit entry containing:

- `actor` (userId, displayName, clinicalRole, activeShiftRole)
- `previousState`, `nextState`
- `requestId`
- timestamp

Blocked access attempts do **not** require audit log entries for now.

---

## 2. Code Blue

### 2.1 Definition

Code Blue is a per-clinic clinical resuscitation event. The persistent state lives across these tables:

- `vt_code_blue_sessions` — session header (`startedAt`, `endedAt`, `managerUserId`, `patientId`, `hospitalizationId`, `outcome`).
- `vt_code_blue_log_entries` — append-only log of interventions (drugs, shocks, CPR cycles, notes, equipment references).
- `vt_code_blue_presence` — who is currently attending (heartbeat-based; stale after 30 s).
- `vt_code_blue_events` — legacy fire-and-forget event records (not used in active sessions flow).
- `vt_crash_cart_checks` — cart readiness, surfaced in the active-session payload but not part of the session itself.

### 2.2 Trigger authority

- **Anyone** may trigger a Code Blue.
- **Student is trigger-only** — they cannot manage the session, end it, or take logging actions beyond what any authenticated user can (clinical-action verification on log entries is **PDN-CB1**).
- The triggering user need not be on shift to trigger.

### 2.3 Patient association — **PDN-1**

Confirmed Product Logic states Code Blue must be associated with an existing patient. The current schema permits `patientId` and `hospitalizationId` to be null. UX & data-flow details are unresolved:

- Selection at trigger time vs post-event reconciliation?
- Admit-on-trigger flow for unregistered animals?
- Backfilling pending Code Blues with a patient after the fact?

**PDN-1 must resolve before Phase 4 PR 4.1.**

### 2.4 Event manager

- Event manager must be an **active-shift Vet**.
- A Code Blue **may start without a manager** if none is selected (or none is available).
- If no manager is assigned, the UI **must show a persistent warning/banner**.
- **Only the event manager may end the Code Blue.**
- **End is blocked when no Vet manager exists.**

The manager picker UI consumes a server endpoint. Today `GET /api/users/managers` exists (users.ts line 923) and returns users; Phase 4 PR 4.6 normalises it to filter by active-shift Vet only (new name `GET /api/users/active-shift-vets`, with the legacy path optionally retained for compatibility).

> Note: The Phase 0–original audit reported that `/api/users/managers` was missing (404). It is in fact registered. Phase 4 work is **renaming + filtering**, not creation.

### 2.5 15-minute rule

- Server-side gate enforces `endedAt - startedAt >= 15 minutes` for ordinary closure.
- Early closure remains possible if **and only if** all of the following hold:
  - Caller is the assigned Vet event manager.
  - Caller supplies a structured `earlyStopReason` payload.
- The early-closure path **must not be a hard block on clinically necessary early termination**. The product intent is to slow accidental early ends, not to prevent legitimate ones.
- Phase 1 PR 1.5 introduces the server-side gate at the schema-validation layer, leveraging the existing `manager-only` end check already in `code-blue.ts:512`. Active-shift verification of the Vet manager is **Phase 4** work.

### 2.6 Notifications

- Code Blue start **notifies all active-shift staff** (push fan-out).
- The current implementation enqueues a broadcast notification at session create (code-blue.ts ~line 233+). Phase 4 PR 4.8 confirms the fan-out targets active-shift staff specifically.
- No SSE for code-blue presence beyond the existing `/api/realtime/stream`.

### 2.7 Manual logging — no auto-side-effects

In current product scope, Code Blue is a **manual logging** workflow:

- Log entries (drugs, shocks, CPR, notes, equipment) are inserted into `vt_code_blue_log_entries`.
- **No auto-checkout of equipment.** The current handler at `code-blue.ts:409-420` performs auto-checkout when a log entry references equipment. **Phase 1 PR 1.6 removes this side-effect.** The log entry remains.
- **No auto-deduction of inventory.** Medications logged in Code Blue are not automatically billed or deducted; reconciliation is manual (see Code Blue Reconciliation page at `/billing/code-blue-reconciliation`).
- RECOVER cockpit / CPR cycle redesign is **explicitly out of scope**.

### 2.8 End rules

- Only the assigned manager may PATCH `/sessions/:id/end`.
- End is blocked if `managerUserId` is null.
- End requires either `endedAt - startedAt >= 15min` or structured `earlyStopReason`.
- End may include `outcome` (`rosc` / `died` / `transferred` / `ongoing`).
- On end, the session status moves to `closed`; the system summarises log entries into a JSON snapshot.
- Presence rows for the session are stale-filtered (30 s) but not actively cleaned today; cleanup on end is a Phase 4 hardening item.

### 2.9 History

- Code Blue history view is **admin-only**.
- Two backend paths exist today: `GET /api/code-blue/events` (line 164, list of past sessions) and `GET /api/code-blue/history` (line 594). Both require `requireAuth + requireAdmin`.
- The Phase 1 PR 1.1 "endpoint mismatch" finding from the original audit is partially incorrect: both endpoints exist. Phase 1 PR 1.1 reduces to verifying which endpoint the FE actually consumes and ensuring the response shape matches. **No code change is mandated by this document.**

### 2.10 Audit

Every Code Blue mutation requires **detailed** audit entries. Required fields beyond standard `{actor, timestamp, clinicId}`:

| Action | Audit fields |
|---|---|
| Trigger session | `sessionId`, `patientId?`, `hospitalizationId?`, `managerUserId?`, `preCheckPassed?` |
| Add log entry | `sessionId`, `logEntryId`, `category`, `idempotencyKey`, `equipmentId?` |
| Presence heartbeat | not audit-logged (high-frequency, non-meaningful mutation) |
| End session | `sessionId`, `outcome`, `endedAt`, `earlyStopReason?`, `durationMs` |
| Reconcile dispenses | `sessionId`, `reconciledItems` summary |
| Manual billing | `sessionId`, `billingLedgerId`, `amountCents` |
| Manager reassignment (if/when supported) | `sessionId`, `previousManagerUserId`, `newManagerUserId` |

---

## 3. Pending Patients vs Pending Emergencies — **PDN-2**

These are distinct concepts today:

- **Pending Patients** (`/pending`) lists patients waiting for assignment/admission. Backed by `GET /api/patients/pending` and `PATCH /api/patients/:id/assign`.
- **Pending Emergencies** (`/pending-emergencies`) reconciles emergency inventory dispenses that were pulled before patient registration. Backed by `GET /api/shift-handover/pending-emergencies` and `PATCH /api/shift-handover/emergency/:logId/reconcile`.

Confirmed Product Logic states "Pending Patient becomes Active Patient after assignment/admission" but does not address the relationship to Pending Emergencies. The relationship — whether these are two views of one workflow stage or distinct concepts — is **PDN-2**.

---

## 4. Open product decisions

- **PDN-1** Code Blue ↔ patient association mechanics.
- **PDN-2** Pending Patient vs Pending Emergency relationship.
- **PDN-5** Sensitive-reads audit policy (does viewing Code Blue history / audit log / patient records produce audit entries?).
- **PDN-8** Exact ER Mode API allowlist (see §1.4 table).
- **PDN-CB1** Whether Code Blue log entries from Students require any additional gating.
- **PDN-CB2** Whether `vt_code_blue_presence` rows should be deleted or marked-stale on session end.
- **PDN-CB3** Whether the Code Blue 15-minute gate applies to `outcome = "ongoing"` (i.e., the session is closed-but-continuing, not truly ended).
- **PDN-ER1** Whether ER intake support for "handoff from receiving Vet to Technician" requires a new endpoint or extends the existing assign/handoff flow.
- **PDN-ER2** Whether the SSE catch-up on reload is sufficient to "restore all active ER events" or whether additional state replay is needed.

---

## 5. Frozen scope

The following are out of scope of this document and of the operational-modes work in Phases 1 through 4:

- RECOVER cockpit / CPR cycle UX redesign.
- Code Blue auto-checkout of equipment.
- Code Blue auto-deduction of inventory.
- Reusing Code Blue or ER infrastructure for non-emergency workflows.
- Auto-admit of patients on Code Blue trigger (unless decided under PDN-1).

---

## 6. Non-goals of this document

- It does not change any code today.
- It does not define the per-task-type escalation matrix (see `task-product-model.md`).
- It does not redefine the authority model (see `authority-model.md`).
- It does not approve any endpoint addition or removal.
