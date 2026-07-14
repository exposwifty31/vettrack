# Docking as a First-Class Concept — Design

**Status:** Proposed (design converged 2026-07-14; no code written)
**Owner:** Equipment Manager (product) · P0-2 audit lane (engineering)
**Related:** `docs/design/program-plan.md`, the a51de1ee docking reality-map, `docs/audit/PROOF_ALIGNMENT_LOG.md`

---

## 1. Problem

Today the hospital's equipment reality is **chaos**: no standardized organization, no agreed ownership, no consistent storage. Equipment drifts between departments and everyone forms their own assumptions about where things "should" be.

VetTrack is **not modeling that chaos** — it is **defining the target operating model** the hospital will transition into, with the Equipment Manager as the authority who establishes it. Every design choice below optimizes for the *future* standardized model, not the current drifted state.

The current code already agrees at the deepest level — `isEquipmentFullyDeployable` is literally `custody_state === 'docked' && readiness === 'ready' && usage === 'available'` (`server/services/equipment-operational-state.service.ts:130-136`), so a merely `returned` item is never "truly available." Docking is *already* the truth-gate for a correct return. What's missing is **ownership (a home), enforcement (drive `returned → docked`), and reconciliation (surface the drift)**. This design supplies those.

---

## 2. The model

### 2.1 Vocabulary

| Term | Meaning |
|---|---|
| **Category** (`vt_asset_types`) | An equipment type: infusion pump, monitor, syringe pump, … |
| **Dock** | A **category-typed physical station** inside a room — a charging rack/cabinet/shelf. Has a **capacity** (slots) and its own **NFC tag**. The start *and* end of an item's lifecycle. |
| **Home Room** | The department/room that **owns** an item. |
| **Home Dock** | The station in the item's Home Room where it charges & rests. **Derived** from `Home Room + Category`. |
| **Expected Fill** | Which items *should* be at a dock — **derived** (items homed there). Aggregated up, a room's expected fill = sum over its docks. |
| **Capacity** | A dock's *configured* physical slot count. Room capacity = aggregate of its docks. |

### 2.2 Core invariants (the whole model)

1. **Docks are organized by category** — intentional standardization. One station per `(room, category)`: "the ICU Infusion-Pump Station." More demand ⇒ larger **capacity**, not a second station.
2. **Single ownership** — every item has exactly **one** Home Room and (derived) **one** Home Dock. Using it elsewhere is a normal `checked_out`; ownership is never ambiguous.
3. **Home Dock derives** — an item's home dock = the dock where `room = home_room AND category = asset_type`. The Manager assigns *Home Room + Category*; the dock follows. No per-item dock assignment.
4. **Home ⟺ docked at home dock** — `custody_state = 'docked' AND current_dock = home_dock`, physically proven (NFC).
5. **Return validates location, not just status** — pressing "Return" in the wrong place does **not** make an item home. The `returned → docked` transition is gated on physical proof.
6. **Misdock is accepted, flagged, reconciled — never blocked** — emergencies dock anywhere. `custody='docked' AND current_dock ≠ home_dock` ⇒ "Returned, not at Home Dock."
7. **Nullable-until-assigned** — `home_room`/`category` may be unset. "No home yet" is a **first-class, visible reconciliation bucket**, so adoption is incremental (no big-bang migration).

### 2.3 What is stored vs derived

```
STORED (new / changed)
  docks.asset_type_id     NEW  · the dock's category (NOT NULL)
  docks.capacity          NEW  · configured physical slots (int)
  UNIQUE(clinic_id, room_id, asset_type_id) on docks   · one station per (room, category)
  equipment.home_room_id  NEW  · ownership (nullable-until-assigned → rooms)
  equipment.asset_type_id EXISTING (server/schema/equipment.ts:148) · keep nullable in transition; TARGET = required

DERIVED (never stored — computed to avoid drift)
  home_dock   = dock WHERE room_id = equipment.home_room_id AND asset_type_id = equipment.asset_type_id
  at_home     = custody_state = 'docked' AND dock_id = home_dock
  misdocked   = custody_state = 'docked' AND dock_id ≠ home_dock
  dock expected fill = items whose (home_room, category) resolve to this dock
  room expected/capacity = aggregate over the room's docks

EXISTING — clarified meaning (NOT ownership)
  equipment.room_id          (:115) current room assignment (present)
  equipment.dock_id          (:149) current / last dock (where last docked)
  equipment.last_rfid_room_id(:130) last RFID-observed room (continuous location)
```

