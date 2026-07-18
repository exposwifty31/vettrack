# 10x Analysis: VetTrack (Veterinary Hospital Operations Platform)
Session 1 | Date: 2026-07-11

> Scope note: this session was invoked with "fetch all latest finished and ongoing work on the repo." §"Repo state" below captures that snapshot; the rest is the 10x strategy built on top of it. Pure strategy — no code. Evidence is cited to files/commits in the repo.

---

## Repo state — what's finished and what's ongoing (as of 2026-07-11)

### Just finished (shipped / merged)
- **Program Phases 0–10 closed out.** The owner's three-app program (`docs/design/program-plan.md`) is done through **Phase 10 close** (`8d9df814b`, PR #78): per-role UX split, web = management console, Command Center `/board` as a fourth platform target.
  - **Per-role UX (Phases 2/3/8/10):** experience-model archetypes + closed capability union; ops vs floor home split (PR #53); **student = custody-only experience** (`da41aacf2`); per-role nav sweeps + web-nav custody gating (`5498338f4`, `27b12db40`).
  - **Web management console (Phases 6/7):** console foundation + slices — **Integrations & Webhooks (7b)**, **Inventory & Procurement (7d)**, **People & Roles (7f)**, **Analytics (7)**, Ops Health.
  - **Command Center as platform (Phases 4/5/9):** `/board` standalone shell + kiosk hardening; snapshot enrichment + calm/pressure modes; **display-device pairing** (pairing code → clinic-scoped revocable read-only token) with a fail-closed revocation watch (`bdd9cc183`, F6).
  - **Phase 10.A/B audit fixes:** F1–F11 punch-list, reviewer pre-seeded clinical shift (`8b60a7e8a`), resubmit.sh versioning tooling (`de0136ac1`).
- **CI-driven Railway deploy cutover (PR #77, `dfad1d98d`):** deploys are now CLI-canonical + healthchecked (previously a silent no-op). Ops reliability foundation.
- **Repo hygiene (#82, `05951a14e`):** dead npm scripts + orphaned scripts removed.

### Ongoing / next (intent, not yet built)
- **The six field problems → follow-on modules** (`docs/design/product-growth-roadmap.md`, `program-plan.md` I.3): (1) reception rush-hour triage, (2) coverage/staffing gaps, (3) cross-department platform, (4) PMS treatment page, (5) shift handover artifact, (6) equipment damage/loss + inventory demand analytics. Proposed sequencing there: **6 → 5 → 1/2 → 3 → 4**.
- **Native rewrite** — Expo/React-Native app + `@vettrack/contracts` in sibling repo `exposwifty31/literate-dollop` (`docs/MAINTENANCE_MODE.md`). Phase 2 experience model was deliberately written UI-framework-free to feed this.
- **App Store resubmission** — Option B bundled shell committed + deployed; resubmission blocked on GitLab + device access (memory: `project_appstore_resubmission`, `project_transformation_state`).
- **RFID / passive readiness wedge** — scoped but not wired (`docs/equipment-readiness-rfid-gap-analysis.md`, `docs/equipment-readiness-wedge-master-execution-plan.md`, `docs/rfid-smoke.md`).

---

## Current Value
VetTrack is the operational nervous system of a veterinary hospital: **equipment custody & tracking**, **Code Blue emergency workflows**, **inventory / dispense / restock / purchase orders**, **tasks & shifts**, and **PMS integrations**, multi-clinic (every table carries `clinicId`). Offline-first PWA + Capacitor native shell + realtime SSE. Three surfaces: mobile (floor), web console (management), `/board` (always-on display).

- **Core action today:** a staff member scans a device in or out (custody), or works a task/shift.
- **The wedge:** *equipment readiness* — knowing where gear is, that it's charged, not lost or damaged.
- **Who uses it & why:** floor staff (find/checkout gear, run emergencies), leads/admins (oversight, config, procurement), and — via `/board` — everyone glancing at the ward.

## The Question
What would make a vet or tech say *"I will not work at a hospital that doesn't have this"* — and make a competing clinic-ops product structurally unable to catch up?

**The core strategic insight:** every high-value feature VetTrack has or plans (analytics, readiness, damage/loss, predictive) is **downstream of custody data that today depends on a human remembering to scan.** The 10x moves either (a) make that root data *ambient and trustworthy*, or (b) exploit surfaces where VetTrack is already *irreplaceable* (emergency, the shared board) and turn them into growth + lock-in engines.

---

## Massive Opportunities

### 1. Kill the scan — passive location & custody (BLE/RFID ambient truth)
**What**: Equipment self-reports location and custody via BLE beacons / RFID gates at doors and docks, so "where is X / who has X" is always accurate **without anyone scanning**. Scan becomes the fallback, not the mechanism. (Groundwork already scoped: `equipment-readiness-rfid-gap-analysis.md`, `equipment-readiness-wedge-master-execution-plan.md`.)
**Why 10x**: Today the product's *entire value chain* — custody, readiness, analytics, damage/loss (problem #6), the board — is only as good as scan discipline, which erodes under pressure exactly when it matters most (a Code Blue is when people *don't* stop to scan). Removing the human step converts VetTrack from a "discipline-tax tool you have to remember to use" into an "ambient source of truth that's just correct." Every other feature gets better for free.
**Unlocks**: Trustworthy analytics, real damage/loss attribution, "device left the building" theft alerts, auto-populated Code Blue cart location, honest utilization data across clinics.
**Effort**: Very High (hardware + firmware + a location model layered additively onto `vt_scan_logs` / custody).
**Risk**: Hardware cost + install per clinic; partial coverage creates gaps; must stay additive (scan path can't regress). Pilot in one clinic first.
**Compounding**: This is the data moat. Quality of every downstream feature compounds with coverage; a competitor without it is guessing.
**Score**: 🔥 (highest strategic leverage — but stage it as a pilot behind the existing readiness wedge)

### 2. Predictive readiness — shift from *tracking the past* to *guaranteeing the future*
**What**: A forward-looking engine that turns custody + inventory + shift roster + expiry + historical usage into guarantees and warnings: *"Tomorrow's 3 surgeries need 2 anesthesia machines; you have 1 functioning + 1 overdue for service. Crash-cart epinephrine expires Thursday. You'll be short 4 IV sets by 14:00 at current burn."* Extends the existing Analytics console (Phase 7) and expiry/forecast workers.
**Why 10x**: Every current surface answers "what is true now." Nobody answers "will I be ready." That's the question that actually causes a clinic to *lose money and endanger patients* (problems #5 and #6). It reframes VetTrack from a ledger into an advisor.
**Unlocks**: Auto-generated prep lists per scheduled procedure; procurement recommendations that pre-fill the existing PO flow; the "money saved" narrative that sells to owners.
**Effort**: High (mostly software; data mostly exists — forecast lib, expiry worker, restock/PO already in `server/services/`).
**Risk**: Predictions must be conservative and explainable, or staff stop trusting them (same failure mode as a noisy alert).
**Compounding**: More history → better predictions. Pure data moat.
**Score**: 🔥

### 3. From per-clinic tool → clinic *network* (equipment sharing + peer benchmarking)
**What**: Exploit the existing multi-tenant `clinicId` model. When a clinic is short a device, show that a sister/partner clinic nearby has an idle one → request a transfer with the custody chain intact. Plus anonymized benchmarking: *"Your ultrasound utilization is 34% vs. 61% peer median — you own one too many."*
**Why 10x**: Turns a single-clinic utility into a network with network effects — the first defensibility that isn't just features. Directly serves the franchise/multi-site owner (the buyer with budget) and monetizes idle capital equipment.
**Unlocks**: Group/enterprise tier; a data product (benchmarks) on top of the ops product; a reason for a chain to standardize on VetTrack across all sites.
**Effort**: High (transfer/custody-across-tenant model + a network permission layer + privacy-safe aggregation).
**Risk**: Cross-tenant data boundaries are a security-critical surface (the `clinicId`-on-every-query rule becomes load-bearing here). Benchmarks must be genuinely anonymized.
**Compounding**: Network effects + data effects. Each new clinic makes benchmarks sharper and the sharing graph denser.
**Score**: 👍 (transformative upside; gate behind proven single-clinic value + a security design pass)

---

## Medium Opportunities

### 4. Code Blue as the marketed wedge — "one tap, everything ready"
**What**: One-tap Code Blue that simultaneously: locates + soft-reserves the nearest **ready** crash cart, pages the on-shift team (push fan-out already exists), opens the timed log with drug-dose reference inline, and pushes the event to every `/board`. The infrastructure is already deep and frozen (`vt_code_blue_sessions`, log entries, keepalive w/ `stormHint`, presence, snapshot, offline-block classifier) — this is *packaging and surfacing*, not rebuilding.
**Why 10x**: Emergency is the one moment VetTrack is literally life-or-death indispensable. It's the product's emotional peak and therefore its strongest word-of-mouth and retention driver — yet today it's treated as a frozen back-end surface, not the headline. Making it feel effortless under maximum stress is what a vet tells a colleague about.
**Impact**: Every clinician, at the highest-stakes moment, several times a week in a busy ER. Converts casual users into evangelists.
**Effort**: Medium (compose existing pieces; the hard runtime guarantees are done). Respect the frozen doctrine — no new transport, no offline queueing, server-confirmed end.
**Score**: 🔥

### 5. Shift handover as a generated artifact (already roadmapped — problem #5)
**What**: At shift end, auto-generate "what changed this shift / what's still open" from the deltas VetTrack already captures (custody moves, task state, alerts, dispenses) — a structured, acknowledged handover pushed to the incoming shift, surfaced in `/handoff`. (`product-growth-roadmap.md` #5 proposes `vt_shift_handover`.)
**Why 10x**: Handover is high-frequency (every shift change, 2–3×/day) and today lossy/free-form. The data already exists — this is turning exhaust into a valued artifact. It also creates a daily habit surface: the incoming shift *opens VetTrack first* to read handover.
**Impact**: Every staffed shift transition. High frequency = high perceived value per unit effort.
**Effort**: Medium (one new record + delta aggregation on existing tables).
**Score**: 🔥 (best effort-to-value ratio of the medium tier; it's already sequenced #5)

### 6. The board that tells you what's wrong *before you ask* (ambient anomaly alerting)
**What**: `/board` is now a fourth-platform surface people already glance at. Make it proactively surface anomalies instead of passively displaying status: *"Dock 3 empty 4h, no checkout logged," "glucometer battery critical," "waitlist backing up 20 min," "crash cart CART-2 last verified 9 days ago."*
**Why 10x**: Turns a screen everyone already looks at from a mirror into an early-warning radar — zero extra user action, value delivered by glance. Leverages the snapshot enrichment + calm/pressure modes already built in Phase 5.
**Impact**: Whole-clinic, continuous, passive. Catches the silent failures that cost money (problem #6) before they bite.
**Effort**: Medium (anomaly rules on existing snapshot/telemetry; must respect the emergency-endpoint cache denylist + bounded-enum telemetry rules).
**Score**: 👍

### 7. Asset Copilot for real ops questions + hands-free chaos guidance
**What**: A natural-language ops assistant over custody + inventory + shifts + schedule: *"What do I need to prep for the 2pm dental?" "Which devices are overdue for calibration?" "Where's the portable X-ray?"* The domain scaffolding exists (`server/domain/equipment/**` Asset Copilot, `docs/PH-01-operational-assistance-during-chaos.md`). Add a hands-free voice mode during a Code Blue.
**Why 10x**: Collapses "hunt through screens" into one question, and in chaos gives spoken guidance when hands are full. In the AI era this is a differentiator competitors will struggle to match without the underlying data model.
**Impact**: Power users daily; everyone in an emergency.
**Effort**: Medium–High (retrieval over existing domain data; voice adds native-shell work).
**Score**: 🤔 (strong, but sequence after the data-quality and Code Blue wins so it has trustworthy data to answer from)

---

## Small Gems

### 1. Universal "Where is it?" locate
**What**: A prominent, always-reachable search that answers *"where is the [device]"* instantly — last-known location + who has it + ready/not — as the single most-hunted-for question in a clinic.
**Why powerful**: The #1 daily micro-frustration (minutes lost, many times a day). Even on manual-scan data it beats walking the halls; on passive data (Massive #1) it becomes magic.
**Effort**: Low (query over existing custody/scan data + a prominent entry point).
**Score**: 🔥

### 2. "Grab & go" readiness badge
**What**: One indicator per device — 🟢 ready (charged, clean, in service) / 🟡 caution / 🔴 not ready — shown wherever the device appears.
**Why powerful**: Kills the recurring anxiety of grabbing a device and finding it dead/unusable. One glance eliminates a whole category of failure. There's already a `--status-stale` readiness palette in the Phase 7 roadmap.
**Effort**: Low (compose battery/service/expiry signals into one derived state).
**Score**: 🔥

### 3. Proactive expiry & low-stock nudge to the right person
**What**: Surface an expiring drug / low crash-cart item / under-stocked SKU to the person who can act, *before* it's a problem — not buried in a report. Expiry + restock workers already run (`expiryCheckWorker`, restock service).
**Why powerful**: Converts existing background jobs into visible, trust-building saves. A crash cart with an in-date epinephrine is a safety win with a one-line change in *where* the signal goes.
**Effort**: Low (route existing worker output to a home-surface nudge / push).
**Score**: 👍

### 4. One-tap "returned damaged" at check-in
**What**: On check-in, a single "damaged / needs service" tap that flags the device and starts the damage-event trail.
**Why powerful**: Tiny UI, but it's the seed data for the entire damage/loss money story (problem #6, `vt_damage_events`). Without a frictionless capture point, the analytics have nothing to analyze.
**Effort**: Low (one control on the existing return flow + an event row).
**Score**: 👍

### 5. Per-role "start of shift" summary card
**What**: The first thing each role sees at shift start — floor: "your assigned gear, open tasks, any active Code Blue"; lead: "coverage gaps, low stock, overdue services." Builds on the roster-derived on-shift hero already shipped.
**Why powerful**: Creates a daily open-VetTrack-first habit (retention) and orients staff in one glance. Reuses the per-role home split already built.
**Effort**: Low–Medium (compose existing per-role data into one card).
**Score**: 👍

---

## Recommended Priority

### Do Now (quick wins, mostly existing data, ship fast)
1. **Universal "Where is it?" locate** — attacks the #1 daily frustration; near-zero new data. (Small #1)
2. **"Grab & go" readiness badge** — kills grab-and-it's-dead anxiety; the `--status-stale` palette is already scoped. (Small #2)
3. **Shift handover artifact** — highest effort-to-value of anything here, already sequenced as roadmap #5; data exists. (Medium #5)
4. **Proactive expiry/low-stock nudge + one-tap damaged-at-checkin** — turn existing workers into visible saves and seed the damage/loss data. (Small #3 + #4)

### Do Next (high leverage, software-heavy)
1. **Predictive readiness engine** — the "will you be ready" reframe; builds the money narrative on data you already hold. (Massive #2)
2. **Code Blue "one tap, everything ready"** — package the deep existing emergency infra into the marketed, evangelism-driving wedge. (Medium #4)
3. **Ambient anomaly alerting on `/board`** — value by glance on a surface everyone watches. (Medium #6)

### Explore (strategic bets — pilot / gate first)
1. **Passive location & custody (BLE/RFID)** — *Risk*: hardware cost, partial-coverage gaps, must not regress the scan path. *Upside*: fixes the data-quality root that every other feature depends on → the durable moat. Pilot one clinic behind the existing readiness wedge. (Massive #1)
2. **Clinic-network sharing + benchmarking** — *Risk*: cross-tenant security boundary, anonymization. *Upside*: network effects + an enterprise/data-product tier. Gate behind proven single-clinic value + a security design pass. (Massive #3)
3. **Asset Copilot + hands-free chaos mode** — *Risk*: only as good as underlying data. *Upside*: AI-era differentiation. Sequence after data-quality + Code Blue wins. (Medium #7)

### Backlog (good, but not the 10x right now)
- Cross-department dimension (`departmentId`) — roadmap #3, highest cost; the roadmap flags a real realtime gap-detector caveat (department-filtered feed can't ride the clinic-global outbox cursor). Do it once module shapes are proven.
- PMS treatment-page re-introduction — roadmap #4; owner-gated patient-facing scope. Last.

---

## The through-line
Two moats, everything else feeds them:
- **Data-quality moat** — passive tracking (Massive #1) makes custody data ambient and trustworthy; predictive readiness (#2) and the copilot (#7) turn that trustworthy data into foresight competitors can't fake.
- **Irreplaceability moat** — Code Blue (#4) and the ambient board (#6) own the moments VetTrack is already indispensable and convert them into habit + word-of-mouth.

Start by mining the data you already have (Do Now + Do Next), *then* spend the hardware/network capital (Explore) once the software value is undeniable. This exactly matches the owner's own additive-module doctrine — extend the archetype/capability union and console IA, never fork or rewrite.

---

## Questions

### Answered (from repo research)
- **Q**: Is RFID/passive tracking already in flight? **A**: Scoped, not wired — gap analysis + wedge execution plan + smoke doc exist; no location model on custody yet.
- **Q**: Is Code Blue infra sufficient to package as a wedge? **A**: Yes — sessions, timed logs, keepalive, presence, snapshot, offline-block are built and frozen; the work is surfacing/packaging, not rebuilding.
- **Q**: Does the multi-clinic foundation support a network play? **A**: Structurally yes (`clinicId` everywhere), but cross-tenant sharing crosses the security boundary that today assumes strict per-clinic isolation — needs a deliberate design pass.

### Blockers (need owner input)
- **Q**: Appetite for a hardware pilot (BLE/RFID capital + install) vs. staying software-only for now? This decides whether Massive #1 is "Explore next quarter" or "not yet."
- **Q**: Is the buyer the single clinic or the multi-site owner? If the latter, the network play (#3) and predictive "money saved" narrative (#2) jump in priority.
- **Q**: Any of these blocked by the App Store resubmission / native-rewrite sequencing? Several small gems ship on the current PWA; some (voice copilot) want the native shell.

## Next Steps
- [ ] Validate assumption: is "where is it" + "is it ready" genuinely the top daily friction? (5 shadowing sessions or a staff poll — cheap, decides the Do-Now order.)
- [ ] Prototype: shift-handover artifact from existing deltas (roadmap #5) — smallest module that proves the "turn exhaust into value" thesis.
- [ ] Design pass: predictive readiness — what conservative, explainable guarantees can be made *today* from forecast + expiry + roster data.
- [ ] Decide: hardware pilot go/no-go (owner) — everything in the Explore tier hinges on this.
- [ ] Security design: cross-tenant sharing boundary before any network work.
