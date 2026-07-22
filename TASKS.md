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

_No tasks currently in progress. Pick the next Ready card (T-05 first)._

---

## Ready to Start — Phase 0A

> Execution order: **T-05 first**, then T-01…T-04 in any order.
> Full cards: `docs/plans/consolidated-audit-10x/phase-0-1.plan.md`
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
| **T-16** | **Phase 0 exit on-device drill** (blocks Phase 1) | blocked on T-01 + relevant 0B |

---

## Queued — Phase 1+ (do not start until T-16 passes)

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

- **T-16 / Phase 1+** — blocked until Phase 0A HIGH fixes + Owner 0B checks needed for the exit drill are done
- **Phase 4 massive-03 / medium-04** — owner entry conditions (see `phase-4.plan.md`)

---

## Completed

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
