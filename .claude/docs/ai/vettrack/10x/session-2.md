# 10x Analysis: VetTrack 2.0 — what justifies the bump
Session 2 | Date: 2026-07-16

> **RESOLVED 2026-07-16 — the six "Open Questions for the Owner" (foot of doc) are now ANSWERED; that section is retitled `## Owner Decisions`. The 2.0 (Case Spine + Shift Autopilot) is GREENLIT within hard boundaries. The binding call: YES to a first-class patient/case object — but an _operational_ object only, never a clinical record. PMS stays the clinical source of truth; VetTrack becomes the _operational_ source of truth.**

> Companion to `session-1.md` (the 10x *feature* program). This session answers a different, higher question: **not "what's the next big feature" but "what change in identity earns the 2.0 badge."** A 2.0 is not a bigger 1.x — it is a change in what the product IS. Every thesis below was adversarially stress-tested against that bar; the ones that were strong-1.x-features-in-disguise are named and killed in "Why NOT 2.0."

---

## Current Value

VetTrack today (v1.2.0, build 26) is an **equipment-first veterinary-hospital operations PWA** — the operational nervous system of a clinic. Core loop: a staff member scans a device in/out (custody), or works a task/shift. Everything is `clinicId`-scoped (app-layer multi-tenancy; no Postgres RLS).

- **Who uses it / why:** admins, vets, techs, students — to know where equipment is, whether it's ready, to run Code Blue emergencies, to dispense/restock inventory, to work tasks and shifts.
- **Core action:** scan → custody change; secondary loops = Code Blue timeline, dispense, task, shift-chat/handover.
- **Where time is spent:** the equipment list / my-equipment / scan surfaces, Code Blue, and the shift surfaces.
- **Deepest assets a 2.0 can leverage** (from the ground digest):
  1. **The `clinicId`-scoped spine + `vt_event_outbox`** — an append-only, monotonic, replayable, DLQ-guarded, per-tenant **fact-stream of everything that happens in the hospital** (`realtime-outbox.ts`, `event-publisher.ts`, `outbox-dlq-scanner.ts`). Not just "realtime UI" — a clean event backbone any AI/analytics/cross-site layer inherits for free.
  2. **The offline-first custody/evidence graph** — Dexie + conflict-detecting sync engine (`sync-engine.ts`), a hexagonal domain (`server/domain/equipment/**`), and schema that already models physical truth *beyond scan*: `vt_equipment_anchors`, `vt_equipment_rfid_reads`, `rfid_tag_epc`, `vt_damage_events`, `vt_unit_condition_states`.
  3. **The PMS integration seam** — a real adapter registry (`server/integrations/adapters/{priza,generic-pms,vendor-x,…}`), credential encryption, inbound webhooks, sync-conflict/mapping tables. The one place VetTrack already touches the clinic's system-of-record — and `CanonicalPatientV1`/`ExternalPatient` already model the patient in `integrations/types.ts`.
  4. **The 4-platform shell + pure-TS capability model** — mobile / iPad / web-console / `/board` resolve through one seam (`src/app/platform/`); role→experience is a closed pure-TS union (`experience-model.ts`). Adding an archetype or surface is additive, not a rewrite.
  5. **A nascent AI scaffold** — `asset-copilot-orchestrator.service.ts`, `task-intelligence.service.ts`, `equipment-inference.ts`, plus an LLM-grounding harness (`ai-safety-validator.ts`, `citation-validator.ts`) so agent output is cited to real events, not hallucinated.
  6. **A just-landed additive Socket.io collaboration channel** (commit `c844e8bda`) — reference-counted presence leases + TTL (`presence-store.ts`), clinic-scoped + record-scoped rooms, Redis cross-instance fan-out, record co-presence card 1.4 designed to be advisory over the OCC guard. Thin today; the exact seam for live surfaces.

## The 2.0 Question

The 1.x program-plan is **done** (per-role UX, web-as-console, board-as-4th-platform — all shipped; 4-platform flow-walk green 2026-07-16). The 10x *feature* program (session-1: massive-01 RFID, massive-02 predictive readiness, massive-03 clinic-network, medium-01…04, live collaboration) is the claimed 1.x forward roadmap. **Session-2 must go one tier ABOVE or ORTHOGONAL to all of it.**

The north star: equipment-first → **a hospital-management layer spanning vet AND human healthcare**; three native apps (console · board · mobile); six field problems — (1) reception can't cover rush-hour triage, (2) reception closes on manpower gaps, (3) no cross-department platform, (4) every patient needs a PMS treatment page, (5) poor shift handover, (6) losing money on equipment damage + too little inventory data.

