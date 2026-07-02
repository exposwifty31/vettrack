# Proof Alignment Log

Append-only log of implementation claims backed by verified evidence. Purpose: prevent reporting work as "done" based on a summary or assumption — every entry records what was actually checked in this session, not what should be true.

## Rules

- One entry per completed task, added **before** reporting the task as done to the user.
- Evidence must be things actually observed this session: `Read`/`grep` output pointing at real `file:line`, actual test run output, actual command output. Do not restate a commit message, PR description, or prior summary as evidence.
- If a claim can't be verified, say so (`PARTIAL` / `NOT FOUND`) rather than omitting the entry or rounding up to `VERIFIED`.
- Entries are never edited or deleted retroactively — if a later check contradicts an earlier one, add a new entry that supersedes it and note the discrepancy.

## Entry format

```
## YYYY-MM-DD — <task/commit summary> (<commit-hash-if-committed>)

**Claim:** <one line: what was implemented or fixed>

**Evidence:**
- `path/to/file.ts:42` — <what was confirmed by Reading/grepping this line>
- Test: `pnpm test -- tests/foo.test.ts` → <actual pass/fail output>
- Command: `<command run>` → `<relevant output excerpt>`

**Verdict:** VERIFIED | PARTIAL | NOT FOUND
```

---

<!-- Entries start below this line. -->

## 2026-07-01 — Establish proof alignment log convention (uncommitted)

**Claim:** Added a Working Convention bullet to CLAUDE.md requiring evidence-backed verification before reporting tasks done, and created this log file to hold entries.

