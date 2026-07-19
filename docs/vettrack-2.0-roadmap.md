# VetTrack 2.0 — Execution Plan

> Synthesized from `.claude/docs/ai/vettrack/10x/session-2.md` (2026-07-16, owner decisions resolved),
> transformed into an execution plan (owner directive 2026-07-19). The source interweaves two planning
> threads — implementation/technical and design/UX; every task below carries both scopes and where they
> depend on or constrain each other. Complements `docs/design/program-plan.md` (experience direction);
> this document sequences and operationalizes the 2.0 capability build underneath it. Platform
> assumptions validated 2026-07-19 against Capacitor / React-Native / Expo / Apple-Liquid-Glass / Android
> primary docs — see "Platform research addendum".
>
> **The 2.0 thesis:** VetTrack becomes **an operational layer from the hospital's resources all the way to
> the patient's bedside** — no longer a registry you feed, but an operator you approve. One continuous layer,
> built by two compounding moves: the **Case Spine** (structural — carries the layer from resources to the
> patient) and the **Shift Autopilot** (behavioral — makes the layer act, with human approval).

---

## How to execute this plan (read first, every session)

1. Pick the next unblocked task from the Goal & scope tracker (respect Dependencies).
2. Route the model per Delivery methodology #6 (Sonnet 5 default; Opus 4.8 for the listed escalation set;
   Fable 5 only when stuck on both).
3. Start the task by writing its failing verification (RED) — test file, script, or checklist run — then
   implement to GREEN. For tasks marked "breakdown-first", the FIRST deliverable is a detailed
   writing-plans-style task file under `docs/plans/2.0/` derived from the Phase-0 artifacts, then execute it.
4. Ship through the size-gated delivery pipeline (`/ship-phase` tiers) — a task here is typically
   feature- or phase-tier.