The structural truth the digest surfaced: **VetTrack today tracks *things* and *staff*, but never the *patient* or the *episode of care*.** Patient/ER/hospitalization tables were deliberately removed (migrations 142–143). North-star #1, #4, and any "human healthcare" claim are *structurally impossible* until that changes. That is where the 2.0 lives.

---

## The 2.0 Thesis

> **VetTrack 2.0 is the release where the product stops being a registry of the clinic's *resources* and becomes the operating layer that runs the clinic's *work around each patient* — an operator you approve, not a logbook you feed.**

Two compounding moves — one structural (what the product IS), one behavioral (what it DOES):

**Move 1 — The Case Spine (structural repositioning).** Introduce a first-class `vt_cases` / episode-of-care object and hang every existing event off a `case_id`: a custody scan, a dispense, a Code Blue session, a task, a damage report all attach to a case. Crucially this is **not** rebuilding the PMS clinical record — it is the *operational shadow* of it, keyed to the PMS patient the adapter layer already ingests (`CanonicalPatientV1`, `patientExternalId` already on appointments). This is the single deepest change-in-identity available: from a logistics layer *beside* the clinical record to a clinical-operations layer *around* the patient. It is the precondition for #1 (triage), #4 (per-patient treatment page), #3 (cross-department), and the entire human-healthcare crossover.

**Move 2 — The Shift Autopilot (behavioral repositioning).** Turn the passive fact-stream into an active agent that *runs the shift*: an outbox consumer that **drafts and stages** the operational action (reassign the equipment coordinator when the current one goes off-roster; cut a restock PO when burn crosses readiness; pull a drifting crash cart back to ready; write the handover) into a per-clinic **approval queue** — one-tap approve/edit/reject, live over the Socket.io presence channel. It ships in the codebase's own `off | shadow | enforce` envelope: `shadow` (proposes, never executes) → `enforce` (executes on approve). This changes the *verb*: from a system staff **operate** to a system that **operates the hospital with them and asks permission** — from clipboard to co-worker.

**Why the two compound (the whole is > the sum):** The Autopilot can start **today** on the existing device/shift fact-stream (it needs no patient object to reassign a coordinator or cut a PO). The moment the Case Spine lands, the Autopilot's proposals become **patient-aware** — "this patient's readiness gap," "triage this arrival to a free tech," "draft this case's handover" — and the case timeline becomes the thing every proposal references. Spine gives Autopilot context; Autopilot makes the Spine *actively worked* rather than merely recorded. Together they are literally the north-star sentence: an operations layer, spanning departments and eventually human healthcare, wrapped around each patient.

**Why this earns 2.0 on reach × frequency × defensibility:**
- **Reach:** both are 100% of users — every patient interaction (Spine), every shift/every event (Autopilot).
- **Frequency:** per-event and per-shift — the highest-frequency surfaces in a hospital's day.
- **Defensibility (the part that matters):** two *compounding* moats, not copyable features.
  - The Spine's moat is **the join no one else can reconstruct**: a PMS has the diagnosis but not the custody/RFID/damage/Code-Blue-timing fact-stream; an RFID vendor has the reads but no case. VetTrack becomes the only system that ties the physical fact-stream to the clinical episode — and it gets richer every event.
  - The Autopilot's moat is **operations-memory**: every approve/edit/reject is a labeled example of *this clinic's* tacit operating policy (who to escalate to, when to reorder, how hard to pull carts). It converges on each clinic's playbook per shift, and across the fleet becomes a cross-clinic policy prior that bootstraps every new clinic on day one — the session-1 "data-quality moat" pointed at *behavior* instead of custody.
- **Grounded in the real stack:** outbox event backbone, PMS adapter seam, BullMQ workers (`start-schedulers.ts`), the copilot + AI-safety harness, the `off|shadow|enforce` pattern already proven on the authority evaluators, and the shipped Socket.io presence channel. Both are **additive consumers of the frozen outbox — no transport replacement, no schema teardown, respects the frozen-surface doctrine.**

Everything else in this document is either (a) connective tissue that makes these two visible and collaborative, (b) the ROI wrapper that sells them to the buyer, or (c) a longer-horizon bet that *depends on* the Spine existing first.

---

## Massive Opportunities