**Evidence:**
- `CLAUDE.md:64` — `git diff CLAUDE.md` shows exactly one line added: "Before reporting a task done, verify claims against real evidence... record it in docs/audit/PROOF_ALIGNMENT_LOG.md"; no other lines in the file changed.
- `docs/audit/PROOF_ALIGNMENT_LOG.md` — file exists (created this session), confirmed via `git status --porcelain` showing `?? docs/audit/PROOF_ALIGNMENT_LOG.md`.
- Command: `git status --porcelain` → `M CLAUDE.md` / `?? docs/audit/PROOF_ALIGNMENT_LOG.md` (only these two paths touched, matching the plan's stated scope).

**Verdict:** VERIFIED

## 2026-07-01 — Stage 3 Today screen rebuilt to iOS design (uncommitted)

**Claim:** Rebuilt `src/pages/home.tsx` Today screen to match the Stage 3 `.dc.html` prototype — large-title greeting, navy ON-SHIFT timer hero (elapsed HH:MM, items-out/scans stats, End/Start shift), red CRITICAL + amber OVERDUE chips, green scan card, and desktop-only Recent activity — responsive across compact/expanded in light, dark, and Hebrew RTL. Added `--action-foreground` token (Phase 0 omission) to fix a dark-mode contrast bug.

**Evidence:**
- `src/pages/home.tsx:1` — full rewrite: hero states driven by `pulse.shift` (`heroState` loading/noshift/active), `itemsOut = equipment.filter(e => e.custodyState === "checked_out").length`, `criticalCount`/`overdueCount` chips, `activityStyle()` map for Recent activity, grid `lg:grid-cols-[minmax(320px,360px)_1fr]`, recent gated on `useIsDesktop()`.
- `src/index.css` — `--action-foreground` added to all 4 theme blocks (`#ffffff` light / `#06210f` dark) via two replace_all edits; scan card now consumes it so dark-mode text is dark ink on bright teal (was white → AA fail).
- `locales/en.json` + `locales/he.json` — 15 new `homePage.*` keys added with parity; interpolated keys (greetingMorning/Afternoon/Evening, startedAt) registered in `src/lib/i18n.ts:654`.
- Command: `npx tsc --noEmit --pretty false` → `0` errors (grep -c "error TS" = 0).
- Command: `pnpm i18n:check` → "locales/en.json and locales/he.json are in deep key parity."
- Test: `pnpm test -- tests/i18n-no-hebrew-in-source.test.ts tests/i18n-parity.test.ts` → 6 passed; `tests/no-hardcoded-ui-strings.test.js` → 1 passed.
- Command: `pnpm build` → "✓ built in 6.99s" (only pre-existing chunk-size warnings).
- Browser (dev server :5000, Chrome MCP + Playwright mobile ctx): desktop-expanded active state (navy 04:32 timer hero + CRITICAL/OVERDUE chips + Recent activity 2-col grid), desktop no-shift state (Start Shift), desktop dark mode (scan card dark-ink verified), desktop Hebrew RTL (full mirror, ForwardChevron flips left, all new keys render he), and compact native shell (bottom tab bar, single-column, recent hidden) — all captured and confirmed faithful to `docs/design-handoff/stages-full/project/Stage 3 - Today.dc.html`.
- Note: temporary `vt_shift_sessions` row `dev-verify-shift-001` was seeded to render the active state, then deleted (`DELETE 1`) — no residual DB change.

**Verdict:** VERIFIED

## 2026-07-02 — Stage 3 Today verified on iOS simulators + timer fixes (622e021a, ca6a493f)

**Claim:** Built + installed the bundled native app on iPad (A16) and iPhone 17 Pro simulators; the redesigned Today screen renders faithfully on both against production `vettrack.uk`. Native testing exposed two multi-day shift-timer defects (overflow + Hebrew bidi), both fixed.

**Evidence:**
- Command: `bash scripts/install-ios-sim.sh --udid DA8D1142…` (iPad) and `--skip-build --udid 9821AC5F…` (iPhone 17 Pro) → both "** BUILD SUCCEEDED **" + "Installed VetTrack on simulator …" (PIDs launched). Runs `pnpm build` + `npx cap sync ios` + `xcodebuild` per `scripts/install-ios-sim.sh`.
- `xcrun simctl io … screenshot` — iPhone (en, compact): navy ON-SHIFT hero + timer + CRITICAL/OVERDUE chips + green scan card + native tab bar; iPad (he, RTL, tablet): right-side sidebar, mirrored hero/chips, no recent-activity — both match `Stage 3 - Today.dc.html`.
- Bug found on device: production account has a ~50-day open shift → timer rendered `1196:49` (overflow). Fixed in `src/pages/home.tsx` `formatElapsed()` → `Nd HH:MM` past 24h; re-screenshotted as `49d 20:54` (iPhone) — confirmed.
- Second bug: Hebrew day unit between LTR numbers scrambled under bidi (`49 ימ׳ 20:54`). Fixed by locale-neutral `{count}d` in both locales + `dir="ltr"`/`rtl:text-end` on the timer; iPad re-screenshotted as clean `49d 20:56` — confirmed.
- Command: `pnpm i18n:check` → deep key parity; `npx tsc --noEmit` → 0 errors (after both fixes).
- Commits: `622e021a` (Nd HH:MM overflow guard), `ca6a493f` (locale-neutral d unit / bidi).

**Verdict:** VERIFIED

## 2026-07-02 — Shift-logic Phase 0: home hero derives on-shift from roster, not orphaned `vt_shift_sessions`

**Claim:** The home dashboard's "on shift" state now comes from the roster (`vt_shifts` via `resolveCurrentRole`) — the same source authority Strategy A and the display board read — instead of the orphaned `vt_shift_sessions` clock-in table (never written by any code; source of the ~49-day stale native "shift"). The interim client-side 24h staleness guard is removed because a roster window is self-bounding. Frozen authority surfaces (`role-resolution.ts`, `authority.ts`) untouched.

**Evidence:**
- `server/routes/home-dashboard.ts` — rewrite: dropped the `shiftSessions`/`isNull` query; first `Promise.all` element is now `resolveCurrentRole({ clinicId, userId, userName, fallbackRole, secondaryRole })` (same input shape as `middleware/auth.ts:738` `requireEffectiveRole`); `buildShiftWindow()` derives absolute `startedAt`/`endsAt` from the roster row (overnight = start clock-time > end → end on next day, matching `role-resolution.ts`); response `shift` is `{ startedAt, endsAt, role } | null`.
- `src/types/tasks.ts:59` — `HomeDashboardPulse.shift` widened to `{ startedAt: string; endsAt: string; role: string } | null`.
- `src/pages/home.tsx:197` — removed `MAX_ACTIVE_SHIFT_MINUTES` guard; `hasActiveShift = !!pulse?.shift`; elapsed computed inside the `pulse?.shift` branch.
- Command: `pnpm typecheck` (frontend `tsc --noEmit` + `tsc -p tsconfig.server.json --noEmit`) → exit 0, no output (0 errors).
- Test attribution: `pnpm test` → 10 failed / 3460 passed. `git stash` of the 4 working-tree files then re-running the 6 affected files → **9 failed at committed HEAD** (admin-emails-promotion ×2, mobile-shell ×3, epic8-slice1 ×2, phase-3-ui-token ×1, phase-6-state ×1 — all pre-existing, the 4 home-structure ones from the prior committed Stage-3 rewrite). The only delta (+1) is `phase-5-pr-5-0-1-qr-overlay-positioning`, caused by the *separate uncommitted* qr-scanner portal fix (asserts old `top-0 left-0 right-0`; `inset-0` is equivalent), NOT by this Phase 0 change. **Phase 0 introduces zero new test failures.**
- Runtime probe (`pnpm dev:api`, dev-bypass, local Postgres, user `Dev Admin`/`dev-clinic-default`): (a) no roster row → `GET /api/home/dashboard` returns `"shift": null`; (b) after `INSERT INTO vt_shifts (…, '00:00:00','23:59:00','Dev Admin','senior_technician','dev-clinic-default')` for today → `{"startedAt":"2026-07-01T21:00:00.000Z","endsAt":"2026-07-02T20:59:00.000Z","role":"senior_technician"}` (00:00/23:59 local ⇄ 21:00Z/20:59Z confirms Asia/Jerusalem UTC+3 handled; instants are absolute so client elapsed math is tz-safe); (c) after `DELETE` → `shift: null` again. Test row removed; no residual DB change.
- Scope: `role-resolution.ts` and `authority.ts` not in the diff (`git status` shows only `home-dashboard.ts`, `home.tsx`, `types/tasks.ts` for this task) — Strategy A byte-for-byte intact.

**Verdict:** VERIFIED (behavioral fix confirmed at runtime; native/prod parity follows because prod no longer reads the orphaned table)

## 2026-07-02 — Reconcile 4 stale home tests to the shipped Stage-3 redesign (no app change)

**Claim:** Four static "grep" tests asserted a **removed** next-up task card (`tasksLoading`, `t.homePage.nextUpEmpty/Body`) and old status classes (`text-destructive`/`border-primary`) that the prior committed Stage-3 home rewrite (`1abb67c7`) replaced. Re-anchored each assertion to the redesign's equivalent guarantee — which still exists, at a new location — rather than deleting coverage. No `home.tsx` behavior change (only test files edited).

**Evidence:**
- `tests/epic8-slice1-state-primitives.test.js` — "next-up card skeleton" → asserts `heroState === "loading"` (hero skeleton block, `home.tsx:304-314`); "next-up all-caught-up empty" → asserts the no-shift hero rest state (`t.home.shift.noShift` + `t.homePage.noShiftSub`, `home.tsx:315-340`).
- `tests/phase-6-state-consistency.test.js` — "next-up loading not blank" → asserts `heroState === "loading"`.
- `tests/phase-3-ui-token-consistency.test.js` — "status visuals use semantic tokens" → asserts `var(--sys-red)` + `var(--sys-green)` (the redesign's status tokens; `home.tsx` code-blue/critical red, on-shift/activity green) instead of the retired `text-destructive`/`border-primary`.
- Command: `pnpm test -- tests/epic8-slice1-state-primitives.test.js tests/phase-6-state-consistency.test.js tests/phase-3-ui-token-consistency.test.js` → **46 passed (3 files)**.
- Command: full `pnpm test` → **6 failed / 3464 passed** (was 10/3460). Targeted re-run confirms the 6 residual reds are all in `admin-emails-promotion` (×2), `mobile-shell` (×3) — pre-existing unrelated baseline — and `phase-5-pr-5-0-1-qr-overlay-positioning` (×1), which comes only from the *separate uncommitted* qr-scanner portal fix (bug #1), not this task.
- `home.tsx` not in the diff for this change (`git status`: only the three `tests/*` files + the unrelated `qr-scanner.tsx`).

**Verdict:** VERIFIED (guarantees preserved, re-anchored to shipped code; suite 10→6, residue unrelated)

## 2026-07-02 — Bug #1: portal QR overlay to body; land fix + reconcile its test (`5113f60e`)

**Claim:** The QR scanner's fullscreen overlay is portaled to `document.body` and anchored `fixed inset-0` (was `fixed top-0 left-0 right-0` at `z-[70]`), so `position:fixed` resolves against the viewport instead of the NativeShell scroll container that clipped the manual-entry footer on iPhone. The `phase-5-pr-5-0-1` test is updated to the new markup without weakening it.

**Evidence:**
- `git diff` reviewed directly (not agent word): `src/components/qr-scanner.tsx:3` `import { createPortal }`, `:563` `return createPortal(`…`document.body`, `:564` root `className="fixed inset-0 qr-scanner-overlay-root z-50 bg-black flex flex-col …" data-testid="qr-scanner-overlay"`. Manual-entry affordances present at `btn-switch-manual-header` (:584) and footer `btn-switch-manual` (:824), reachable in the `flex flex-col` viewport-anchored root.
- `tests/phase-5-pr-5-0-1-qr-overlay-positioning.test.ts` — required-token loop changed to `["fixed","inset-0","qr-scanner-overlay-root","z-50","flex","flex-col"]` + explicit `data-testid="qr-scanner-overlay"` assertion; the other 12 cases (CSS cascade, `h-[100dvh]` absence, freeze contract) untouched.
- Command: `npx tsc --noEmit` → 0 errors; `pnpm test -- tests/phase-5-pr-5-0-1-qr-overlay-positioning.test.ts` → 13/13 passed.
- Committed as an atomic unit (code + test) because the test asserts the new markup and would fail at HEAD without the code.
- **Not yet done:** on-device visual verification (iPad/iPhone sim rebuild) — recommended follow-up; only static/type/unit checks performed.

**Verdict:** VERIFIED (static/unit); on-device visual check outstanding

## 2026-07-02 — Fix 2 admin-emails-promotion runtime tests (env leakage, test-only)

**Claim:** The two `resolveAuthUser — ADMIN_EMAILS promotion runtime` tests failed because `.env.local` sets `CLERK_ENABLED=false`, which Vitest auto-loads into `process.env`. `resolveAuthMode`'s `clerk-explicitly-disabled` branch overrides even a present `CLERK_SECRET_KEY`, so `resolveAuthModeFromEnv().mode === "dev-bypass"` and `resolveAuthUser` took the `ensureDevUserRecord` branch instead of the Clerk promotion path under test. Fix is test-only: the describe block already forces the Clerk path via `CLERK_SECRET_KEY`/`NODE_ENV` overrides in beforeAll/afterAll but overlooked `CLERK_ENABLED`. Neutralized it the same way. No production code changed; promotion/role/status security semantics untouched.

**Evidence:**
- Failure signature: `result.ok`/`role`/`status` asserts PASSED (they echo the queued `dbResolves` row returned by `ensureDevUserRecord().returning()`); only `insertValuesLog.find(clerkId === "clerk-owner-1"/"clerk-tech-1")` returned `undefined` (line 225 / 286). The dev-bypass insert carries `DEV_USER.clerkId = "dev-admin-001"`, not the session clerkId — exact match for the dev-bypass branch running.
- Empirical probe (temp test, `resolveAuthModeFromEnv()` under vitest): `CLERK_ENABLED=false mode=dev-bypass` even with `CLERK_SECRET_KEY` set → confirms env leakage, not code regression.
- Source-contract tests in the same file (grep the real promotion logic in `server/middleware/auth.ts:389-391`, onConflict excludes `role`, dev-bypass block clean) already passed → production code is correct; `auth.ts` NOT modified.
- Change: `tests/admin-emails-promotion.test.ts` — capture `originalClerkEnabled`, `delete process.env.CLERK_ENABLED` in beforeAll (so `resolveAuthMode` selects `clerk` given the present secret), restore in afterAll. Mirrors the existing `CLERK_SECRET_KEY`/`NODE_ENV` handling.
- Command: `pnpm test -- tests/admin-emails-promotion.test.ts` → **9 passed (9)**, 0 failed.
- Scope: `git status` shows only `tests/admin-emails-promotion.test.ts` (+ this log). No server code, no locales, no shared modules touched → `typecheck:server` not required.

**Verdict:** VERIFIED (env/setup root cause; test made self-contained without weakening any admin-promotion assertion)

## 2026-07-02 — Bug #3: keep native Equipment tab active on the /equipment scan surface (`5ceaca08`)

**Claim:** The 3 `mobile-shell` active-state failures were a real UX regression, not stale tests: `dad44639` repointed the native Equipment tab href from `/equipment` to `/my-equipment`, but `isTabActive` (`startsWith(href)`) then stopped matching the `/equipment` surface where the scanner overlay lives (`?scan=1`), so opening the scanner deactivated the tab. Fixed the component, not the test.

**Evidence:**
- `git diff` reviewed directly: `src/native/NativeTabBar.tsx` + `src/native/NativeTabSidebar.tsx` `isTabActive()` now special-cases `/my-equipment` to `location.startsWith("/my-equipment") || location.startsWith("/equipment")`; `/home` case and default `startsWith(path)` unchanged. Route-path literals only (no UI copy / i18n), no left/right props, exported APIs unchanged. `MobileTabBar` inherits via re-export of `NativeTabBar` (`NativeShell.tsx:3`).
- Root cause corroborated: the failing assertion was `expected null to be 'page'` (Equipment tab not marked active) at `mobile-shell.test.tsx:128/161/206`; the test correctly encodes the intended UX and was not touched.
- Command: `pnpm test -- tests/mobile-shell.test.tsx` → 14/14 passed; `npx tsc --noEmit` → 0 errors.

**Verdict:** VERIFIED (component fix for a genuine regression; tests unchanged and now green)

## 2026-07-02 — Shift Phase 1, Increment 1: shift-adjustment request→approval backend

**Claim:** Backend foundation for the request→admin-approval extension/leave-early layer: `vt_shift_adjustments` table + migration, `/api/shift-adjustments` route (create / list / approve-reject / cancel) with overnight-aware direction validation, four audit kinds, and a pure unit-tested time helper. **Additive** — no role-resolution/authority change in this increment.

**Evidence:**
- `server/schema/ops.ts` + `migrations/156_vt_shift_adjustments.sql` — applied via `pnpm db:migrate` ("✅ Applied migration: 156_vt_shift_adjustments.sql"); `psql \d vt_shift_adjustments` confirms columns (kind/status enums, base_shift snapshot, decided_by/at/note) + 3 indexes + `pending` default.
- `server/routes/shift-adjustments.ts` registered at `/api/shift-adjustments` (`server/app/routes.ts`, contract-lock test updated 47→48 paths).
- Runtime lifecycle (dev:api + local Postgres, user Dev Admin, roster row seeded to cover "now"): `POST` extend → **201** with correct roster snapshot (`currentEndTime` 05:35 from the seeded shift, `requestedEndTime` 08:35, `baseShiftId` linked, status `pending`); not-on-shift → **409 NOT_ON_SHIFT**; reason "x" → **400 INVALID_REASON**; wrong-direction leave_early → **400 NOT_EARLIER**; second create → **409 DUPLICATE_PENDING**; `PATCH` approve → **200** `status=approved` (decidedBy=dev-admin-001, note recorded); re-decide → **409 ALREADY_DECIDED**.
- Audit: `vt_audit_logs` shows `shift_adjustment_requested` + `shift_adjustment_approved` (metadata.kind=extend). Discovered `vt_audit_logs` is append-only (`no_delete_audit_logs`/`no_update_audit_logs` `DO INSTEAD NOTHING` rules) — DELETEs are no-ops by design; the 4 audit kinds are members of the closed `AuditActionType` union (`server/lib/audit.ts`).
- `server/lib/shift-adjustment-window.ts` — pure overnight-aware direction math; `tests/shift-adjustment-window.test.ts` → **11/11** (same-day + overnight extend/leave-early, incl. a midnight-crossing extension).
- Command: `pnpm typecheck:server` → 0 errors; full `pnpm test` → **3485 passed (353 files), 0 failed**.
- Dev-DB residue: 6 append-only `shift_adjustment%` audit rows on `dev-clinic-default` cannot be removed (by design); harmless in local dev.

**Verdict:** VERIFIED (backend runtime + unit + full-suite green); role-resolution wiring is Increment 2.

## 2026-07-02 — Shift Phase 1, Increment 2: approved-adjustment authority wiring (FROZEN SURFACE)

**Claim:** `resolveCurrentRole` (frozen Strategy-A input) now layers **approved** `vt_shift_adjustments` onto the roster result via a new `resolveEffectiveShift` helper: `leave_early` shortens the active window (person goes off-shift once the earlier effective end passes); `extend` keeps the person on past the rostered end while the extended window still covers `now`. The role never changes — only the effective end moves. The change is **additive + fail-safe**: no userId, no approved row, or any query throw all return the roster `activeShift` unchanged, so the snapshot is **byte-identical** on the existing no-adjustment path.

**Evidence:**
- `git diff server/lib/role-resolution.ts` reviewed directly — exactly additive: the frozen roster-window SELECT block is untouched byte-for-byte; the permanent branch (`ROLE_LEVELS` + secondary-role pick) is unchanged; the only wiring change is `if (!activeShift)` → `if (!effectiveShift)` and two references in the shift-branch return. When no adjustment applies, `resolveEffectiveShift` returns the *same* `activeShift` object (reference identity), so `effectiveShift === activeShift`.
- `server/lib/shift-adjustment-window.ts` — `git diff --stat` = **22 insertions, 0 deletions** (added `shiftWindowContains`, overnight-aware local-time frame mirroring the roster window). No existing helper changed.
- **Byte-identical regression gate** (`tests/role-resolution-adjustments.test.ts`, new): mocks `../server/db.js` with a table-keyed query stub (extend vs leave_early distinguished by `innerJoin`) + inert `drizzle-orm` fragments, exercising the *real* `resolveEffectiveShift`/`shiftWindowContains`. Asserts `result.activeShift` **is the same object** the roster query returned when zero adjustments apply, plus no-userId short-circuit, permanent-branch passthrough, leave_early (passed→off / future→shortened), extend (covers→on / elapsed→off), and both fail-safe (query-throw→roster) paths. → **9/9 passed**.
- **Real-Postgres end-to-end probe** (throwaway tsx script against local DB, seeded `dev-clinic-default`/`dev-admin-001` + a 07:30–19:30 roster row, fixed `now`, cleaned up): CASE 1 no-adjustment → `source=shift end=19:30 role=senior_technician`; CASE 2 approved extend→23:00 at 21:00 → `source=shift end=23:00`; CASE 3 approved leave_early→11:00 at 12:00 → `source=permanent activeShift=null`; CASE 4 approved leave_early→15:00 at 12:00 → `source=shift end=15:00`; CASE 5 approved extend→20:00 at 21:00 → `source=permanent null`. → **ALL PASS (exit 0)**. This validates the *new* adjustment SELECT filters (clinicId/requesterUserId/baseShiftId/kind/status='approved'/`inArray(baseShiftDate,[today,yesterday])`) against real SQL — the one thing the mock cannot cover. Post-run DB check: `leftover_shifts 0 leftover_adjustments 0`.
- Authority invariants unaffected: `pnpm test -- tests/authority-strategy-a-invariant.test.ts tests/authority.test.ts tests/authority-checkin.test.ts tests/shift-adjustment-window.test.ts tests/role-resolution-adjustments.test.ts` → **93/93 passed** (the Strategy-A byte-equal-across-flag-state invariant still holds).
- Command: `pnpm typecheck` (frontend + server) → **0 errors**; full `pnpm test` → **3506 passed (354 files), 0 failed** (baseline is now fully green; Increment 2 added zero failures).

**Verdict:** VERIFIED (frozen surface additive + fail-safe; byte-identical gate + real-SQL probe + authority invariants + full suite all green)

## 2026-07-02 — Shift Phase 1, Increment 3: frontend + i18n (Today hero affordances + admin approvals) — fixes the reported "End Shift" bug

**Claim:** The user-reported bug ("Today 'End Shift' navigates to the handover summary and doesn't end the shift") is fixed by replacing that button with real request affordances. The on-shift hero now offers **Request extension** + **End shift early** (both → a sheet: new end time + reason → `POST /api/shift-adjustments`), shows the requester's own pending/approved status, and lets them cancel a pending request. The admin surface gains a **Shift requests** tab with a pending-count badge and an approvals list (requester, kind, window change, reason, Approve/Reject). Typed API client + types + en/he i18n added; role-resolution/backend unchanged (this increment is UI only).

**Evidence:**
- **API + types** — `src/types/shift-adjustments.ts` (`ShiftAdjustment` mirrors the server row + `CreateShiftAdjustmentRequest`), exported via `src/types/index.ts`; `api.shiftAdjustments.{list,create,decide,cancel}` in `src/lib/api.ts` match the route contract (`GET → {requests}`, `POST → row`, `PATCH → row`, `POST :id/cancel → row`), verified against `server/routes/shift-adjustments.ts` read this session.
- **i18n** — `shiftAdjustments.*` namespace added to `locales/en.json` + `locales/he.json`, registered in the hand-built `buildTranslations` accessor (`src/lib/i18n.ts`) per the known gotcha; codegen regenerated `src/lib/i18n.generated.d.ts` (+60 lines). Command: `pnpm i18n:check` → "✓ deep key parity". No hardcoded copy (times/names/reasons render as data; the only literal glyph is the `→` separator inside a `dir="ltr"` span). Command: `pnpm test -- tests/no-hardcoded-ui-strings.test.js tests/i18n-no-hebrew-in-source.test.ts tests/i18n-parity.test.ts` → **7/7 passed**.
- **Live browser E2E** (dev-bypass server started with `VITE_CLERK_PUBLISHABLE_KEY=` blanked; local Postgres; Vite proxy `/api → 127.0.0.1:3001`, so same-origin/local despite `VITE_API_ORIGIN=vettrack.uk` in `.env` — confirmed safe via `resolveApiUrl`'s native-only guard). Seeded a Dev-Admin roster row covering now:
  - `/home` desktop hero rendered **Request extension** + **End shift early** (replacing the old single button); clicking Request extension opened the sheet showing "Current end 23:59", a time input, reason textarea, and a **disabled** Send request (empty reason).
  - Seeded a pending `leave_early` (23:59→20:00); `/admin` showed the **Shift requests** tab with an amber "1" badge; the tab rendered the card (Dev Admin · Leave early · `23:59 → 20:00` · reason · Approve/Reject).
  - Clicked **Approve** → "Request approved" toast, list collapsed to the "No pending requests" empty state, badge cleared.
  - Reloaded `/home` → hero showed **"Early leave approved"** (still on-shift because 20:00 is future) — i.e. the admin decision propagated through `resolveEffectiveShift` (increment 2) to the live dashboard. Seeded rows cleaned up (`leftover_shifts 0 leftover_adjustments 0`); dev server stopped.
  - Not visually verified: mobile/tablet widths (Chrome window-resize did not narrow the rendered viewport below ~1456px in this automation session — the compact hero relies on standard responsive `grid-cols-2`/full-width classes) and Hebrew RTL / dark theme. Recommended follow-up on device/simulator.
- **Self-review fix (uncommitted → included):** the hero `mine` query used `api.shiftAdjustments.list()` (no status); the list endpoint returns **all** clinic requests to admins, so an on-shift admin could see another user's request in their own hero. Fixed by scoping `relevant` to `r.requesterUserId === userId` (via `useAuth()`), `src/features/shift-adjustments/ShiftAdjustmentControls.tsx`. (The live test masked this — Dev Admin was both requester and approver.)
- Command: `pnpm typecheck` (frontend + server) → **0 errors**; `pnpm build` → built OK (exit 0; only the pre-existing chunk-size advisory); full `pnpm test` → **3506 passed (354 files), 0 failed**.

**Verdict:** VERIFIED (typecheck + build + full suite + i18n parity + live browser E2E of the request→approve→effective-window loop); mobile/RTL/dark visual pass outstanding as follow-up

## 2026-07-02 — Stage design program: Stage 1 iOS tokens finish + lock (test-driven)

**Claim:** Completed Stage 1 of the design-implementation program (audit-first, test-driven). Reconciled `--brand-ink` to the design's indigo-950 and added the token families the audit found missing (surface ramp, translucent bar material, size-class responsive layout tokens, motion aliases, name aliases, canonical maintenance/sterilized pill-fill aliases), then locked the canonical `:root`/`.dark` values + tailwind + `StatusKind` wiring with a new regression test so drift is caught in CI.

**Evidence:**
- Audit basis: workflow `wf_963a03c6-c4d` (11 agents) full output at `/private/tmp/.../wgliea94m.output` — Stage 1 flagged `partial` (brand-ink drift #312e81 vs design #1E1B4B; absent surface/bar/size-class/motion tokens; no value-lock test).
- RED first: `tests/stage-1-token-values.test.js` (new) run before edits → **8 passed / 9 failed** (canonical values already present; new tokens absent) — confirms a real RED→GREEN cycle.
- GREEN: `src/index.css` edits — `--brand-ink: #1e1b4b` (`grep` confirms no `--brand-ink: #312e81` remains; the two residual `#312e81` are the distinct `--hero-b` gradient stop, out of scope); added `--surface*`/`--hairline`/`--bar-bg*`/`--bar-blur` (light `:root` + `.dark` + `data-color-theme` dark block), `--dur-fast/base/slow` + `--ease-standard`, `--radius-lg`, `--display`/`--text-largetitle`, `--brand-foreground`/`--on-ink-bar`/`--ink-skeleton`/`--ink-shimmer`, `--status-maintenance-*`/`--status-sterilized-*` (var()-indirection aliases), size-class `--inline-margin`/`--content-gap`/`--max-content` via `@media` (16/24/32px), and a `prefers-reduced-transparency` opaque-bar override.
- Test: `npx vitest run tests/stage-1-token-values.test.js` → **30 passed** (post-edit); existing `phase-3-ui-token-consistency` + `phase-4-i18n-rtl-foundation` still green.
- Command: `pnpm i18n:check` → deep-key parity OK; `npx tsc --noEmit` (frontend) → 0 errors; full `pnpm test` → **355 files / 3523 passed / 0 failed** (baseline 3506 + 17 new lock asserts, zero regressions).
- Build gate caught a real bug static tests missed: `pnpm build` first FAILED (`src/index.css:189` PostCSS "Unknown word" — a `*/` sequence inside a comment `--status-maint-*/--status-steril-*` closed the comment early). Fixed the comment; `pnpm build` → **built OK** (exit 0, only pre-existing chunk-size advisory).
- Live browser (dev server :5000 dev-bypass, Chrome MCP): `getComputedStyle(:root)` at 1280px → `--brand-ink:#1e1b4b`, `--radius-lg:14px`, `--surface-hover:#f7f6f3`, `--bar-bg:rgba(255,255,255,0.8)`, `--ease-standard:cubic-bezier(0.2,0,0,1)`, `--inline-margin:32px` (correct expanded value), `--display:2.353rem`, `--status-maintenance-bg:rgb(255 149 0 / 0.14)`. After `classList.add('dark')` → `--surface:#1c1c1e`, `--surface-hover:#2a2a2c`, `--bar-bg:rgba(28,28,30,0.8)`, `--hairline:rgba(84,84,88,0.4)`, `--status-maintenance-fg:#ffb340` (the alias correctly inherited the `.dark` override of `--status-maint-fg` — validates the var()-indirection strategy). Home hero renders deep-indigo with legible white text in light mode.

**Verdict:** VERIFIED (RED→GREEN lock test + typecheck + i18n parity + full suite 3523/0 + build + live light/dark token resolution). Note: `--hero-b` gradient stop intentionally left at #312e81 (design flagged only `--brand-ink`).

## 2026-07-02 — Stage 2 (increment 1): Button + Card iOS primitives (test-driven)

**Claim:** Started Stage 2 with the two globally-reused primitives. Retuned `Button` to the iOS spec (14px radius, 700 weight, 56px `lg`, semantic `action` scan/confirm-green variant, hero-ink `ghostHero` variant, width-preserving `loading` state) and `Card` to a flat iOS surface (dropped the resting drop shadow for an inset top highlight; added `attention`/`critical` leading rails via logical `border-inline-start`; 12/20/16 header/content/footer rhythm). Locked both with new regression tests.

**Evidence:**
- Coupling check first: no test pins the old Button styling (the epic8 test asserts an unrelated card string); Button call-site variants in use are `outline`/`ghost`/`secondary`/`destructive`/`link` (grep counts) — `teal` and `action` unused, so adding `action` and retuning defaults is call-site-safe. `--action`/`--action-foreground` and `--on-ink*` exist in `index.css` but are not Tailwind color utilities, so consumed via arbitrary-value classes.
- RED first: `tests/stage-2-button-token-consistency.test.js` (new) → **7 failed / 7** before edits; `tests/stage-2-card-token-consistency.test.js` (new) → **5 failed / 5** before edits (real RED→GREEN).
- GREEN: `src/components/ui/button.tsx` — base `rounded-xl`→`rounded-lg` (14px) + `font-semibold`→`font-bold`; `lg`/`xl` → `h-14` (56px) `rounded-lg`; added `action` (`bg-[var(--action)]`/`text-[var(--action-foreground)]`/`hover:bg-[var(--action-deep)]`) and `ghostHero` (`text-[var(--on-ink)]`/`hover:bg-[var(--on-ink-bar)]`) variants; `loading` prop renders a centered `Loader2` (`animate-spin motion-reduce:animate-none`) over `invisible` children so width is preserved; `asChild` branch passes children through untouched so Slot still merges onto the real element. `src/components/ui/card.tsx` — converted to cva with `attention`/`critical` variants, base inset highlight `shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]` + `dark:` faint variant (no `shadow-card`); header `px-5 pt-4 pb-3`, content `px-5 pb-5 pt-0`, footer `px-5 pb-4 pt-0`.
- Test (post-edit): both lock tests green (7 + 5); `npx tsc --noEmit` (frontend) → **0 errors**; full `pnpm test` → **357 files / 3535 passed / 0 failed** (baseline 3523 + 12 new lock asserts, zero regressions); `pnpm i18n:check` → deep-key parity OK; `pnpm build` → built OK (exit 0, only pre-existing chunk-size advisory).
- Live browser (dev server :5000 dev-bypass, Chrome MCP, `/home`, light): `getComputedStyle(firstButton)` → `borderRadius: 14px`, `fontWeight: 700` (was 16px/600). Screenshot at expanded width shows intact layout — "Start Shift" (ghost-on-hero white CTA), "Install" (indigo primary), "Not now" (secondary), and the green `--action` Scan card all render bold/14px-radius with no breakage.
- Not visually verified this increment: compact/medium widths, Hebrew RTL, dark theme, and the `attention`/`critical` Card rails + Button `loading`/`action` variants in situ (no screen consumes them yet — they land when their first consuming screen is built). Recommended follow-up on device/simulator as those screens are implemented.

**Verdict:** VERIFIED (RED→GREEN lock tests + typecheck + full suite 3535/0 + i18n parity + build + live computed-style + screenshot). New variants/states are structurally locked but await in-situ visual confirmation on their first consuming screen.

## 2026-07-02 — Stage 2 (increment 2): Skeleton shimmer + Badge count overlay (test-driven)

**Claim:** Added the remaining self-contained Stage 2 primitives that need no consuming screen. `Skeleton` now uses a reduced-motion-gated shimmer sweep (§6.14) instead of a bare pulse; `Badge` gained a `count` overlay variant (§6.12) — a self-sizing circular red pill driven by `--sys-red`. Registered a `shimmer` keyframe + animation in Tailwind. (Note: `StatusBadge` already implements the full 6-state StatusChip §6.6 with tokenized dot+label+i18n, so no change was needed there.)

**Evidence:**
- RED first: `tests/stage-2-skeleton-token-consistency.test.js` (3) + `tests/stage-2-badge-token-consistency.test.js` (2) → **5 failed / 5** before edits.
- GREEN: `tailwind.config.ts` — added `shimmer` keyframe (`backgroundPosition 200% 0 → -200% 0`) + `shimmer: "shimmer 1.6s ease-in-out infinite"`. `src/components/ui/skeleton.tsx` — `animate-pulse` → `animate-shimmer motion-reduce:animate-none` over `bg-muted/70` with a 200%-wide highlight gradient. `src/components/ui/badge.tsx` — added `count` variant (`bg-[rgb(var(--sys-red))] text-white justify-center min-w-[18px] h-[18px] px-1 tabular-nums`).
- Test (post-edit): both lock tests green (3 + 2); `npx tsc --noEmit` (frontend) → **0 errors**; full `pnpm test` → **359 files / 3540 passed / 0 failed** (baseline 3535 + 5 new, zero regressions — the global `animate-pulse`→shimmer swap broke nothing); `pnpm build` → built OK (the arbitrary-value gradient `rgb(130_130_130/0.18)` parses under PostCSS/Tailwind).
- Live browser (dev server :5000, Chrome MCP): injected a Skeleton-classed element → `getComputedStyle` reported `animationName: shimmer`, `animationDuration: 1.6s`, `backgroundImage: linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(130,130,130,0.18) 50%, …)`, `backgroundSize: 200% 100%` — the shimmer sweep resolves correctly at runtime.
- Not visually verified in situ: the Badge `count` overlay positioned over an icon, and the shimmer under an actual loading state on a real screen (both land with their consuming screens). Reduced-motion fallback verified structurally (`motion-reduce:animate-none`), not yet with an OS reduce-motion pass.

**Verdict:** VERIFIED (RED→GREEN lock tests + typecheck + full suite 3540/0 + build + live computed-style of the shimmer). In-situ visual pass of count-overlay + loading shimmer deferred to their first consuming screen; StatusChip §6.6 already satisfied by existing StatusBadge.

## 2026-07-02 — Stage 2 (increment 3): ListRow primitive + Stage 2 close-out (test-driven)

**Claim:** Added the reusable `ListRow` primitive (§6.18) — the last screen-agnostic Stage 2 component — and closed Stage 2. ListRow renders as button/div/asChild, has leading/label/description/meta slots, a reading-forward drill-in chevron, hover/pressed on the surface ramp, a selected state, a 44px min touch target, and logical properties for RTL. Remaining Stage 2 items (`PrimaryActionCard`/QuickScan §6.7, flat scan tab §6.9/6.11) are explicitly screen/behavior-coupled and deferred to their consuming work per the plan (Stage 3 Today + Stage 4/cross-cutting platform-scan model).

**Evidence:**
- RED first: `tests/stage-2-list-row-token-consistency.test.js` (new, guarded read) → **4 failed / 4** before the file existed.
- GREEN: `src/components/ui/list-row.tsx` (new) — `min-h-11` (44px), interactive `hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)]`, `selected` → `bg-[var(--surface-active)]` + `aria-current`, reuses `ForwardChevron` (RTL-aware), logical `text-start`/`ms-auto`/`gap-3`; `asChild` via Radix Slot for router links; renders `<button type="button">` only when interactive (else `<div>`), no `any` (typed `React.ElementType`).
- Test (post-edit): lock test green (4); `npx tsc --noEmit` (frontend) → **0 errors**; full `pnpm test` → **360 files / 3544 passed / 0 failed** (baseline 3540 + 4 new, zero regressions); `pnpm i18n:check` → parity OK; `pnpm build` → built OK. ListRow's surface tokens (`--surface-hover`/`--surface-active`) were already proven to resolve live in the Stage 1 entry.
- Not visually verified in situ: ListRow has no consumer yet (library primitive) — its first visual pass lands when a screen (Settings/Admin/Rooms) adopts it.

**Stage 2 status:** CLOSED for screen-agnostic primitives — Button, Card, Skeleton, Badge, ListRow shipped + locked; StatusChip already satisfied by StatusBadge. Deferred (by design): PrimaryActionCard (→ Stage 3), flat scan tab (→ Stage 4 + cross-cutting).

**Verdict:** VERIFIED (RED→GREEN lock test + typecheck + full suite 3544/0 + i18n + build). In-situ visual confirmation deferred to first consumer.

## 2026-07-02 — Stage 3: Today (home.tsx) finish + BUG-005 (test-driven)

**Claim:** Finished Stage 3 on the real `/home` screen (`src/pages/home.tsx`; the `features/today/*` set is unused dead code and was left untouched). Added a display-only offline banner, made an equipment-load error *replace* the content region (Code Blue banner deliberately kept above the gate), skeletoned the scan slot during load, and removed the redundant Today scan card on the native shell (BUG-005).

**Evidence:**
- Wiring check first: `/home` → `HomePage` (`home.tsx`), which dual-renders via `useIsDesktop` (≥1024px) inside `AppShell`. `features/today/TodayScreen.tsx` (which already had these states) is imported nowhere — confirmed dead. The native shell mounts a tab-bar `ScanFab` (`NativeTabBar`: Today · Equipment · [ScanFab] · Emergency · Menu), so scan stays reachable on iPhone/iPad after removing the Today card. Offline tokens (`--offline-bg/border/text`) and `t.home.offline` ("You're offline — data may be outdated") both pre-exist.
- RED first: `tests/stage-3-today-token-consistency.test.js` (new) → **5 failed / 1 passed** before edits (only the pre-existing `--action` scan-card assert passed).
- GREEN: `home.tsx` — added `isOffline` state + online/offline listeners (display-only, no queueing), an amber `role="alert"` banner on the offline tokens; restructured so the content grid + get-started render behind `equipmentError ? <ErrorCard/> : <>…</>` (Code Blue banner outside the gate); `showScanCard = heroState !== "loading" && isDesktop` (BUG-005) with a new `showScanSkeleton` rendering `<Skeleton className="h-[60px] w-full rounded-[16px]"/>` during load; imported the Stage 2 `Skeleton`.
- Test (post-edit): lock test green (6/6); `npx tsc --noEmit` → **0 errors** (confirms the ternary JSX is balanced); full `pnpm test` → **361 files / 3550 passed / 0 failed** (baseline 3544 + 6 new; no test pins the scan card testid); `pnpm i18n:check` → parity OK; `pnpm build` → built OK.
- Live browser (dev server :5000, Chrome MCP): at 1280px (isDesktop) dispatched an `offline` event → the amber banner rendered "You're offline — data may be outdated" and the desktop scan card stayed present; screenshot confirms banner styling + intact desktop layout. Reloaded at innerWidth 500 (`matchMedia(min-width:1024px)` = false) → `[data-testid="quick-action-scan"]` **absent**; screenshot confirms the compact hero renders full-width with no scan card (BUG-005).
- Not visually triggered this pass: the error-replaces-content state (would require forcing the equipment query to fail) and the transient loading skeleton — both are structurally locked (typecheck + source asserts). Dark theme / Hebrew RTL not re-verified on this screen this pass. Recommended follow-up.

**Verdict:** VERIFIED (RED→GREEN lock test + typecheck + full suite 3550/0 + i18n + build + live offline-banner render + live BUG-005 scan-card removal at compact). Error/loading-state visuals and dark/RTL deferred as structural-only.