> **Ownership vs presence:** `home_room_id`/home_dock are *ownership* ("where it belongs"). `room_id`/`dock_id`/`last_rfid_room_id` are *presence* ("where it is now"). Reconciliation is the diff between the two. Keeping them separate is what makes the diff meaningful.

---

## 3. Custody + location truth

### 3.1 The existing state machine (unchanged states)

States on `equipment.custody_state`: `untracked | docked | checked_out | returned` (default `untracked`, `:152`). Transitions live (scattered) across `post-equipment-create.ts`, `equipment-custody-toggle.service.ts`, and the `equipment-operational-state.ts` dock-return route. **We add no new states** — we give `returned` vs `docked` a *location meaning* and gate the transition.

### 3.2 Two-tier location proof

RFID granularity is **room-level**; a per-dock **NFC tag** is needed for dock-level truth (today's master tag is per-*room* and goes ambiguous with >1 dock — the audit flagged this at `dock-return-nfc.tsx:164-180`).

| Physical signal | Proves | Result |
|---|---|---|
| NFC scan at **home dock** | at Home Dock | `docked`, **at home** — deployable for owner |
| NFC scan at a **non-home dock** | at *a* dock, wrong one | `docked` + **misdock flag** (accepted, reconciled) |
| RFID in **home room**, no dock scan | in the right room | `returned`, "in home room — finish docking" (soft nudge) |
| Not in home room | away | `returned`, "away from home" (strong nudge) |

**"At home" ≠ "deployable."** Deployability (`custody='docked' && readiness && available`) stays the gate for *can someone check it out*. **At-home** (`docked && dock_id = home_dock`) is the new gate for *is it where it belongs* — the reconciliation axis. A misdocked item is deployable (someone can grab it) but not at-home (owner is short).

### 3.3 Misdock

`dock-return` accepts **any** dock (never blocks — `equipment-operational-state.ts:317-336`). Home-ness is computed, not enforced at write time. A dock-return to a non-home dock records the real `dock_id` and surfaces as misdock in reconciliation. This is the emergency-safe design.

---

## 4. Reconciliation — the Manager's worklist

Reconciliation is the diff **target homes ⟨vs⟩ actual location**. It is not a passive report; it *is* the tool that drags the hospital from chaos to the target model, one item at a time.

### 4.1 Per-item audit (answerable for every item)

- **Who owns it?** → `home_room`
- **Where should it be?** → home dock
- **Where is it?** → `dock_id` / `last_rfid_room_id` / checked-out location
- **Who has it?** → `checked_out_by_*`
- **Is it home / a problem?** → the bucket below

### 4.2 Buckets (per room, per category)

| Bucket | Definition | Manager action |
|---|---|---|
| **At home** | `docked` at home dock | ✅ none |
| **Checked out** | `checked_out` to a known user | ✅ accounted for — **not** a problem |
| **Returned, away** | `returned`, not in home room | 🔴 go collect / user to return home |
| **In home room, not docked** | `returned`, RFID = home room | 🟡 finish docking |
| **Misdocked** | `docked` at wrong dock | 🟡 relocate to home dock |
| **Unassigned** | no `home_room` or no `category` | 🟠 Manager: assign a home |
| **No station** | home_room + category set, but no dock exists for it | 🟠 Manager: create the station |

> **"Missing from home" excludes checked-out.** An item legitimately in use is accounted for; the problem set is *returned/idle-not-home* and *unassigned*.

### 4.3 Room readiness (replaces the scan-% ring)

Today the room "readiness ring" is a scan-verification % (`ops-tile-helpers.tsx:26-30`). Under this model it becomes **present-vs-expected**: `at_home_count / expected_fill` per category, aggregated per room — a real "is this department stocked?" signal.

---

## 5. Build phases

Each phase is independently shippable, RED-test-first, and lives in **equipment schema / dock-return route+service / room-radar / new files — never `src/pages/rooms-list.tsx`** (owned by the Phase-3 fork, task T-48).

### P1 — Ownership (establish the source of truth)

*Goal: define homes; no behavior change yet.*

- **Schema** (migrations `164+`, hand-authored):
  - `docks.asset_type_id text NOT NULL REFERENCES vt_asset_types`, `docks.capacity int`.
  - `UNIQUE(clinic_id, room_id, asset_type_id)` on `vt_docks`.
  - `equipment.home_room_id text REFERENCES vt_rooms` (nullable).
- **Admin UI (Equipment Manager):** define a room's category-stations (one per category, capacity); assign each item a Home Room + Category → home dock derives + is shown. Bulk assign by category.
- **Derived reads:** `resolveHomeDock(item)`, `dockExpectedFill(dock)`, `roomExpected(room)`.
- **Rollout:** nullable throughout; "Unassigned" and "No station" are visible buckets from day one. No transition of existing custody behavior.
- **Tests:** home-dock derivation (unique per room+category; null when unset / no station); one-station-per-(room,category) constraint; expected-fill aggregation.

### P2 — Location-gated return + misdock

*Goal: `returned → docked` means "physically home."*

- Extend the dock-return path (`equipment-operational-state.ts`, `equipment-custody-toggle.service.ts`) to compute `at_home` / `misdock` from `dock_id` vs derived home dock; record, never block.
- Per-dock NFC tags: dock-level identity so a room with >1 station disambiguates (removes the `AMBIGUOUS_DOCKS` fallback for tagged docks).
- On plain return, classify by `last_rfid_room_id` vs `home_room` (in-home-room vs away) for the nudge tier.
- **Tests:** dock-return at home dock → at-home; at non-home dock → docked + misdock; plain return away → returned+away; emergency never blocked.

### P3 — Reconciliation views (solve the drift)

*Goal: the Manager's worklist.*

- Per-room, per-category buckets (§4.2); per-item audit (§4.1).
- Replace the room readiness ring with present-vs-expected (§4.3) — in `room-radar.tsx` and the home ops tile (new components, not `rooms-list.tsx`).
- A "Needs docking / away / unassigned" surface + a `staleReturnedSweep` worker that nudges `returned`-not-home items after a TTL (parallels the existing `staleCheckoutSweepWorker`).
- **Tests:** bucket classification (incl. checked-out excluded from "missing"); expected-vs-present math; sweep nudges only `returned`-not-home.

### P4 — Unify charging into the dock

*Goal: the dock is the charging station.*

- Fold the existing charge-alert (`chargeAlertWorker`, fired on plain-return-unplugged, `:109-142`) into docking: a docked-but-unplugged item at its dock gets the charge nudge; dock-return records plug state. Unifies the today-independent `is_plugged_in` (on `vt_equipment_returns`, `:226`) with dock presence.
- **Tests:** docked-unplugged → charge nudge; docked-plugged → none; plain-return path preserved.

---

## 6. Non-goals / explicit out-of-scope

- **No RFID-history-based home proposals** — there is no RFID history; homes are *defined* by the Manager, not inferred.
- **No shared/pooled ownership** — single ownership is deliberate; it is what makes the audit trail answerable.
- **No snapshot-current-as-home** — that would codify the drift the system exists to remove.
- **No new custody states** — `returned`/`docked` are reused; only the transition gate and derived truth are added.
- **No blocking on misdock** — always accept + flag.
- **`untracked`** stays a default-only legacy value (no writer today); out of scope to repurpose.

---

## 7. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D-1 | Design the **target** operating model, not current chaos | The app defines the future workflow; there is no order to infer |
| D-2 | Docks are **category-organized** stations | Intentional standardization; makes Home Dock *derivable* |
| D-3 | **Single ownership** (one Home Room + Home Dock per item) | Answerable audit trail; using elsewhere = checkout |
| D-4 | Home Dock **derives** from Home Room + Category | Avoids a per-item dock-assignment project |
| D-5 | **One station per (room, category)** | Unique home-dock derivation; more demand = capacity, not a 2nd station (reversible) |
| D-6 | `home_room_id` + `asset_type_id` stored; **home dock derived** | No denormalization drift |
| D-7 | **Nullable-until-assigned**; "no home" is a visible bucket | Incremental adoption, no big-bang migration |
| D-8 | Misdock = **accept + flag + reconcile**, never block | Emergency reality |
| D-9 | Reconciliation excludes **checked-out** from "missing" | In-use is accounted for |

**Deferred / to confirm during P1:** whether any room genuinely needs *two* stations of one category (relaxes D-5); making `equipment.asset_type_id` `NOT NULL` (target state) vs staying nullable through transition.

---

## 8. Verification & coordination

- Every phase: RED-first tests (unit for derivation/classification; integration for the dock-return transitions), `npx tsc --noEmit` clean, `pnpm architecture:gates`.
- New user-facing copy → `locales/en.json` + `he.json` (parity), typed `t.*`. No hardcoded Hebrew in source.
- Schema: hand-authored migrations from `164`, commit generated SQL, `pnpm db:migrate`.
- **Fork boundary:** all work stays in equipment schema / dock-return route+service / `room-radar.tsx` / new components — **not** `rooms-list.tsx` (Phase-3 fork, T-48). No `pnpm dev`/DB disruption of the parallel lane.
