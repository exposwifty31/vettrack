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
> **This repo's open items for that program** (verified 2026-08-13):
>
> | Item | Owner | State |
> |---|---|---|
> | Run `pnpm seed:reviewer-demo` against **production** so the store reviewer sees real data (not empty lists) | Owner | ✅ **DONE 2026-08-11** — the demo-5roles fire seeded 5 isolated demo clinics (`reviewer-demo-clinic-*`) + 5 prod Clerk users, verified against prod (`vt_users`/`vt_shifts` counts). Credentials CSV in the job dir; **teardown owed** after the G3 on-device verdict |
> | Play App Signing SHA-256 → `server/lib/well-known-assetlinks.ts` + redeploy | Agent | blocked until the first AAB is uploaded |
> | The doctor-gate + reviewer-seed contract suites were named by no workflow — incl. the doctor-gate test that pins the provenance contract the RN app depends on (the RN client sends `source: "doctor_gate"` in the request body; the server persists it as `checkInSource`, which is the field the test asserts) | Agent | ✅ **CLOSED** — coverage by `7a3ad3a` (named files in `integration-ops`); the silent-skip hole in it closed separately: both suites are `describe.skipIf(!dbReachable)`, so an unset or unreachable `DATABASE_URL` made them skip with the step still green. `scripts/ci/db-integration-preflight.mjs` now runs before them and refuses that |
> | **The rest of that class is still open.** `vite.config.ts` excludes 10 entries from `pnpm test` (`tests/migrations/**` is a glob over 6 files); verified 2026-08-21 that **none** is named by any workflow: `tests/migrations/**`, `restock.service`, `shift-chat-window`, ~~`charge-alert-worker`, `code-blue-mode-equipment`, `equipment-scan-e2e`, `expiry-api`, `expiry-check-worker`, `returns-api`~~. Two of those touch **Code Blue / equipment scan**. *Corrected 2026-08-22:* those six — the whole live-server half, including both safety-critical ones — now run in CI's `live-server` job (`pnpm test:live-server`), which the merge gate depends on, and which gates on the reported assertion count rather than the exit code alone. **Three remain open:** `tests/migrations/**`, `restock.service` and `shift-chat-window` are DB-only and need a different setup; they are NOT covered. `tenant-pooling-isolation` is the one deliberate exclusion (real DDL — run via `test:rls-pooling`). Do not read the row above as "the class is handled" | Agent | open |
> | `tenant:lint` was `--warn-only` + `--touched` + `continue-on-error` | Agent | ✅ silent-gate **CLOSED**; baseline debt **open** — `pnpm tenant:lint:enforce` (`--all --baseline .tenant-lint-known-violations.json`) is a layer-3 evidence gate (`verify.config.json` `tenant-scope`) and a merge-blocking CI step (`ci.yml` "tenant query lint (new findings only)", no `continue-on-error`). Baseline on this tree: **203** findings across **138** `file::table` keys. The heuristic is unchanged (it still does not inspect the `.where()` chain), so the baseline is a freeze, not a proof of tenancy: a new leak fails, a leak already in the baseline does not |
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
- TASK: Split remaining >800-LOC files (repo ceiling). `admin.tsx` DONE (1656→219 + prop-less section files under `src/pages/admin/`). Next, modular/clean: `equipment-list.tsx` (1351 — extract `EquipmentItem` + desktop sub-sections). Monolithic/higher-risk (single cohesive component; needs real decomposition + visual-regression, do individually): `equipment-detail.tsx` (2075), `Tasks.tsx` (1590), `inventory-page.tsx` (1033), route files `containers.ts`/`users.ts`/`equipment.ts`. EXCLUDE frozen/generated: `i18n.generated.d.ts` (generated), `metrics.ts`, `code-blue.ts`, `realtime.ts`, `auth.ts`, hand-built `i18n.ts`.

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
