# VetTrack Ownership & Workflow Lifecycle

**Status:** Phase 0 alignment document — **final pre-freeze pass**.
**Source:** `docs/authority-model.md`, `docs/task-product-model.md`, `docs/operational-modes.md`, `docs/phase-2.5-decision-brief.md`, `docs/offline-operational-architecture.md`.
**Audience:** Engineers planning Phase 2.5 and Phase 4; clinical-workflow reviewers.
**Companion:** `docs/offline-operational-architecture.md` (per-workflow offline behaviour).

This document defines ownership semantics and lifecycle behaviour for the nine operational workflows in V1. It is the canonical reference for "who owns this workflow right now and what happens to that ownership during disconnects, shift changes, and reconnects."

---

## 1. Four ownership concepts (kept separate)

| Concept | What it answers | Where it lives | Mutability |
|---|---|---|---|
| **Workflow ownership** | "Whose workflow is this right now?" | `vt_appointments.vetId`, `vt_code_blue_sessions.managerUserId`, `vt_equipment.checkedOutById`, etc. | Mutable per workflow lifecycle. |
| **Authority to act** | "Does this actor have live authority to perform this action *now*?" | Resolved per request from `vt_clinical_shift_sessions` + `vt_users` (Phase 2.5 target). | Volatile (second-to-second). |
| **Operational assignment** | "Is the user formally tied to this workflow for the duration of the shift?" | Same column(s) as workflow ownership, plus assignment audit. | Mutable on transfer / handoff. |
| **Historical responsibility** | "Who took which action and when?" | `vt_audit_logs`. | Immutable after write. |

**Two corollary rules:**

- A user can have **ownership without authority** (own the task but shift ended).
- A user can have **authority without ownership** (active-shift Senior Vet override).

These two cases drive most of the rules below.

---

## 2. Common rules (apply across all workflows)

1. **Ownership survives short disconnects.** Transient network loss does not change ownership.
2. **Authority does NOT survive shift-end.** Check-out (manual or auto) immediately revokes authority, even if ownership persists.
3. **Reconnect re-validates authority.** Client refetches `/api/users/me` on reconnect; cached authority is best-effort UX only (see `offline-operational-architecture.md §2`).
4. **Backend is authoritative on reconcile.** Any queued action the user lacks authority for at server-time is rejected with a structured reason.
5. **Audit is server-side only.** Client mutations carry `originalClientTimestamp`; server writes the audit entry with both client and server times.
6. **Override authority is recorded.** Senior Vet / Senior Tech / Admin overrides include `metadata.overrideRole` + `metadata.overrideReason`.
7. **No silent orphans.** Either check-out blocks (Phase 2.5 Decision 4) or escalation re-fan-out (Phase 3B/3C) catches every otherwise-orphaned workflow.

---

## 3. Per-workflow lifecycle

For each workflow:

- **Owner** — the user column or session reference.
- **Acquisition** — how ownership begins.
- **Transfer** — how ownership moves.
- **Live authority on action** — does taking action require live authority *now*?
- **Disconnect** — what happens during transient network loss.
- **Reconnect** — what happens on reconnect.
- **Shift-end** — what happens when the owner's check-in ends.
- **Forced reassignment** — when reassignment is mandatory.
- **Audit triggers** — which events emit audit entries.

### 3.1 Generic task

- **Owner:** Assignee (`vt_appointments.vetId` for medication tasks; same column for non-medication today).
- **Acquisition:** Created with assignee; or accepted from `escalated` state.
- **Transfer:** Manual reassignment (Phase 3 endpoint TBD); escalation flow.
- **Live authority on action:** YES — start / complete require active-shift authority on the actor.
- **Disconnect:** Ownership unchanged. Cache shows task locally.
- **Reconnect:** Refetch task state from server.
- **Shift-end:** Task remains assigned. Escalation engine re-fans-out after 10 minutes of no progress (Phase 3C).
- **Forced reassignment:** Triggered by escalation engine. Manual reassignment by Senior Vet / Admin allowed.
- **Audit triggers:** `task.created`, `task.assigned`, `task.started`, `task.completed`, `task.escalated`, `task.accepted`, `task.refused`, `task.reassigned`.

### 3.2 Medication task

(Inherits §3.1 plus:)

- **Secondary ownership (acknowledged-by):** Tech who acks at start (`metadata.acknowledgedBy`).
- **Live authority on create:** YES — active-shift Vet of any operational role except on-call (per `task-product-model.md §2.2`).
- **Live authority on start:** YES — active-shift Tech / Senior Tech / Vet.
- **Live authority on complete:** YES — must match `acknowledgedBy` or be Vet / Senior Tech override.
- **Live authority on dose change:** **Tech cannot change dose.** Vet only. (Hard rule; not relaxable by clinic policy.)
- **Disconnect during execution:** Tech may continue local volume/dose entry (no server commit yet). Issue-report and complete are queued.
- **Reconnect:** Server validates active-shift on complete. If Tech's shift ended mid-execution, complete is rejected; FE prompts handoff via reassignment.
- **Issue report:** Queue-safe; server fires notification to creating Vet on reconcile.
- **Audit triggers:** add `medication.vet_approved`, `medication.acknowledged`, `medication.issue_raised`, `medication.dose_changed` (vet-only path).

