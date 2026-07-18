# HANDOFF — VetTrack 10x Plan Library

**To:** the agent/user working in `/Users/dan/Developer/active/vettrack-ship`
(branch `claude/phase-10a-audit-fixes`).
**From:** the `/game-changing-features` 10x session (branch
`claude/game-changing-features-sync-987ca9`, commit `4c3edcd64`).
**Nature:** documentation only — a library of 12 standalone, executable feature plans.
No app/source/schema was changed by this work.

---

## ⚠ FIRST — before you decide anything, review YOUR current work + the live code

Do **not** act on this handoff blindly. Start by orienting in your own checkout:

1. **Review your in-flight phase-10a work** (`git status`, your uncommitted changes) so you
   know what you must not disturb.
2. **Review the current code** these plans propose to extend — several plans assume existing
   scaffolding (readiness rules service, evidence location/custodian resolvers, Asset Copilot,
   Code Blue linked-equipment, the `--status-stale` token). Confirm those still exist and still
   look the way the briefs describe **before** committing to any plan.
3. **Then decide** whether/what to pull in. These are plans, not changes — nothing here needs
   to land now, and none of it should interrupt phase-10a.

This library rides its own branch. It reaches you cleanly via `main` on your next pull once its
own PR merges — you do not have to do anything. The steps below are only if you want the files
in your checkout sooner.

---

## How to fetch the files yourself — WITHOUT disrupting phase-10a

The whole `10x/` directory is **new files** on my branch — they do not exist on
`claude/phase-10a-audit-fixes`, so a path-scoped checkout is conflict-free and never touches
your tracked source or your untracked work:

```bash
# run inside /Users/dan/Developer/active/vettrack-ship (stays on your branch):
git checkout claude/game-changing-features-sync-987ca9 -- .claude/docs/ai/vettrack/10x/

# undo — leaves zero trace (these files never existed on your branch):
git restore --staged .claude/docs/ai/vettrack/10x/ && rm -rf .claude/docs/ai/vettrack/10x/
```

**Do NOT `git merge` my branch into phase-10a.** My commit also appends to
`docs/audit/PROOF_ALIGNMENT_LOG.md`, which your branch also modified — a full merge would
likely conflict there. The path-scoped checkout above excludes the proof log entirely, so it
cannot conflict. (The 14 `10x/` files are purely additive; the proof-log line is the *only*
overlap, and this method skips it.)

To execute any single plan later: prompt
`execute .claude/docs/ai/vettrack/10x/plans/<file>`.

---

## What's in the library (inlined below, so this file stands alone)

- The INDEX (status + recommended execute-order + shared conventions).
- 12 executable briefs: 3 Massive, 4 Medium, 5 Small Gems.
- Each brief cites **real, verified** code anchors to reuse. Anchor existence was spot-checked
  at authoring time (2026-07-11); re-verify per step 2 above before you build.

> The full strategy analysis these plans derive from is at
> `.claude/docs/ai/vettrack/10x/session-1.md` on the source branch (not inlined here).


---

<!-- ===== INDEX.md ===== -->

# VetTrack 10x — Plan Library

Standalone, executable feature plans derived from the 10x strategy analysis
([`../session-1.md`](../session-1.md)). Each file is a **~1-page executable brief**: enough
for a fresh session to implement without re-deriving strategy or re-exploring the codebase.

**To execute one:** prompt `execute .claude/docs/ai/vettrack/10x/plans/<file>`.

