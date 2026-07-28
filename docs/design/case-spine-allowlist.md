# Case Spine — Operational Allowlist / Clinical-PHI Denylist

> VetTrack 2.0, Task 0.1. Makes owner decision #1 ("Case object = operational-only") concrete: the exact
> boundary the `vt_cases` schema (Task 0.2/1.2) is allowed to carry, and what it may never carry. PMS
> stays the clinical source of truth; VetTrack becomes the operational source of truth for the same
> patient's episode, joined by a PMS-issued external key — never by re-deriving clinical facts.

## Review checklist (must be fully checked before this spec is usable by 0.2/1.2)

- [x] Every allowlist field names its source event table (existing, real, `clinicId`-scoped), with two
  explicitly-labeled exceptions that are **not** event streams and are called out as such in the table:
  the **current-state** room entity (`vt_rooms` — placement, not a move-event log) and the case's own
  **intrinsic lifecycle** field (the new `vt_cases` status column). Both are operational and neither
  carries a clinical fact; the checklist is satisfied because these two exceptions are declared, not
  because they name an event table.
- [x] Every denylist category cites owner decision #1 as its authority.
- [x] PMS-key linkage (how a `vt_cases` row finds its patient) is defined.
- [x] No denylisted category appears inside the Allowlist section.
- [x] Design review question answered: what must an operationally-useful case card show?

## PMS-key linkage

A `vt_cases` row does not store or derive clinical identity. It carries a foreign reference to the PMS
patient already modeled by the integration layer:

- `CanonicalPatientV1` — `server/integrations/contracts/canonical.v1.ts` — the PMS-agnostic patient
  contract the adapter registry produces per integration.
- `ExternalPatient.externalId` — `server/integrations/types.ts:46` — the raw external identifier an
  adapter (Priza, generic-pms, vendor-x, …) reports for that patient. (`ExternalAppointment` carries a
  distinct `patientExternalId` field, `types.ts:101`, used to reference a patient from an appointment
  record — a related but separate concept from the patient's own `externalId`.)

`vt_cases.patientExternalId` (mirroring `ExternalPatient.externalId`, + `clinicId`) is the join key. If the PMS integration is absent or the
adapter hasn't resolved a patient yet, a case may exist with a null external id (operational tracking
starts before/without PMS resolution) — it back-fills the join when resolution completes; it never
invents a substitute clinical identity.

## Allowlist — fields `vt_cases` (and anything it references) MAY carry

Every row below is operational: it describes what VetTrack already tracks about equipment, rooms, tasks,
emergencies, and inventory — now attachable to a case via `case_id`. Nothing here is a clinical fact about
the patient; it is a fact about hospital *operations around* the patient.

| Allowlist field / concept | Source event table | Why it's operational |
|---|---|---|
| Equipment usage (checkout/return/scan tied to this case) | `vt_scan_logs` (`server/schema/equipment.ts:553`, `scanLogs`) | Custody event, not a clinical fact |
| Room / location — **current** assignment | `vt_rooms` (`server/schema/equipment.ts:26`, `rooms`) is the room **entity/current-state** table, not a move-event log | Physical placement, operational. NOTE: `vt_rooms` yields only the *current* room; a room-**move timeline** with per-move timestamps needs a dedicated assignment-history source (derivable from `vt_scan_logs` room references, or a future move-event table) — Task 1.2 must identify that source before the timeline renders historical moves. Until then the contract exposes current room only. |
| Operational task linkage | `vt_appointments` (`server/schema/tasks.ts:6`, `appointments` — the unified task model) | Task/workflow state, not diagnosis |
| Code Blue session reference | `vt_code_blue_sessions` (`server/schema/er.ts:34`, `codeBlueSessions`) | Emergency *event* linkage (session id, timing) — not clinical notes entered during it |
| Inventory / dispense activity | `vt_dispense_events` (`server/schema/inventory.ts:213`, `dispenseEvents`) | What was dispensed and when — quantity/item, not why clinically |
| Equipment condition / damage tied to this case | `vt_damage_events` (`server/schema/equipment.ts:646`) | Physical condition fact, not a clinical injury record |
| RFID location trace | `vt_equipment_rfid_reads` (`server/schema/equipment.ts:190`) | Physical tracking, not clinical |
| Workflow state (case open/closed, staged in triage, etc.) | New `vt_cases` status column — operational lifecycle only | Describes VetTrack's own tracking state, never a clinical stage |