### 3.3 Escalation flow

- **Owner before escalation:** Assignee.
- **Owner during escalation:** Unassigned; visible to active-shift staff matching task type (PDN-10).
- **Owner after accept:** Acceptor.
- **Live authority on accept / refuse:** YES — caller must be active-shift staff matching the escalation matrix.
- **Disconnect mid-escalation:** Accept may queue; idempotency + server conditional-update resolves the race (first-write-wins).
- **Reconnect:** First acceptor wins. Later accepts return 409 `ALREADY_ACCEPTED`; FE shows current acceptor.
- **Refuse:** Queue-safe; audit-logged; task stays escalated.
- **Shift-end during ownership:** Task re-escalates after 10 minutes if no progress (Phase 3C scheduler).
- **Audit triggers:** `task.escalated`, `task.accepted`, `task.refused`, `task.auto_re_escalated`.

### 3.4 Code Blue session

- **Owner (manager):** Assigned manager (`vt_code_blue_sessions.managerUserId`).
- **Acquisition:** Assigned at start, or later via reassignment endpoint (Phase 4 PR 4.6).
- **Transfer:** Reassignment endpoint; requires live active-shift Vet authority (operational role per `clinicPolicy.codeBlue` — V1: any Vet).
- **Live authority on log entry:** NO at endpoint level (anyone authenticated may log; clinical-action verification is **PDN-CB1**).
- **Live authority on end:** **YES — STRICT.** Cannot end Code Blue offline.
- **Live authority on early closure:** YES — assigned Vet manager + structured `earlyStopReason`.
- **Disconnect (manager):** Manager continues logging; entries queue. Session continues server-side.
- **Reconnect (manager):** Log entries replay via idempotency. End-session re-validates manager authority; if shift ended during disconnect, server rejects end and prompts reassignment.
- **Shift-end of manager:** Per Phase 2.5 Decision 4, **manager check-out is BLOCKED** while a session is active. If session somehow ends up manager-absent (e.g., auto-token-expiry without warning), banner appears; reassignment required (**PDN-V11**).
- **Forced reassignment:** When manager's authority is lost and session is still active. Auto-assignment policy is **PDN-V11**.
- **Historical responsibility:** All log entries are immutable in `vt_code_blue_log_entries`.
- **Audit triggers:** `code_blue.triggered`, `code_blue.manager_assigned`, `code_blue.manager_reassigned`, `code_blue.log_entry_added`, `code_blue.ended`, `code_blue.early_closure`.

### 3.5 ER intake

- **Owner:** Receiving Vet creator → handoff target after handoff.
- **Acquisition:** `POST /api/er/intake` by an active-shift Receiving Vet (or Senior Vet / ER-ICU Vet per `clinicPolicy.erIntake`).
- **Transfer:** Handoff to ER/ICU Vet, Hospitalization Vet, or Technician.
- **Live authority on create / handoff:** YES.
- **Live authority on ack:** YES — target user must be active-shift.
- **Disconnect:** Create queues if the Receiving Vet's authority was cached fresh; otherwise refused. Handoff and ack queue.
- **Reconnect:** Server validates active-shift state.
- **Shift-end:** Intake remains; reassignment required if pre-handoff. Post-handoff, the target's shift-end re-triggers handoff or escalation (PDN-ER1).
- **Audit triggers:** `er_intake.created`, `er_intake.handoff_started`, `er_intake.handoff_acked`.

### 3.6 Equipment checkout

- **Owner:** User who checked out (`vt_equipment.checkedOutById`).
- **Acquisition:** Scan or explicit checkout.
- **Transfer:** Return event resets ownership.
- **Live authority on scan / checkout:** Phase 2C target = active-shift Tech / Senior Tech / Vet. Pre-Phase 2.5: coarse role-string.
- **Live authority on return:** YES + ownership match (Phase 2B.3). Senior Tech may override with explicit flag.
- **Disconnect:** Scan / checkout / return queue. Cache shows local ownership.
- **Reconnect:** Server reconciles. If equipment already checked out to someone else, conflict UX shows current owner + offers return.
- **Shift-end:** Ownership persists. Returning equipment after shift end requires Senior Tech override or active-shift owner.
- **Audit triggers:** `equipment.scanned`, `equipment.checked_out`, `equipment.returned`, `equipment.return_overridden`.

### 3.7 Inventory jobs

- **Owner:** System (no user).
- **Acquisition:** Created on task completion (medication deduction).
- **Transfer:** n/a.
- **Live authority on retry:** Phase 5 target: per `clinicPolicy.inventoryJobRetry` (PDN-4); V1: Admin only.
- **Disconnect / reconnect:** n/a (server-side; recovery scheduler from Phase 1 PR 1.3 runs server-side).
- **Audit triggers:** `inventory_job.created`, `inventory_job.resolved`, `inventory_job.failed`, `inventory_job.retried`.

