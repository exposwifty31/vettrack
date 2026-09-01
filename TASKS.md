# TASKS.md

> Agents: read this to find your task. Update status when you finish.
> Humans: add tasks here before starting an agent session.
>
> One task = one logical change. If a task takes more than one session, split it.
>
> See PLAN.md for the active sprint scope. **Executable card details** (anchors, RED/GREEN, verify) live in `docs/plans/consolidated-audit-10x/` — do not invent scope beyond the card.
> See BUG_REGISTER.md for known defects outside this program.

---

## In Progress

> **⚠ 2026-08-13 — this file's card program is CLOSED. See the PLAN.md banner before using anything below.**
>
> The active program is the **RN store push** (get the React Native successor into review on both
> stores), tracked in `~/.claude/plans/store-submission-runbook.md`. It is not card-shaped and does
> not live here. The Phase-0/1/2/3 cards below are historical.
>
> **This repo's open items for that program.** Each row states its own
> verification date — the rows are re-checked independently, and one date on the
> heading would be a claim about rows nobody re-read that day. The table was
> first written 2026-08-13; the store rows below were re-verified 2026-08-31 and
> carry attestations, since neither the AAB nor the signing certificate is
> anything this repository can prove on its own.
>
> | Item | Owner | State |
> |---|---|---|
> | Run `pnpm seed:reviewer-demo` against **production** so the store reviewer sees real data (not empty lists) | Owner | ✅ **DONE — twice.** The 2026-08-11 demo-5roles fire seeded 5 isolated demo clinics (`reviewer-demo-clinic-*`) + 5 prod Clerk users. A second, single-account fire on **2026-08-29** created `reviewer-demo@vettrack.app` + `reviewer-demo-clinic` (14 shift days, 2 rooms, 2 docks, 4 equipment, 2 tasks) and those credentials are what the Play **App access** form now carries. Sign-in verified live on the Pixel release build. **Teardown still owed on both**, and it is owed to the owner, not to an agent — the credentials are not in this repo |
> | Play App Signing SHA-256 → `server/lib/well-known-assetlinks.ts` + redeploy | Owner→Agent | **The blocker moved: the AAB is uploaded.** versionCode 10301 has been on the Play **alpha** track since 2026-08-29, so "blocked until the first AAB is uploaded" is no longer why this is open. What blocks it now is that the certificate is Console-only. Checked on 2026-08-30 rather than assumed: the authenticated `gplay` CLI has no signing/cert command, and `gplay bundles list` returns a `sha256` that is the **digest of the uploaded artifact**, not the certificate fingerprint. Do not paste that value here — `server/lib/well-known-assetlinks.ts:16` requires colon-separated hex pairs and would reject it, which is the only reason a wrong paste would be caught. **Owner action:** copy the SHA-256 from Play Console → App integrity → App signing; then the redeploy is an agent step <!-- vt-claim: attested play-alpha-aab-10301 --> <!-- vt-claim: attested gplay-exposes-no-signing-cert --> |
> | The doctor-gate + reviewer-seed contract suites were named by no workflow — incl. the doctor-gate test that pins the provenance contract the RN app depends on (the RN client sends `source: "doctor_gate"` in the request body; the server persists it as `checkInSource`, which is the field the test asserts) | Agent | ✅ **CLOSED** — coverage by `7a3ad3a` (named files in `integration-ops`); the silent-skip hole in it closed separately: both suites are `describe.skipIf(!dbReachable)`, so an unset or unreachable `DATABASE_URL` made them skip with the step still green. `scripts/ci/db-integration-preflight.mjs` now runs before them and refuses that |
> | **The rest of that class is still open.** `vite.config.ts` excludes ~~10~~ ~~13~~ **32** entries from `pnpm test` (see the 2026-08-27 correction at the end of this row) (`tests/migrations/**` is a glob over 6 files); verified 2026-08-21 that **none** is named by any workflow: `tests/migrations/**`, `restock.service`, `shift-chat-window`, ~~`charge-alert-worker`, `code-blue-mode-equipment`, `equipment-scan-e2e`, `expiry-api`, `expiry-check-worker`, `returns-api`~~. Two of those touch **Code Blue / equipment scan**. *Corrected 2026-08-22:* those six — the whole live-server half, including both safety-critical ones — now run in CI's `live-server` job (`pnpm test:live-server`), which the merge gate depends on, and which gates on the reported assertion count rather than the exit code alone. ~~**Three remain open:** `tests/migrations/**`, `restock.service` and `shift-chat-window` are DB-only and need a different setup; they are NOT covered.~~ *Corrected 2026-08-27 — the struck sentence was accurate for the pre-rebase branch and is wrong on this tree. Re-measured on `origin/main` `bf1e0480c`: commit `4f48620e1` (merged as PR #225, closing issue 221) added 18 more DB-backed suites to the exclude block, taking it from 13 tracked entries to 32. **21 are covered by no workflow, not three:** `tests/migrations/**` (6 files), `restock.service`, `shift-chat-window`, plus those 18 — `dock-return-anchor`, `docking-anchor-contradictions`, `docking-citizen-anchor`, `docking-home-assign`, `docking-route`, `equipment-anchor.service`, `equipment-coordinator`, `equipment-missing-alert`, `reconciliation-buckets`, `room-last-swept`, `room-readiness`, `room-sweep`, `senior-doctor-eligible`, `shift-handover-generator`, `shift-handover-observed`, `shift-handover-patient-worklist`, `shift-handover-surface`, `sweep-escalation` — a block `vite.config.ts` annotates itself with "No dedicated runner exists yet for these". Covered on `main`: equipment-operational-state + push-endpoint-cross-clinic via `pnpm test:integration:ops`; doctor-shift-gate + seed-reviewer-demo via a CI step that names both files; the six live-server suites via `pnpm test:live-server`. `pnpm test:db-integration` is run by no workflow at all — `.github/workflows/ci.yml` names it only inside a comment saying why those two are invoked by filename instead. `CLAUDE.md` carries the matching 18-suite list, consistent with this tree's `vite.config.ts`.* `tenant-pooling-isolation` is the one deliberate exclusion (real DDL — run via `test:rls-pooling`). Do not read the row above as "the class is handled" | Agent | open |
> | RN's `/api` client paths are validated against this server's real route table | Agent | ✅ **ARMED 2026-08-30, both halves.** `scripts/generate-server-route-manifest.mjs` (PR #270) emits the mounted-route table; the RN repo pins it and its previously-skipped `endpoint-drift` suite now runs 8/8 over all 90 distinct RN paths. PR #271 put the generator into the `typecheck` job here, so a route this repo adds or moves cannot silently drift from the app. Two blind spots were found by trying to test it and are fixed: a registration reached only through a `mount…(router)` **function call** (the waitlist and RFID routes — 4 real endpoints under-reported), and a registration inside a comment counting as reached |
> | `tenant:lint` was `--warn-only` + `--touched` + `continue-on-error` | Agent | ✅ silent-gate **CLOSED**; baseline debt **open** — `pnpm tenant:lint:enforce` (`--all --baseline .tenant-lint-known-violations.json`) is a layer-3 evidence gate (`verify.config.json` `tenant-scope`) and a merge-blocking CI step (`ci.yml` "tenant query lint (new findings only)", no `continue-on-error`). Baseline on this tree: **202** findings across **149** `file::table` keys. The heuristic is unchanged (it still does not inspect the `.where()` chain), so the baseline is a freeze, not a proof of tenancy: a new leak fails, a leak already in the baseline does not |
>
> **⚠ Safety note — writing seed data to a production database.** Verified against
> `scripts/seed-reviewer-demo.ts` on 2026-08-13, not assumed:
>
> | Property | State |
> |---|---|
> | **Tenant isolation** | ✅ writes only to its own namespaced clinic (`reviewer-demo-clinic` by default, or `REVIEWER_DEMO_CLINIC_ID`). The script carries an explicit guard against a typo'd/stale clinic id silently writing into a real clinic (`scripts/seed-reviewer-demo.ts:60-62`) |
> | **Idempotency** | ✅ every insert uses `onConflictDoNothing` / `onConflictDoUpdate` — safe to re-run |
> | **Synthetic data only** | ✅ demo persona + demo equipment; no real patient, staff, or clinic data is created or modified |
> | **Cleanup** | ⚠ **partial.** Rollback order is documented in `docs/runbooks/code-blue-qa-walkthrough.md` (children-first, all FKs are `ON DELETE RESTRICT`). But `vt_audit_logs` is append-only — once anything writes an audit row for the demo clinic, the clinic row itself becomes undeletable and leave-in-place is the only option |
>
> **Before running:** confirm `REVIEWER_DEMO_CLINIC_ID` is the demo clinic and not a real one,
> and take the routine production DB backup first. Accept that the demo clinic is effectively
> permanent once audited — it is unreachable by real users, so the cost is a stray row, not a risk.
>
> _Phase-0A cards below are COMPLETE (2026-07-12) — see banner and Completed. Do not re-execute._

---

## Phase 0A cards (COMPLETED 2026-07-12 — reference only, do NOT execute)

> **⚠ 2026-07-28:** T-05 · T-01 · T-02 · T-03 · T-04 all COMPLETED 2026-07-12 (commits `b79f0819a`,
> `bb148cb3`→`b3c1f2e66`, `364d21cfd`→`78c94841c`, `4a1a75cc3`→`e451f0743`, `332c311d2`→`9edf4845d`;
> batch gate 492 files / 4552 tests, 0 fail — PROOF-logged). Cards retained for card-contract reference only.

> All five cards COMPLETED 2026-07-12 (commits in the banner below).
> Full cards remain in `docs/plans/consolidated-audit-10x/phase-0-1.plan.md` for reference.
> After GREEN: `pnpm test -- <RED file> && pnpm typecheck` → log `docs/audit/PROOF_ALIGNMENT_LOG.md` → commit per card.

### T-05: Pass QueryClient into `initSyncEngine()` (R-SY-01)
**Priority:** `high` · **Tier:** `S +R` · **Linked plan:** Phase 0A · foundational (do first)

**What to do:**
Sole caller at `src/hooks/use-sync.tsx` invokes `initSyncEngine()` with no arg → `queryClientRef` stays undefined → post-replay invalidations, reconcile, and 401 cache-clear are no-ops. Pass `useQueryClient()` into `initSyncEngine(queryClient)`.

**Acceptance criteria:**
- [ ] RED then GREEN: `tests/sync-engine-queryclient-wiring.test.ts` (QueryClient passed; replay invalidates equipment; 401 clears cache)
- [ ] Wiring only — no queue/circuit-breaker/emergency-cache changes
- [ ] `pnpm test -- tests/sync-engine-queryclient-wiring.test.ts && pnpm typecheck`
- [ ] `code-reviewer` pass before commit; proof logged

**Files in scope:** `src/hooks/use-sync.tsx`, `src/lib/sync-engine.ts` (read), test file  
**Files NOT in scope:** sync queue semantics, SW cache paths, emergency endpoints

---

### T-01: Code Blue outcome Cancel dismisses without ending session (R-CB-01)
**Priority:** `high` · **Tier:** `S +R` · **Linked plan:** Phase 0A

**What to do:**
Cancel calls `onClose("")` → `handleEndSession` returns at the empty-outcome guard before closing the modal. Give Cancel a dedicated close that sets `showOutcomeModal=false` and does **not** call the end path.

**Acceptance criteria:**
- [ ] RED then GREEN: `tests/code-blue-outcome-cancel.test.tsx` (modal gone; end mutation not called; focus returns)
- [ ] No SSE/keepalive changes; no optimistic session end
- [ ] `pnpm test -- tests/code-blue-outcome-cancel.test.tsx && pnpm typecheck`
- [ ] `code-reviewer` pass before commit; proof logged

**Files in scope:** `src/pages/code-blue.tsx`, test file

---

### T-02: Dock-Return + RFID sheets mount at page level (R-EQ-01/02)
**Priority:** `high` · **Tier:** `S` · **Linked plan:** Phase 0A

**What to do:**
`<DockReturnFlow>` and `<DockReturnNfc>` sit inside inactive Readiness `TabsContent` → silent no-op on default tab. Move both to page level (mirror equipment-list).

**Acceptance criteria:**
- [ ] RED then GREEN: `tests/equipment-detail-dock-return-mount.test.tsx`
- [ ] Presentation/mount only — no custody-mutation change
- [ ] `pnpm test -- tests/equipment-detail-dock-return-mount.test.tsx && pnpm typecheck`
- [ ] Proof logged

**Files in scope:** `src/pages/equipment-detail.tsx`, test file

---

### T-03: QR auto-decode last-scanned-wins exactly once (R-SC-01)
**Priority:** `high` · **Tier:** `S` · **Linked plan:** Phase 0A

**What to do:**
Overlapping resolves can last-resolved-win the wrong tag and double-count scans. Monotonic token + stop scanner before await; apply resolve only if token still latest; increment once per applied scan.

**Acceptance criteria:**
- [ ] RED then GREEN: `tests/qr-scanner-race.test.tsx`
- [ ] Do not touch `classifyEmergencyEndpoint` / offline emergency block
- [ ] `pnpm test -- tests/qr-scanner-race.test.tsx && pnpm typecheck`
- [ ] Proof logged

**Files in scope:** `src/components/qr-scanner.tsx`, test file

---

### T-04: Room-radar Return works after canceled dialog (R-RM-01)
**Priority:** `high` · **Tier:** `S` · **Linked plan:** Phase 0A

**What to do:**
Return sets `busyRef=true` then only opens dialog; Cancel never runs `returnMut.onSettled` → later taps blocked. Reset `busyRef` on dialog close via `onOpenChange`.

**Acceptance criteria:**
- [ ] RED then GREEN: `tests/room-radar-return-busyref.test.tsx`
- [ ] `pnpm test -- tests/room-radar-return-busyref.test.tsx && pnpm typecheck`
- [ ] Proof logged

**Files in scope:** `src/pages/room-radar.tsx`, test file

---

## Owner / ops — Phase 0B + exit (not agent TDD)

> Tier: **Owner**. Binary checks — see plan § Phase 0B. Not RED→GREEN.

| ID | Summary | Status |
|---|---|---|
| T-06 | Rostered reviewer account + active shift (highest-value) | ready (Owner) |
| T-07 | Build only via `pnpm cap:build:native` | ready (Owner) |
| T-08 | SIWA round-trip if social login retained | ready (Owner) / N/A if email-only |
| T-09 | Sentry ↔ PrivacyInfo / ASC privacy | ready (Owner) |
| T-10 | Broaden `NSCameraUsageDescription` | ready (Owner) |
| T-11 | Localize permission prompts (he) | ready (Owner) |
| T-12 | Offline cold-start "connect to sign in" | ready (Owner) |
| T-13 | AASA + entitlements live | ready (Owner) |
| T-14 | `auth:preflight` + `validate:prod` + `verify:resubmission` | ready (Owner) |
| T-15 | App Review notes framing | ready (Owner) |
| ~~**T-16**~~ | ~~Phase 0 exit on-device drill (blocks Phase 1)~~ | **historical — void 2026-08-13**; survives only as store-lane **O8** (G3 on-device verdict) in the store-submission runbook |

---

## Queued — Phase 1+ (⚠ the "do not start until T-16 passes" gate is VOID as of 2026-08-13)

> These cards were written in July. Much of this list either shipped under a different name
> (equipment fixes, shift/home, web admin-gate, Code Blue races, board features) or was
> superseded by the RN migration. **Re-verify against `git log` before executing any card here.**

Full cards in the plan library. Summary only:

| Bundle | IDs | Plan |
|---|---|---|
| Equipment fixes | T-17…T-21 | `phase-0-1.plan.md` |
| Locate / readiness / damaged | T-22a–c, T-23a–e, T-24a–e | same |
| Shift / home | T-25…T-27; **R-SH-F1** sub-spec | same + `subspecs/R-SH-F1-shift-handover.plan.md` |
| Inventory | T-28a–b, T-29, T-30a1…T-30c | `phase-0-1.plan.md` |
| Web admin-gate | T-31 (`S +R`) | same |
| Code Blue races (gate medium-01) | R-CB-02/03 | `subspecs/R-CB-stabilize-code-blue-races.plan.md` |
| Phase 2 MED + features | T-34…T-44; R-CBF-1 / R-BDF-1 / R-PDF-1 | `phase-2-3.plan.md` + sub-specs |
| Phase 3 LOW | T-45…T-53 | `phase-2-3.plan.md` |
| RFID-gate e2e | R-M1.0…M1.5 | `subspecs/R-M1-rfid-gate-e2e.plan.md` |
| Phase 4 parked | massive-03, medium-04 | `phase-4.plan.md` — entry conditions required |

---

## Blocked

- ~~**T-16 / Phase 1+** — blocked until Phase 0A HIGH fixes + Owner 0B checks needed for the exit drill are done~~
  **Historical — no longer blocked (void 2026-08-13).** Phase 0A landed 2026-07-12; Phase 1+ either
  shipped or was superseded by the RN migration. The only live on-device gate is store-lane **O8**.
- **Phase 4 massive-03 / medium-04** — owner entry conditions (see `phase-4.plan.md`)

---

## Completed

- 2026-08-23 — **Auth Ivory door chrome** (visual-only): `/signin` + `/signup` use shared `AuthDoorChrome`. **Platform layouts:** web = centered Ivory sheet (`max-w-sm`); Capacitor phone = full-bleed top-aligned (no floating card); tablet = same language + `max-w-lg` / landscape two-column. Flattened Clerk appearance — including the OUTER `cardBox` and the grey `footer` band, which Clerk 5 draws outside `card`, so the page chrome is the only card on every variant. 44px role chips on **sign-up only**; Welcome back = sign-in only. Auth logic untouched. Tests: `auth-door-chrome` + `role-chips-signup` + `native-auth-surface` green; `tsc --noEmit` clean. Verified in the bundled Capacitor shell on iPhone SE (375pt), iPhone 17 and iPad Pro 11-inch (portrait + landscape).
- 2026-08-13 — **The nine-blocker push + TV board** (PRs #167–#181 to `main`): native push +
  RFID readers, reviewer-demo seed (#175), Code Blue vet-QA persona + click-path runbook (#179),
  doctor shift gate + migrations 181–184 (#180, RN companion #59), TV Command Center board
  10-foot mode (#178) and the state-driven Phase-1 redesign (#181). All CI-green and
  proof-logged; deployed to production the same day (three Railway releases).
- 2026-07-12 — **Phase 0A: T-05, T-01, T-02, T-03, T-04** (HIGH fixes; RED→GREEN, batch gate green) — PROOF_ALIGNMENT_LOG entries "2026-07-12 — Consolidated Audit × 10x".

_Archive completed tasks here with date and notes._

---

## Backlog

_Agents: add out-of-scope items here rather than acting on them._

### Deferred from prior maintenance PLAN (superseded by Audit × 10x)

- TASK-001: Eliminate N+1 queries on equipment list endpoint — was Area 2; reassess after Phase 0–1
- TASK-002: Add missing test coverage for restock service (`tests/restock.service.unit.test.ts`)
- TASK-003: Hebrew translation parity sweep (use `pnpm i18n:check` / parity tests when touching locales)

### Closure audit 2026-09-01 — what is NOT closed, and why

Recorded so it is explicit rather than silent. The owner goal is "nothing planned that does
not work, nothing built that is not wired properly"; these three are the residue.

- ~~**TASK: `knip` is a dead-code detector that nothing reads, and its output is not yet
  adjudicated.**~~ **CLOSED 2026-09-01.** The triage was the work, and the flag followed it.
  The list was **125 unused files**; it is now **7**, and a blocking gate freezes those.
  - **111 were never application code** — `.agents/**`, `.claude/**`, `docs/**` handoff
    assets, `load/**`, `public/**`. Scoped out in `knip.json`.
  - **3 were knip being wrong**, and the cause was the config: `AlertCard`,
    `ShiftProgressHero` and `Sidebar` are reachable only through
    `src/design-system-entry.ts`, which sat in `ignore` — so knip never traversed it and
    called its dependents dead. Moving that one path from `ignore` to `entry` fixed all
    three. The earlier note that "declaring `entry` is NOT the fix" was half right: knip
    does report hand-written entries as redundant when its plugins already find them
    (verified — the four vitest/playwright configs were, and were removed again), but the
    two that remain are each load-bearing, measured one at a time: removing
    `src/design-system-entry.ts` puts the count back to 11 and `tests/global.setup.ts` to 8.
    A third attempt was WRONG and the tool said so: declaring
    `tests/flow-walk/native/wdio.conf.ts` and `tests/flow-walk/native/native-walk.e2e.ts` as
    entries made knip analyse them and report two WebdriverIO packages as unlisted
    dependencies — correctly, because that directory is its own private package with its own
    `tests/flow-walk/native/package.json` and `tests/flow-walk/native/package-lock.json`,
    declaring those packages itself and "deliberately NOT part of the root install" in its
    own description. It is `ignore`d now, which is what it always was.
    (The claim gate made the same point about this very paragraph: naming those two packages
    in backticks reads as a claim that THIS package.json declares them, which is the opposite
    of what the sentence says. Hence the path citations.)
  - **7 are genuine** — `shared/index.ts`, the five `src/infrastructure/*/index.ts` barrels
    and `src/lib/query-keys/registry.ts`. Adjudicated against a real import graph
    (dependency-cruiser with `tsPreCompilationDeps` + tsconfig paths), which is what the two
    unreliable grep passes should have been.
  - The gate: `pnpm knip:files` (`scripts/ci/knip-unused-files.mjs`) freezes those 7 in
    `scripts/ci/knip-unused-files.baseline.json` and runs in `architecture-gates` **without**
    `continue-on-error`. A new unreachable file fails; a baseline entry that gains a caller
    also fails, so the freeze cannot outlive its reason. Proven red on both, plus on a third
    case worth naming: a `knip.json` with an unrecognized key prints `ERROR: Invalid input`
    and exits **2**, and the advisory step passed anyway — a config that analysed nothing
    read as a clean run. The gate treats a non-zero knip exit as a failure.
  - Still advisory, deliberately: **241 unused exports · 253 unused exported types.** A type
    exported ahead of its consumer is a different judgement from a file nothing reaches, and
    mixing them is how the report became unreadable. That remains open work. A review asked
    for that step to be made blocking too; measured before answering — `pnpm knip` without
    `--no-exit-code` exits 1 on those **494** pre-existing issues, so making it blocking
    today fails every build on a backlog nobody has triaged. That is the "block on noise"
    half of the dilemma this entry opened with, and it is why the blocking gate is a
    separate, narrower step rather than a flag flipped on this one.

- **TASK (new, found while closing the one above): the claim gate is blind to every
  dot-directory.** `scripts/verify/claims.cjs` resolves globs without `dot: true`, so `**`
  never matches `.agents/`, `.claude/` or `.github/` — a governed doc can claim a path under
  any of them and the gate reports "glob matches nothing" whether the path exists or not.
  Two such claims are registered in `docs/claims-registry.json` with the measurement that
  proves them (`git ls-files .agents` → 10, `.claude` → 461). Not fixed here on purpose:
  that engine is fingerprint-locked and byte-shared with the RN repo, so the fix is a
  coordinated two-repo change with its own `engineFingerprint` bump, not a side effect of a
  docs edit.

- **TASK: the four ⏸ entries in the RN parity register carry reasons but no decision.**
  D1 avatar upload (server ships `POST /api/uploads/avatar` and returns `avatarUrl`; RN's
  `MeUser` has no such field — needs `expo-image-picker`, which invalidates the binaries
  currently staged) · D4 iOS quick action (owner-gated) · G1 notification preferences
  (**server-blocked**: no endpoint exists, and a naive toggle would silently disable Code
  Blue — a documented refusal, not an omission) · H2 `ANDROID_PLAY_SIGNING_SHA256`
  (Console-only certificate). None is code. Each needs a written owner decision before the
  register can read 0 ⏸.

- **TASK: `scripts/analysis/autopilot-backtest.ts` is a SYNTHETIC harness.**
  `docs/vettrack-2.0-roadmap.md` marks it "never cite for real thresholds". It runs, so it
  looks like evidence and is not. Either feed it real data or move it out of the evidence
  path; until then no Autopilot threshold may be sourced from it.

### Ongoing

- TASK: Investigate stale check-in sweep worker — confirm TTL sweep is running in production
- TASK: Audit `vt_event_outbox` retention — verify janitor is not letting the table grow unbounded
- TASK: Review Playwright Phase 9 drills — confirm all 8 drills pass against local dev server
- TASK: Add `.cursor/rules/` vettrack-specific overrides for i18n and multi-tenancy invariants
- DONE (2026-07-07 relevance cleanup): deleted root cruft (`Archive.zip`, `Archive 2.zip`, `all-files.md`, `screenshot.png`, `app-cloud.js`, `.nvrmc`, session `.txt`, 38 `playwright-ui-screenshots/`); removed verified-dead `shared/permissions.ts` (server uses `er-mode-permissions.ts`), `server/integrations/{rollout,conflicts}/*`, `src/lib/constants/regex.ts`, `src/lib/task-dashboard-filters.ts`, `src/hooks/use-is-mobile.ts`. Gate green; superseded stale PR #40.
- TASK: Remove dead `src/features/today/*` unused siblings (`QuickScanCard`, `ShiftHero`, `TodayScreen`, `UrgentCountChips`, `use-today-shift`, `index.ts`) — verify each is unreachable first. KEEP `HomeTabletDashboard.tsx` — it is LIVE (`src/pages/home.tsx:26` imports it). PR #40's blanket `features/today` deletion was unsafe for this reason.
- TASK: Audit `docs/design-handoff/` (240 tracked files, ~15MB) — archive externally or trim to active design refs
- TASK: NFC FAB for the native shell — never landed; reference implementation preserved at local ref `refs/removed-origin/claude-new-session-rw4978` (origin branch deleted 2026-07-22 repo tidy). Built pre-`src/app/platform` seam — re-implement against the current platform router, do not rebase.
- TASK: Deduplicate untracked `.agents/skills/ecc/` mirror of `.claude/skills/ecc/` (~1.7MB each); pick one canonical agent-skills path
- NOTE (do not "clean"): `inventory-deduction` worker/queue is NOT dead — `server/services/dispense.service.ts:614` enqueues it and 5 tests assert its shape. Removing it is a behavior change (Removal Protocol), not a relevance-cleanup deletion. Reassess only if the dispense enqueue path is intentionally retired.
- TASK: Honour iOS Dynamic Type in the Capacitor shell — app-wide typography, not a screen fix. Measured on an iPhone 17 simulator at `accessibility-extra-extra-extra-large`: the auth door is pixel-identical to the default size (969 of 3,162,132 pixels differ, all inside the status-bar clock). An isolated Safari probe at the same setting showed why — `px` and `rem` both stay 16px, and so does a rule carrying the app's own `-webkit-text-size-adjust` value from `src/index.css`, while a text style set from the iOS system body font scaled 16px to 53px. So the adjust property is a red herring and the real requirement is basing the scale on the system text styles. Deliberately NOT done as part of the auth door: Clerk's form is px-based and outside our control, so scaling only our chrome would triple the copy around a form that stays 16px — a broken screen, not an accessible one. Mitigation already in place: `index.html` sets no `user-scalable=no`, so pinch-zoom works. Owner deferred 2026-08-24.
- TASK: `src/components/native-clerk-gate.tsx` spinner still animates under reduce-motion — the four auth-door spinners were given `motion-reduce:animate-none` (matching `src/components/ui/skeleton.tsx`); this file was out of scope for PR 237 and is the last one left.
- TASK: Split remaining >800-LOC files (repo ceiling). `admin.tsx` DONE (1656→204 + prop-less section files under `src/pages/admin/`). Next, modular/clean: `equipment-list.tsx` (1421 — extract `EquipmentItem` + desktop sub-sections). Monolithic/higher-risk (single cohesive component; needs real decomposition + visual-regression, do individually): `equipment-detail.tsx` (1824), `Tasks.tsx` (1420), `inventory-page.tsx` (1079), route file `server/routes/equipment.ts` (954). *Corrected 2026-08-27 — every count in this line was stale; all re-measured on `origin/main` `bf1e0480c`. It previously read ~~"1656→219 … `equipment-list.tsx` (1351) … `equipment-detail.tsx` (2075), `Tasks.tsx` (1590), `inventory-page.tsx` (1033), route files `containers.ts`/`users.ts`/`equipment.ts`"~~. The two route files it listed as pending are **done, not pending**: both were split into handler modules on 2026-08-23 — `server/routes/containers.ts` by `80edf7c63` and `server/routes/users.ts` by `e55ec8f82` — leaving them at 180 and 527 lines, both under the ceiling. Both commits are on `origin/main`; the handler directories they added are present in this checkout (`server/routes/containers`, `server/routes/users`). `server/routes/equipment.ts` is the only route file still over it.* EXCLUDE frozen/generated: `i18n.generated.d.ts` (generated), `metrics.ts`, `code-blue.ts`, `realtime.ts`, `auth.ts`, hand-built `i18n.ts`.

---

## Task Template

```markdown
### T-NNN / TASK-NNN: [Title]
**Priority:** `high` / `medium` / `low`
**Tier:** `S` / `S +R` / `O +R` / `Owner` (from plan card)
**Linked plan:** [phase-0-1 / phase-2-3 / subspec path + requirement id]

**What to do:**
[2–4 sentences. Prefer copying the plan card defect + GREEN direction.]

**Acceptance criteria:**
- [ ] RED then GREEN per plan card test file
- [ ] Card Verify command passes
- [ ] Proof logged in docs/audit/PROOF_ALIGNMENT_LOG.md
- [ ] No TODO comments in delivered code

**Files in scope:**
- (from plan card — ≤2 impl + 1 test unless mechanical mount fan-out)

**Files NOT in scope:**
- (from plan card guardrails)

**Notes:**
[Frozen doctrine, Tier review/drill gates]
```