**Rule of thumb for adding a new allowlist row:** it must name a real, already-`clinicId`-scoped event
table, and answer "what does this tell staff about resource/task/emergency handling" — never "what does
this tell staff about the patient's condition."

## Denylist — fields `vt_cases` (and anything it references) MUST NEVER carry

Every category below is barred by **owner decision #1** (2026-07-16, `docs/vettrack-2.0-roadmap.md` §
Binding constraints): *"Case object = operational-only... No diagnoses, prescriptions, labs, imaging,
owner info."*

| Denylisted category | Authority | Why it's out |
|---|---|---|
| Diagnoses / clinical assessment | owner decision #1 | Clinical fact — PMS is the source of truth |
| Prescriptions / medication orders (the clinical order, not the dispense event) | owner decision #1 | Clinical order — PMS territory; VetTrack may log *that a dispense happened* (allowlist), never *why it was prescribed* |
| Lab results | owner decision #1 | Clinical data |
| Imaging / diagnostic studies | owner decision #1 | Clinical data |
| Owner (client) personal info — name, phone, email, address | owner decision #1 | PII belonging to the PMS's client record, not operational |
| Any other medico-legally sensitive record (treatment notes, consent forms, clinical narrative) | owner decision #1 | Falls under "anything medically/legally sensitive stays in the PMS" |

**Rule of thumb for rejecting a proposed field:** if it describes the patient's clinical state, the
clinical reasoning behind an action, or personally identifies the client (owner/client name, phone,
email, address), it is denylisted — full stop, regardless of how operationally convenient it would be
to cache it. Client-contact PII is **unconditionally** denylisted here: there is no "operational contact
need" exception — any genuine future need would require a separately defined, narrowly scoped, explicitly
approved field, never a blanket carve-out in this rule.

## Design review — what must an operationally-useful case card show?

(Working-agreement checkpoint per `docs/vettrack-2.0-roadmap.md` — design signs off on this before 0.2/1.2
schema work begins.)

An operationally-useful case card is a **timeline of allowlisted events**, not a mini clinical record. At
minimum it should show:

1. **Case identity strip** — PMS patient display name (from `CanonicalPatientV1`, read-only pass-through,
   not stored redundantly beyond what's needed to render) + `patientExternalId` + case open/closed state.
   **Unresolved-PMS state (required):** because a case may exist before PMS resolution (`patientExternalId
   = null`, per PMS-key linkage above), the strip must render an explicit **pending/unresolved** identity
   — show whatever display name the integration has already surfaced (or "PMS patient not yet linked" if
   none) and mark the external ID visibly as *unresolved/pending*, never blank-as-if-final. It must
   **never** substitute a placeholder, inferred, or locally-invented identity for the missing external
   ID; the pending badge stays until the real join back-fills.
2. **Timeline of attached events**, each rendered from its allowlisted source table: scans (equipment +
   timestamp), room moves, task references, Code Blue session references (link out to the session, not an
   inline clinical summary), dispense events (item + quantity, no clinical rationale), damage/condition
   events, RFID location trace. (Room shows **current** placement; a historical room-move timeline is
   gated on identifying a move-event source — see the Allowlist room-assignment note above.)
3. **No free-text clinical field anywhere on the card.** Any note-taking surface attached to a case must
   be operational (e.g., "coordinator flagged room swap"), never clinical narrative. This must be
   enforced **server-side** — a constrained operational-note schema plus server-side validation that
   rejects clinical narrative before persistence, regardless of whether the write arrives via UI, API,
   or an offline-sync payload. A UI-only rule is insufficient (it is bypassable) and does not by itself
   satisfy the denylist.
4. **Explicit "view in PMS" affordance** for anything clinical — the card should make it obvious that
   deeper clinical detail lives elsewhere, reinforcing integrate-never-replace (owner decision #5).

This becomes the input contract for the Task 1.2 case timeline and per-patient operations page: any field
the timeline wants to render must already appear in the Allowlist table above, or it doesn't ship.