### 1. The Case Spine — the operations layer AROUND each patient
**What:** First-class `vt_cases`/episode object; bind every existing event (custody, dispense, Code Blue, task, damage, RFID location) to a `case_id`. Operational shadow of the PMS record, keyed to the PMS patient via the existing adapter registry — not a clinical-record rebuild. Add the `departmentId` dimension the model lacks (everything is `clinicId`-flat today; the outbox cursor can't do department-scoped feeds yet — a real realtime gap, not just a column).
**Why 2.0:** The single biggest change in what the product IS. Today it tracks things and staff, never the patient (tables removed in migrations 142–143; `server/schema/er.ts` vestigial). Adding the case object crosses VetTrack from logistics-beside-the-record to operations-around-the-patient — the literal north-star "hospital-management layer," and the only path to #4 and "human healthcare."
**Unlocks:** Per-patient treatment/operations page (#4); reception triage boards (#1); cross-department view (#3, once `departmentId` lands); the semantic layer every AI/predictive feature needs to be *about care* rather than *about things*; the human-healthcare wedge.
**Compounding:** Every already-shipped module (custody, Code Blue, dispense, tasks) becomes retroactively more valuable the instant it attaches to a case. The defensible asset is the **physical×clinical join** no PMS or RFID vendor holds — and it deepens with every event.
**Effort:** High (new schema surface + `case_id` wiring through existing routes + `departmentId` + outbox department-scoping). De-risked by the outbox backbone + the PMS canonical patient contract already existing.
**Risk:** Scope creep into "rebuilding the PMS" — must stay disciplined as the *operational shadow*. The removed-tables decision (`docs/scope-change-2026.md`) was deliberate; owner must re-open it. Department-scoped realtime is a genuine architecture task.
**Score:** 🔥

### 2. The Shift Autopilot — operator you approve, not a system you operate
**What:** Agent loop over `vt_event_outbox` that drafts + stages operational actions into a per-clinic approval queue (approve/edit/reject), live over the Socket.io channel. Reuses `asset-copilot-orchestrator.service.ts` as the orchestration seam; adds an `action_proposal` table + approval route + `AuditActionType` kinds; ships `shadow`→`enforce` like the authority evaluators; outputs grounded/cited via `ai-safety-validator` + `citation-validator`.
**Why 2.0:** 1.x AI is *answer-shaped* (Copilot answers "where is the ventilator"; predictive-readiness shows a badge). This changes the verb to *does the mundane work and asks permission* — a different product category. medium-04 and massive-02 stop at "informs a human"; nothing on the 1.x list crosses into "drafts and executes."
**Unlocks:** Directly attacks #1/#2 (coverage) and #5 (handover) — the agent absorbs coordination labor thin staffing can't. Enables an **hours-of-work-saved-per-shift** pricing story instead of per-seat. The approval queue becomes the lead's home screen.
**Compounding:** Per-clinic operations-memory moat (labeled approve/edit/reject) → converges on each clinic's tacit playbook; cross-fleet policy prior bootstraps new clinics day one.
**Effort:** High, but high-feasibility on the real stack — substrate (ordered replayable outbox, BullMQ loop, action-endpoint routes, LLM-safety harness) is done. Additive outbox consumer; no frozen-surface change.
**Risk:** Trust — a wrong auto-proposal in a clinical setting is costly. Mitigated by shadow-first + human-in-the-loop approval + citation grounding + the proven `off|shadow|enforce` gate. Alert fatigue if the queue is noisy (borrow the bounded-enum telemetry discipline).
**Score:** 🔥

### 3. The Ambient Safety Net — predict-and-prevent, folded into the Autopilot's "sense" half
**What:** Always-on inference scoring the fact-stream for pre-failure signatures — crash-cart drifting from ready into a thin-roster shift (`vt_crash_cart_checks`); a unit whose `vt_damage_events` + `vt_unit_condition_states` + return cadence trace a failure trajectory; a device class trending to zero-ready in the learned high-demand window (`vt_scan_logs` + `vt_operational_metrics`); a Code Blue readiness gap. On threshold-cross it **pages the named accountable person** (push via `notification.worker`, ambient flash on `/board`) with the one closing action.
**Why 2.0:** Inverts the tense of the whole product from retrospective (records what happened) to preventive (pages before the incident) — aimed at the stickiest surface (Code Blue/crash-cart). Opens human-healthcare positioning: an operational early-warning score is the ops analog of a clinical EWS.
**Unlocks:** Turns the irreplaceable emergency surface from reactive to preventive — the feature a clinical director won't give up ("removing a smoke detector").
**Compounding:** Each prediction gets a ground-truth label when the incident does/doesn't occur → a self-labeling incident dataset; across the fleet, a cross-site failure-signature library.
**Effort:** Medium-high; fact tables + alert rails (`alert-engine.ts`, `notification.worker`, `/board`) exist; `equipment-location-inference.ts` proves inference-over-domain is in-tree.
**Risk:** Alarm spam destroys trust — must start rules/statistical in `shadow`, high-precision-only. **Not a standalone 2.0** — it is the *predict* half of the Autopilot loop (the sense that precedes the propose). Ranked as a sub-thesis of #2, not a peer.
**Score:** 👍 (as Autopilot's sensing layer)

### 4. Human-healthcare crossover — the destination, gated behind the Spine
**What:** Package the three most transplantable capabilities (sterile-instrument custody/audit, crash-cart + Code Blue runtime, RFID directional tracking) as a `human_hospital` clinic archetype targeting mandated retained-surgical-item / instrument-count + OR/ED code-cart readiness.
**Why 2.0:** New market, 10–100× TAM; the capability model is a closed pure-TS union so a new archetype is additive. This is the owner's explicit north star.
**Unlocks:** Entry into human-hospital procurement; a compliance-anchored path vet-only competitors can't follow.
**Compounding:** Regulatory moat (instrument tracking is compliance-mandated → sticky, audit-driven); every human deployment feeds the benchmark corpus.
**Effort:** Very High, and **gated** — requires the Case Spine (to talk about human patients) AND real PHI posture: **Postgres RLS (currently zero)** + HIPAA-grade audit before a single human deployment.
**Risk:** Attempting it before the Spine + RLS exist is the classic over-reach. This is a *consequence* of moves 1–2, not a parallel build — it is the strategic frame, sequenced after them.
**Score:** 🤔 (strategic destination; do not start standalone)

### 5. The Immutable Hospital Ledger — reposition outbox+audit+anchors as the tamper-evident record-of-truth
**What:** Promote the internal transport (`vt_event_outbox` cursor + closed `AuditActionType` union + contradiction-based `vt_equipment_anchors`) into an externally-authoritative, hash-chained, signable ledger: add a prev-hash column + per-clinic signing key + tamper-evident export/attestation.
**Why 2.0:** Reframes plumbing as the *deliverable* — from a tool a clinic uses to a record a clinic (+ its insurer, regulator, malpractice defense) depends on. One tier above the 10x roadmap: RFID/predictive/copilot/collab all *write to* this ledger.
**Unlocks:** Insurance/warranty attestations, malpractice-defense export, controlled-substance registers, and the compliance posture for human healthcare.
**Compounding:** Record-of-truth lock-in is the deepest moat here — hash-chaining turns "a database" into "evidence" a competitor can't retroactively manufacture; the anchor model's contradiction-based truth (D-13) is rare and hard to copy.
**Effort:** High-feasibility, additive (prev-hash column + signing step + export route; outbox/audit/anchor stacks exist and are frozen/load-bearing).
**Risk:** Without the Case Spine it's a ledger of *things*, not care — its full value (and the human-healthcare/compliance story) needs the Spine. Strong **Do-Next enabler**, not the headline (a backend repositioning is felt by the buyer only once it's exported/attested against real regulatory need).
**Score:** 👍

---

## Medium Opportunities

### 1. The Live Floor + The Baton — synchronous shared operating picture + live custody of *responsibility*
**What:** Promote the ephemeral collab channel to a persistent "who's doing what, where, right now" canvas rendered simultaneously on every phone/tablet and `/board` (presence leases already shipped in `presence-store.ts`). Layer **The Baton**: a two-sided, acknowledged handoff of a task/case/Code-Blue-role/zone — the receiver must be present and explicitly ACCEPT, else it escalates up the roster ladder (reuse the P3 Equipment Coordinator escalation pattern). Extend VetTrack's equipment chain-of-custody to **custody of work**.
**Why 2.0-adjacent:** Flips the product from asynchronous system-of-record you consult to synchronous system-of-presence you live inside; the Baton guarantees responsibility can never be *silently dropped* at a shift/department boundary (#5, #3). This is the connective tissue that makes moves 1–2 visible and collaborative.
**Impact:** Rush-hour becomes visible and absorb-able; handoff becomes an accountable transfer, not a document. Every baton pass is an outbox fact → a queryable accountability graph (a liability/compliance asset).
**Effort:** Medium — rides the shipped presence/room channel + escalation-ladder pattern + `collab-socket.ts` seam; the frozen SSE/outbox path stays authoritative (live floor is advisory-presence over it).
**Score:** 🔥 (as the connective-tissue layer over the Spine + Autopilot)

### 2. The Economic Loss & ROI Ledger (+ optional autonomous P&L drafting)
**What:** Auto-price every event the system already streams into a continuously-updating $ ledger: repair/replacement cost per `vt_damage_events`, carrying + wastage cost per expiry, spend-vs-par per item; surfaced first on the admin+lead-gated management console as the owner's running P&L on physical operations. Optional Autopilot extension: on a chargeable/warranty-eligible damage event, auto-draft the cost-recovery packet (pulling the evidence graph — custody chain + condition history) into the approval queue.
**Why it matters more than it seems:** Owner-problem #6 ("losing money on equipment damage; too little inventory data") is the multi-site buyer's literal decision criterion. Today the product records the damage but never tells them what it *cost*. This is the first economic system-of-record in the product — the ROI proof that *sells* moves 1–2.
**Impact:** Hard-dollar renewal + multi-site-expansion justification; seeds cross-site cost benchmarking (the feasible half of massive-03).
**Effort:** Medium — event streams (damage/dispense/restock/procurement) + cost-bearing tables (`parLevel`, `targetPar`, POs) exist; net-new is a pricing/cost-attribution service + a ledger view. No frozen-surface change.
**Score:** 👍

### 3. Reception War-Room — a shared live triage/intake queue (front-of-house wedge)
**What:** One live intake queue (walk-ins/arrivals/waiting) any present staffer on any surface can see, claim, and progress; presence-aware so load visibly spreads instead of piling on one desk. Board shows queue depth + who's claiming; phones let a free tech pull the next arrival.
**Why it matters:** Directly attacks #1/#2 (reception can't cover rush hour; the clinic *closes* on manpower gaps) — problems no amount of equipment tracking touches — and introduces a **new archetype** (reception/front-desk), widening who the product is for.
**Impact:** Habit at the day's most stressful moment; intake-timing/claim data feeds the missing coverage engine and the arrivals demand-signal for massive-02.
**Effort:** Medium — live-claim rides the shipped presence/room channel + reuses waitlist/staging-queue patterns; needs a lightweight intake object (can precede the full Spine) + a reception archetype in `experience-model.ts`.
**Score:** 👍 (best sequenced after the intake object / early Spine)

### 4. Controlled-substance & regulated-custody compliance module
**What:** Specialize the Ledger (#5 Massive) into a regulated-custody vertical: chain-of-custody + reconciliation + e-signature + immutable register for controlled substances and high-value devices, generating statutory reports (controlled-drug registers; DEA-style logs in the human-health context).
**Why it matters:** Repositions VetTrack as the system the clinic's *compliance* runs through — the most credible concrete bridge into human healthcare (shared controlled-substance/device-custody regime). Changes who the buyer is (compliance officer / liability-de-risking owner).
**Impact:** A compliance-grade SKU; human-healthcare beachhead; reframes #6 losses as liability reduction.
**Effort:** High-feasibility — dispense/restock/procurement routes + audit log + custody events exist; adds a compliance layer + signing + statutory export. The `off|shadow|enforce` wiring is a proven gated-enforcement model.
**Score:** 👍 (Explore — narrow reach, but non-negotiable and non-churning where it applies)

---

## Small Gems

### 1. Auto-composed shift handover (a feature *of* the Autopilot, not a 2.0)
**What:** `handoff.tsx` stops being a form the tired tech fills; the copilot auto-composes the handover from the ordered outbox fact-stream + presence for that shift window (shift is already roster-derived — the system knows whose window is whose). Tech reviews and confirms; never writes.
**Why powerful:** Inverts authorship (recorder → reviewer) at a twice-daily, clinic-wide touchpoint (#5); confirmed-vs-corrected drafts are labeled training data. Highest-feasibility summarization pass over data the system already has.
**Effort:** Low-Medium.
**Score:** 👍 (ship as the first concrete Autopilot proposal type — a fast proof of the "operator you approve" pattern)

### 2. Per-case timeline "pin" on any existing surface
**What:** The instant the Case Spine exists, add a one-tap "attach to case" on the scan/dispense/damage/Code-Blue surfaces so the timeline back-fills with zero new screens.
**Why powerful:** Makes the Spine felt on day one without a migration of user behavior — the case timeline populates itself from actions staff already take.
**Effort:** Low (once Spine exists).
**Score:** 👍

### 3. "Who's on the floor right now" glance card
**What:** A minimal reduced view of the Live Floor presence on every phone home screen (avatars on rooms) before the full canvas ships.
**Why powerful:** Cheap first taste of the synchronous-presence repositioning; validates the "everyone must be on it or the picture is wrong" adoption dynamic before investing in the full board canvas.
**Effort:** Low (presence store already shipped).
**Score:** 🤔

---

## Recommended Priority

### Do Now
1. **Shift Autopilot — `shadow` mode over the existing device/shift fact-stream** 🔥 — Why: highest-feasibility half of the headline, needs no schema teardown, starts generating the operations-memory label set immediately. Impact: proves "operator you approve" with real proposals (coordinator reassign, restock PO, cart-drift pull). Ship the **auto-composed handover** (Small Gem 1) as the first proposal type — fastest visible win.
2. **The Case Spine — schema + `case_id` binding + `departmentId`** 🔥 — Why: the structural precondition for the entire 2.0 and the north star; nothing about #1/#3/#4/human-healthcare is possible without it. Build in parallel with #1 (Autopilot doesn't block on it, but becomes patient-aware the moment it lands). Unlocks: per-patient page, triage, cross-department, the physical×clinical join moat.

### Do Next
1. **The Live Floor + The Baton** 🔥 — Why: connective tissue that makes the Spine + Autopilot visible and collaborative; the Baton adds accountable custody-of-work (#5/#3). Rides the shipped Socket.io channel. Unlocks: rush-hour visibility, the accountability graph.
2. **Economic Loss & ROI Ledger** 👍 — Why: the buyer's decision criterion (#6); the ROI proof that *sells* the two headline moves; first economic system-of-record. Unlocks: hard-dollar renewal + cross-site cost benchmarking.
3. **Autopilot → `enforce` + Ambient Safety Net sensing** 👍 — Why: promote proven-in-shadow proposals to one-tap execution; add the predict-before-the-incident sensing on the emergency surface. Unlocks: the preventive repositioning of the stickiest module.

### Explore (strategic bets)
1. **Immutable Hospital Ledger (hash-chain + signing + attestation export)** 👍 — Why: reframes plumbing as the record-of-truth deliverable; the compliance substrate for human healthcare. Risk: full value needs the Spine first. Upside: insurance/malpractice/controlled-substance lock-in.
2. **Controlled-substance / regulated-custody compliance module** 👍 — Why: the most concrete human-healthcare bridge; regulatory lock-in. Risk: narrow reach. Upside: compliance-grade SKU + beachhead.
3. **Reception War-Room** 👍 — Why: front-of-house wedge attacking #1/#2 + a new archetype. Risk: needs the intake object / early Spine. Upside: widens who the product is for + coverage/demand data.

### Backlog (good but not now)
1. **Human-healthcare crossover packaging** — Why later: a *consequence* of the Spine + RLS + PHI posture, not a parallel build. Gated on all three.
2. **Cross-tenant actuarial network ("Carfax for medical devices") + VetTrack mutual-aid marketplace** — Why later: both gated on a cross-tenant primitive + Postgres RLS that don't exist, and the actuarial value needs many clinic-years of fleet scale. The benchmarking half is feasible before the lending/settlement half. This is the long-game moat the Spine + Ledger + sensors *feed* — sequence it after the fleet and the data density exist.
3. **Sensor/IoT readiness fusion (load cells, fridge probes, door/power sensors)** — Why later: capital-intensive, hardware-BOM-and-partnership-gated, adjacent to the massive-01 RFID roadmap. Genuine physical lock-in, but a hardware bet, not the software 2.0. The ingestion half (`vt_equipment_rfid_reads` gateway stream) is reusable when the time comes.
4. **Open the Adapter Registry as a public App Platform** — Why later: a genuine app→platform category move (`base.ts` already documents a self-contained SPI), but premature — you platform-ize once there's ecosystem *pull* (PMS/device vendors clamoring), which doesn't exist yet. Revisit once the Case Spine makes VetTrack the integration hub worth building against.

---

## Why NOT 2.0 (theses rejected or downgraded as 1.x-in-disguise)

The rigor of a 2.0 call is in what it *refuses* to badge. Killed/downgraded:

- **"Your Shift Documents Itself" (auto-handover) → Small Gem.** This is medium-02 (shift-handover artifact) with a summarization pass. Auto-composing an existing artifact is an enhancement, not a change in what the product IS. It's real and worth shipping — as the *first proposal type of the Autopilot*, not a headline.
- **"Ambient Safety Net" (standalone) → folded into the Autopilot.** An extended massive-02 (predictive readiness across more fact classes). Inverting tense is powerful, but it's the *sense* half of the sense→propose→approve loop, not a separate product category. Peer-ranking it double-counts the same move.
- **"Autonomous P&L Agent" and "The Money Accounts for Itself" → merged into one Medium (the ROI Ledger).** The economic ledger is genuinely new and hits the buyer's decision criterion — but descriptive→economic is a strong *module*, not a change in what the product IS on its own. It's the ROI *wrapper* that sells the headline, ranked Do-Next. The "agent that acts on money" is just the Autopilot pointed at the ledger.
- **"Open the Adapter Registry as an App Platform" → Backlog.** A real app→platform category move, but platforms need ecosystem demand that doesn't exist yet. Shipping an SDK nobody is asking to build against is a 2.0 in *form* without the 2.0 in *value*. Premature.
- **"VetTrack Network — mutual-aid marketplace" → Backlog.** Gated on a cross-tenant primitive + RLS that don't exist, and the lending half rests on a shaky behavioral assumption (clinics loaning ventilators to nearby competitors, with liability). The benchmarking half is more feasible than the marketplace half; neither is buildable now.
- **"Cross-tenant actuarial network" → Backlog (long-game moat).** The deepest network moat on the list, but it needs the cross-tenant primitive/RLS *and* fleet scale (many clinic-years) before actuarial value exists. It's what the Spine + Ledger + sensors *feed*, not a session-2 build.
- **"Sensor/IoT readiness fusion" → Backlog.** Identity-flavored ("building knows its own state"), but capital- and hardware-partnership-intensive and adjacent to massive-01. A hardware bet, not the software 2.0.
- **"Human-healthcare crossover" as a standalone build → Strategic frame, not a thesis.** It is the *destination* that moves 1–2 (+ RLS/PHI) unlock, not something you build in parallel. Treating it as a buildable session-2 item inverts the dependency.
- **"The Chart Writes Itself — Ambient Clinical Scribe" → deferred variant of the Case Spine.** Correctly identifies that owning a patient/episode object is the real 2.0 — but leads with the *hardest* input modality (on-device clinical speech-to-intent + a bounded grammar) for the *narrowest* surface (Code Blue only). The 2.0 is the **spine**; voice capture is a later high-value input *into* it, not the way to birth it. Reach the object first via the PMS seam + one-tap attach (Small Gem 2), add voice once the spine is load-bearing.

The through-line of every rejection: a 2.0 must change *what the product is* (resource-registry → patient-operations layer) or *what it fundamentally does* (logbook → operator). Features that make an existing capability faster, prettier, or smarter — however valuable — are 1.x. Bets that depend on primitives that don't exist yet (cross-tenant, RLS, hardware, ecosystem pull) are backlog, not badge-justifying.

---

## Owner Decisions (2026-07-16) — questions resolved

The six questions are answered. Each decision below is now **binding direction** for the 2.0 build; the analysis body predates them and is superseded where it conflicts.

### The gate — ANSWERED: **YES, but operational-only.**
Introduce a first-class **operational Case object** — but it must **never** become a Patient Management System or duplicate one. **PMS = clinical source of truth; VetTrack = operational source of truth.** The Case carries only what improves hospital *operations*: equipment usage, room assignments, operational tasks, Code Blue events, inventory activity, workflow state. Clinical documentation, diagnoses, prescriptions, labs, imaging, owner information, and any medically/legally sensitive record **stay in the PMS**. The separation is intentional — it caps legal exposure, avoids duplicated responsibility, keeps the mission on operations. → *Design rule for the Case Spine: an explicit operational-field **allowlist** + a clinical/PHI **denylist**. Because VetTrack stores no clinical data, Postgres-RLS / HIPAA-PHI hardening is a **human-healthcare-horizon** cost, not a vet-now blocker — this de-risks and accelerates the Spine.*

### Human-healthcare timeline — ANSWERED: **the destination, not the objective.**
Vet emergency hospitals first. Expand into human ED/hospitals **only after** product maturity, operational reliability, multi-clinic deployments, and validated workflows. To a human hospital today the answer is deliberately **"not yet."** Every decision stays *compatible* with future healthcare requirements, but the **vet roadmap is never slowed to accommodate them.** Veterinary medicine is the proving ground, not a stepping stone. → *Confirms human-healthcare + RLS/PHI stay Backlog; keep the Case boundary and capability model clean so the crossover stays additive later.*

### Build-vs-mirror the case identity — ANSWERED: **complementary — neither mirror nor replace.**
PMS owns the medical record; **VetTrack owns operational continuity.** The defining principle: **Offline-First is a _trust strategy_, not a technical detail.** Equipment tracking, Code Blue, tasks, inventory, handovers, and coordination must continue when the network / internet / PMS is unavailable; on reconnect VetTrack syncs with the PMS and restores consistency without disrupting operations. Continuing to run when the enterprise systems are down is the confidence wedge at the moments reliability matters most. → *Elevates Offline-First from resilience to positioning — the Case object must be fully functional offline and reconcile on reconnect via the existing sync engine.*

### Appetite for autonomous action — ANSWERED: **a continuously-learning assistant, human approval by default.**
The Autopilot is **not** an autonomous system. Every proposed action initially requires human approval — and approvals, edits, rejections, and overrides are **training data**, not merely safety rails. The objective is **continuous learning**, not universal automation: learn how each hospital operates, how departments differ, how individuals prefer to work. Evolve into a **policy-driven** system that adapts per organization. **Automation occurs only where explicit, organization-approved policies exist.** Trust is earned through learning, not by removing humans. → *Refines the open `enforce` question: not "shadow forever" and not blanket `enforce` — `enforce` is unlocked **per-policy, per-org, explicitly**, on top of the proven `off | shadow | enforce` envelope. The approve/edit/reject stream is the operations-memory moat, by design.*

### Go-to-market — ANSWERED: **Integrate. Never replace.**
VetTrack is **not** sold as a PMS replacement — replacing a PMS is expensive, disruptive, and risky, and hospitals have years invested in theirs. VetTrack integrates with the existing PMS and fills the operational gaps it was never designed to solve; value comes from **extending** existing infrastructure, not competing with it. A hospital adopts VetTrack **without** changing clinical workflows, retraining all staff, or migrating historical data — immediate operational value, existing systems preserved. → *Constrains the Case Spine: no PMS-workflow change and no data migration may be required to adopt.*

### `departmentId` / Department model — ANSWERED: **important long-term, introduced only when mature and scoped.**
Department is part of the long-term architecture but must **not** be added just because hospitals have departments — only where it delivers measurable operational value (department-specific workflows, permissions, dashboards, real-time coordination, staffing visibility, department-aware analytics), and its scope must be **clearly defined before implementation.** Too early = needless domain-model complexity; too late = limited scalability. → *Answers the open question: `departmentId` + department-scoped realtime is a **scoped fast-follow**, not a 2.0-blocking requirement.*

---

## Core Product Principles (owner-set, binding — 2026-07-16)

Guardrails for every future product decision:

1. **VetTrack complements the PMS — it never competes with it.**
2. **Offline-First is a trust strategy, not a feature.**
3. **AI exists to learn each hospital's operations — not to replace human judgment.**
4. **Adoption must be frictionless** — immediate value without replacing existing infrastructure.
5. **Operational simplicity always takes priority over feature quantity.**
6. **Every new capability must reduce operational friction, not add cognitive load.**

---

## Next Steps (updated 2026-07-16 — the gate is decided)
- [x] **DECIDED (owner):** patient/case object re-opened — **YES, operational-only** ("operational source of truth"), hard clinical/PHI boundary. *Gate cleared.*
- [ ] **Spec:** the Case object's operational-field **allowlist** + clinical/PHI **denylist** (the "operational shadow, not PMS rebuild" boundary made concrete) — the first artifact, before any schema.
- [ ] **Spike:** `vt_cases` schema + `case_id` binding on one existing event path (dispense or Code Blue), riding the outbox additively — prove the physical×clinical join without touching frozen surfaces, and prove it works **offline** + reconciles on reconnect.
- [ ] **Spike:** Autopilot `shadow`-mode consumer of the outbox that emits one proposal type (auto-handover) into an `action_proposal` table + approval route — prove the propose→approve loop, and capture approve/edit/reject as labeled training data (the operations-memory moat) via the existing copilot + AI-safety harness.
- [ ] **Design:** the **per-org policy layer** that gates `enforce` — automation only where an explicit organization-approved policy exists (sits above `off | shadow | enforce`).
- [ ] **Research (deferred to human-healthcare horizon):** Postgres RLS + PHI/audit hardening — *not* a vet-now blocker, since the operational Case stores no clinical data.
- [ ] **Validate:** pull one clinic's month of outbox history and hand-label what the Autopilot *would have* proposed vs. what staff actually did — measure the operations-memory signal before enabling any policy-gated `enforce`.
- [ ] **Later / scoped:** `departmentId` + department-scoped realtime feed — fast-follow, scope defined before build.
- [ ] **Still open — Decide:** pricing model (per-seat vs. work-saved) — the Autopilot/Ledger value narrative depends on it.
