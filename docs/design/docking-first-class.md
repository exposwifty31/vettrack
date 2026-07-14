# Docking as a First-Class Concept — Design (v2)

**Status:** Proposed v2 (interaction model converged 2026-07-14) — **P1 (Ownership) is implemented** (PR #98: migration, schema, derivation service, dock 409 route, `/api/docking`, client wiring, two Manager pages — see `docs/audit/docking-review-findings.md`). P2–P4 remain proposed/not started.
**Owner:** Equipment Manager (product) · P0-2 audit lane (engineering)
**Related:** `docs/design/program-plan.md`, the a51de1ee docking reality-map, `docs/audit/PROOF_ALIGNMENT_LOG.md`
**v2 change:** replaces v1's per-dock NFC "location proof" with an **evidence-stream model**. v1 designed the sensing before the workflow; v2 designs the effortless interaction first and derives the minimum sensing it needs. Docks carry **zero hardware** and are **never scanned**.

---

## 1. Problem

Today the hospital's equipment reality is **chaos**: no standardized organization, no agreed ownership, no consistent storage. Equipment drifts between departments; within a room it moves between beds and procedures dozens of times a day; everyone forms their own assumptions about where things "should" be.

VetTrack is **not modeling that chaos** — it is **defining the target operating model** the hospital will transition into, with the Equipment Manager as the authority who establishes it. Every design choice below optimizes for the *future* standardized model, not the current drifted state — while keeping the day-to-day interaction nearly effortless for technicians and veterinarians on a busy shift.

The current code already agrees at the deepest level — `isEquipmentFullyDeployable` is `custody_state === 'docked' && readiness === 'ready' && usage === 'available'` (`server/services/equipment-operational-state.service.ts:130-136`), so a merely `returned` item is never "truly available." Docking is *already* the truth-gate for a correct return. What's missing is **ownership (a home), honest location truth (without sensor fantasy), enforcement (drive `returned → docked`), and reconciliation (surface the drift)**. This design supplies those.

---

## 2. Interaction principles (design the workflow first)

1. **At most ONE deliberate action per lifecycle event.** The user's natural action *is* the intent; no ceremony, no confirmation scans.
2. **A scan is a complete event, never a confirmation.** Its meaning derives from the item's state (available → take flow; checked out to me → return; checked out to someone else → status/waitlist). There are no scan "modes" and no second scan.
3. **Docks are never scanned and carry no hardware.** A dock is an organizational fact, not a sensed location.
4. **During custody, the person is the location.** You find an in-use pump by finding its holder. In-use movement generates zero events.
5. **Intra-room chaos is bounded, not tracked.** Continuous intra-room positioning is unaffordable and unnecessary; a per-shift Room Sweep ritual re-anchors truth. (The product already contains the embryo: room "verify all," `recentlyVerifiedCount`, the crash-cart "not checked today" banner.)
6. **Exceptions cost one tap and only appear on failure.** Happy paths ask nothing.
7. **Truth is a fold over evidence streams with explicit attribution and age** — never a boolean pretending to be sensor fact.

---

## 3. The model

### 3.1 Vocabulary

| Term | Meaning |
|---|---|
| **Category** (`vt_asset_types`) | An equipment type: infusion pump, monitor, syringe pump, … |
| **Dock / Station** | A **category-typed physical station** inside a room — charging rack/cabinet/shelf. Has a **capacity** (slots). **No tag, no reader, no electronics.** The start and end of an item's lifecycle, and its rendezvous point. |
| **Home Room** | The department/room that **owns** an item. |
| **Home Dock** | The station in the item's Home Room where it charges & rests. **Derived** from `Home Room + Category`. |
| **Anchor** | An accountable, attributed, timestamped assertion that an item is at a station ("returned to ICU · Pump Station"). Created by humans (or, later, smart chargers); invalidated only by contradiction. |
| **Expected Fill** | Which items *should* be at a dock — **derived** (items homed there). Room expected fill = sum over its docks. |
| **Capacity** | A dock's *configured* physical slot count. Room capacity = aggregate of its docks. |

### 3.2 Core invariants

1. **Docks are organized by category** — intentional standardization. One station per `(room, category)`: "the ICU Infusion-Pump Station." More demand ⇒ larger **capacity**, not a second station.
2. **Single ownership (target state)** — every *assigned* item has exactly **one** Home Room and (derived) **one** Home Dock. Using it elsewhere is a normal `checked_out`; ownership is never ambiguous. P1 ships invariant 7 (nullable-until-assigned) as the transitional reality — an item with no Home Room/Category yet has no ownership to be ambiguous about.
3. **Home Dock derives** — the dock where `room = home_room AND category = asset_type`. The Manager assigns *Home Room + Category*; the dock follows. No per-item dock assignment.
4. **Home ⟺ resting with a current at-station anchor at the home dock.**
5. **Return clears custody; being *home* requires an anchor.** Pressing "Return" in the wrong place never makes an item home.
6. **Misplacement is accepted, flagged, reconciled — never blocked** — emergencies park equipment anywhere.
7. **Nullable-until-assigned** — `home_room`/`category` may be unset. "No home yet" is a first-class, visible reconciliation bucket; adoption is incremental.

### 3.3 Stored vs derived

```text
STORED (new / changed)
  docks.asset_type_id     NEW  · the dock's category (nullable during P1 — a dock can be created before
                                 its category is decided; TARGET state is NOT NULL, tightened once every
                                 dock is categorized)
  docks.capacity          NEW  · configured physical slots (int)
  UNIQUE(clinic_id, room_id, asset_type_id) on docks   · one station per (room, category)
  equipment.home_room_id  NEW  · ownership (nullable-until-assigned → rooms)
  equipment.asset_type_id EXISTING (server/schema/equipment.ts:148) · keep nullable in transition; TARGET = required
  anchor evidence         NEW  · latest at-station anchor per item: station, asserted_by, asserted_at, source
                                 (return-toggle | sweep | citizen | future: smart-charger), plus contradiction log

DERIVED (never stored — computed to avoid drift)
  home_dock   = dock WHERE room_id = equipment.home_room_id AND asset_type_id = equipment.asset_type_id
  at_home     = resting AND current anchor.station = home_dock
  misplaced   = resting AND (anchored at a non-home station OR located outside home room)
  dock expected fill = items whose (home_room, category) resolve to this dock
  room expected/capacity = aggregate over the room's docks

EXISTING — clarified meaning (NOT ownership)
  equipment.room_id          (:115) current room assignment (present)
  equipment.dock_id          (:149) station of the CURRENT anchor (where last anchored)
  equipment.last_rfid_room_id(:130) last RFID-observed room (continuous presence, when RFID exists)
```

> **Ownership vs presence:** `home_room_id`/home dock are *ownership* ("where it belongs"). `dock_id`/`room_id`/`last_rfid_room_id`/holder are *presence* ("where it is"). Reconciliation is the diff between the two.

---

## 4. Truth: evidence streams and anchors

### 4.1 Three evidence streams

| Stream | Source | Granularity | Cost | Confidence |
|---|---|---|---|---|
| **Custody events** | the user's own take/return action | *who* has it | the action itself (1 tap/scan) | high, attributed, instant |
| **Presence** | room-level RFID (optional, one reader per room; tags on equipment only) | *which room* | zero user effort | medium, continuous |
| **Anchors** | accountable assertions "at its station" (return toggle, sweep confirm, citizen anchor) | *at the station* | one pre-filled toggle or absorbed into the sweep ritual | high at a timestamp |

Truth = the fold of these streams by the existing evidence-graph resolvers (`server/domain/equipment/**` — same philosophy as today's location resolver precedence, extended with the anchor stream).

### 4.2 Anchor lifecycle (owner decision: sticky-until-contradicted)

An anchor **never expires by time alone**. It stays valid until **evidence contradicts it**:

- someone **checks the item out**;
- **RFID** detects the item in another room (when RFID exists);
- a **Room Sweep** marks it missing from the station;
- a user reports **"Not Found Here."**

Every anchor displays **who verified it, when, and how long ago** ("at ICU · Pump Station — verified by Dana, 3h ago"). Age is information for humans, not a decay trigger for the machine. This keeps the model deterministic.

### 4.3 Custody-state mapping (evolution, not rewrite)

States are unchanged (`untracked | docked | checked_out | returned`, `schema/equipment.ts:152`); their *meaning* is sharpened:

| State | Meaning under v2 |
|---|---|
| `checked_out` | In someone's custody — the person is the location. Unchanged. |
| `docked` | **Resting with a current at-station anchor.** Written by the unified return (toggle checked), a sweep confirm, or a citizen anchor — not by a special ceremony. Sticky until contradicted. |
| `returned` | **Resting without a current anchor** — whereabouts unverified or known-away. The open loop. Unchanged storage; clarified meaning. |
| `untracked` | Legacy default; no writer today; out of scope. |

Deployability stays `docked && ready && available` — i.e., *someone credibly asserted it's at its station and it's ready*. Readiness/conditions machinery (`vt_asset_type_conditions`, staleness worker) is unchanged.

### 4.4 Honesty without sensors

The return toggle is phrased against the item's actual home ("Returned to **ICU · Pump Station**?") — asserting it from the wrong place is a deliberate act, not an accident. Lies don't survive: RFID contradicts instantly where installed; otherwise the next seeker's "Not Found Here" or the next sweep contradicts — and **both assertion and contradiction are attributed and timestamped**. Accountability is social and auditable, which is what actually changes behavior in hospitals. Repeat patterns are visible to the Manager.

---

## 5. The interaction flows

| Flow | Actions | Mechanics |
|---|---|---|
| **Scan-first take** | 1 scan + 1 tap | Scan the item → **Equipment Details** (status, holder, battery/readiness, location, anchor age) → **Take** → checkout with a brief **Undo**. The details screen is the deliberate safety checkpoint (owner decision — no instant-take). |
| **Search-first take** | 1 tap | Search → detail → **Checkout** (shipped on mobile detail, commit d84cb64f7). No scan; a deliberate claim with known identity is custody evidence. |
| **Move** (bed→bed, room→room) | 0 | Person-is-location; RFID logs room transitions passively where installed. |
| **Return** | 1 action + 1 pre-filled toggle | Tap **Return** (or scan the item — same event, state machine reads "mine → return"). ONE dialog, ONE toggle: **"Returned to ⟨home station⟩, plugged in."** Checked ⇒ anchor ⇒ `docked`. Unchecked/impossible ⇒ `returned` (open loop). For powered categories **plug-in ≐ at-station** (the charger lives at the station); for unpowered, the toggle is "at its station." Collapses today's two flows (plain return + dock-return ceremony) into one. Condition quick-check stays where asset types require it. |
| **Room Sweep** (end of every shift) | ~1 tap/scan per item | Open room → **Sweep**: expected list grouped by station; confirm present items (NFC tap-tap-tap or visual bulk-confirm); checked-out lines show "with Alice since 14:20" (accounted, never flagged). Output: fresh anchors for all confirmed, room re-anchored green, discrepancies → worklist. |
| **Citizen anchor** | 1 scan + 1 tap | Scanning a resting item offers secondary action: "Not taking — confirming it's here" (at its station, if in home room). Anyone can heal the map anytime; entirely optional. |
| **Exceptions** | 1 tap | **"Not Found Here"** on a claimed/expected item → contradiction event: flips to "missing — last seen …", releases/queues the claim, red reconciliation row. Zero cost on the happy path. |
| **Emergency** | grab first | Never blocked; existing emergency checkout stands; the sweep absorbs the aftermath. |

**Wrong-room return (the original motivating scenario):** Return tapped in Internal Medicine for an ICU-owned pump → custody cleared; the toggle names ICU's station so an honest user leaves it unchecked (and RFID, where present, contradicts a dishonest check) → item lands in **"returned, away/unverified"** → reconciliation. *Not* truly returned — with zero dock sensors.

**Relocating a stray home** (porter walks it back): citizen anchor on arrival, or simply let the next ICU sweep absorb it.

---

## 6. Reconciliation — the Manager's worklist

The diff **target homes ⟨vs⟩ actual evidence**. Not a passive report: it is the tool that drags the hospital from chaos to the target model.

### 6.1 Per-item audit (answerable for every item)

Who owns it (`home_room`) · where it should be (home dock) · where it is (anchor / RFID / holder) · who has it (`checked_out_by_*`) · anchor provenance (who/when/how long ago) · is it a problem (bucket below).

### 6.2 Buckets (per room, per category)

| Bucket | Definition | Action |
|---|---|---|
| **At home** | resting, current anchor at home dock | ✅ none |
| **Checked out** | in custody of a known user | ✅ accounted — **never** "missing" |
| **Returned, unverified** | resting, no current anchor, location unknown | 🟡 sweep / citizen anchor will resolve |
| **Returned, away** | resting, evidence places it outside home room | 🔴 collect / borrower returns it |
| **Misplaced at a station** | anchored at a non-home station | 🟡 relocate to home dock |
| **Missing** | claimed/expected but contradicted ("Not Found Here", sweep-missing) | 🔴 locate; last-seen trail shown |
| **Unassigned** | no `home_room` or no `category` | 🟠 Manager: assign a home |
| **No station** | home + category set, but no dock exists for that (room, category) | 🟠 Manager: create the station |

### 6.3 Room Sweep ownership (owner decision)

- **Cadence:** end of **every shift**.
- **Owner:** a designated per-shift **Equipment Technician** (Equipment Coordinator) — a *responsibility designation on the shift*, not a new auth role; the system is designed around this responsibility model.
- **Fallback:** the **Shift Lead** runs the identical workflow when no Equipment Technician is designated — zero workflow difference, so hospitals adopt the role gradually.
- The room card shows sweep state ("last swept 2h ago by Dana ✓" / "not swept this shift"), mirroring the crash-cart-check pattern.

### 6.4 Room readiness (replaces the scan-% ring)

Room readiness becomes **present-vs-expected**: `at_home / expected_fill` per category, aggregated per room — a real "is this department stocked?" signal (today's ring is scan-verification %, `ops-tile-helpers.tsx:26-30`).

---

## 7. Sensing architecture, right-sized

- **Baseline (today, zero RFID):** custody events + anchors + sweeps give full custody tracking, station-level organization, and reconciliation. Fully functional.
- **With per-room RFID (when installed):** passive room presence; instant contradiction of false anchors; "returned-away" auto-detection; the existing semi-dock nudge (`server/lib/semi-dock-notify.ts`) keeps nudging holders whose items idle in their home room. Optional enhancement: idle-in-home-room dwell may *propose* an auto-return/anchor (proposal, not silent mutation).
- **Future dock hardware — smart charging stations only:** per-port power sensing turns plugging in (the natural physical act) into a free, automatic, high-confidence anchor. Because truth is a fold over evidence streams, adding this source **changes no workflows** — it just joins the stream. No other dock hardware is sanctioned.
- **Never:** per-dock NFC tags, per-dock readers, dock scanning of any kind.

---

## 8. Build phases

Each phase independently shippable, RED-test-first, in **equipment schema / return route+service / room-radar / new files — never `src/pages/rooms-list.tsx`** (Phase-3 fork lane, T-48).

### P1 — Ownership (establish the source of truth)

- Schema (migrations `164+`, hand-authored): `docks.asset_type_id` (nullable in P1; TARGET is `NOT NULL`), `docks.capacity`, `UNIQUE(clinic_id, room_id, asset_type_id)`, `equipment.home_room_id` (nullable). **Implemented — PR #98.**
- Manager UI: define a room's category-stations (capacity); assign items Home Room + Category (bulk by category); home dock derives + displays.
- Derived reads: `resolveHomeDock`, `dockExpectedFill`, `roomExpected`.
- Tests: derivation (unique; null when unset / no station); constraint; aggregation. No behavior change to custody.

### P2 — Unified return + anchors + contradictions

- One return dialog with the home-station toggle (plug ≐ station for powered); toggle ⇒ anchor ⇒ `docked`; else `returned`. Collapse the separate dock-return ceremony into it (condition quick-check preserved for asset-typed items).
- Anchor evidence storage + the contradiction events (checkout, RFID-elsewhere, sweep-missing, Not-Found-Here) as the *only* invalidators; anchor provenance (who/when/age) surfaced on the detail.
- Scan flow: state-machine disambiguation; available item ⇒ Details ⇒ **Take** ⇒ undo; "Not taking — confirming it's here" secondary (citizen anchor); **"Not Found Here"** on claimed items.
- Tests: state-machine meanings; anchor create/invalidate matrix (each contradiction type; time alone never invalidates); wrong-room return lands "away/unverified"; emergency never blocked.

### P3 — Room Sweep + reconciliation (solve the drift)

- Sweep mode (per station checklist, confirm/flag, checked-out shown accounted); sweep state on room cards; Equipment-Technician-per-shift designation with Shift-Lead fallback.
- Buckets (§6.2) per room + per item; present-vs-expected room readiness replacing the scan-% ring (room-radar + home ops tile — new components).
- A `staleReturnedSweep`-style nudge for `returned`-unverified items (parallels `staleCheckoutSweepWorker`) — nudges, never mutates.
- Tests: bucket classification (checked-out excluded from missing); sweep re-anchoring; expected-vs-present math; designation fallback.

### P4 — Charging integration

- Now: plug-in assertion ≐ station anchor for powered categories; existing charge-alert (`chargeAlertWorker:109-142`) keyed off the unified return toggle.
- Later (optional hardware): smart charging stations as an automatic anchor source; docked-unplugged-at-station nudges.
- Tests: powered vs unpowered toggle semantics; charge-alert parity with today's behavior.

---

## 9. Non-goals / explicit out-of-scope

- **No per-dock NFC/readers/hardware; docks are never scanned** (v2 reversal of v1 §3).
- **No instant-take on scan** — the details screen is a deliberate checkpoint (owner decision).
- **No time-based anchor decay** — contradiction-only invalidation (owner decision).
- **No continuous intra-room tracking** — bounded by the sweep ritual, honestly untracked between anchors.
- **No RFID-history-based home proposals** — homes are defined by the Manager, not inferred (no history exists).
- **No shared/pooled ownership; no snapshot-current-as-home; no new custody states; no blocking on misplacement.** (Carried from v1.)
- **`untracked`** stays a default-only legacy value.

---

## 10. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D-1 | Design the **target** operating model, not current chaos | The app defines the future workflow |
| D-2 | Docks are **category-organized** stations | Standardization; makes Home Dock derivable |
| D-3 | **Single ownership** per item | Answerable audit trail |
| D-4 | Home Dock **derives** from Home Room + Category | No per-item dock assignment project |
| D-5 | **One station per (room, category)** | Unique derivation; capacity over duplication (reversible) |
| D-6 | Store `home_room_id` + `asset_type_id`; **derive** home dock | No denormalization drift |
| D-7 | **Nullable-until-assigned**; visible "no home" bucket | Incremental adoption |
| D-8 | Misplacement = **accept + flag + reconcile**, never block | Emergency reality |
| D-9 | Reconciliation excludes **checked-out** from missing | In-use is accounted for |
| D-10 | **Track at room level, organize at dock level; docks carry zero hardware** | Friction + infrastructure cost of per-dock sensing outweighs value; intra-room precision is unknowable anyway |
| D-11 | **Scan = complete event; meaning from item state** | Kills scan-ambiguity and double-scan flows |
| D-12 | Scan of available item → **Details → Take → Undo** | Safety checkpoint without extra scans (owner) |
| D-13 | **Anchors sticky-until-contradicted**, show who/when/age; contradictions: checkout, RFID-elsewhere, sweep-missing, Not-Found-Here | Deterministic; no arbitrary time decay (owner) |
| D-14 | **Room Sweep at end of every shift**; owned by per-shift **Equipment Technician**, **Shift Lead fallback** | Bounds intra-room entropy; introduces the target operational role without blocking adoption (owner) |
| D-15 | **Plug-in ≐ at-station** for powered categories | The charger lives at the station; one toggle carries both meanings |
| D-16 | Future dock hardware: **smart charging stations only**, as an added evidence source | Natural act becomes a free anchor; workflows unchanged |

**Deferred / to confirm during build:** two stations of one category in a room (relaxes D-5); making `equipment.asset_type_id` NOT NULL; RFID dwell auto-return proposals (P-later); how the Equipment Technician designation attaches to the roster (shift flag vs adjustment).

---

## 11. Verification & coordination

- Every phase: RED-first tests (unit for derivation/state-machine/anchor matrix; integration for return transitions), `npx tsc --noEmit` clean, `pnpm architecture:gates`.
- New user-facing copy → `locales/en.json` + `he.json` (parity), typed `t.*`. No hardcoded Hebrew in source.
- Schema: hand-authored migrations from `164`, commit SQL, `pnpm db:migrate`.
- **Fork boundary:** equipment schema / return route+service / `room-radar.tsx` / new components — **not** `rooms-list.tsx` (Phase-3 fork, T-48). No `pnpm dev`/DB disruption of parallel lanes.