Every plan inherits the [Shared conventions](#shared-conventions-all-plans-inherit) below —
each brief only calls out what is *specific or frozen* for that feature.

## Plans

| ID | Title | Tier | Effort | Status | One-line |
|----|-------|------|--------|--------|----------|
| [small-01](small-01-locate.md) | "Where is it?" locate | Small | Low | 📋 planned | Search → device location + custodian + readiness, instantly |
| [small-02](small-02-readiness-badge.md) | Grab & go readiness badge | Small | Low | 📋 planned | One 🟢/🟡/🔴 indicator per device, everywhere |
| [medium-02](medium-02-shift-handover.md) | Shift handover artifact | Medium | Medium | 📋 planned | Auto "what changed / what's open," acked to next shift |
| [small-03](small-03-expiry-lowstock-nudge.md) | Expiry / low-stock nudge | Small | Low | 📋 planned | Route existing worker signals to the right person, early |
| [small-04](small-04-damaged-at-checkin.md) | One-tap "returned damaged" | Small | Low | 📋 planned | Capture damage at check-in → seeds the loss story |
| [massive-02](massive-02-predictive-readiness.md) | Predictive readiness engine | Massive | High | 📋 planned | "Will you be ready" — demand vs. ready supply vs. burn |
| [medium-01](medium-01-code-blue-one-tap.md) | Code Blue "one tap" | Medium | Medium | 📋 planned | One tap: cart + page + timed log + board |
| [medium-03](medium-03-ambient-board-alerts.md) | Ambient board alerts | Medium | Medium | 📋 planned | `/board` surfaces anomalies before you ask |
| [small-05](small-05-start-of-shift-card.md) | Start-of-shift card | Small | Low–Med | 📋 planned | Per-role "first thing you see" summary |
| [massive-01](massive-01-passive-tracking.md) | Passive location (BLE/RFID) | Massive | Very High | 🚧 gated | Kill the scan — ambient custody truth |
| [massive-03](massive-03-clinic-network.md) | Clinic network + benchmarks | Massive | High | 🚧 gated | Cross-site sharing + peer benchmarking |
| [medium-04](medium-04-asset-copilot.md) | Asset Copilot + voice | Medium | Med–High | 🚧 gated | NL ops Q&A; hands-free in chaos |

**Status key:** 📋 planned = ready to execute now · 🚧 gated = needs an owner decision first
(see each brief's "Standing blocker").

## Recommended execute-order

`small-01` → `small-02` → `medium-02` → `small-03` + `small-04` → `massive-02` →
`medium-01` → `medium-03`. Then, once their blockers clear: `massive-01`, `massive-03`,
`medium-04`. `small-05` is cheap and fits anywhere.

Rationale: mine data you already have first (low risk, fast value); spend
hardware / network / frozen-surface capital only after the software value is proven —
matching the owner's additive-module doctrine (`docs/design/program-plan.md` I.3).

## Shared conventions (all plans inherit)

- **Feature checklist** (`CLAUDE.md` §"Adding a new feature"): schema in `server/schema/*`
  → `npx drizzle-kit generate` → commit SQL → route in `server/routes/` registered in
  `server/app/routes.ts` → `src/lib/api.ts` fn + `src/types/` type → page/lazy route in
  `src/app/routes.tsx` → he+en keys in `locales/*.json` (parity) → audit kind added to the
  closed `AuditActionType` union in `server/lib/audit.ts` → bounded-enum telemetry on both
  client and `server/routes/realtime.ts` → `npx tsc --noEmit` clean.
- **Multi-tenancy:** every query filters `clinicId`. No exceptions.
- **Frozen surfaces (never weaken):** SSE transport + monotonic outbox cursor; no offline
  emergency queueing; no emergency endpoint in any cache; bounded-enum telemetry only;
  Strategy A authority safety net; `appointmentsPage.*` / `vt_appointments` /
  `/api/appointments` names. See `CLAUDE.md` §"Frozen architecture surfaces" +
  §"Operational doctrine".
- **i18n:** no hardcoded copy in `.ts/.tsx`; Hebrew-default, RTL-first.
- **Testing:** every code task ships or updates a test (`.cursor/rules/03-testing.mdc`).
- **Proof:** log verification evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md` before
  claiming done.


---

<!-- ===== massive-01-passive-tracking.md ===== -->

# massive-01 · Passive location & custody (BLE/RFID ambient truth)

> Tier: Massive · Effort: Very High · Status: 🚧 gated · Inherits [INDEX.md](INDEX.md) conventions.
> **Standing blocker:** owner hardware appetite (capital + per-clinic install). Do not start
> code until owner says go. Strategy source: [`../session-1.md`](../session-1.md) Massive #1.

## Goal
Equipment self-reports location and custody via BLE beacons / RFID gates at doors and docks,
so "where is X / who has X" is correct **without a human scan**. Scan becomes a fallback
source, not the mechanism.

## Why 10x
The product's entire value chain — custody, readiness, analytics, damage/loss, the board — is
only as good as scan discipline, which erodes exactly under pressure (nobody scans mid-Code-Blue).
Ambient truth converts VetTrack from a "discipline-tax tool you must remember to use" into a
source of truth that is just correct. Every downstream feature improves for free. This is the
durable data moat.

## Reuse (real anchors — verify they still exist)
- `server/services/rfid-readers.service.ts` — RFID reader service scaffolding already present.
- `server/services/equipment-location-inference.ts` — existing location inference.
- `server/domain/equipment/evidence/resolver/location.ts` + `custodian.ts` — the evidence
  engine that already derives location/custodian; passive signals become a new weighted input.
- `vt_rooms.gatewayCode` (already modeled for gateways), `vt_docks`, `vt_scan_logs`.

## Approach
1. Additive `vt_location_signals` table (`clinicId`, `equipmentId`, `readerId`, `rssi`,
   `observedAt`, `source` enum `ble|rfid|scan`). Never mutate existing custody tables' semantics.
2. An ingest route for reader payloads (rate-limited; clinic-scoped auth).
3. Extend the evidence resolver to weight passive signals against last scan — **scan stays a
   first-class source**; the resolver blends, it does not replace.
4. Stage as a **single-clinic pilot** behind the existing readiness wedge
   (`docs/equipment-readiness-wedge-master-execution-plan.md`).

## New schema / surfaces
- `vt_location_signals` (+ migration). Optional `lastSeenSource` on equipment reads.
- No new user-facing surface required for v1 — it upgrades existing locate/badge/board reads.

## Frozen constraints
- Additive only; the manual scan path must be byte-for-byte unaffected for non-instrumented
  clinics (golden test is the acceptance bar).
- Partial coverage must degrade gracefully to last-known (no "unknown" regressions).
- `clinicId` on every signal read/write.

## Verification
- Simulate reader payloads → resolver returns the correct room + custodian.
- Scan-only clinic snapshot unchanged before/after (golden test).
- Ingest endpoint rejects cross-clinic reader IDs.

## Effort / Risk
Very High (hardware + firmware + resolver work). Risk: capital + install per clinic; partial
coverage gaps. Mitigate with the single-clinic pilot and graceful last-known fallback.

## Open questions
- Hardware vendor / protocol (BLE beacon vs. RFID gate vs. hybrid)?
- Pilot clinic selection and success metric (e.g. % locate queries answered without a manual scan)?


---

<!-- ===== massive-02-predictive-readiness.md ===== -->

# massive-02 · Predictive readiness engine ("will you be ready")

> Tier: Massive · Effort: High · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Massive #2.

## Goal
A forward-looking engine that turns scheduled demand + inventory + roster + expiry + usage
history into conservative, explainable warnings:
*"Tomorrow's 3 surgeries need 2 anesthesia machines; you have 1 functioning + 1 overdue for
service. Crash-cart epinephrine expires Thursday. You'll be short 4 IV sets by 14:00 at current
burn."*

## Why 10x
Every current surface answers "what is true now." Nobody answers "will I be ready." That is the
question that actually loses money and endangers patients (problems #5/#6 in `program-plan.md`
I.3). It reframes VetTrack from a ledger into an advisor — and creates the owner-facing "money
saved" narrative.

## Reuse (real anchors)
- `server/services/operational-metrics.service.ts` — existing metrics aggregation.
- `server/services/restock.service.ts` + `server/routes/restock.ts` + PO flow — supply + reorder.
- `server/workers/expiryCheckWorker.ts` + `stagingExpiryWorker.ts` — expiry signals.
- `server/routes/analytics.ts` — extend the existing Analytics console (Phase 7), don't add a
  new surface family.
- `vt_appointments` (unified task/schedule model) — scheduled procedures → demand.

## Approach
1. New `server/services/readiness-forecast.service.ts` with an internal sub-phase split:
   **demand model** (schedule → required equipment/consumables) →
   **supply model** (available + *ready* units, current stock) →
   **shortfall join** (demand − supply, plus burn-rate projection) →
   **surface**.
2. Render as an Analytics console panel + pre-filled PO recommendations that flow into the
   existing `restock`/PO path.
3. **Explainable:** every warning shows the source rows behind it (which appointment, which
   stock level, which burn rate). Conservative thresholds — under-warn rather than cry wolf.

## New schema / surfaces
- No new tables required for v1 (read-mostly over existing data). Optional: a small
  `equipment.requires[]` / procedure-template mapping to model demand cleanly — decide during
  the demand-model sub-phase.
- One new Analytics console panel; optional home-surface summary tile.

## Frozen constraints
- Read-mostly; no new transport. Bounded-enum telemetry if counters are added.
- `clinicId` on every read.

## Verification
- Seeded schedule + stock → engine emits exactly the expected shortfalls.
- Explainability panel lists the source rows for each warning.
- A "no shortfall" clinic shows a calm, empty state (no false alarms).

## Effort / Risk
High (mostly software; data mostly exists). Risk: **trust** — noisy or aggressive predictions
get ignored, same failure mode as a noisy alert. Bias toward precision over recall in v1.

## Open questions
- How is per-procedure equipment/consumable demand modeled — explicit templates, or inferred
  from historical usage per appointment type?
- Burn-rate window (trailing 7/14/30 days)?


---

<!-- ===== massive-03-clinic-network.md ===== -->

# massive-03 · Clinic network (equipment sharing + peer benchmarking)

> Tier: Massive · Effort: High · Status: 🚧 gated · Inherits [INDEX.md](INDEX.md) conventions.
> **Standing blocker:** buyer is single-clinic vs. multi-site (owner decision from
> [`../session-1.md`](../session-1.md)). Also requires a dedicated security design pass before
> any code. Strategy source: session-1 Massive #3.

## Goal
When a clinic is short a device, show that a partner site nearby has an idle one → request a
transfer that re-homes custody with the chain intact. Plus anonymized utilization benchmarks
("your ultrasound utilization is 34% vs. 61% peer median — you own one too many").

## Why 10x
Turns a single-clinic utility into a **network** — the first defensibility that isn't just
features (network effects + a data-product tier). Directly serves the multi-site owner (the
buyer with budget) and monetizes idle capital equipment.

## Reuse (real anchors)
- Multi-tenant `clinicId` model + `vt_clinics`.
- `server/services/equipment-custody-toggle.service.ts` — the custody state machine a transfer
  must reuse (a transfer is a custody re-home, not a new concept).
- `server/integrations/` — patterns for cross-boundary flows.

## Approach
1. A **clinic-group** concept: `vt_clinic_groups` + membership. This is the ONLY sanctioned
   cross-`clinicId` read path — every network query goes through an explicit group check.
2. A transfer request → accept flow that re-homes custody and preserves the audit chain.
3. Privacy-safe aggregate benchmarks: k-anonymity threshold (suppress below N peers), no raw
   peer rows ever returned.

## New schema / surfaces
- `vt_clinic_groups`, `vt_clinic_group_members`, `vt_equipment_transfers`.
- A network panel in the web console (transfers + benchmarks); mobile request/accept.
- New `AuditActionType`s for transfer request/accept/reject.

## Frozen constraints (⚠ security-critical)
- Cross-tenant is the highest-risk surface in the product — the `clinicId`-per-query rule
  becomes load-bearing. **No network read may bypass the group-membership check.**
- Benchmarks must be genuinely anonymized (k-anonymity enforced server-side).
- Requires a security design pass + `security-reviewer` before merge.

## Verification
- **Negative test is the acceptance bar:** a clinic not in a group can never read another
  clinic's rows via any network endpoint.
- Transfer re-homes custody and leaves a complete audit trail on both sides.
- Benchmark suppresses cohorts below the k threshold.

## Effort / Risk
High. Risk: data-isolation boundary correctness; anonymization correctness. Gate behind proven
single-clinic value.

## Open questions
- Group formation: owner-defined static groups, or opt-in marketplace?
- Transfer logistics — does VetTrack track physical hand-off, or just custody re-home?


---

<!-- ===== medium-01-code-blue-one-tap.md ===== -->

# medium-01 · Code Blue "one tap, everything ready"

> Tier: Medium · Effort: Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Medium #4.
> ⚠ Touches the most-frozen surface in the product. Read `CLAUDE.md` §"Code Blue runtime
> guarantees" and §"Operational doctrine" BEFORE writing code.

## Goal
One tap that simultaneously: locates + soft-reserves the nearest **ready** crash cart, pages
the on-shift team, opens the timed log with drug-dose reference inline, and pushes the event to
every `/board`.

## Why 10x
Emergency is the one moment VetTrack is literally life-or-death indispensable — the product's
emotional peak and its strongest word-of-mouth/retention driver. Today the deep infra is
treated as a frozen back-end surface, not the headline. This is **packaging and surfacing**,
not rebuilding.

## Reuse (real anchors — the infra already exists)
- `server/routes/code-blue.ts` — session/log/presence/end endpoints.
- `server/lib/code-blue-linked-equipment.ts` — cart ↔ session linking already exists.
- `server/lib/code-blue-keepalive.ts`, `code-blue-reconciliation-scanner.ts` — runtime.
- `server/services/equipment-readiness-rules.service.ts` — pick the nearest *ready* cart.
- `notification.worker` — push fan-out to on-shift team.
- `src/lib/offline-emergency-block.ts` — `classifyEmergencyEndpoint()` (must keep blocking).

## Approach
1. One client action wired to a single orchestration endpoint that composes: nearest-ready-cart
   resolve → soft-reserve → session create → team page → board publish.
2. "Soft-reserve" is an **additive custody hint**, not a hard lock (never blocks a clinician
   grabbing a different cart).
3. Inline drug-dose reference in the timed log view (reference data, not a new domain).

## New schema / surfaces
- No new tables required (linking + sessions exist). Possibly a nullable `reservedForSessionId`
  hint on cart state — additive.
- One consolidated "Start Code Blue" action on mobile + board acknowledgement.

## Frozen constraints (strict — non-negotiable)
- **No new transport** (SSE only). **No offline queueing** — emergency mutations fail loud via
  the existing classifier. **Server-confirmed end** — never optimistically mark a session ended.
  **No emergency endpoint in any cache.** **Bounded-enum telemetry** only.

## Verification
- Playwright Phase-9-style drill: one tap → cart reserved + team paged + log open + board
  propagation, all observed live.
- Offline attempt blocks loudly and increments `offline_emergency_mutation_blocked_*`.
- Session end still follows the server event (no optimistic local termination).

## Effort / Risk
Medium (compose existing pieces). Risk: it touches the most-frozen surface — the *work* is
constraint-checking every step against the doctrine, not new logic.

## Open questions
- "Nearest" by room adjacency or by last-known location only?
- Drug-dose reference source — static table shipped in-app, or clinic-configurable?


---

<!-- ===== medium-02-shift-handover.md ===== -->

# medium-02 · Shift handover as a generated artifact

> Tier: Medium · Effort: Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Medium #5 · roadmap #5
> (`docs/design/product-growth-roadmap.md` sketches `vt_shift_handover`).

## Goal
At shift end, auto-generate "what changed this shift / what's still open" from the deltas
VetTrack already captures — a structured, acknowledged handover pushed to the incoming shift.

## Why 10x
Handover is high-frequency (every shift change, 2–3×/day) and today lossy/free-form. The data
already exists — this turns exhaust into a valued artifact, and creates a daily habit surface
(the incoming shift opens VetTrack first to read handover). Best effort-to-value ratio of the
Medium tier.

## Reuse (real anchors)
- `vt_shifts` / `vt_shift_sessions`; `server/routes/shifts.ts`, `shift-adjustments.ts`,
  `shift-chat.ts`; `src/features/shift-adjustments/*`, `src/features/shift-chat/*`.
- `vt_audit_logs` + `vt_event_outbox` — the delta sources (custody moves, task state, alerts,
  dispenses).
- `notification.worker` — push to incoming shift.
- Per-role home surfaces (`src/features/today/surfaces/*`) — where to surface it.

## Approach
1. New `vt_shift_handover` (`clinicId`, `shiftSessionId`, `openItems[]`, `deltas`,
   `acknowledgedBy`, timestamps).
2. A generator that runs at shift end and aggregates the shift's custody/task/alert/dispense
   deltas into a compact artifact + open-items list.
3. **New `/handoff` surface** (none exists today) rendering the artifact; an acknowledge action;
   push to the incoming shift.

## New schema / surfaces
- `vt_shift_handover` (+ migration).
- `/handoff` page (lazy route in `src/app/routes.tsx`) + a home-surface entry point.
- New `AuditActionType` for handover generate + acknowledge.

## Frozen constraints
- Standard feature checklist. `clinicId` scoped. Deltas read from existing audit/outbox — do
  not add a new realtime path.

## Verification
- Seeded shift with a known set of mutations → handover lists exactly those deltas + open items.
- Acknowledge records `acknowledgedBy`; incoming shift receives the push.
- RTL spot-check of the `/handoff` surface (default + empty + loading + error states).

## Effort / Risk
Medium. Risk: low — self-contained; the only real design choice is which deltas count as
"handover-worthy."

## Open questions
- Which delta types are in-scope for v1 (all four, or start with custody + open tasks)?
- Auto-generate at shift end only, or also an on-demand "handover now" button?


---

<!-- ===== medium-03-ambient-board-alerts.md ===== -->

# medium-03 · Ambient anomaly alerting on `/board`

> Tier: Medium · Effort: Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Medium #6.

## Goal
`/board` proactively surfaces anomalies instead of passively displaying status:
*"Dock 3 empty 4h, no checkout logged," "glucometer battery critical," "waitlist backing up
20 min," "crash cart CART-2 last verified 9 days ago."*

## Why 10x
Turns a screen everyone already glances at from a mirror into an early-warning radar — value
delivered by glance, zero extra user action. Catches the silent failures that cost money
(problem #6) before they bite.

## Reuse (real anchors)
- `server/services/equipment-command-board.service.ts` — board snapshot composition.
- `server/routes/display.ts` — the `/api/display/snapshot` endpoint (⚠ cache-denylisted).
- `src/board/BoardShell.tsx` + board components; Phase-5 calm/pressure modes.
- `server/services/equipment-readiness-rules.service.ts` — readiness thresholds for anomalies.

## Approach
1. An anomaly-rules pass over the existing snapshot — a **bounded, closed set** of rule types
   (empty-dock-too-long, battery-critical, cart-unverified, waitlist-backing-up, …).
2. Render as a board section that respects calm/pressure modes (anomalies escalate in pressure).
3. No new polling — anomalies derive from the snapshot already fetched.

## New schema / surfaces
- No new tables. Anomaly derivation lives in the board service.
- A board "attention" section + optional per-role console mirror.

## Frozen constraints
- **Emergency-endpoint cache denylist:** `/api/display/snapshot` is never cached — do not add
  any caching to satisfy this feature.
- **Bounded-enum telemetry:** anomaly types must be a closed enum on both client and
  `server/routes/realtime.ts`. No free-form labels.
- No new transport.

## Verification
- Seeded anomalous state → board shows exactly the right anomaly cards; a healthy clinic shows
  none.
- Snapshot stays uncached (assert the denylist path).
- Calm vs. pressure rendering spot-check.

## Effort / Risk
Medium. Risk: rule tuning — false positives erode the glance value. Start with a few
high-precision rules, expand once trusted.

## Open questions
- Which anomaly rules ship in v1, and their thresholds (owner-configurable or fixed)?
- Do anomalies also fan out to a role's mobile home, or board-only for v1?


---

<!-- ===== medium-04-asset-copilot.md ===== -->

# medium-04 · Asset Copilot for ops questions + hands-free chaos mode

> Tier: Medium · Effort: Medium–High · Status: 🚧 gated · Inherits [INDEX.md](INDEX.md) conventions.
> **Standing blocker (voice only):** voice mode needs the native shell — gated on the Expo /
> native-app sequencing. The text copilot is not blocked. Strategy source:
> [`../session-1.md`](../session-1.md) Medium #7.

## Goal
Natural-language Q&A over custody + inventory + shifts + schedule — *"What do I need to prep
for the 2pm dental?" "Which devices are overdue for calibration?" "Where's the portable
X-ray?"* — plus a hands-free voice mode during a Code Blue.

## Why 10x
Collapses "hunt through screens" into one question, and in chaos gives spoken guidance when
hands are full. In the AI era this is a differentiator competitors can't match without the
underlying data model. **Much is already built** — this is extend + surface.

## Reuse (real anchors — substantial existing scaffolding)
- `server/services/asset-copilot-orchestrator.service.ts` + `asset-copilot-resolve.service.ts`.
- `server/routes/equipment-copilot.ts` — existing copilot endpoint.
- `server/domain/equipment/copilot/{answer.types,ai-safety-validator,citation-validator}.ts`
  — keep the existing citation + AI-safety validators.
- `server/domain/equipment/evidence/resolver/*` — the evidence engine to widen.
- `docs/PH-01-operational-assistance-during-chaos.md` — chaos-mode design notes.

## Approach
1. Widen the resolver's evidence sources from equipment-only to inventory + shifts + schedule.
2. Keep the mandatory citation + AI-safety validators unchanged (every answer must cite).
3. Voice = a native-shell add-on layered later (speech-to-text in, TTS out) — the text path
   ships first and is fully useful on its own.

## New schema / surfaces
- No new tables (retrieval over existing data). A copilot entry point on mobile + console.
- Voice mode: native-shell integration (deferred).

## Frozen constraints
- **Citations mandatory** (existing validator) — no uncited answers.
- `clinicId` scoping on every evidence source.
- AI-safety validator must gate every response (no bypass for new sources).

## Verification
- A golden Q/A set returns cited answers across the new source types.
- Out-of-scope / unanswerable questions refuse safely (validator path).
- Cross-clinic questions never leak another clinic's rows.

## Effort / Risk
Medium–High (text); voice adds native work. Risk: answer quality is bounded by data quality —
**sequence after the data-quality wins** (small-01/02, massive-01) so it answers from trustworthy
inputs.

## Open questions
- LLM provider/model + prompt-caching strategy (see the `claude-api` skill before wiring).
- Voice scope — only during Code Blue, or a general hands-free mode?


---

<!-- ===== small-01-locate.md ===== -->

# small-01 · Universal "Where is it?" locate

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #1. **Recommended first execute.**

## Goal
A prominent, always-reachable search that answers *"where is the [device]"* instantly —
last-known location + who has it + ready/not.

## Why 10x
The #1 daily micro-frustration in a clinic (minutes lost, many times a day). Even on manual-scan
data it beats walking the halls; on passive data (massive-01) it becomes magic. Near-zero new
data — fastest real-user win in the whole library.

## Reuse (real anchors — the engine already exists)
- `server/domain/equipment/evidence/resolver/location.ts` + `custodian.ts` — already derive a
  device's location + custodian.
- `server/services/equipment-location-inference.ts`.
- `src/lib/api.ts` (add one typed fn) + `src/types/`.
- Existing equipment UI to link into: `src/pages/equipment-detail.tsx`, `src/features/equipment/*`.

## Approach
1. A read-only `GET /api/equipment/locate?q=` endpoint that composes the existing resolvers and
   returns `{ location, custodian, readiness }` per match. No new derivation logic.
2. A prominent search entry: mobile home (pairs with small-05) + web console top bar.
3. Result row links straight to equipment detail.

## New schema / surfaces
- None (read-only over existing data). One search component reused on mobile + console.

## Frozen constraints
- Standard checklist; `clinicId` scoped. Rate-limit under the scan/action limiter family.

## Verification
- Query returns the correct room + custodian + readiness for seeded devices.
- Empty/no-match and loading states render (RTL spot-check).
- Cross-clinic device is never returned.

## Effort / Risk
Low. Risk: minimal (read-only). If reused with small-02, surface the readiness badge inline.

## Open questions
- Search scope — name + asset tag only, or also type/room?
- Placement on the web console: command-bar (Cmd+K) or a persistent search field?


---

<!-- ===== small-02-readiness-badge.md ===== -->

# small-02 · "Grab & go" readiness badge

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #2.

## Goal
One indicator per device — 🟢 ready (charged, clean, in service) / 🟡 caution / 🔴 not ready —
shown wherever a device appears (list, detail, home, board, locate results).

## Why 10x
Kills the recurring anxiety of grabbing a device and finding it dead or unusable. One glance
eliminates a whole category of failure.

## Reuse (real anchors — derivation already exists)
- `server/services/equipment-readiness-rules.service.ts` — readiness is already derived
  (config key `equipment.readinessRules.v1`, per-clinic cached).
- `server/services/equipment-operational-state.service.ts` — operational state inputs.
- **`--status-stale` tokens already in `src/index.css`** (sys-purple, light + dark, with
  `-bg/-fg/-border`) + existing status-pill components in the design system.

## Approach
1. Expose the already-derived readiness tier on equipment read responses (additive field).
2. A `<ReadinessBadge tier=...>` component composed from existing status-pill primitives + the
   existing tokens — no new palette.
3. Drop it into equipment list/detail, home surfaces, board, and locate results.

## New schema / surfaces
- None (readiness already computed). One reusable badge component.

## Frozen constraints
- Compose existing tokens; **do not introduce a new palette** (design-system rule).
- `clinicId` scoped reads. i18n the tier labels (he + en).

## Verification
- Devices with dead battery / overdue service / near expiry render the correct tier.
- RTL + dark-mode spot-check of the badge.
- Badge derivation matches the readiness-rules service (single source of truth — no duplicate
  logic in the client).

## Effort / Risk
Low. Risk: minimal. The one thing to avoid: re-deriving readiness client-side — always read the
server's derived tier.

## Open questions
- Three tiers, or a fourth "unknown/stale" state using `--status-stale` directly?
- Does the badge show the *reason* on tap (battery vs. service vs. expiry)?


---

<!-- ===== small-03-expiry-lowstock-nudge.md ===== -->

# small-03 · Proactive expiry / low-stock nudge to the right person

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #3.

## Goal
Surface an expiring drug / low crash-cart item / under-stocked SKU to the person who can act,
*before* it's a problem — not buried in a report.

## Why 10x
Converts existing background jobs into visible, trust-building saves. A crash cart with in-date
epinephrine is a safety win with a change in *where the signal goes* — no new detection logic.

## Reuse (real anchors — detection already runs)
- `server/workers/expiryCheckWorker.ts` + `stagingExpiryWorker.ts` — expiry detection (daily cron).
- `server/services/restock.service.ts` + `server/routes/restock.ts` — low-stock signals.
- `notification.worker` — push fan-out.
- Per-role home surfaces (`src/features/today/surfaces/*`) — the nudge target.

## Approach
1. Route the existing worker output to a **home-surface nudge** for the relevant role + an
   optional push. The detection already exists; this is delivery + routing.
2. Nudge is dismissible and links to the action (restock / replace / create PO).

## New schema / surfaces
- None required (optionally a lightweight `dismissedAt` per nudge if dedupe is needed).
- A nudge component on the role home surfaces.

## Frozen constraints
- Bounded-enum telemetry if counters are added. `clinicId` scoped. i18n the nudge copy.
- Don't add a new realtime path — reuse push + the existing home data fetch.

## Verification
- Seeded near-expiry / low-stock → nudge appears for the correct role, not others.
- Dismiss persists; no duplicate spam on refetch.
- Push fires once per event (no fan-out storms).

## Effort / Risk
Low. Risk: notification volume tuning — batch/threshold to avoid nudge fatigue.

## Open questions
- Which role owns which nudge (lead for stock, floor for cart items)?
- Lead time thresholds (e.g. expiry within 7 days, stock below reorder point)?


---

<!-- ===== small-04-damaged-at-checkin.md ===== -->

# small-04 · One-tap "returned damaged" at check-in

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #4.

## Goal
On check-in, a single "damaged / needs service" tap that flags the device and starts a damage
trail.

## Why 10x
Tiny UI, but it's the **seed data** for the entire damage/loss money story (problem #6 /
roadmap #6) and feeds the predictive engine (massive-02). Without a frictionless capture point,
the analytics have nothing to analyze.

## Reuse (real anchors)
- Custody return flow: `server/services/equipment-custody-toggle.service.ts`,
  `server/routes/equipment.ts` (return/check-in path).
- `server/services/equipment-operational-state.service.ts` — flip the device to a
  needs-service/out-of-service state.
- Return UI in `src/features/equipment/*` — add the one tap there.

## Approach
1. Add a "returned damaged" affordance on the existing check-in/return control.
2. Write a damage event + set the device condition; optionally open a service task.

## New schema / surfaces (required — nothing exists today)
- `vt_damage_events` (`clinicId`, `equipmentId`, `reportedBy`, `at`, `note`, `resolvedAt`).
- Optional `conditionStatus` column on equipment (`ok | damaged | out_of_service`).
- New `AuditActionType` for damage-report.

## Frozen constraints
- Standard feature checklist (schema → migration → route → api → i18n → audit → tsc).
- `clinicId` scoped. A damaged device must reflect in readiness (small-02) as not-ready.

## Verification
- Check-in with "damaged" writes a `vt_damage_events` row + flips condition.
- The device then reads as not-ready (readiness rules pick up condition).
- Analytics/predictive can query damage events by clinic + period.

## Effort / Risk
Low. Risk: low. Keep the capture to one tap + optional note — don't build a full RMA workflow.

## Open questions
- Does "damaged" auto-create a service task, or just flag + note for v1?
- Required note, or optional?


---

<!-- ===== small-05-start-of-shift-card.md ===== -->

# small-05 · Per-role "start of shift" summary card

> Tier: Small · Effort: Low–Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #5. Fits anywhere; cheap.

## Goal
The first thing each role sees at shift start — floor: "your assigned gear, open tasks, any
active Code Blue"; lead: "coverage gaps, low stock, overdue services."

## Why 10x
Creates a daily open-VetTrack-first habit (retention) and orients staff in one glance. Reuses
the per-role home split already shipped — pure composition.

## Reuse (real anchors — surfaces already exist)
- `src/features/today/surfaces/{Floor,Vet,Tech,Student,Ops}HomeSurface.tsx` — per-role homes.
- `src/features/today/surfaces/OnShiftHero.tsx` — roster-derived on-shift state (already built).
- Experience-model archetypes + capability union (per-role gating already exists).
- Pairs with small-01 (locate), small-02 (badge), small-03 (nudges) as card contents.

## Approach
1. Compose existing per-role data into one summary card per home surface — no new data sources,
   just a curated first-glance arrangement keyed off the on-shift hero.
2. Gate card contents by the existing capability union (floor vs. ops composition differs).

## New schema / surfaces
- None. One summary-card component parameterized per archetype.

## Frozen constraints
- Per-role gating via the **existing** capability union — no new nav entries, no new roles.
- i18n all copy (he + en). Respect the roster-derived shift model (no clock-in invented).

## Verification
- Each role's card shows the correct composition (floor ≠ lead ≠ student).
- Off-shift state renders a sensible empty/idle variant.
- RTL spot-check across the role surfaces.

## Effort / Risk
Low–Medium. Risk: low. Main design choice is *what* each role sees first — keep it to 3–4 items
to preserve the one-glance value.

## Open questions
- Exact per-role contents (owner input, or infer from each surface's current top items)?
- Does the card collapse after first interaction, or persist for the shift?