5. Before flipping a tracker box: independent fresh-context review (diff + this task's Verify block only),
   visual evidence for UI scope, PROOF_ALIGNMENT_LOG entry.
6. The Stop hook (`scripts/vettrack-2.0-scope-gate.sh`) prints `X/18 shipped` every session — the goal is
   18/18.

## Working agreement — Claude Code ↔ Claude Design sync (before any build)

Real sync between the implementation thread (Claude Code) and the design thread (Claude Design) is a
precondition, not a nicety:

1. **Shared artifacts, not summaries.** Both threads work from THIS plan + the 0.1 allowlist spec + the
   0.3 `action_proposal` schema. Design components sync through the established claude.ai/design project
   ("VetTrack Design System"; config in `.design-sync/NOTES.md`).
2. **Named checkpoints where the threads must meet:** 0.1 spec review (design signs the allowlist before
   schema); 0.3 joint spike (card anatomy ↔ schema freeze together); 2.5 alert-fatigue budget (thresholds
   + notification restraint tuned together).
3. **Every design handoff lands as repo artifacts** (tokens/specs/screens); every technical schema change
   touching a designed surface is flagged back to the design thread before merge.
4. **Neither thread ships a 🔥 task solo.** Tasks 1.1, 1.2, 2.2 require both scopes done — a technical
   merge without its design scope (or vice versa) is incomplete, not shipped.

## Goal & scope tracker

**THE GOAL: VetTrack 2.0 ships 100% of this plan's scope.** Re-check this tracker after every working
turn; a box flips to `[x]` only with evidence per the Delivery methodology — never on a summary. The
Stop hook prints the shipped count at every session end.

- [x] 0.1 Case operational allowlist / PHI denylist spec
- [x] 0.2 `vt_cases` spike — one event path, offline-proven
- [x] 0.3 Autopilot shadow spike — `action_proposal` + one proposal type
- [x] 0.4 Per-org policy layer design
- [x] 0.5 Operations-memory backtest (synthetic harness — owner-approved deviation, real data unreachable)
- [ ] 0.6 Pricing-model decision
- [ ] 0.7 Native shell & plugin hygiene (haptics repair, cap-sync law, edge-to-edge)
- [ ] 1.1 Shift Autopilot — shadow mode
- [ ] 1.2 The Case Spine
- [ ] 1.3 Ship the Android app (Google Play)
- [ ] 2.1 One-tap "attach to case" pin
- [ ] 2.2 The Live Floor + The Baton
- [ ] 2.3 "Who's on the floor" glance card
- [ ] 2.4 Economic Loss & ROI Ledger
- [ ] 2.5 Autopilot `enforce` + Ambient Safety Net
- [ ] 3.1 Immutable Hospital Ledger
- [ ] 3.2 Controlled-substance compliance module
- [ ] 3.3 Reception War-Room

## Delivery methodology (binding on every task)

1. **Verification criteria first.** Before implementation, each task names exact files, the scenario it
   must satisfy, the test command, and expected output. A failing check is written BEFORE the file it
   verifies exists (RED→GREEN — owner law). Unverifiable ⇒ unshippable.
2. **UI changes verified visually.** Screenshots at 320/768/1024+, Hebrew RTL AND English, light + dark
   where themed, on each surface the task declares (mobile / console / board). Backend + frontend + UX all
   green before done. Native-feel items (haptics, safe-areas) verified on a REAL device, never the simulator.
3. **Root causes, not symptoms.** Every fix states symptom → located cause (file:line) → what "fixed"
   looks like, then lands a failing test at the cause. (Worked example: "haptics not working" → ranked
   causes in Task 0.7, not a blind retry loop.)
4. **Independent review before a task counts.** A fresh-context reviewer (subagent) sees only the diff +
   the task's Verify block — never the implementing session's reasoning. Tracker boxes flip only after
   this review passes.
5. **Session hygiene.** One task per session (`/clear` between); after two failed corrections on one
   issue, stop and re-prompt fresh; investigations scoped or delegated to subagents.
6. **Model routing (owner policy, 2026-07-19 — per task, never per project).** **Sonnet 5 default**
   (default effort) — this plan's per-task instructions are Sonnet's comfort zone. **Escalate to Opus 4.8**
   only for the pre-identified hard/architectural set: 0.2, 0.4, 1.1, 1.2, 2.2, 2.5, 3.1, and any Phase-4
   `departmentId` architecture review (frozen surfaces / flagged conflicts). **Fable 5 = reserve** — only
   when a task is stuck after real attempts on BOTH Sonnet and Opus with full context. Move between models
   per task as difficulty changes: routine-for-a-while on big → drop down; wrong-with-full-context on
   small → step up.

## Binding constraints (owner decisions + frozen surfaces)

**Owner decisions (2026-07-16, binding):**
1. Case object = **operational-only**. PMS = clinical source of truth; VetTrack = operational source of
   truth. Explicit operational-field **allowlist** + clinical/PHI **denylist**. No diagnoses,
   prescriptions, labs, imaging, owner info.
2. Human healthcare = destination, not objective. Vet roadmap never slowed for it. RLS/PHI hardening
   deferred to that horizon.
3. Offline-First is a **trust strategy** — the Case object must work offline and reconcile on reconnect.
4. Autopilot = continuously-learning assistant, human approval by default. `enforce` unlocked
   **per-policy, per-org, explicitly** — never blanket.
5. Go-to-market: **integrate, never replace.** Adopting VetTrack requires zero PMS-workflow change and
   zero data migration.
6. `departmentId` = scoped fast-follow, only where it delivers measurable value; scope defined before build.

**Frozen surfaces (engineering law — tasks touching these carry ⚠️ inline, never silently):**
- SSE/outbox realtime transport (`vt_event_outbox`, monotonic cursor, replay) — all 2.0 consumers are
  **additive** readers.
- Code Blue semantics (online-only mutations, server-confirmed end, no offline queueing, no polling recovery).
- Dexie pinned 3.2.7 — offline Case support = additive stores only, no library bump.
- `vt_appointments` table / `/api/appointments` route / `appointmentsPage.*` i18n namespace — additive
  columns only, no renames.
- `off | shadow | enforce` enforcement envelope — extended (policy layer on top), never weakened.

**Cross-cutting design constraints (every task with UI):**
- All user-facing strings through the `src/lib/i18n.ts` typed accessor; keys in `locales/he.json` +
  `locales/en.json` (parity-enforced). **No hardcoded strings, ever.** Hebrew default; RTL-first.
- 4-platform seam (`src/app/platform/`): every new surface declares mobile / desktop-console / board
  presentation (or explicit absence).
- Design-token-driven so the parallel Liquid Glass track (owner 2026-07-17, post-resubmit) restyles
  without rework. Glass belongs ONLY on the floating controls layer (Apple's own hierarchy rule) —
  **glass OFF on Code Blue and `/board`**.
- **Accessibility parity:** honor `prefers-reduced-motion`, `prefers-contrast`, reduced-transparency
  fallback in CSS (native Liquid Glass gets these free; our WKWebView approximation must hand-roll).
  Never branch on screen-reader detection (no web API); dynamic surfaces announce via `aria-live`.
- **Android hygiene:** targetSdk 35 / Android 15+ enforces edge-to-edge — system-bar insets handled
  before new surfaces ship on Android (Task 0.7).

---

## Phase 0 — Specs & Spikes (gate-clearing; full step detail)

### Task 0.1 — Case operational allowlist / PHI denylist spec · **P0 · S · Sonnet 5**
- **Objective:** The written boundary that makes the Case "operational shadow, not PMS rebuild" concrete.
- **Files:** Create `docs/design/case-spine-allowlist.md`.
- **Execute:** (1) RED: add a checklist at the doc's head — every allowlist field must name its source
  event table; every denylist category must cite owner decision #1 — review fails until complete.
  (2) Enumerate allowlist (equipment usage, room assignment, operational tasks, Code Blue refs, inventory
  activity, workflow state) with source tables (`vt_scan_logs`, `vt_rooms`, `vt_appointments`,
  `vt_code_blue_sessions`, `vt_dispense_events`…). (3) Enumerate denylist (diagnoses, prescriptions,
  labs, imaging, owner info, anything medico-legal). (4) Define PMS-key linkage: `CanonicalPatientV1`
  (`server/integrations/contracts/canonical.v1.ts`) + `patientExternalId`/`ExternalPatient`
  (`server/integrations/types.ts`). (5) Design review (working-agreement checkpoint): what must an
  operationally-useful case card show?
- **Verify:** Checklist all-green; design sign-off recorded in the doc; no denylisted field appears in any
  allowlist row.
- **Done when:** Fresh-context review passes; tracker flips. **Blocks 0.2, 1.2.**

### Task 0.2 — `vt_cases` spike, one event path, offline-proven · **P0 · M · Opus 4.8** ⚠️
- **Objective:** Prove the physical×clinical join + offline reconcile WITHOUT touching frozen surfaces.
- **Files:** Spike branch only — prototype `server/schema/cases.ts`, one binding on the dispense path
  (prefer dispense over Code Blue for the spike), additive Dexie store in `src/lib/offline-db.ts`.
- **Execute:** (1) RED: failing vitest — creating a case + attaching a dispense event yields a queryable
  case timeline row; offline-queued attach reconciles after simulated reconnect. (2) Minimal `vt_cases`
  schema per 0.1 allowlist. (3) Wire ONE event path additively (outbox consumer, no transport change).
  (4) Offline: additive Dexie store (⚠️ Dexie stays 3.2.7), sync-engine replay, conflict noted not solved.
  (5) GREEN, then write findings → `docs/plans/2.0/case-spine-spike-findings.md`.
- **Verify:** Spike tests green; `pnpm typecheck` 0; zero diffs on frozen files (`git diff --stat` review);
  findings doc lists every seam 1.2 must build through.
- **Done when:** Findings reviewed; spike branch NOT merged (learning artifact). **Blocks 1.2.**

### Task 0.3 — Autopilot shadow spike — `action_proposal` + auto-handover · **P0 · M · Sonnet 5**
- **Objective:** Prove the propose→approve loop on the existing fact-stream; capture labeled data.
- **Files:** Prototype `server/schema/ops.ts` addition (`action_proposal`), consumer in
  `server/workers/`, route in `server/routes/`, registration in `server/app/start-schedulers.ts`;
  orchestration via `server/services/asset-copilot-orchestrator.service.ts`; grounding via
  `server/domain/equipment/copilot/ai-safety-validator.ts` + `citation-validator.ts`.
- **Execute:** (1) JOINT KICKOFF (working-agreement checkpoint): draft proposal-card anatomy WITH design —
  schema freezes only after the card's required fields are known. (2) RED: failing vitest — outbox events
  in a shift window produce ONE staged `action_proposal` (auto-composed handover draft) with citations;
  approve/edit/reject writes a labeled record + new `AuditActionType` members (closed union — add, never
  infer). (3) Implement consumer (BullMQ) + approval route. (4) GREEN + findings doc
  `docs/plans/2.0/autopilot-spike-findings.md`.
- **Verify:** Tests green; citations resolve to real outbox rows (citation-validator passes); audit kinds
  compile in the union; typecheck 0.
- **Done when:** Reviewed; labeled-data capture demonstrated. **Blocks 0.4, 0.5, 1.1.**

### Task 0.4 — Per-org policy layer design (gates `enforce`) · **P0 · S · Opus 4.8** ⚠️
- **Objective:** Design (doc, not code) how an explicit org-approved policy sits ABOVE `off|shadow|enforce`
  and unlocks `enforce` per proposal type per org. ⚠️ Envelope extended by layering — semantics unchanged.
- **Files:** Create `docs/design/autopilot-policy-layer.md`.
- **Execute:** (1) RED checklist: doc must answer — storage shape, resolution order vs per-clinic mode
  TTL, who approves, revocation, audit trail, failure default (= `shadow`). (2) Write design + admin/console
  UX concept (trust surface — owner principle #4). (3) Design-thread review.
- **Verify:** Checklist green; explicit statement that `off` still short-circuits and resolver-throw
  degrades to `off` (CI-16/CI-20 pattern preserved).
- **Done when:** Reviewed. **Blocks 2.5(a).**

### Task 0.5 — Operations-memory backtest · **P1 · S · Sonnet 5**
- **Objective:** Measure proposal signal quality before any `enforce`.
- **Files:** Create `scripts/analysis/autopilot-backtest.ts` (read-only over prod-copy outbox) + report
  `docs/plans/2.0/autopilot-backtest.md`.
- **Execute:** (1) RED: script exits non-zero until it emits precision/recall table. (2) Pull one clinic's
  month of outbox history; hand-label would-have-proposed vs staff-did. (3) Report with per-proposal-type
  precision.
- **Verify:** Report exists with n≥1 clinic-month; numbers cited in 2.5's threshold choices.
- **Done when:** Reviewed. **Feeds 2.5.**

### Task 0.6 — Pricing-model decision · **P1 · S · owner (not a build task)**
- **Objective:** Owner decides per-seat vs work-saved. Park until decided; record in
  `docs/business-case/`. Blocks nothing technically; shapes 2.4 narrative.

### Task 0.7 — Native shell & plugin hygiene · **P0 · S · Sonnet 5**
- **Objective:** Plugins connect correctly EVERY time; haptics works on device; Android edge-to-edge ready.
- **Files:** Modify `src/lib/haptics.ts` (dev-only failure log inside the existing catch); decide
  finish-or-delete `src/infrastructure/platform/HapticsAdapter.ts` (zero consumers; latent
  `selectionChanged()`-without-`selectionStart()` bug); possibly `android/app/build.gradle` (targetSdk),
  safe-area CSS.
- **Execute:** (1) RED: on-device checklist (real iPhone + real Android) — `haptics.tap()` from the scan
  surface fires physically; currently expected FAIL/unknown. (2) Root-cause down the ranked list: fresh
  `npx cap sync` + `pnpm cap:build:native` (SPM/Gradle pin exact pnpm-store paths — stale sync = silent
  breakage) → `hapticsEnabled` settings gate (`vettrack-settings` storage) → iOS Settings System Haptics.
  Fix the CAUSE found, at its location. (3) Add dev-only `console.warn` in the swallowed-catch path so
  misregistration is observable. (4) Adapter decision: port call sites or delete file. (5) Android:
  verify targetSdk vs 35; insets/safe-area CSS on tab bar + board full-bleed. (6) Document the plugin law
  in `docs/capacitor-native-app.md`: version-major match → `pnpm add` → `npx cap sync` EVERY change →
  build only via `scripts/build-native-shell.sh` → verify on REAL device (Simulator has no Taptic Engine).
- **Verify:** On-device checklist green both platforms (visual/physical evidence per methodology #2);
  typecheck 0; no orphan adapter left half-wired.
- **Done when:** Reviewed; tracker flips. **Gates 1.3; should precede Phase-1 surfaces.**

---

## Phase 1 — The 2.0 Headline (breakdown-first tasks: first deliverable = detailed task file under `docs/plans/2.0/`, derived from Phase-0 artifacts, then execute it)

### Task 1.1 — Shift Autopilot, `shadow` mode · **P0 · L · Opus 4.8 (breakdown + review) / Sonnet 5 (execution)** 🔥 ⚠️
- **Objective:** Productionize 0.3: agent loop over `vt_event_outbox` staging proposals into a per-clinic
  approval queue — the lead's home screen.
- **Scope (technical):** proposal types = handover, coordinator-reassign-when-off-roster (P3 Equipment
  Coordinator model), restock-PO-on-burn, crash-cart-drift pull-back; `shadow`-first in the proven
  envelope; queue updates over the additive Socket.io channel. ⚠️ SSE/outbox stays authoritative;
  Socket.io advisory only — no parallel realtime authority path.
- **Scope (design):** approval queue home screen — one-tap approve/edit/reject; citation-grounded "why"
  linked to outbox facts; shadow-vs-enforce visual language; noise discipline (never an alert firehose);
  `aria-live` on arriving proposals; mobile-first + console variant + board ambient count; i18n he+en.
- **Execute:** (1) Write `docs/plans/2.0/task-1.1-autopilot-shadow.md` (writing-plans style: exact
  files/tests per proposal type, from 0.3 findings). (2) Execute it task-by-task, TDD, one proposal type
  per PR-sized slice. (3) Visual evidence per methodology #2.
- **Verify:** Per-type vitest suites green; typecheck 0; screenshots (mobile+console, RTL+EN);
  citation-validator green on every proposal; bounded counters only.
- **Done when:** All four proposal types staged in shadow on a real clinic's stream; fresh review passes.
  **Depends 0.3, 0.4. Does NOT block on 1.2.**

### Task 1.2 — The Case Spine · **P0 · L · Opus 4.8** 🔥 ⚠️
- **Objective:** First-class `vt_cases` + `case_id` across existing event paths; offline-capable;
  PMS-keyed. The structural half of the thesis.
- **Scope (technical):** allowlist-shaped schema (0.1); bindings on custody scan, dispense, Code Blue
  session, task, damage, RFID read; adapter-registry patient keying; additive Dexie stores
  (⚠️ 3.2.7 pinned) + reconcile-on-reconnect. ⚠️ `case_id` on `vt_appointments` = additive column on a
  frozen table — flag in PR. ⚠️ `departmentId`/department-scoped feeds are OUT (Phase 4 — would touch the
  frozen outbox cursor).
- **Scope (design):** case timeline (operational story of one patient's episode); per-patient operations
  page — operational fields only, denylist enforced visually (no clinical-looking chrome); offline/sync
  staleness affordances visible; mobile + console; board case-aware later.
- **Execute:** (1) Write `docs/plans/2.0/task-1.2-case-spine.md` from 0.1 spec + 0.2 findings (exact
  schema, migration via `npx drizzle-kit generate`, per-path binding order, Dexie store names).
  (2) Execute TDD; migration committed per repo convention; one event-path binding per slice.
  (3) Visual evidence: timeline + patient page, 3 breakpoints, RTL+EN, offline-state shots.
- **Verify:** Binding tests green per path; offline reconcile test green; typecheck 0; frozen-file diff
  review (only additive column on `vt_appointments`); screenshots.
- **Done when:** All six event paths attach; timeline renders from real events; review passes.
  **Depends 0.1, 0.2. Parallel with 1.1; Autopilot becomes patient-aware when this lands.**

### Task 1.3 — Ship the Android app (Google Play) · **P0 · M · Sonnet 5**
- **Objective:** The existing Capacitor Android shell becomes a shipped Play Store app.
- **Scope (technical):** build via `scripts/build-native-shell.sh --android` (`pnpm
  cap:build:native:android`); targetSdk 35 + edge-to-edge (0.7); release signing (upload keystore + Play
  App Signing); Clerk OAuth redirect + deep links on Android (bundled-shell Option-B lesson — no thin web
  wrapper); FCM push path for `notification.worker`; NFC/haptics/camera verified on real Android hardware;
  Play Console: listing, Data-safety form (operational data only — mirrors the PHI denylist), content
  rating, internal-testing track → production.
- **Scope (design):** mobile design stays source of truth — no fork: system back-button audit on every
  flow (sheets, scanner, Code Blue); adaptive icon + splash; edge-to-edge safe-areas; Play listing assets
  (screenshots/feature graphic, Hebrew-first + English, RTL-correct).
- **Execute:** (1) Write `docs/plans/2.0/task-1.3-android-ship.md` (signing steps, Play Console
  checklist, device test matrix). (2) Execute: internal track first; real-device matrix; then production.
- **Verify:** Internal-track install works end-to-end (sign-in → scan → Code Blue view) on ≥2 real
  devices; back-button audit checklist green; store listing screenshots match app.
- **Done when:** App live on Play (or internal track if owner holds production); review passes.
  **Depends 0.7 (hard). Independent of 1.1/1.2 — ships with current feature set.**

---

## Phase 2 — Make It Visible & Sellable (breakdown-first)

### Task 2.1 — One-tap "attach to case" pin · **P1 · S · Sonnet 5**
- Attach affordance on scan/dispense/damage/Code-Blue surfaces writing `case_id` refs; zero new screens;
  timeline back-fills from actions staff already take. Design: one tap, NO flow friction on the scan loop
  (owner principle #6 — prototype on-device before commit); i18n keys.
- **Verify:** e2e attach-from-scan test; on-device tap-count check; screenshots. **Depends 1.2.**

### Task 2.2 — The Live Floor + The Baton · **P1 · M · Opus 4.8** 🔥 ⚠️
- Promote the Socket.io collab channel (`server/lib/realtime-collab/presence-store.ts`, clinic/record
  rooms, Redis fan-out) to a persistent who's-doing-what-where layer. The Baton: two-sided acknowledged
  handoff (task/case/Code-Blue-role/zone) — receiver ACCEPTS or it escalates up the roster ladder (P3
  pattern); every pass = an outbox fact → accountability graph. ⚠️ Advisory-presence over frozen
  SSE/outbox authority — never a second source of truth. ⚠️ Code-Blue-role batons = coordination metadata,
  never emergency state. Design: shared operating picture phone/tablet/board (avatars-on-rooms);
  offer→pending→accept/escalate made *felt*; stale-presence graceful degradation; kiosk type scale on board.
- **Verify:** baton escalation tests; presence-staleness UI states screenshotted; frozen-transport diff
  review. **Depends 1.1 + 1.2 (connective tissue).**

### Task 2.3 — "Who's on the floor" glance card · **P2 · S · Sonnet 5**
- Minimal home-screen presence card (avatars on rooms) — 2.2's adoption pilot. Sequence before 2.2 as
  de-risker or drop if 2.2 ships whole. **Verify:** screenshots; presence-store read-only.

### Task 2.4 — Economic Loss & ROI Ledger · **P1 · M · Sonnet 5**
- Cost-attribution service over existing streams: repair/replacement per `vt_damage_events`,
  carrying+wastage per expiry, spend-vs-par (par/PO tables exist). Optional Autopilot extension:
  auto-draft cost-recovery packet into the approval queue on chargeable damage. Design: owner-facing
  running P&L on the management console (admin+lead gate respected); dataviz as design-system citizen;
  locale-aware currency (he/en); "looks like money, not logs".
- **Verify:** attribution unit tests against seeded events; console screenshots light+dark+RTL.
  **Independent of 1.1 except the auto-draft extension. Feeds 0.6 narrative.**

### Task 2.5 — Autopilot `enforce` (policy-gated) + Ambient Safety Net · **P1 · L · Opus 4.8** ⚠️
- (a) Promote proven-in-shadow proposal types to one-tap execution behind the 0.4 policy layer —
  ⚠️ envelope extended never weakened; `enforce` per-policy per-org only. (b) Safety Net: score the
  fact-stream for pre-failure signatures (crash-cart drift into thin roster, damage-trajectory units,
  class-level readiness collapse, Code Blue readiness gaps); threshold-cross pages the named accountable
  person (`notification.worker` push + board ambient flash); rules/statistical first, `shadow`,
  high-precision-only (0.5 thresholds). ⚠️ Pages ABOUT Code Blue readiness — never touches Code Blue
  mutation/recovery semantics; no emergency endpoint in any cache. Design: executed-vs-proposed
  legibility; the page = named person + ONE closing action, no broadcast spam; `aria-live`; glass OFF on
  board.
- **Verify:** policy-gate tests (enforce denied without org policy); precision thresholds cite 0.5;
  alert-fatigue review with design thread; frozen-surface diff review.
  **Depends 1.1-in-shadow duration + 0.4 + 0.5.**

---

## Phase 3 — Strategic Bets (breakdown-first; start only when Phases 0–2 tracker boxes are green or owner re-prioritizes)

### Task 3.1 — Immutable Hospital Ledger · **P2 · L · Opus 4.8** ⚠️
- Hash-chain the record-of-truth: prev-hash column + per-clinic signing key + tamper-evident
  export/attestation over outbox + closed `AuditActionType` audit + `vt_equipment_anchors`. ⚠️ Additive
  columns/exports ONLY on the frozen outbox/audit stacks. Design: attestation/export artifact
  (insurer/regulator/malpractice-grade); console-only.
- **Verify:** chain-verification test (tamper → detect); export golden-file test. **Full value needs 1.2.
  Enables 3.2 + Phase-4 human-healthcare.**

### Task 3.2 — Controlled-substance / regulated-custody module · **P2 · L · Sonnet 5**
- Specialize 3.1: chain-of-custody + reconciliation + e-signature + immutable register over existing
  dispense/restock/procurement routes; statutory reports. Design: e-signature ceremony; register/report
  views for a NEW compliance-officer archetype; print/export layouts.
- **Verify:** register reconciliation tests; statutory-report golden files; signature-flow screenshots.
  **Depends 3.1.**

### Task 3.3 — Reception War-Room · **P2 · M · Sonnet 5**
- Lightweight intake object (may precede full Spine maturity) + live claim/progress over the presence
  channel (waitlist/staging-queue patterns); NEW reception archetype in
  `src/lib/roles/experience-model.ts` (closed union — additive). Design: claimable arrival cards on any
  surface; board queue-depth; load-spreading visible; full role-experience design pass (new archetype,
  not a re-skin).
- **Verify:** claim-race test (two staff claim same arrival); archetype union typecheck; board + phone
  screenshots. **Depends early 1.2 + 2.2 patterns.**

---

## Phase 4 — Horizon (gated backlog; NOT tracker scope — each needs its own gate-clearing decision first)

| Item | Gate that must clear first | Disposition |
|---|---|---|
| **Human-healthcare crossover** (`human_hospital` archetype) | Case Spine mature + multi-clinic deployments + Postgres RLS + PHI/HIPAA audit posture | Destination, not objective — never slows the vet roadmap |
| **`departmentId` + department-scoped realtime** ⚠️ | Measurable per-department value + pre-defined scope (owner decision #6). ⚠️ Department-scoped outbox feeds touch the FROZEN SSE/outbox cursor — the one item that cannot be purely additive; dedicated architecture review (Opus 4.8) before any build | Scoped fast-follow |
| **Cross-tenant actuarial network / mutual-aid marketplace** | Cross-tenant primitive + RLS (neither exists) + fleet-scale data density | Long-game moat the Spine+Ledger feed |
| **Sensor/IoT readiness fusion** | Hardware BOM + partnerships; ingestion half (`vt_equipment_rfid_reads` gateway) reusable later | Hardware bet, not software 2.0 |
| **Adapter Registry as public App Platform** | Ecosystem pull (PMS/device vendors asking) — doesn't exist yet | Premature platform-ization |

---

## Dependency & conflict map (technical ↔ design)

**Design blocked on technical:** approval-queue card ← `action_proposal` schema (0.3); case timeline /
patient page ← allowlist (0.1); ROI ledger view ← attribution data shape (2.4).
**Technical blocked on design:** `action_proposal` schema freeze ← card-anatomy requirements; paging
thresholds (2.5) ← alert-fatigue UX budget.
**Conflicts (resolve explicitly, don't drift):** (1) timeline richness vs PHI denylist → resolve at 0.1
review; (2) Live Floor authority vs advisory presence → design for staleness, SSE stays truth; (3)
Autopilot visibility vs noise → shared precision/restraint budget from 0.5; (4) department dashboards →
hold the line, Phase 4; (5) scan-loop friction from 2.1's pin → on-device prototype before commit.

---

## Platform research addendum (2026-07-19)

1. **Shell strategy confirmed — Capacitor stays.** RN New Architecture (JSI/Fabric/TurboModules, default
   since 0.76) optimizes native-widget rendering — orthogonal to the one-web-bundle / 4-platform-seam /
   offline-PWA strategy. Migration = UI rewrite, discards the App-Store-approved bundled shell. RN's
   `AccessibilityInfo` retained only as the a11y-parity checklist above.
2. **Liquid Glass:** floating controls-layer material — never content layer. Native material auto-adapts
   to Reduced Transparency / Increased Contrast / Reduced Motion; the WKWebView CSS approximation must
   hand-roll those (`prefers-reduced-motion`, `prefers-contrast`, reduced-transparency fallback).
   Glass-OFF-on-Code-Blue/board matches Apple's own hierarchy rule.
3. **Android:** targetSdk 35 / Android 15+ enforces edge-to-edge → insets/safe-area work in Task 0.7
   gates Android shipping (1.3).
4. **Plugin law (github.com/ionic-team/capacitor-plugins):** plugin major = Capacitor core major;
   `npx cap sync` after EVERY plugin/dep change (regenerates SPM/Gradle wiring pinning exact pnpm-store
   paths); native builds only via `scripts/build-native-shell.sh`; verify on a real device — the iOS
   Simulator has no Taptic Engine ("resolve without performing any action"). Haptics breakage tracked in
   Task 0.7 (live path `src/lib/haptics.ts` swallows failures; `HapticsAdapter.ts` unused parallel
   implementation slated finish-or-delete).

---

## Coverage note

Every session-2 opportunity is accounted for: Massive 1→1.2, 2→1.1, 3→2.5(b), 4→Phase 4, 5→3.1 ·
Medium 1→2.2, 2→2.4, 3→3.3, 4→3.2 · Small gems 1→0.3/1.1, 2→2.1, 3→2.3 · all four Backlog items→Phase 4 ·
all six owner decisions + six product principles→Binding constraints. Tasks 0.7 and 1.3, the working
agreement, goal & scope tracker, delivery methodology (incl. model routing), and the research addendum
derive from the 2026-07-19 platform-doc validation + owner amendments, not session-2. The thesis wording
is the owner's 2026-07-19 fusion of session-2's two moves.