### 3.8 Handoffs (shift handover + ER handoff)

- **Owner pre-submit:** Outgoing user (the draft author).
- **Owner at submit:** Both parties (draft becomes proposed handoff).
- **Owner post-ack:** Receiver.
- **Live authority on create / submit:** YES.
- **Live authority on ack:** YES — receiver must be active-shift.
- **Disconnect:** Draft authoring works offline (cached); submit and ack queue.
- **Reconnect:** Server validates.
- **Shift-end of outgoing user:** Submitted handoff persists; un-submitted draft remains accessible to the same user on re-check-in. Auto-discard policy: PDN-L3.
- **Audit triggers:** `handoff.draft_created`, `handoff.submitted`, `handoff.acked`, `handoff.cancelled`.

### 3.9 Shift session (the check-in itself)

- **Owner:** The user who checked in.
- **Acquisition:** Successful check-in (Phase 2.5 endpoint).
- **Transfer:** None — sessions are non-transferable. Check-out + new check-in.
- **Live authority:** Defines authority itself.
- **Disconnect:** Session persists server-side. Client caches the session for `authority cache TTL` (PDN-O1; proposal 60s).
- **Reconnect:** Client refetches `/api/users/me`. If session was auto-closed (token expiry, EZShift block end), cached authority invalidated.
- **Shift-end:** Manual check-out (Phase 2.5 Decision 4) or auto-close. Either way, authority is revoked.
- **Audit triggers:** `clinical_shift_session.check_in`, `clinical_shift_session.check_out`, `clinical_shift_session.auto_check_out`, `clinical_shift_session.check_out_blocked`.

---

## 4. Disconnect / reconnect summary

Quick reference. Detailed offline behaviour per workflow in `offline-operational-architecture.md`.

| Workflow | Ownership survives disconnect? | Action permitted offline? | Reconcile strategy |
|---|---|---|---|
| Generic task (start / complete) | yes | yes — non-medication | server validates active-shift; reject if stale |
| Medication task — create | yes | **NO** | live-only |
| Medication task — start / complete | yes | partial (cached approval + ack) | server validates |
| Medication task — issue report | yes | yes | queue + notify Vet |
| Escalation accept / refuse | yes | yes | first-write-wins via idempotency |
| Code Blue trigger | n/a (creates) | yes | server creates session |
| Code Blue log entry | yes | yes | append (idempotent) |
| Code Blue manager assign | yes | **NO** | live-only |
| Code Blue end | yes | **NO** | live-only — strict |
| ER intake create | n/a (creates) | partial | server validates Receiving Vet auth |
| ER intake handoff / ack | yes | yes | server validates |
| Equipment scan / checkout / return | yes | yes | server reconciles; conflict UX |
| Inventory restock | n/a (system-side) | yes — scans queue | server records observedQuantity |
| Inventory dispense (non-emergency) | n/a | **NO** | live-only |
| Inventory dispense (emergency) | n/a | yes | server reconciles |
| Check-in | n/a (creates) | **NO** | live-only |
| Check-out | yes | yes (if session cached) | server records end |
| Handoff draft / submit / ack | yes | yes | server validates |
| Push notification ack | yes | yes | queue |

---

## 5. Audit requirements

Every ownership transfer fires an audit entry. The minimum set:

- **Acquisition** — every workflow records who acquired ownership and when.
- **Transfer** — every transfer records both previous and new owner, plus the transferring actor if different.
- **Override** — every override action records `metadata.overrideRole` + `metadata.overrideReason`.
- **Reconcile reject** — server-rejected queued mutations record `metadata.rejectReason` (`STALE_AUTHORITY`, `CONFLICT`, `ALREADY_APPLIED`, etc.).
- **Auto-reassignment** — scheduler-triggered reassignments record `metadata.trigger = "scheduler"`.

`originalClientTimestamp` is recorded for every queued mutation (per `offline-operational-architecture.md §5`).

Code Blue specifically: every log entry is audited; elapsed time uses the earliest queued timestamp to preserve session ordering.

---

## 6. Open product decisions

- **PDN-L1** Auto-reassignment policy on shift-end (overlaps with PDN-V11). Default V1: no auto-reassign; manager-check-out is blocked so the case is bounded.
- **PDN-L2** Conflict resolution UX wording for equipment double-checkout.
- **PDN-L3** Whether an un-submitted handoff draft survives indefinitely or auto-discards after N days.
- **PDN-L4** Stale-authority cache window (proposal 60s; confirm in `offline-operational-architecture.md`).
- **PDN-L5** Inventory job retry permission (overlaps with PDN-4).

---

## 7. Non-goals

- No CRDT.
- No event sourcing.
- No peer-to-peer ownership negotiation.
- No generalised workflow engine.
- No client-side audit generation.
- No optimistic ownership "merge" — server is authoritative.
- No auto-reassignment of Code Blue manager in V1 (PDN-V11).
