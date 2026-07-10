# Product Growth Roadmap (Phase 10 close-out · serves I.3)

> **Purpose.** The owner is growing VetTrack from equipment-first into a **hospital-management layer** solving six field problems (program-plan I.3). This program laid the *foundations* — archetypes + capability contracts, a console IA with room to grow, generic primitives that accept new domains as **modules, not rewrites**, and domain-neutral code (vet-only assumptions live only in i18n copy + config). This doc maps each of the six problems to a concrete follow-on module: what's already **provided**, what's **missing**, a **proposed placement** (schema + platform target), and a rough cost so the owner can sequence the next program.
>
> **Standing constraints (every follow-on inherits):** build-for-growth (extend the archetype/capability union + console IA, don't fork them); domain-neutral new code (no vet-only identifiers/schemas/logic); patient-facing domains stay removed (migrations 142–143, `docs/scope-change-2026.md`) until an owner-gated decision; every table carries `clinicId` and every query filters it. Cost is rough engineer-weeks.

## The six problems → follow-on modules

### 1 · Reception can't cover rush-hour triage

- **Provided:** the experience-model archetypes + closed capability union let a **`reception` archetype** slot in without re-architecture; waitlist/staging primitives (`vt_equipment_waitlist`, `vt_staging_queue`) exist.
- **Missing:** a reception/intake surface and a triage queue model.
- **Proposed:** add `reception` to `ExperienceArchetype` + a grant row; new `vt_intake_queue` (clinicId, arrivedAt, urgency enum, assignedTo, status enum) + `/reception` home surface (mobile) and an intake console tab. **Platform:** mobile (floor) + console oversight. **Cost:** M.

### 2 · Reception closes on manpower gaps

- **Provided:** console IA has room for an intake module; `/board` can carry a waiting-room display (display-token pairing already ships).
- **Missing:** a coverage/staffing model + a public waiting-room board variant.
- **Proposed:** reuse `vt_shifts` coverage data → a "coverage gaps" console panel; a `board` variant (`?surface=waiting-room`) rendering the intake queue for a lobby screen via the existing pairing flow. **Platform:** console + board. **Cost:** S–M (leans on shifts + board that already exist).

### 3 · No cross-department platform

- **Provided:** realtime outbox/SSE, tasks, shift-chat — all **clinic-scoped** (not department-modeled); the Command Center is a shared live surface; the console is cross-department oversight.
- **Missing:** a **department** dimension on the core entities + routing/filtering by department.
- **Proposed:** additive `departmentId` (nullable) on equipment/tasks/shifts/outbox + a `vt_departments` table; department filters on the board + console; department-scoped realtime channels layered on the existing clinic-scoped outbox (additive cursor filter, not a transport change — frozen SSE stays intact). **Caveat (design before building):** the client gap-detector treats any non-contiguous outbox id as a gap and forces a baseline resync, so a department-filtered feed **cannot** ride the clinic-global cursor as-is — it would resync-loop or silently drop events. A filtered channel needs a **separate per-department cursor** (or an explicit department-aware gap rule) specified up front, not a naive server-side `WHERE departmentId = …` on the shared stream. **Platform:** all three. **Cost:** L (touches core entities; ship additive + shadow-first).

### 4 · Every patient needs a PMS treatment page

- **Provided:** the `server/integrations/` adapter layer (webhook inbound/outbound, sync jobs, conflict tables); the **Integrations & Webhooks console (Phase 7b)** makes the PMS layer operable/visible.
- **Missing:** the patient-facing treatment surface itself (deliberately removed scope) + per-PMS field mapping UI.
- **Proposed:** an owner-gated re-introduction of a minimal treatment/record surface fed by the integration layer (NOT the removed ER/patient tables — a new, integration-sourced read model); a field-mapping editor in the Integrations console. **Platform:** console (config) + mobile (read). **Cost:** L + **owner gate** (patient-facing scope).

### 5 · Poor shift handover

- **Provided:** `vt_shifts`, `/handoff` (shift summary sheet), shift-chat, shift-adjustments; per-role homes already surface handover-relevant state at shift edges (the roster-derived on-shift hero).
- **Missing:** a structured handover artifact (what changed this shift; open items) rather than a free-form summary.
- **Proposed:** a `vt_shift_handover` record (clinicId, shiftSessionId, openItems[], acknowledgedBy) generated at shift end from tasks/custody/alerts deltas; surfaced in `/handoff` and pushed to the incoming shift. **Platform:** mobile. **Cost:** M.

### 6 · Losing money on equipment damage; too little inventory data

- **Provided (THE core):** custody, scan/audit, inventory, restock, purchase orders; Command Center visibility; **Inventory & Procurement (Phase 7d)**; per-role data access; Ops Health.
- **Missing:** damage/loss analytics + inventory demand signals turned into recommendations.
- **Proposed:** a `vt_damage_events` model (already-collected scan/custody signals aggregated) + an analytics panel ("units losing money," "under-stocked at current burn") extending the existing analytics console; optional cost fields on equipment/inventory. **Platform:** console (analytics) + board (at-a-glance). **Cost:** M (analytics extension on data that mostly exists).

## Sequencing note

3 (department dimension) is the highest-leverage but highest-cost — it unblocks true cross-department triage (1/2) and cleaner analytics (6). A pragmatic order: **6 → 5 → 1/2 → 3 → 4** (start with the money/handover wins on existing data; take the department refactor once the module shapes are proven; gate the patient-facing item last). Each ships as an additive module behind a capability grant + console tab, never a rewrite.
