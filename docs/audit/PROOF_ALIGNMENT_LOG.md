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

## 2026-07-02 — Stage 5 (increment 1): Inventory palette→token sweep + BUG-010 (test-driven)

**Claim:** Migrated `src/pages/inventory-page.tsx` off the hardcoded Tailwind palette (the dominant audited defect: `emerald/amber/red` hex) onto the Stage-1 semantic tokens (`--status-ok/-issue/-stale` HSL dots, `--status-*-{bg,fg,border}` banners/chips, `--action` confirm-green), and fixed BUG-010 by removing the `position:fixed` floating "Take consumables" button and inlining it into the page scroll flow (placed after the container tab strip, gated on having containers). The restock/NFC session behavior was left byte-for-byte unchanged — restyle only.

**Evidence:**
- Scope check first: the current screen is the restock workflow (tab strip → inc/dec item rows → finish session, with NFC), not the prototype's browse grid. The grid rebuild + new `inventory-item-detail.tsx` + `procurement.tsx`/`DispenseSheet.tsx` restyles remain later Stage-5 increments; this increment is the mechanical, behavior-preserving token sweep + BUG-010.
- Enumerated every palette hit: `grep -noE "(emerald|amber|red|zinc|indigo|green|orange|slate|gray)-[0-9]{2,3}"` → 51 occurrences across `containerDotClass`, `progressColor`, restocking header, all-stocked banner, other-user warning, row flash, row pulse ring, item dots, short-by/stocked chips, complete-count text, full-restock icon button, last-session summary, finish button, scan overlay.
- RED first: `tests/stage-5-inventory-token-consistency.test.js` (new) → **9 failed / 5 passed** before edits.
- GREEN: dots → `bg-[hsl(var(--status-ok|stale|issue))]`; banners/chips → `bg-[var(--status-*-bg)] text-[var(--status-*-fg)] border-[var(--status-*-border)]` (drops all `dark:` variants — one token pair covers both themes); row flash → `--status-{ok,issue}-bg`; pulse ring → `ring-[hsl(var(--status-ok))]`; full-restock icon button → `text-[var(--action)] border-[var(--action-border)]`; finish button → Stage-2 `<Button variant="action" size="lg" loading={…}>` (drops manual `Loader2`, width-preserving spinner); scan overlay success → `bg-[var(--action)] text-[var(--action-foreground)]`. BUG-010: deleted the `fixed inset-x-0 … z-40` wrapper; inserted an inline `<Button size="lg" className="w-full">📦 Take consumables</Button>` after the tab strip.
- Residual palette after sweep: **0** (`grep` returns empty).
- Test (post-edit): lock test green (**14/14**); `npx tsc --noEmit` → **0 errors**; `pnpm build` → built OK (confirms the arbitrary-value token classes parse through PostCSS/Tailwind); `pnpm i18n:check` → parity OK; full `pnpm test` → **362 files / 3564 passed / 0 failed** (baseline 3550 + 14 new, zero regressions).
- Live browser (dev server :5000, Chrome MCP, compact width): `/inventory` renders with red issue dots, amber "Short by N" stale chips, green tab-strip ok dots, and action-green full-restock check-button outlines — all arbitrary-value tokens resolved (light). Toggled `.dark` → the same elements render the `.dark` token overrides (brighter red/amber/green, teal `--action`) legibly. **BUG-010 confirmed:** the "Take consumables" button sits inline below the tab strip and scrolls off-screen when the item list is scrolled (no longer pinned to the viewport).
- Not covered this increment (by design): the container-card grid rebuild, `inventory-item-detail.tsx`, `procurement.tsx`, and `DispenseSheet.tsx` restyle — subsequent Stage-5 increments. RTL not re-verified this pass.

**Verdict:** VERIFIED (RED→GREEN lock test 14/14 + typecheck 0 + full suite 3564/0 + i18n + build + live light/dark token render + live BUG-010 scroll behavior). Restock/NFC behavior untouched.

## 2026-07-02 — Stage 5 (increment 2): Procurement palette→token sweep (test-driven)

**Claim:** Made `src/pages/procurement.tsx` fully palette-clean. The screen was already ~99% tokenized (surface cards, filter chips, `STATUS_BADGE` pill map, divided line tables — the plan's "iOS queue" structure already present); only two palette leaks remained.

**Evidence:**
- Enumerated: `grep` found exactly 2 hits — `partial` badge `border-amber-500/20` (line 45) and the received-quantity table cell `text-emerald-600` (line 312). No rebuild warranted; the screen already matched the prototype's queue structure.
- RED first: extended `tests/stage-5-inventory-token-consistency.test.js` with a Procurement block (reads `procurement.tsx`) → **3 failed** (emerald, amber, missing `--status-ok-fg`).
- GREEN: `partial` → `border-[var(--status-stale-border)]`; received-quantity emphasis → `text-[var(--status-ok-fg)]`. Residual palette: **0**.
- Test (post-edit): stage-5 lock **20/20**; `npx tsc --noEmit` → **0**; `pnpm build` → built OK; full `pnpm test` → **362 files / 3570 passed / 0 failed** (baseline 3564 + 6 new).
- Live browser (dev server :5000, Chrome MCP, desktop 1280px — procurement is behind `WebOnlyGuard`): `/procurement` renders the header, New-order button, filter chips (All/Draft/Ordered/Partial/Received/Cancelled) and the "No purchase orders" empty state with no breakage. The two changed styles live in `STATUS_BADGE`/a table cell that only render with order rows; the dev clinic has none, so the pills weren't force-rendered (changes are surgical + test/build-covered).

**Verdict:** VERIFIED (RED→GREEN 20/20 + typecheck 0 + full suite 3570/0 + build + live empty-state render). Pill-with-data visual not exercised (no seed data); low risk — two-property change inside existing tokenized structure.

## 2026-07-02 — Stage 5 (increment 3): DispenseSheet palette→token restyle (frozen — restyle only)

**Claim:** Re-tokenized `src/features/containers/components/DispenseSheet.tsx` (7 palette hits → 0). This is a frozen emergency surface (the `classifyEmergencyEndpoint` offline-block / online-only mutations); I changed **classNames only** — no logic, no handlers, no offline-block, and deliberately left the pre-existing hardcoded Hebrew strings untouched (separate out-of-scope i18n concern; the file is already allowlisted by `i18n-no-hebrew-in-source`).

**Evidence:**
- Enumerated 7 hits: two English-label indicator dots (`bg-amber-400`), success `CheckCircle` (`text-green-500`), emergency-success `XCircle`/title (`text-red-500`/`text-red-700`), emergency-success outline button (`border-red-300 text-red-700`), and the always-visible emergency action button (`bg-red-600 … active:bg-red-700`).
- RED first: added a DispenseSheet block to `tests/stage-5-inventory-token-consistency.test.js` (banned emerald/amber/red/green + require a `--sys-red`/`--status-issue` token + assert `handleEmergencyTap` still present) → RED before edits.
- GREEN: dots → `bg-[hsl(var(--status-stale))]`; success check → `text-[hsl(var(--status-ok))]`; emergency XCircle/title → `text-[var(--status-issue-fg)]`; emergency outline button → `border-[var(--status-issue-border)] text-[var(--status-issue-fg)]`; emergency action button → `bg-[rgb(var(--sys-red))] text-white active:brightness-90`. Residual palette: **0**.
- Test (post-edit): stage-5 lock **29/29**; `npx tsc --noEmit` → **0**; `pnpm build` → built OK; full `pnpm test` → **362 files / 3579 passed / 0 failed** (baseline 3570 + 9 new).
- Live browser (dev server :5000, Chrome MCP, compact 420px): opened the sheet from the inline "Take consumables" button → the state-0 emergency screen renders the חירום button as solid vivid red (`--sys-red`) with white text, RTL intact, "no items in this container" empty state below. Emergency online-only behavior unchanged. The green success-check and red emergency-success states weren't force-completed (would log real dispense/emergency audit events) — covered structurally by test + build.

**Verdict:** VERIFIED (RED→GREEN 29/29 + typecheck 0 + full suite 3579/0 + build + live emergency-button red-token render, RTL). Frozen emergency offline-block + handlers untouched; Hebrew strings intentionally left for a dedicated i18n pass.

## 2026-07-02 — Stage 5 (increment 4): inventory item-detail — net-new real-data screen + endpoint

**Claim:** Built the Stage 5 item-detail screen `src/pages/inventory-item-detail.tsx` end-to-end with REAL data (no fabricated par/usage). Added a read-only aggregate endpoint `GET /api/inventory-items/:id/detail` (clinic-scoped) that returns item facts, on-hand distribution across containers (`vt_container_items` join), and 7-day usage unnested from `vt_dispense_events.items` jsonb (server-side `generate_series` zero-fill). Wired route `/inventory-items/:id` (behind `AuthGuard`+`WebOnlyGuard`), `api.inventoryItems.detail`, `InventoryItemDetail` types, en/he i18n namespace `inventoryItemDetailPage`, and a link from the item list. Par-level / reorder are deliberately deferred (they require new schema — not faked).

**Evidence:**
- Backend gap confirmed first: `InventoryItem` has no par/reorder/usage fields; item routes exposed only list/create/patch/deactivate/prices; `GET /api/containers` returns no items. So all three prototype sections were endpoint-gapped but the underlying tables (`vt_container_items`, `vt_dispense_events`) exist → added the missing read endpoint rather than fabricate.
- RED first: `tests/stage-5-item-detail-token-consistency.test.js` (13 asserts: status HSL tokens, no palette, `t.inventoryItemDetailPage` used, route + api.detail + server `/:id/detail`+`containerItems`+`vt_dispense_events`+`clinicId` wired) — failed before the screen/endpoint existed.
- GREEN: server tsc **0**, frontend tsc **0**, `pnpm i18n:check` parity OK, stage-5 lock tests **42/42** (13 new + 29 prior), `pnpm build` exit 0 (arbitrary-value token classes parse), full `pnpm test` → **363 files / 3592 passed / 0 failed** (baseline 3579 + 13).
- Endpoint contract verified via curl against dev API: empty item → `onHandTotal:0`, `containers:[]`, 7 zero-filled usage points (2026-06-26→07-02). After seeding one container holding (12) + one CONFIRMED dispense (qty 3, today) via psql → `onHandTotal:12`, `containers:[{Crash Cart A,12}]`, `usage7dTotal:3`.
- Live browser (dev :5000, Chrome MCP, expanded 1180px, seeded item "Gauze Pads 4x4"): header + mono code + "Wound Care" badge; on-hand hero "12" with green `--status-ok` dot; **Usage · last 7 days** with the today (Thu) bar full-height and others at baseline, "3 used"; Facts 2-col grid (Code/Category/Billable=Yes/Min=1/NFC=—/Added "Jul 2, 2026" locale date); In-containers row (status dot + Crash Cart A + qty). Verified **dark** (one `--status-ok` token covers both themes, no `dark:` variants) and **Hebrew/RTL** (nav+sidebar mirror, "חזרה" chevron flips, on-hand dot moves left, bars read right→left with today ה׳ tallest on the left, "3 שומשו" interpolates).
- Bug found & fixed during visual verification: usage bars first rendered all-collapsed — `height:%` had no definite parent height under `items-end` (columns shrink-wrapped). Fixed by stretching columns to the `h-28` track (`h-full` + drop `items-end`, `min-h-0` on the flex bar-wrapper). Re-verified bars scale.

**Verdict:** VERIFIED (RED→GREEN 42/42 + typecheck 0×2 + i18n parity + full suite 3592/0 + build + endpoint contract via curl on empty AND seeded data + live expanded/dark/he-RTL render with populated states). Par/reorder deferred (schema-blocked; not fabricated).

## 2026-07-02 — Stage 5 (increment 5): item par level + reorder point (par bar + reorder cue)

**Claim:** Added the item-detail prototype's signature feature with real, settable data: `par_level` + `reorder_point` columns on `vt_items` (migration 157, additive nullable), accepted by create/update, returned by the detail endpoint, set via the admin item form, and rendered on the detail screen as a token-driven par bar + "Below reorder point — N left" cue. Untracked (null) items render the plain on-hand view.

**Evidence:**
- Schema: `server/schema/inventory.ts` par_level/reorder_point; `migrations/157_vt_items_par_reorder.sql` (`ADD COLUMN IF NOT EXISTS`) applied via `pnpm db:migrate` (drizzle-kit generate is broken in this env — CJS loader can't resolve the schema barrel's `.js` ESM imports — so the SQL was authored by hand to match the numbered-file runner).
- RED first: extended `tests/stage-5-item-detail-token-consistency.test.js` with a par/reorder describe (schema columns, server parLevel/reorderPoint, screen parLabel/belowReorder + `--status-stale` tokens) → RED before the columns/UI existed.
- GREEN: FE tsc **0**, server tsc **0**, `pnpm i18n:check` parity OK, stage-5 lock **45/45** (3 new), `pnpm build` exit 0, full `pnpm test` → **363 files / 3595 passed / 0 failed** (baseline 3592 + 3).
- API round-trip: `PATCH /api/inventory-items/:id` with `{parLevel:20,reorderPoint:15}` persisted and echoed back (parLevel 20, reorderPoint 15); detail endpoint returns them on the item row.
- Live browser (dev :5000, Chrome MCP, expanded 1180px, seeded on-hand 12): hero shows "12 / On hand" + "Par 20", an amber `--status-stale` dot, a ~60% par bar (12/20) in the stale token, and the amber "Below reorder point — 12 left" banner (`--status-stale-bg`/`-fg`). Color logic verified: on-hand ≤ reorder (12 ≤ 15) → stale, as designed (empty → issue, above reorder → ok).

**Verdict:** VERIFIED (RED→GREEN 45/45 + typecheck 0×2 + i18n parity + full suite 3595/0 + build + migration applied + API round-trip + live par-bar/reorder-cue render). Reorder→PO-creation button remains the one deferred piece (procurement is a separate existing screen).

## 2026-07-02 — Stage 4 (worktree fork): Board / Scan / Web-Guard / Code-Blue

> Built in an isolated git worktree branched off `feat/design-stages-implementation` (tip `98f2d929`), 4 commits. The fork cannot drive Chrome/iOS, so **manual browser + iOS-simulator verification is explicitly deferred to the parent after merge** (see the "needs manual verification" list at the end). Gates run per surface: `npx tsc --noEmit`, `npx tsx scripts/i18n/check-parity.ts`, the new lock test, related regression suites, and `npx vite build` (the only gate that actually parses arbitrary-value Tailwind classes).

### Increment 1 — WebOnlyGuard `<1024px` viewport guard (BUG-009) · commit `138acb63`
**Claim:** `src/app/platform/guards/WebOnlyGuard.tsx` now renders a dark guard screen below the 1024px desktop breakpoint (reusing the shared `useIsDesktop()` hook) that routes the operator to a mobile-appropriate view, in addition to the existing Capacitor-native redirect. The board route (`/equipment/board`) falls back to `/my-equipment`. New `webOnlyGuard` i18n namespace (passthrough wired in `src/lib/i18n.ts`, en/he parity, `.d.ts` regenerated).
**Evidence:** RED→GREEN lock test `tests/stage-4-web-guard-token-consistency.test.js` **8/8** (asserts `useIsDesktop`, no bespoke `matchMedia`, `!isDesktop` branch + guard-screen testid, `navigate(fallback)` CTA, `bg-background` not palette, `t.webOnlyGuard.*` copy, board→`/my-equipment` route, en/he key parity). `npx tsc --noEmit` → **0**; `npx tsx scripts/i18n/check-parity.ts` → deep parity OK; `npx vite build` → exit 0. Hooks unconditional (called before the Capacitor branch) — no conditional-hook order violation.
**Verdict:** VERIFIED (static + typecheck + parity + build). Runtime viewport behavior (guard shows on iPhone/iPad browser, desktop unaffected, CTA navigates) needs manual verification.

### Increment 2 — QR scanner 44px close (BUG-004) + status tokens · commit `c1ecae11`
**Claim:** `src/components/qr-scanner.tsx` — the close control is now a 44px (`h-11 w-11`) target in the always-visible header (BUG-004; was 40px `h-10`). Result-sheet indicators (match banner, owner-return warning, mark-ok / mark-issue) move off `emerald/amber/red` onto `--status-*` tokens (one pair covers light+dark, `dark:` variants dropped); scanning reticle + scan line become the white camera reticle. **Permission-priming was NOT implemented** (see deferred list).
**Evidence:** Residual palette after sweep: **0** (`grep -E 'emerald-|amber-|red-[0-9]|green-[0-9]|zinc-|indigo-|blue-[0-9]'` empty). RED→GREEN lock test `tests/stage-4-scanner-token-consistency.test.js` green, and the **existing** `tests/phase-5-pr-5-0-1-qr-overlay-positioning.test.ts` still passes — combined **31/31** — confirming the frozen portal/overlay contract (`qr-scanner-overlay-root`, `fixed inset-0 z-50 flex flex-col`, safe-area paddings, `killAllCameras`, qrbox 250, `permission_denied`, no new viewport exports, scan-line prefix) is intact. `npx tsc --noEmit` → **0**; `npx vite build` → exit 0.
**Verdict:** VERIFIED (static + Phase-5 contract preserved + typecheck + build). On-device close reachability on a real iPhone + the white reticle appearance need manual verification.

### Increment 3 — Command board: overdue→orange, skeleton, footer, overlay tokens · commit `8df2dd90`
**Claim:** `src/pages/display.tsx` — `overdue` readiness reads the orange (maintenance) token instead of red across all three status maps; added a board skeleton loading state (was a bare loading string) and a footer status strip (last-updated + LIVE) reusing existing `board.*` keys; the `CodeBlueOverlay` + fallback notice drop hardcoded `#0d0505 / red-* / gray-* / green-* / amber-300` onto the theme-independent `emergency-*` + `--sys-*` tokens. Overlay is a frozen surface — **classNames only**, SSE/timer/presence logic untouched.
**Evidence:** Residual palette: **0** (`grep -E '#0d0505|red-[0-9]|amber-[0-9]|green-[0-9]|gray-[0-9]|emerald-|blue-[0-9]'` empty). RED→GREEN lock test `tests/stage-4-board-token-consistency.test.js` **27/27** (banned palette, emergency-* adoption, overdue→maintenance in all three class maps, skeleton testid + a11y label, footer). Regression suites green: `ward-display.test.js`, `display-command-board-timeout.test.ts`, `display-snapshot-retry-and-timer.test.ts`. `npx tsc --noEmit` → **0**; `npx vite build` → exit 0.
**Verdict:** VERIFIED (static + regressions + typecheck + build). Overlay red identity + skeleton/footer appearance in light/dark + kiosk render need manual verification.

### Increment 4 — Code Blue page palette→token restyle (frozen) · commit `6391d26f`
**Claim:** `src/pages/code-blue.tsx` — restyle only (className strings): off hardcoded red/amber/green/blue onto the theme-independent `emergency-*` family + always-vivid `rgb(var(--sys-green))` + the `--status-sterilized` blue. The screen renders on the fixed-dark emergency surface (NOT under `.dark`), so this deliberately avoids theme-forked `-fg` tokens that would drop contrast in light mode. Clinical mutations / session lifecycle / idempotency / critical alert tone byte-for-byte unchanged.
**Evidence:** Residual palette: **0** (`grep -E 'red-[0-9]|amber-[0-9]|green-[0-9]|blue-[0-9]|emerald-|indigo-|zinc-|gray-[0-9]'` empty). RED→GREEN lock test `tests/stage-4-code-blue-token-consistency.test.js` green (banned palette + token adoption + **frozen-behavior markers**: `api.codeBlue.sessions.start/end`, `idempotencyKey: crypto.randomUUID()`, `playCriticalAlertTone`, `useCodeBlueSession`). Regressions green: `code-blue-frontend.test.js`, `i18n-code-blue.test.ts` — combined **54/54**. `npx tsc --noEmit` → **0**; `npx vite build` → exit 0.
**Verdict:** VERIFIED (static + behavior-marker assertions + regressions + typecheck + build). Emergency-screen color contrast in **both** light and RTL, on device, needs manual verification (highest-priority manual check — clinical color signal on a frozen surface).

### Stage 4 overall
- Full default suite after all four commits: **356 files passed / 10 skipped · 3608 passed / 51 skipped / 0 failed** (baseline 3579 → +29 new lock-test assertions, zero regressions).
- **Deferred (NOT done this pass), with rationale:**
  - **QR permission-priming state** — behavioral change to the camera-mount flow; the e2e scan test is live-server-only (excluded from the default suite), so a regression wouldn't be caught by CI and the fork can't verify on device. Recommend the parent implement with live verification.
  - **BUG-016 remove all scan UI on web** — this is a cross-cutting nav change touching `NativeTabSidebar`/`routes`/topbar scan entry points (the plan's "platform scan model" cross-cutting workstream), not isolated to the Stage-4 scan surface. `src/pages/scan.tsx` already redirects non-mobile-shell to `/equipment?scan=1`; the remaining sidebar/topbar entry removal belongs to the parent's cross-cutting task.
- **Needs manual browser + iOS-sim verification (parent, post-merge):** (1) WebOnlyGuard shows on iPhone/iPad browser + narrow viewport, desktop unaffected, CTA routes to /my-equipment; (2) scanner close reachable/tappable on a real iPhone + white reticle; (3) board overlay red identity, skeleton, footer in light/dark + kiosk; (4) **Code Blue emergency-screen contrast in light AND dark, RTL, on device.**

## 2026-07-02 — Stage 4 (parent post-merge live check): WebOnlyGuard BUG-009

**Claim:** After merging the Stage 4 fork, the parent live-verified the WebOnlyGuard viewport guard the fork had deferred.

**Evidence:** Dev server :5000, Chrome MCP, window resized to **800px** (<1024). Navigated `/equipment/board` → renders the full dark guard screen ("Best viewed on a larger screen" / "This view is built for desktop and wide tablet displays… continue with the mobile-optimized view." / "Go to my equipment" CTA) instead of the command board. At ≥1024 the board renders normally (unchanged). Confirms BUG-009 behavior at the narrow-viewport boundary.

**Still deferred (device/camera-dependent, not verifiable same-origin):** scanner close reachability + white reticle on a real iPhone; Code Blue emergency-screen contrast in light/dark/RTL on device; board overlay red identity in kiosk. QR permission-priming + BUG-016 (remove web scan UI) remain unimplemented (cross-cutting nav workstream).

## 2026-07-02 — Design batch 1 (cross-cutting): nav/shift-gate/topbar-dropdowns/header-spacing/Forest-theme + iPad bug sweep

**Claim:** Cross-cutting workstream (Task #21) + the 16-bug iPad/iPhone sweep from the on-device QA pass, committed as one batch. Covers: (a) Equipment page restored to reachability on native after it was wrongly guarded; (b) off-shift users blocked from scanning AND equipment checkout in the UI (roster-derived, no clock-in); (c) top-bar Alerts bell + Settings gear converted from page-navigation to dropdown panels (BUG-007/BUG-014), avatar sized to match gear/bell (BUG-006); (d) page-title header spacing (`px-4 sm:px-6 pt-3` + max-width wrapper) applied to settings/my-equipment/inventory/admin/admin-shifts/appointments (BUG-008); (e) Forest color theme actually renders green (BUG-015-adjacent theme block was missing); (f) misc iPad nav bugs (tab active-state, MoreSheet rows, crash-cart RTL, redundant admin Shifts tab, Start-shift→summary dead path).

**Evidence:**
- Gates: `pnpm typecheck` (frontend + server) → **0 errors**; `pnpm i18n:check` → deep en/he parity OK; `pnpm build` → **exit 0** (arbitrary-value token classes + new panel styles parse); guard tests `mobile-shell` + `i18n-no-hebrew-in-source` + `i18n-parity` → **20/20**.
- Equipment restore (`src/app/routes.tsx`, `NativeTabBar`/`NativeTabSidebar`/`MoreSheet`): `/equipment` un-guarded (has a mobile screen: `equipment-list.tsx` renders `<EquipmentListScreen/>` when `inMobileShell`), tab points back to `/equipment` labelled "Equipment", `isTabActive` treats `/equipment` + `/my-equipment` as active but excludes `/equipment/tasks`; menu row + Browse button restored. Kept guarded (no mobile screen): board, procurement, analytics, dashboard, audit-log, print, code-blue/display.
- Off-shift gating (UI): new `src/hooks/use-active-shift.ts` derives `hasActiveShift = !!data?.shift` from `/api/home/dashboard` (no clock-in). `ScanScreen` shows an off-shift block (camera never mounts) when `!hasActiveShift`; `equipment-detail.tsx` `handleCheckout()` toasts `t.scan.offShiftBody` + the two checkout Buttons carry `disabled={… || !hasActiveShift}`; home "Start shift" dead button removed. **Server-side enforcement is a known follow-up gap** — `/scan` + checkout endpoints remain role-gated, not shift-gated (logged, not yet built).
- Top-bar dropdowns (`NativeHeader.tsx` rewrite): Alerts panel (up to 5 unacked, severity dot, → `/equipment/:id`, "See all alerts" → `/alerts`) + quick-settings panel (dark-mode + language toggles, Profile, "All settings"). Panels are siblings of `<header>` (fixed-positioned) to escape the header's `backdrop-filter` containing block. Avatar = 28px circle in a 36px hit area to match the 20px gear/bell glyphs.
- Forest theme (`src/index.css`): added the missing `:root[data-color-theme="forest"]` (light) + `.dark[data-color-theme="forest"]` blocks overriding `--primary`/`--ring`/brand vars to green (142 hue); base + clinical stay indigo. Default theme reverted to `clinical` in `user-settings-storage.ts`.
- i18n: added `scan.offShiftTitle/offShiftBody` (wired in `i18n.ts`, explicit namespace) + `nav.*` dropdown keys (passthrough) incl. `langHebrewName`/`langEnglishName` (fixes a hardcoded-Hebrew-in-source test failure); `.d.ts` regenerated; en/he parity maintained.

**Verdict:** VERIFIED at the gate level (typecheck 0×2 + i18n parity + guard tests 20/20 + build exit 0) and via the prior on-device iPad/iPhone simulator QA pass that drove this bug list. **Known deferred:** server-side shift enforcement for `/scan` + checkout (UI-only today). Committing as "design batch 1" for CodeRabbit review.

## 2026-07-02 — Design batch 1: fundamentals audit remediation

**Claim:** Ran the product-design-fundamentals rubric over the whole batch-1 diff (25 files) and fixed every actionable finding.

**Evidence (per finding):**
- **C1 CRITICAL** (fixed): `NativeHeader` alert-count badge used `var(--destructive)` raw (an HSL triplet) → invalid declaration → invisible count on the near-white header. Now `hsl(var(--destructive))`. Grep confirmed it was the only raw-`var()` HSL-triplet misuse across `src/native/` + `src/features/scan/`.
- **H2 HIGH** (fixed): `equipment-detail` off-shift checkout buttons were `disabled` AND wired to a toast that a disabled button can never fire (dead guard). Added `offShiftCheckoutNote` (reuses `t.scan.offShiftBody`, no new keys) rendered beside both checkout affordances so an off-shift tech sees the reason.
- **H3 HIGH** (fixed): header icon hit areas 36→44px (iOS HIG floor; glyphs stay 20px, fit the 44px bar).
- **H4 HIGH** (fixed): alert severity was color-only (red vs orange dot). Now distinct shapes — `AlertCircle` (issue) vs `AlertTriangle` (warning) — WCAG 1.4.1.
- **M1 MEDIUM** (fixed): panels advertised `role="menu"`/`menuitem`/`menuitemcheckbox` without the ARIA menu keyboard contract. Downgraded to plain buttons in an `aria-label`led container (`aria-haspopup="true"`, toggle → `aria-pressed`), and wired Escape-to-close + focus-into-panel-on-open + focus-return-to-trigger.
- **M3 MEDIUM** (fixed): filled `--primary` avatar out-weighed the live-badge bell (false hierarchy). Now muted fill + hairline ring.
- **M4 MEDIUM** (fixed): panel/footer rows 44→48px to match the VetTrack touch floor.
- **L1 LOW** (fixed): bell announced "alerts" twice (button + badge). Count folded into the button `aria-label`; badge `aria-hidden`.
- **M2** (no change — verified coherent): Forest theme overrides every chromatic brand token; `--accent`/`--secondary`/`--muted` are neutral grays, no `--chart-*` tokens exist, `--action` is already forest-teal. No indigo leak.
- **M5** (accepted by convention): avatar→profile is a well-established affordance; left as direct navigation.
- **L2** (deferred to Stage 9): `crash-cart` has 10 palette usages — whole-file re-token is Stage 9's job; a lone line-140 swap would leave 9 inconsistent siblings.
- **L3** (deferred to FAB workstream): removing the iPad sidebar Scan entry without the tablet Scan FAB (BUG-011) would regress scan access.
- Gates: `pnpm typecheck` (fe+server) → 0 · `pnpm build` → exit 0 · guard tests (mobile-shell, i18n-no-hebrew, i18n-parity, no-hardcoded-ui-strings) → 21/21.

**Verdict:** VERIFIED at gate level. On-device re-verification of the dropdown keyboard/focus behavior + 44px targets recommended on next sim pass.

## 2026-07-02 — CodeRabbit findings on design-handoff bundle: verify + selective fix

**Claim:** Verified each CodeRabbit inline finding (all in `docs/design-handoff/`) against the current file; fixed the still-valid ones minimally, skipped two with reason. No `src/` touched — repo build/typecheck unaffected.

**Fixed (13):**
- `deck-stage.js` disconnectedCallback: reset `this._railEnabled=false` so `_enableRail()` re-runs on reconnect (node --check: valid JS).
- `apply.sh` mkdir: added `src/components/alerts` (bash -n: valid).
- `alert-card.tsx`: `text-[12.5px]`→`text-sm` (reference file; live `src/components/alerts/AlertCard.tsx` already has no 12.5px).
- `audit-log-row.prompt.md` / `confidence-indicator.prompt.md`: added top-level `#` heading (MD041).
- `chat-message.tsx`: gated progress UI on `ackPercent && ackLabel` (no bare bar) + made `ChatMessageProps` a discriminated union; `chat-message.prompt.md` doc updated to match.
- `Stage 1 …dc.html`: `sizeMeta.expanded.target` `'var(--space-9)'`→`'36pt'` (matches `.page[data-size="expanded"]{--target-min:36px}`, plain-string format like siblings).
- `Stage 7 …dc.html`: per-screen `topbarTitleMap[screen]`; duplicate `statCols` key renamed to `metricsStatCols` (was silently overwriting the 4-col analytics/dashboard grid with the 3-col metrics value) + 2 metrics template bindings repointed (grep: 4×statCols gap:10px kept, 2×metricsStatCols).
- `Stage 8` / `Stage 9 …dc.html`: per-screen `topbarTitleMap[screen]` (Admin/Shifts/Asset Types; Crash Cart/History/Chat/Handover). Mirrors the shipped Stage 6 pattern.
- `README.md`: stale `vettrack-design-handoff/project/`→`docs/design-handoff/stages-full/project/`.

**Skipped (2), with reason:**
- `apply.sh` "Asset #" i18n (419-422): live `src/` has no `EntityMetaRow`/"Asset #" (grep-verified) — the script was applied-then-reset and isn't executed; converting a dead reference script's sed-injected TSX into a live i18n flow (touching real locales + equipment-detail) is out of scope.
- `apply.sh` append idempotency (13-16): one-shot reference apply script, self-documented "review the diff before committing," applied-then-reset; guarding all ~8 `cat >>` sites exceeds "minimal" for a non-executing artifact.

**Verdict:** VERIFIED (node --check + bash -n on the scriptable edits; structural grep on the `.dc.html` template/JS edits; scope confirmed docs-only). `.dc.html`/reference `.tsx` are not in tsconfig/vite, so not gate-compiled — validated by parser + pattern-match against the working Stage 6.

## 2026-07-02 — Stage 6 (increment 1): Equipment Detail — back header + at-a-glance grid

**Claim:** Brought the mobile `EquipmentDetailScreen` toward the Stage 6 detail prototype: added an iOS back-button header row and a token-driven "At a glance" 4-tile fact grid (Location / Assignee / Last scan / Due) wired to real `Equipment` + `LocationInference` fields, and moved the pull-to-refresh copy off hardcoded English. No fabricated data — every tile falls back to "—" when its source field is absent.

**Evidence:**
- Backing fields verified real in `src/types/equipment.ts`: location (`roomName`/`checkedOutLocation` + inference), assignee (`checkedOutByEmail` + inference `accountablePerson`), last scan (`lastVerifiedAt`/`lastSeen`/inference `lastConfirmedAt`), due (`checkedOutAt` + `expectedReturnMinutes`). Service-schedule card deferred to a later increment (data exists — `lastMaintenanceDate`+`maintenanceIntervalDays` — but wanted a focused slice); actions row deferred (needs mutation wiring).
- RED→GREEN lock test `tests/stage-6-equipment-detail-token-consistency.test.js` **8/8** (back testid + copy, EquipmentGlanceGrid + atGlance heading, `repeat(2, minmax(0, 1fr))` grid, 4 real tiles, tokens present + banned palette absent, pull-to-refresh de-hardcoded, all 8 new keys wired in the hand-listed `equipmentDetail` accessor + en/he entries).
- i18n: 8 new `equipmentDetail.*` keys (back/atGlance/assignee/lastScan/due/unassigned/pullToRefresh/releaseToRefresh) added to en+he, wired into `src/lib/i18n.ts`, `.d.ts` regenerated. RTL: back chevron flips via `useDirection` (ArrowLeft/ArrowRight); grid uses logical `minmax`.
- Gates: `pnpm typecheck` (fe+server) → **0**; `pnpm i18n:check` → parity OK; guard tests (i18n-no-hebrew-in-source, no-hardcoded-ui-strings, mobile-shell) → **21/21**; `pnpm build` → exit 0.

**Verdict:** VERIFIED at gate level (RED→GREEN 8/8 + typecheck 0×2 + parity + guards 21/21 + build). Live browser verification (392/860/1180 · light/dark · en/he-RTL, seeded equipment) pending for the stage's end pass. Service-schedule card + actions row are the next Stage 6 detail increments.

## 2026-07-02 — Stage 6 (increment 2): Equipment Detail — service-schedule card

**Claim:** Added the Stage 6 service-schedule card to the mobile detail screen, derived entirely from real fields (`lastMaintenanceDate` + `maintenanceIntervalDays`). Renders only when both are present; progress bar + last/next dates + overdue chip computed from those values.

**Evidence:**
- New `EquipmentServiceCard.tsx`: gate `if (!lastMaintenanceDate || !maintenanceIntervalDays) return null;`, `pct` clamped 0–100 from elapsed/interval, bar token ok/stale/issue by pct + overdue, dates via `formatDateByLocale`. Rendered after the location card.
- i18n: 4 new keys (serviceSchedule/lastServiced/nextService/serviceOverdue) en+he + wired in `i18n.ts`, `.d.ts` regenerated.
- Gates: stage-6 lock **11/11** (3 new asserts: rendered, gated-on-real-data, status-HSL-token bar + no palette), typecheck **0×2**, i18n parity OK, build exit 0, guards (hebrew-in-source + no-hardcoded) pass.

**Verdict:** VERIFIED at gate level. Live render (with a seeded maintenance interval) pending stage-end browser pass.

## 2026-07-02 — Stage 6 (increments 5–6): facility surfaces palette→token

**Claim:** Room Radar (`room-radar.tsx`, 17 palette sites) and Rooms list (`rooms-list.tsx`, 10 sites) moved off hardcoded emerald/amber/red palette onto `--status-*` / `--sys-*` tokens (readiness chips, health rings, status text, action-button color classes, error/attention banners). `my-equipment.tsx` and `new-equipment.tsx` were already palette-free (prior refactors) — no change needed.

**Evidence:**
- Both files now `grep`-clean of the banned palette (emerald/amber/zinc/indigo/slate-N, red/green/blue/gray-NN, 6-hex) → **0**. Status chips → `--status-{ok,issue,stale}-{bg,fg,border}`; rings/dots → `rgb(var(--sys-{green,orange,red,blue}))`; STATUS_BAR_COLORS `needs_attention` → `border-s-status-maintenance`, fallback → `border-s-border`.
- RED→GREEN lock test `tests/stage-6-facility-token-consistency.test.js` **4/4** (no-palette + status-token presence, per file).
- Gates: typecheck **0×2**, `pnpm build` exit 0, guards (i18n-no-hebrew-in-source, no-hardcoded-ui-strings) pass.

**Verdict:** VERIFIED at gate level (static token sweep + lock + typecheck + build). Live dark/RTL render of the radar rings + chips pending the stage-end browser pass.

## 2026-07-02 — Stage 6 (increment 7): desktop equipment-detail palette→token

**Claim:** `src/pages/equipment-detail.tsx` (EquipmentDetailPageDesktop) — all 29 hardcoded palette sites (report-issue amber theming, red validation/flag/error, emerald success icons, blue dock-return button, destructive confirm) moved onto `--status-*` / `--sys-*` / `bg-destructive` tokens. `new-equipment.tsx` was already palette-free — the plan's "rebuild" was, on measurement, a token sweep + an already-clean form.

**Evidence:**
- Applied via a literal-replace script (every one of the 21 patterns matched — no WARN); file now `grep`-clean of the banned palette → **0**. Mapping: emerald→`--status-ok`, red→`--status-issue`, amber→`--status-stale` (maintenance icon→`--status-maint`), blue→`rgb(var(--sys-blue))`, destructive confirm→`bg-destructive`.
- Lock test `tests/stage-6-facility-token-consistency.test.js` extended with a desktop describe → **6/6** (no-palette + status/sys token presence).
- Gates: typecheck **0×2**, build exit 0, guards (i18n-no-hebrew-in-source, no-hardcoded-ui-strings) pass.

**Verdict:** VERIFIED at gate level. Behavior untouched (className-only sweep). Live dark/RTL render pending stage-end browser pass.

## 2026-07-02 — Stage 6 (increment 3): Equipment Detail — actions row (Check in)

**Claim:** Added the mobile detail actions row's primary action — "Check in" (return) — as a real, verifiable, equipment-scoped mutation reusing the desktop's proven infrastructure. Flag + Report-missing deferred with reason (no reusable equipment-scoped issue flow; no missing endpoint).

**Evidence:**
- New `EquipmentActions.tsx`: renders "Check in" only when `isCheckedOut && (checkedOutByMe || isAdmin)` (else `return null`); `returnMut` calls `api.equipment.return(id, {isPluggedIn, plugInDeadlineMinutes})` (the identical optimistic/offline path the desktop uses) via the standalone `ReturnPlugDialog`; success → cache set + invalidate + `toast.equipmentDetail.toast.returned` (or `savedOffline` when queued); error → `returnFailed`. **Return is deliberately not shift-gated** (you can always hand equipment back — unlike checkout).
- **Behavioral verification** `tests/equipment-actions.test.tsx` (happy-dom + RTL) **5/5**: shows for checked-out+admin; hidden when available; hidden for non-admin non-holder; shown to the holder; and click→dialog→`api.equipment.return("eq-1",{isPluggedIn:true})`→success toast. This is the real behavior check (the mobile screen needs the native shell, so it can't be driven in plain Chrome).
- Lock test `tests/stage-6-equipment-detail-token-consistency.test.js` extended → **16/16** (rendered, real return + ReturnPlugDialog + checkIn key, holder/admin gating, no shift-gate).
- i18n: `checkIn` (en+he) wired in the hand-listed accessor; reused existing `reportIssueTitle`/`toast.{returned,savedOffline,returnFailed}`. `.d.ts` regenerated.
- Gates: typecheck **0×2**, i18n parity OK, build exit 0, guards pass.

**Deferred (not dead-buttoned):** Flag (equipment-scoped note+photo issue flow lives only inside the desktop screen; the standalone `ReportIssueDialog` is a general support ticket, not an equipment flag) and Report-missing (no API endpoint). Documented in the component header.

**Verdict:** VERIFIED — the return action is exercised end-to-end in a jsdom behavioral test against the proven API+dialog, plus static lock + typecheck + build. Stage 6 increments 1–7 all shipped.

## 2026-07-02 — Stage 9 (increments 1–2): Crash Cart + Code Blue History palette→token

**Claim:** Crash Cart check (`crash-cart.tsx`, 9 sites) and Code Blue History (`code-blue-history.tsx`, 22 sites) moved off hardcoded green/red/amber/zinc palette onto theme + status/sys tokens. History also stops hardcoding `dir="rtl"` — it now mirrors by locale.

**Evidence:**
- crash-cart: ready/attention banner + present/missing rows + missing-items card → `--status-{ok,issue,stale}-*`; className-only, frozen code-blue mutation/transport surfaces untouched.
- code-blue-history: zinc dark palette → theme tokens (`bg-card`/`bg-muted`/`border-border`/`text-muted-foreground`/`text-foreground`); outcome pills → `--status-ok-fg`/`--status-issue-fg`/`rgb(var(--sys-blue))`/`--status-stale-fg`; both `dir="rtl"` → `dir={dir}` via `useDirection`, back chevron flips (ArrowLeft/ArrowRight).
- Both `grep`-clean of banned palette → **0**. Lock test `tests/stage-9-emergency-token-consistency.test.js` **5/5** (no-palette + token presence per file + dir-by-locale). `tests/i18n-code-blue.test.ts` regression still green.
- Gates: typecheck **0×2**, build exit 0.

**Verdict:** VERIFIED at gate level (static token sweep + lock + i18n-code-blue regression + typecheck + build). Live dark/light/RTL render pending stage-end browser pass. Remaining Stage 9: shift-chat hardcoded-Hebrew (BUG-002) + quick-reply wiring (BUG-003) + stale messages (BUG-001) + standalone chat screen + richer Handover + code-blue.tsx restyle.

## 2026-07-02 — Stage 9 (increment 3): shift-chat broadcast i18n (BUG-002) + BroadcastCard re-token

**Claim:** Fixed the hardcoded-Hebrew-in-EN-mode bug for broadcasts (BUG-002): the `BROADCAST_TEMPLATES` data model is now keys-only, all broadcast copy lives in i18n, and `BroadcastCard` renders via `t.*` + theme tokens. `BroadcastCard.tsx` and `types.ts` removed from the Hebrew-debt allowlist.

**Evidence:**
- `types.ts`: `BROADCAST_TEMPLATES` → `{ department_close: {} }` (Hebrew label/subtitle removed). Consumers (`BroadcastCard`, `ShiftChatPanel`) resolve label/subtitle from `t.shiftChat.broadcastTemplates[key]`.
- New i18n: `shiftChat.broadcast.{iSent,seniorTech,received,gotItOnWay,fiveMin,ackedReceipt,snoozedReminder}` + `shiftChat.broadcastTemplates.department_close.{label,subtitle}` (en+he, passthrough namespace, `.d.ts` regenerated).
- `BroadcastCard` re-tokened: indigo→`primary`, green→`--status-ok`, red→`--status-issue` (theme-following). `ShiftChatPanel` broadcast buttons likewise + resolve copy from `t`.
- Allowlist: `BroadcastCard.tsx` + `types.ts` removed; the guard's "no stale entries" + "every offender listed" both hold (MessageBubble/SystemCard/ShiftChatArchive remain — still have Hebrew).
- Gates: typecheck **0×2**, i18n parity OK, `i18n-no-hebrew-in-source` **2/2**, stage-9 lock **8/8** (new BroadcastCard/types describe), `no-hardcoded-ui-strings` pass, build exit 0.

**Verdict:** VERIFIED at gate level (Hebrew now impossible to regress in these two files — off the allowlist; parity + typecheck + build). Remaining Stage 9: MessageBubble/SystemCard/ShiftChatArchive Hebrew, BUG-003 quick-reply, BUG-001 stale messages, standalone chat screen, richer Handover, code-blue.tsx restyle.

## 2026-07-02 — Stage 9 (increment 4): shift-chat MessageBubble + ShiftChatArchive i18n (BUG-002 cont.)

**Claim:** Cleared hardcoded Hebrew + palette from `MessageBubble.tsx` and `ShiftChatArchive.tsx`; both removed from the Hebrew-debt allowlist. Only `SystemCard.tsx` remains on the chat allowlist (9 interpolated event-copies, several for removed ER/med scope — deferred to a focused pass).

**Evidence:**
- MessageBubble: `"⚡ דחוף"` → `⚡ {t.shiftChat.urgent}`; palette indigo→`primary`, role avatars blue→`sys-blue`/green→`--status-ok`, urgent red→`--status-issue`, mention/hashtag spans → `text-primary` (senior-tech `purple` kept — a deliberate role color outside the token set, not a lint target).
- ShiftChatArchive: 5 strings → `t.shiftChat.archive.{loading,notFound,title,readOnly,empty}`; `toLocaleString("he-IL")` → `formatDateByLocale(..., {dateStyle:"medium",timeStyle:"short"})` (locale-aware); amber banner → `--status-stale-*`.
- i18n: `shiftChat.urgent` + `shiftChat.archive.*` (en+he passthrough, `.d.ts` regenerated).
- Both files `grep`-clean of Hebrew (0) + banned palette (0). Allowlist: removed both; guard's "no stale entries" + "every offender listed" hold (SystemCard remains).
- Gates: typecheck **0×2**, i18n parity OK, `i18n-no-hebrew-in-source` + `no-hardcoded-ui-strings` pass (3/3), build exit 0.

**Verdict:** VERIFIED at gate level. Remaining Stage 9: SystemCard event-copy i18n (+ removed-scope event cleanup), BUG-003 quick-reply, BUG-001 stale messages, standalone chat screen, richer Handover, code-blue.tsx restyle.

## 2026-07-02 — Stage 9 (increment 5): SystemCard event-alignment + i18n + tokens (BUG-002 cont.)

**Claim:** Rewrote `SystemCard.tsx` to match the server's actual system-event contract, cleared its hardcoded Hebrew (last shift-chat allowlist entry), and moved dark-only Tailwind palette onto `--status-*` tokens. This is both the de-Hebrew fix and a silent-gap bug fix.

**Evidence (traced against server 2026-07-02):**
- `postSystemMessage()` (`server/lib/shift-chat-presence.ts`) is the ONLY insert path for `type:"system"` messages (grep confirmed: no other `type: "system"` inserts).
- Its callers emit exactly 9 event types: `code_blue_start`/`code_blue_end` (`routes/code-blue.ts`), `equipment_overdue`/`alert_reopened` (`lib/alert-reminder.ts`), `code_blue_unreconciled` (`lib/code-blue-reconciliation-scanner.ts`), `outbox_dlq_threshold_exceeded` (`lib/outbox-dlq-scanner.ts`), `critical_push_delivery_failed` (`workers/notification.worker.ts`), `emergency_dispense_unresolved` (`services/dispense.service.ts`), `task_escalated` (`services/task-automation.service.ts`).
- OLD SystemCard rendered only 3 of the 9 (`code_blue_start/end`, `equipment_overdue`) — the other 6 emitted events hit `if (!config) return null` and rendered nothing (silent gap). It also carried 6 DEAD entries: `med_critical`, `hosp_critical`, `hosp_discharged`, `hosp_deceased` (ER/med scope removed in migrations 142–143) + `low_stock`/`shift_summary` (grep-confirmed never emitted).
- NEW SystemCard: config = the 9 emitted events, each with a status `tone` (issue/ok/stale) → `TONE_CLASS` pre-formed `--status-*` vars; every label reads `t.shiftChat.system.*`; interpolated data (name, minutes, outcome, time, count) concatenated in TSX (passthrough namespace → no interpolation-fn wiring needed); time via `formatDateByLocale(..., {hour,minute})`.
- New i18n: `shiftChat.system.{codeBlueStarted,codeBlueEnded,codeBlueUnreconciled,equipmentOverdue,alertReopened,emergencyDispenseUnresolved,taskEscalated,criticalPushFailed,outboxDlqExceeded,minutesShort}` (en+he, passthrough, `.d.ts` regenerated).
- Allowlist: `SystemCard.tsx` removed — **the shift-chat subsystem now has zero Hebrew-debt entries.** Guard's "every offender listed" + "no stale entries" both hold.
- RED→GREEN: added SystemCard describe to `stage-9-emergency-token-consistency.test.js` (5 asserts: no-palette, i18n-not-Hebrew, all-9-emitted-present, all-6-dead-absent, status-tone-tokens) — failed 5/5 pre-impl, pass post-impl.
- Gates: typecheck **0×2**, i18n parity OK, `stage-9` lock **13/13**, `i18n-no-hebrew-in-source` pass, `no-hardcoded-ui-strings` pass, build exit 0.

**Verdict:** VERIFIED at gate level. SystemCard is now contract-aligned (no dead config, no unrendered emitted events) and Hebrew-free. Remaining Stage 9: ShiftChatPanel palette→tokens + BUG-003 behavioral proof (next increment), BUG-001 stale messages, standalone chat screen, richer Handover, code-blue.tsx restyle.

## 2026-07-02 — Stage 9 (increment 6): BUG-003 proof + ShiftChatPanel tokens

**Claim:** Closed BUG-003 (broadcast quick-reply buttons "do nothing") with a behavioral test proving the ack chain fires, and tokenized the last palette in the live chat surface (`ShiftChatPanel.tsx`).

**Evidence:**
- BUG-003 root-cause trace (2026-07-02): button (`BroadcastCard` line 67/74) → `onAck(status)` → panel `ackMessage({id, status})` (`ShiftChatPanel` line 212) → `ackMutation.mutate` → `shiftChatApi.ackMessage` → `POST /api/shift-chat/messages/:id/ack` (server route exists, validates `status` enum, allows broadcast+system acks, enqueues snooze push). Chain is intact end-to-end — the current buttons DO post. The increment-3 BroadcastCard rewrite fixed it; this increment locks it.
- New behavioral test `tests/shift-chat-broadcast-ack.test.tsx` (happy-dom + RTL, 5/5): receiver sees 2 reply buttons; primary → `onAck("acknowledged")`; secondary → `onAck("snoozed")`; buttons hidden once acked; sender sees none. Locale-robust (queries by button role/order, not copy).
- `ShiftChatPanel.tsx` palette → tokens: online dot green→`hsl(var(--status-ok))` (+ glow), pinned banner amber→`--status-stale-*`, room-filter active blue→`primary` (×2), broadcast toggle indigo→`primary`, urgent toggle red→`--status-issue-fg`. `grep` of banned palette regex → 0 matches.
- New lock: ShiftChatPanel describe in `stage-9-emergency-token-consistency.test.js` (no-palette + status/primary token asserts).
- Gates: `stage-9` lock **15/15**, `shift-chat-broadcast-ack` **5/5**, `i18n-no-hebrew-in-source` pass, typecheck **0×2**, build exit 0.

**Verdict:** VERIFIED. BUG-002 (shift-chat Hebrew) fully cleared across BroadcastCard/types/MessageBubble/ShiftChatArchive/SystemCard; BUG-003 proven resolved + locked. Remaining Stage 9: BUG-001 (stale messages — `useShiftChat` accumulation not reset on shift change), standalone chat screen, richer Handover, `code-blue.tsx` restyle (frozen surface).

## 2026-07-02 — Stage 7 (Analytics & Management): palette→token + i18n + lock (delegated)

**Claim:** Converted the Stage 7 screens off hardcoded palette onto the `--status-*`/`--sys-*` tokens (single declaration, no `dark:` fork), cleared the last Hebrew from `shift-leaderboard.tsx`, and locked it with a token test. Implemented by a delegated sub-agent; gates re-verified by the orchestrator.

**Evidence (orchestrator-run, not agent-reported):**
- `git diff --stat`: `analytics.tsx` (+/−38), `management-dashboard.tsx` (20), `shift-leaderboard.tsx` (6), allowlist (−1). New file `tests/stage-7-analytics-token-consistency.test.js`.
- `analytics.tsx`: `STATUS_COLORS_HEX` (4×#hex) → `STATUS_COLORS` = `hsl(var(--status-{ok,issue,maintenance,sterilized}))`; Recharts `<Cell fill>`/`<Bar fill>`/grid `stroke`/axis tick `fill` → token refs; `contentStyle` border → `hsl(var(--border))`. Recharts token pattern matches shipped+verified precedent (`display.tsx:94` `stroke="hsl(var(--status-ok))"`, `TodayScreen.tsx:93` `stroke="var(--brand)"`) — `var()` resolves in SVG presentation attributes on the app's modern engines.
- `management-dashboard.tsx`: 3 summary tiles `dark:`-forked emerald/amber/red → single-declaration `var(--status-{ok,stale,issue}-{bg,border,fg})`; all-good check → `hsl(var(--status-ok))`.
- `shift-leaderboard.tsx`: Hebrew comment `{/* תוצאות */}` removed; zero-capture highlight → `var(--status-stale-*)`. Removed from `KNOWN_DEBT_ALLOWLIST` — both ratchet assertions hold.
- `audit-log.tsx`: **left unchanged** — already 0 palette / 0 Hebrew, delete-free (S7-D3 preserved), semantic-token classes. Prototype chip-filters/avatar-rows deferred (churn over a working Select filter, no defect benefit).
- Gates (orchestrator-run): `npx tsc --noEmit` → 0 errors; palette grep on the 3 pages → 0; Hebrew grep → 0; `i18n:check` → deep parity OK; `pnpm test` on `stage-7-*` + `i18n-no-hebrew-in-source` + `i18n-parity` → **16 passed**. Lock test = 3 describes / 10 asserts, RED-verified before GREEN.

**Verdict:** VERIFIED at gate level. **Deferred (flagged):** shift-leaderboard podium + week/month toggle, audit-log category chips + avatar rows (additive, need new keys + data restructure); live chart/theme render pending the stage-end manual Chrome pass (392/860/1180 · light/dark · en/he).

## 2026-07-02 — Stage 8 (Admin & Governance): palette→token + i18n + IA reconciliation (delegated)

**Claim:** Admin surfaces moved off hardcoded palette onto `--status-*`/`--sys-*` tokens, all Hebrew extracted (admin.tsx + admin-shifts.tsx off the allowlist), S8-D1 audit-logs tab removed (destination kept reachable), and AssetTypes given the responsive 2-col + dashed-empty layout. Delegated sub-agent; gates re-verified by orchestrator.

**Evidence (orchestrator-run):**
- `git diff --stat`: admin.tsx (−net, 62 lines churned), admin-shifts.tsx (38), AdminAssetTypesPage.tsx (27), locales en+he (+11 keys each), i18n.generated.d.ts (regen), allowlist (−2). New `tests/stage-8-admin-token-consistency.test.js`.
- Palette grep on all 3 files → **0**; Hebrew grep → **0**. admin.tsx + admin-shifts.tsx removed from `KNOWN_DEBT_ALLOWLIST` (both ratchet assertions hold).
- **S8-D1 audit-logs tab REMOVED**, reachability confirmed by orchestrator: `/audit-log` route (`routes.tsx:147`, behind AuthGuard+WebOnlyGuard), nav entry (`layout.tsx`), home link (`home.tsx`). Orphaned `AuditLogsSection` helper + unused `ClipboardList` import deleted; no dangling refs (`SharedAuditLogsPanel` remains only in its owner `audit-log.tsx`). `grep ClipboardList admin.tsx` → 0.
- i18n: +11 keys under existing spread roots (`adminPage` ×2, `adminShiftsPage` ×1, `adminAssetTypesPage` ×8) — no i18n.ts edit; 6 other admin strings mapped to pre-existing keys (`auditLogAdminOnly/Desc/GoHome`, `userRestored/RestoreFailed`, `common.loading`). Copy-appropriateness of the reused keys to confirm in the browser pass.
- Gates (orchestrator-run): `npx tsc --noEmit` → 0 errors; `i18n:check` → deep parity OK; `pnpm test` stage-8 lock + i18n guards → **18 passed** (lock = 3 describes/18 asserts incl. audit-tab-absent + shift-requests-tab-present + dashed-empty + md-grid).

**Verdict:** VERIFIED at gate level. **Orchestrator decision flagged — BUG-012:** the Admin "shift-requests" tab was **NOT** removed. `AdminShiftRequestsSection` (shift-adjustment approval queue, shipped in the shifts Phase-1 increments) is referenced only from admin.tsx; `/admin/shifts` is CSV *import*, not approvals — removing the tab would orphan a live feature. Kept per the reachability rule; moving approvals to a dedicated route is a separate task. **Deferred:** admin-shifts dashed dropzone + AssetTypes 2-col responsive layout need a browser/breakpoint pass; AssetTypes right-column auto-select intentionally not added (would be a data-fetch behavior change).

## 2026-07-02 — Stage 10 (Access & Onboarding): palette→token + auth i18n + dismissible whats-new (delegated)

**Claim:** help.tsx moved off 26 palette hits onto tokens; signin/signup Hebrew extracted to a new `authPage` namespace (both off the allowlist) with Clerk components left frozen; whats-new made version-keyed dismissible. Net-new/backend items flagged, not faked. Delegated sub-agent; gates re-verified by orchestrator.

**Evidence (orchestrator-run):**
- `git diff --stat`: help.tsx (75), signin.tsx (44), signup.tsx (34), whats-new.tsx (+38), i18n.ts (+2), locales en+he (+29 each), i18n.generated.d.ts (regen), allowlist (−2). New `tests/stage-10-access-token-consistency.test.js`.
- Palette grep on all 4 pages → **0**; Hebrew grep → **0**. `signin.tsx`+`signup.tsx` removed from `KNOWN_DEBT_ALLOWLIST` (ratchet holds).
- Clerk FROZEN respected: `<SignIn>`/`<SignUp>` components + auth props untouched; only app-rendered chrome (headings, role chips, helper copy) re-themed/extracted. New root `authPage` (24 keys) wired via one mapping line `authPage: d.authPage,` (`i18n.ts:1235`) — typecheck confirms `t.authPage.*` resolves.
- whats-new S10-D3: `dismissWhatsNew(version)`/`isWhatsNewDismissed(version)` persist against `getBundledAppVersion()` in localStorage; "Got it" dismisses + routes to /home. (`isWhatsNewDismissed` is an exported seam, no auto-surface caller yet — intended reader for the re-show trigger.)
- Gates (orchestrator-run): `npx tsc --noEmit` → 0 errors; `i18n:check` → deep parity OK; `pnpm test` stage-10 lock + i18n guards → **12 passed**.

**Verdict:** VERIFIED at gate level. **Flagged (not built — auth-safety / backend):** (1) `forgot-password.tsx` standalone page — Clerk's mounted `<SignIn>` already exposes forgot-password inside the component, so the flow isn't broken; a standalone page needs Clerk reset wiring with dev-bypass-safe fallback. (2) Licenses page — no LICENSE/NOTICE manifest exists in-repo to render. (3) S10-D2 sign-up→pending-approval queue — backend (couples to Stage 8 approvals). Role-chip chrome added; Clerk submit behavior unchanged. Live theme/breakpoint render pending manual Chrome pass.

## 2026-07-02 — Stage 9 (BUG-001): shift-chat stale messages across session change

**Claim:** Fixed BUG-001 — the chat panel retained messages from a prior shift session. Accumulation is now scoped to the current shift session; prior-session messages drop out.

**Evidence:**
- Root cause (traced in `useShiftChat.ts`): `allMessages` merged incoming polls by id but reset only on `isOpen` toggle (lines 54–62). When the active shift rolled over mid-open, the new session's messages were *appended* to the old session's and the old ones never left.
- Fix: extracted pure `mergeSessionScoped(prev, incoming)` → `src/features/shift-chat/message-scoping.ts` — takes the current session from the newest incoming message and filters out any accumulated message whose `shiftSessionId` differs; returns `prev` by reference when nothing changed (no needless re-render). Hook now calls it in the accumulation effect (inline merge removed).
- Lock: `tests/shift-chat-session-scoping.test.ts` (5 asserts): same-session accumulate, id-dedupe (ref-stable), **drop-prior-session-on-new-session** (the BUG-001 core — fails against the old inline merge), empty-batch ref-stable, mixed-boundary keeps only current session.
- Gates: `npx tsc --noEmit` → 0 errors; `pnpm test` on `shift-chat-session-scoping` + `shift-chat-broadcast-ack` → **10 passed**.

**Verdict:** VERIFIED at gate level. Residual edge (noted): a brand-new session with zero messages yet won't clear the prior transcript until its first message arrives (no session signal exists outside the message stream to trigger an earlier reset); the isOpen-close/reopen reset still covers the common per-shift path. BUG-001's mid-open cross-session leak is closed.

## 2026-07-02 — Stage 5 tail: DispenseSheet Hebrew → i18n (delegated)

**Claim:** Extracted all 36 hardcoded Hebrew strings from the dispense sheet into `dispense.sheet.*` locale keys with zero behavior change; removed the file from the Hebrew allowlist. Delegated sub-agent; gates re-verified by orchestrator.

**Evidence (orchestrator-run):**
- `grep '[֐-׿]' src/features/containers/components/DispenseSheet.tsx` → **0**.
- `git diff --stat`: DispenseSheet.tsx (72 lines, copy-only), locales en+he (+31 keys each), i18n.ts (+1 line `sheet: d.dispense.sheet,` at :435 — the `dispense` namespace is assembled by explicit member selection, not spread, so the member line was required), i18n.generated.d.ts (regen), allowlist (−1).
- Frozen surface respected: only user-facing strings (JSX text, `title`/`aria-label`, one `toast.error`) changed; dispense mutation / offline-block / validation / control flow untouched. `formatTimeHHMM("he-IL")` left as-is (locale identifier, not rendered copy).
- Gates (orchestrator-run): `npx tsc --noEmit` → 0 errors; `i18n:check` → deep parity OK; `pnpm test` `i18n-no-hebrew-in-source` + `i18n-parity` → **6 passed**. Allowlist ratchet holds.

**Verdict:** VERIFIED at gate level. Copy-fidelity note: `sheet.back` kept as a dedicated key (original `חזור`, imperative) rather than reusing `common.back` (`חזרה`) to preserve exact copy.

## 2026-07-02 — Cross-cutting unit 1: BUG-015 (settings re-render) + BUG-014 (settings dropdown)

**Claim:** Fixed the Master-Sound page-jump at its root cause (a full-app remount triggered by any settings toggle); BUG-014 required no change (the mobile settings dropdown already shipped). Delegated sub-agent; gates re-verified by orchestrator.

**Evidence (orchestrator-run):**
- **BUG-015 root cause (traced, not guessed):** `applySettings()` in `use-settings.tsx` called `setStoredLocale(settings.locale)` on every `update()`; `setStoredLocale` unconditionally dispatches `vettrack:locale-changed`; `main.tsx` keys `<App key={locale-${localeVersion}}>` off that event → every toggle remounted the whole tree and reset scroll. Master Sound surfaced it most because its handler `await`ed an audio tone before `update()`, landing the remount in a detached continuation.
- Fix (diff-reviewed): `use-settings.tsx` guards the broadcast — `if (settings.locale !== getStoredLocale()) setStoredLocale(...)` — lang/dir still always applied; `settings.tsx` `handleSoundToggle` no longer `async` (fires tone via `void`, commits `update()` synchronously like Dark mode); `settings-controls.tsx` `SettingsToggle` gets `type="button"` (defensive hygiene). This fixes the latent remount for ALL toggles, not just sound.
- **BUG-014:** verified in code — the mobile top-bar gear (`layout.tsx:927`) already opens a quick-settings dropdown (Dark/Display/Sound/Critical + "All settings" → /settings), shipped `e5375709`. `openSettingsPage` is only the dropdown's "See all" link + native slide-menu item, not the gear. No redundant refactor made. `/settings` reachable.
- Regression lock: `tests/settings-sound-toggle-no-remount.test.tsx` (5 asserts): no `vettrack:locale-changed` on mount or on soundEnabled/darkMode update; IS dispatched on real locale change; toggle button `type="button"`.
- Gates (orchestrator-run): `npx tsc --noEmit` → 0 errors; `i18n:check` → parity OK; palette+Hebrew grep on changed files → 0; `pnpm test` regression + i18n guards → **9 passed**.

**Verdict:** VERIFIED at gate level. **Needs device verification:** absence of the visible scroll/jump on a real iPhone WebView + pointer browser. **Flagged gap (separate from BUG-014):** the *desktop* web top bar (`layout/Topbar.tsx`, via WebShell) has no settings entry point at all — if a desktop settings affordance is wanted, that's a distinct additive task, not BUG-014.

## 2026-07-02 — Cross-cutting unit 2: scan platform model (BUG-004/005/011/016)

**Claim:** Unified the scan affordance behind one pure gate — iPhone = flat scan tab, iPad = FAB, web = none — resolving the flat-tab-vs-FAB conflict by platform context. Delegated sub-agent + one orchestrator follow-up edit; gates re-verified by orchestrator.

**Evidence (orchestrator-run):**
- New `src/lib/scan-affordance.ts`: pure `scanAffordance({isNative,isTablet}) → "tab"|"fab"|"none"` (`isNative = capacitorPlatform() !== "web"`, `isTablet = min-width:768px`) + `useScanAffordance()`. Lock `tests/scan-affordance.test.ts` (6 asserts, all combos + web-never/native-always invariants).
- `NativeTabBar.tsx`: raised ScanFab removed from the bar → flat scan **tab** (QrCode → /scan) only when affordance `"tab"` (BUG-016 phone: nothing on web-phone). `ScanFab.tsx`: self-gating fixed FAB, `null` unless `"fab"`, token colors only. `NativeTabSidebar.tsx` (iPad): removed sidebar-only scan item, renders `<ScanFab/>` (BUG-011). `home.tsx`: scan card gate `isDesktop`→`scanAffordance === "fab"` (hidden on web+iPhone, shown iPad).
- **Orchestrator follow-up:** gated the `?scan=1` deep-link in `home.tsx` — `if (scanAffordance === "none") return;` — so web can't open the scanner via URL (closes the BUG-016 residual the agent flagged).
- **BUG-004 verified not regressed:** `qr-scanner.tsx` close is `h-11 w-11` (44px), `paddingTop: max(1rem, env(safe-area-inset-top))`, inside the `createPortal` overlay (5113f60e intact). No scan/camera logic touched anywhere.
- Gates (orchestrator-run): `npx tsc --noEmit` → 0 errors; palette+Hebrew grep on all 6 changed files → 0; `i18n:check` → parity OK (reused `nav.equipmentScan`, no new keys); `pnpm test` scan lock + i18n guards → **12 passed**.

**Verdict:** VERIFIED at gate level. **Needs DEVICE verification** (iPhone + iPad simulators + desktop browser): iPhone flat tab, iPad FAB placement/safe-area over the sidebar, web shows no scan, scanner-close reachability under the notch. **Deferred (flagged):** legacy `layout.tsx renderScanFab` NOT gated — it carries 11 pre-existing palette hits (would fail the changed-files gate) and is reached only transiently via `EquipmentDetailSkeleton`; its raised FAB still renders there. Recommend a dedicated de-palette+gate follow-up (or retire the Layout skeleton). iPad currently shows both FAB + Today scan card (union of the phone/web removals); tighten to FAB-only if desired.

## 2026-07-02 — Cross-cutting unit 3: avatar upload (BUG-013) + top-bar avatar sizing (BUG-006)

**Claim:** Built profile-picture upload reusing the existing S3 storage pattern, persisted per-user (clinic-scoped), surfaced in profile + both top bars, and right-sized the mobile avatar. Delegated sub-agent; gates + migration convention re-verified by orchestrator.

**Evidence (orchestrator-run):**
- Backend reuse: `POST /api/uploads/avatar` added to `server/routes/uploads.ts` — `requireAuth`, multer image/5MB, `PutObjectCommand` via the existing `getS3Client()`, key `avatars/{userId}-{uuid}.{ext}`, then `db.update(users).set({avatarUrl}).where(and(eq(id), eq(clinicId)))` (**clinic-scoped** — multi-tenant rule). Returns 501 `OBJECT_STORAGE_NOT_CONFIGURED` when `S3_*` unset. `GET /me` (users.ts) now returns `avatarUrl`.
- Schema/migration: `avatarUrl text("avatar_url")` on `vt_users` (core.ts:24). **Migration convention verified:** `server/migrate.ts` applies numbered `migrations/*.sql` (tracked in `vt_migrations`), tail was 157; new `158_vt_users_avatar_url.sql` = idempotent `ALTER TABLE vt_users ADD COLUMN IF NOT EXISTS avatar_url TEXT`. (drizzle-kit generate fails in this env / is not the applied path — the numbered SQL is canonical; agent flagged, orchestrator confirmed against migrate.ts.)
- Frontend: `api.users.uploadAvatar(file)` (FormData); `ProfileHeroZone.tsx` upload UI (img/initials, file input, preview, 5MB+type validation, invalidates `/api/users/me`); `Topbar.tsx` (desktop) + `NativeHeader.tsx` (mobile) render `avatarUrl`. **BUG-006:** NativeHeader avatar 28px→24px (font 11→10) to match the 20px Settings/Alerts glyphs; 44px hit-area preserved. (Actual components differ from the my-profile.tsx/layout.tsx hints — agent implemented against the real `ProfileHeroZone`/`Topbar`/`NativeHeader`.)
- i18n: `profile.*` +5 keys (en+he parity), existing spread root. Lock `tests/upload-filename.test.ts` (8 asserts on `sanitizeUploadExtension`/`buildAvatarKey`).
- Gates (orchestrator-run): `npx tsc --noEmit` (frontend) **0** + `npx tsc -p tsconfig.server.json --noEmit` (server) **0**; `i18n:check` parity OK; `pnpm test` upload-filename + i18n guards → **13 passed**.

**Verdict:** VERIFIED at gate level. **BLOCKED on infra:** a Railway object-storage bucket must be provisioned + `S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_PUBLIC_URL` (+`S3_ENDPOINT`/`S3_REGION`) set — until then the route returns 501 by design (Railway MCP is unauthorized this session; provisioning is a user CLI/dashboard step). **Needs browser/device verification:** upload flow + preview + resized top-bar avatars. Pre-existing `bg-indigo-600` on Topbar.tsx:53 left untouched (out of scope).

## 2026-07-02 — Avatar storage: Railway bucket provisioned + private-bucket serving (unblocks BUG-013)

**Claim:** Provisioned a Railway object-storage bucket, wired its credentials onto the VetTrack service, and reworked avatar serving for Railway's private-bucket model (store key → presign on read), unblocking the BUG-013 upload path that shipped returning 501.

**Evidence:**
- **Bucket created (Railway MCP, now authorized):** `vettrack-uploads` (id `2cae2fe7-0388-47b8-ab17-c765bc4cfcb4`, region `ams` / EU West), project `pacific-flow` (`adf88531…`), environment `production`.
- **Credentials wired as reference variables** on service `VetTrack` (`551051c2…`) via `add_reference_variable` (secret values never entered the transcript): `S3_BUCKET←${{ vettrack-uploads.BUCKET }}`, `S3_ACCESS_KEY_ID←ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY←SECRET_ACCESS_KEY`, `S3_REGION←REGION`, `S3_ENDPOINT←ENDPOINT`. Set with intent to not clobber; **not** redeployed yet (current deployed code still assumes a public URL — deploy must carry the code change below).
- **Design finding (verified against Railway docs `/storage-buckets`):** Railway buckets are **private-only** — no public object URL. The shipped code stored `${S3_PUBLIC_URL}/${key}` and rendered it directly, which would 403. `S3_PUBLIC_URL` was therefore intentionally left unset. User chose the presigned-URL serving model (docs' recommended pattern).
- **Code change:** new `server/lib/object-storage.ts` centralizes `getS3Client()`/`isObjectStorageConfigured()` (moved out of `uploads.ts`) + `presignObjectUrl(keyOrUrl)` (1h TTL, passes absolute URLs through, null when unconfigured). `uploads.ts` avatar handler now persists the object **key** in `vt_users.avatar_url` and returns a freshly presigned URL. `users.ts` `GET /me` presigns the stored key before returning `avatarUrl`. Frontend unchanged (still renders `avatarUrl`).
- **Dependency:** added `@aws-sdk/s3-request-presigner@3.1037.0` (pinned to match `@aws-sdk/client-s3@3.1037.0` — the floating `@3` pulled a newer `@smithy/types` and broke the `S3Client` type; pinning resolved it).
- **Gates:** `pnpm typecheck` (frontend **0** + server **0**); `pnpm test tests/upload-filename.test.ts` → **7 passed**; new `tests/object-storage.test.ts` → **4 passed** — including a real presign asserting the URL carries `storage.railway.app`, the object key, `X-Amz-Signature=`, and `X-Amz-Expires=3600` (offline crypto, no network).
- **Flagged (out of scope, same latent bug):** `POST /api/uploads/fault-image` still builds `${S3_PUBLIC_URL}/${key}` — now that S3 is configured its PutObject will succeed but yield an unusable `undefined/...` URL. Needs the same store-key + presign-on-read treatment at the fault read site before fault images are relied upon.

**Verdict:** VERIFIED at gate level. **Needs deploy + device verification:** deploy the new code to VetTrack (the env vars are set but the running image predates the presign change), then confirm real upload → presigned render in the app on iPhone/desktop.

## 2026-07-02 — fault-image: same private-bucket fix as avatar

**Claim:** Applied the avatar private-bucket treatment to `POST /api/uploads/fault-image` — drop the broken `${S3_PUBLIC_URL}/key` construction, add the 501-unconfigured guard, return a presigned URL via the shared helper.

**Evidence:**
- `uploads.ts` fault-image handler now: (1) returns 501 `OBJECT_STORAGE_NOT_CONFIGURED` when `S3_*` unset (matching /avatar); (2) after PutObject, returns `{ success, url: presignObjectUrl(key), key }` instead of `${S3_PUBLIC_URL}/${key}`. `key` is surfaced so a long-term caller can persist the key and presign on read.
- **Verified fault-image is currently dead code:** `grep -rn "fault-image" src` → 0 hits (no client caller). The live photo path (`equipment-detail.tsx`) reads files via `FileReader.readAsDataURL` and stores base64 **data URLs** directly in `scan_logs.photo_url` — it never touches S3. So this is a correctness/future-proofing fix, not a live-path change.
- `pnpm typecheck:server` → 0 errors.
- **Flagged (pre-existing, out of scope):** scan/report photos are persisted as inline base64 data URLs in `scan_logs.photo_url` (rendered directly in EquipmentDetailActivityTab). If those should move to bucket storage, that's a separate migration (wire the upload → store key → presign at the equipment/scan read sites), not covered here.

## 2026-07-02 — Cross-cutting unit 4: nav/profile/settings shell parity (desktop Topbar)

**Claim:** Restored the alerts bell + settings entry point that the newer `PageShell`/`Topbar` web shell dropped during the shell migration (the legacy `layout.tsx` still carried them), added a desktop quick-settings dropdown mirroring the mobile `NativeHeader`, verified profile routing is already consistent across shells, and gated the legacy raised scan FAB off the web surface. Browser-verified live (light + dark).

**Evidence (this session):**
- **Audit reconciliation:** the morning stage-design-audit (workflow `wf_963a03c6`) flagged "verify PageShell topbar renders … alerts bell with red unread badge … + settings entry" (Stage 3 gap); an earlier proof entry flagged "desktop web top bar has no settings entry point." Live-verified both pre-change: `Topbar.tsx` right-controls were `ShiftBadge + UserAvatar` only — no bell, no gear; NAV model exposes `alerts` as a plain text link and **no** `/settings` anywhere in desktop nav.
- **A (nav-chrome material tokens):** already present — `--hairline/--bar-bg/--bar-bg-opaque/--bar-blur` at `index.css:121-124` (light) / `325-327` (dark) + `@media (prefers-reduced-transparency: reduce)` opaque override at `:494-495`. No work needed (audit was ~14h stale on this).
- **B (alerts bell):** wired the existing, already-designed `AlertsDropdown` (bell color `--brand-green-bright`, tuned for the navy bar) into `Topbar.tsx`, fed by the same `computeAlerts` + `countActiveAlerts(buildAlertAckSet())` path the legacy layout + mobile header use, plus a local badge-pop effect. Added an optional backward-compatible `buttonClassName` to `AlertsDropdown` so its 44px trigger fits the 40px (`h-10`) bar (`h-8 w-8 min-h-0 min-w-0`); legacy call site unchanged (default keeps 44px).
- **C (settings entry point):** new `src/components/layout/TopbarSettingsMenu.tsx` — self-contained gear → quick-settings dropdown (Dark mode switch, Language toggle, My Profile, All settings → `/settings`), reusing existing `nav.*` i18n keys + `useSettings` (no new keys → parity unaffected). Kept separate from the device-verified mobile `NativeHeader` rather than refactoring it.
- **D (profile shell/routing):** verified, no change — `/my-profile` is `AuthGuard`-routed, `AppShell`-wrapped, reachable from mobile `NativeHeader` (avatar + settings row), `MoreSheet`, desktop `Topbar` avatar, and the new gear dropdown.
- **E (legacy scan FAB gate):** `layout.tsx` `renderScanFab` now returns `null` when `useScanAffordance() === "none"` (web) — closes the BUG-016 residual (raised FAB leaking onto web via the transient EquipmentDetailSkeleton). Native (`tab`/`fab`) stays byte-for-byte. iPhone-flat-tab-in-legacy-layout remains a documented deferral (per the Unit-2 note).
- **Search field ('/' hint):** deferred + flagged — needs a real global-search feature; a decorative dead input would violate the anti-template rule.
- **Gates:** `npx tsc --noEmit` → **0 errors**; targeted locks `scan-affordance` + `i18n-parity` + `i18n-no-hebrew-in-source` → **12 passed**; palette scan on new/changed lines → clean (pre-existing `bg-indigo-600` active-nav pill at `Topbar.tsx:90` left untouched, already flagged out-of-scope in the avatar unit).
- **Browser (dev server :5000, Chrome MCP, desktop width):** Topbar renders bell (red **2** badge) + gear + avatar. Gear → quick-settings dropdown opens; **"All settings" navigates to `/settings`** and the page renders fully (Display/Push/Sound). Bell → alerts dropdown lists the 2 active alerts ("E2E Test Equipment", "QA Test Monitor") + "See all alerts"; badge count = dropdown count = 2. Toggled Dark mode → whole app + the new dropdown render correctly on `--popover` dark tokens, and the toggle did **not** remount/reload the page (BUG-015 stays fixed).

**Verdict:** VERIFIED at gate + live-browser level (light + dark). **Note:** the desktop Topbar is a pointer/web surface (not shown in the native iOS shell), so no simulator pass is required for it; the legacy scan-FAB gate on real iPhone/iPad (native `tab`/`fab` unchanged) is covered by the scan-affordance unit test but not re-run on-device this session. **Deferred (flagged):** global search field; iPhone-flat-tab in the legacy layout bottom nav.

## 2026-07-02 — Unit 4 follow-up: topbar equipment-search field ('/' hint)

**Claim:** Implemented the design's topbar search field (Stage 3 expanded topbar — `searchPlaceholder` "Search equipment" + `/` kbd) as a real entry point to the **existing** equipment search, not a decorative input. Browser-verified end-to-end.

**Evidence (this session):**
- **Not a new backend — URL-as-state:** `src/features/equipment/hooks/use-equipment-filters.ts` derives its query from `useSearch()` → `params.get("q")`, and `/equipment` (`equipment-list.tsx`) renders the filtered list from it. Server already supports `ilike` search on equipment. So the topbar search only needs to `navigate('/equipment?q=<query>')`.
- **New `src/components/layout/TopbarSearch.tsx`:** owns local input state only; on submit → `navigate('/equipment?q=' + encodeURIComponent(q))` (empty → `/equipment`), then blurs. Global `keydown` handler focuses it on `/` and `preventDefault()`s the slash, but bails when `activeElement` is INPUT/TEXTAREA/contentEditable so `/` stays literal while typing. Reuses `t.equipmentList.search.placeholder` (no new i18n key → parity untouched). `hidden lg:flex` per the design's expanded breakpoint. Translucent-on-navy styling (`bg-white/10`) to cohere with the bar's existing `text-white/60` treatment rather than a stark light pill.
- **Wired into `Topbar.tsx`** as the leading item of the right-control cluster (search → shift badge → bell → gear → avatar), matching the prototype order.
- **Gates:** `npx tsc --noEmit` → **0 errors**.
- **Browser (dev :5000, Chrome MCP, 1456px wide, dark):** field renders in the topbar (magnifier + placeholder + `/` kbd). Typed "monitor" + Enter → URL became `/equipment?q=monitor`, the equipment page's own search bar pre-filled "monitor", and the list filtered to **"1 of 1 items — QA Test Monitor"**. Then clicked page body, pressed `/` → topbar search focused with **no literal slash inserted**; typed "vital" → appeared in the field. Both paths confirmed.

**Verdict:** VERIFIED at gate + live-browser level. **Behavior note:** the topbar search is a *launcher* — it clears on submit and hands the active query to the equipment page's own search bar (which displays it). Syncing the topbar input back from `?q` when already on `/equipment` was intentionally not added (the page owns the active-query display). Desktop/pointer surface — no simulator pass required.

## 2026-07-02 — Unit 4 follow-up: iPhone flat scan-tab in the legacy layout bottom nav

**Claim:** Made the legacy `layout.tsx` bottom-nav scan slot affordance-aware so it no longer flashes the raised FAB on iPhone — flat emphasized scan tab on phone (`"tab"`), raised FAB on tablet (`"fab"`), nothing on web (`"none"`). Closes the last piece of the BUG-016 scan-model residue.

**Evidence (this session):**
- **Scoped the blast radius first:** `grep` for `<Layout` shows the legacy `Layout` (`src/components/layout.tsx`) is mounted in **exactly one place** — `src/components/skeletons/equipment-detail-skeleton.tsx` (the equipment-detail loading skeleton). It is not a live shell for any route; the real loaded bottom bar is `NativeTabBar` (already correct from Unit 2). So the only defect was the *loading skeleton* flashing the wrong scan affordance before the loaded page renders the right one.
- **Fix:** added `renderScanTab()` (flat `QrCode` tab, `ivory-green` brand tint, `min-h-[52px]` matching `renderBottomNavTab`, same `handleScanButtonClick` action + `scannerUIOpen` X-swap as the FAB) and made `renderScanFab` a 3-way dispatch: `"none"` → `null`, `"tab"` → `renderScanTab()`, else (`"fab"`) → the existing raised FAB. Occupies the same center grid slot, so the 5-col bar layout is unchanged; iPhone now shows a flush flat tab instead of the raised FAB. Mirrors `NativeTabBar`'s `affordance === "tab"` branch (`QrCode` scan tab).
- **Gates:** `layout.tsx` compiles clean — `tsc` errors are **0 in my file** (see the separate i18n.ts note below). `tests/scan-affordance.test.ts` (the decision function this consumes) → passes. 
- **Verification ceiling (honest):** this surface is **Capacitor-native-gated** — `scanAffordance` resolves `"none"` whenever `capacitorPlatform() === "web"`, so it renders nothing in desktop Chrome *and* in a mobile-sized web context. It is therefore **not browser-verifiable**; it needs an iOS/Android simulator pass on the equipment-detail loading state. Covered here by: the pure scan-affordance unit test, typecheck, and logic review against the verified `NativeTabBar` pattern. No Layout-render test added (mounting the legacy skeleton — many hooks/queries — is disproportionate for a transient loading surface; the affordance decision is already unit-tested).

**Verdict:** VERIFIED at gate level (typecheck + scan-affordance unit test + parity with NativeTabBar). **NEEDS DEVICE verification** (iPhone flat tab / iPad FAB on the equipment-detail loading skeleton) — cannot be reproduced in any web context by design.

## 2026-07-02 — ⚠️ FLAG (not mine): `src/lib/i18n.ts` has a duplicate `formatDateTimeByLocale`

`src/lib/i18n.ts` (modified in the working tree this session by a concurrent background job — mtime post-dates my edits; not listed dirty at my session start) declares `export function formatDateTimeByLocale` **twice** — at L79 (`date.toLocaleString(locale, options)`) and L95 (`Date | string`, localeTag + `{dateStyle:"medium",timeStyle:"short"}` defaults). This yields `tsc` **TS2323 + TS2393 ×2 = 4 errors**, the repo's only current type errors. Left untouched per the "don't stomp another agent's in-flight file" rule. The L95 version (documented, accepts `Date | string`, has defaults) looks like the intended keeper; the L79 stub looks like the leftover — but the owning job should reconcile. Flagging so a green `tsc` isn't mistakenly attributed to this unit's commits.

## 2026-07-03 — Stage 1–10 audit remediation: 2 MEDIUM findings fixed

**Context:** Reviewed the Stages 1–10 design work (PR #38 + precursors) through three skill lenses — `product-design-fundamentals`, `apple-platform-ux`, `vettrack-codebase-relevance-audit`. Most of the surface is token migration already guarded by the stage-N lock tests; the two defects below were outside that net. (The i18n.ts duplicate flagged in the entry above is now reconciled — `pnpm typecheck` returns 0 errors this session.)

**Finding 1 (MEDIUM, correctness) — avatar pinned to a revoked object URL.**
- **Verified real:** `src/features/profile/ProfileHeroZone.tsx` displays `avatarUrl = previewUrl ?? me?.avatarUrl`. `previewUrl` was cleared only in the `catch`; on success it stayed set while `finally` called `URL.revokeObjectURL(localPreview)`. Net: after a successful upload the `<img>` src was a *revoked* `blob:` URL that masked the refetched server URL for the component's lifetime — visually "works" only because a decoded `<img>` often survives revocation, but breaks on any re-decode/remount (Capacitor WKWebView).
- **Fix:** added `setPreviewUrl(null)` on the success path (after `invalidateQueries` has already refreshed `me`) so the render falls through to the real presigned URL before the blob is revoked.
- **Test:** new `tests/profile-avatar-upload.test.tsx` (happy-dom, 3 cases): success renders `SERVER_URL` (not `OBJECT_URL`) + revokes the preview; non-image rejected without calling upload; upload failure clears preview → falls back to initials + error toast. Genuine regression lock — against the pre-fix code the success assertion `img.src === SERVER_URL` fails (src would be the revoked blob). Harness note: seeded the QueryClient cache to `success/fresh` so post-upload `invalidateQueries` issues a real refetch instead of coalescing with a still-pending mount fetch.

**Finding 2 (MEDIUM, design-system + dark-mode) — hardcoded tab-bar separator.**
- **Verified real:** `src/native/NativeTabBar.tsx:106` used `borderTop: "0.5px solid rgba(60,60,67,0.18)"` — a fixed light-mode iOS separator. In dark mode (`--background` near-black) an 18%-opacity dark line is effectively invisible, and it's exactly the token drift the PR set out to remove. `NativeHeader.tsx:102` already uses `hsl(var(--border))` for the symmetric bottom border. (Confirmed the other native-shell literals — `#fff` badge text on `--destructive`, the switch thumb, black-alpha shadows — are defensible, not drift.)
- **Fix:** `borderTop: "0.5px solid hsl(var(--border))"` — adapts per theme, matches the header.

**Gates (this session):**
- `pnpm typecheck` (frontend + server) → **exit 0, 0 errors**.
- `pnpm test tests/profile-avatar-upload.test.tsx` → **3 passed**; `tests/mobile-shell.test.tsx` (renders the edited tab bar) → **passed** (18 in the combined run).
- No i18n keys added (comments English-only) → parity/`i18n-no-hebrew-in-source` unaffected.

**Verdict:** VERIFIED at gate + unit level. **Not device-verified this session:** the dark-mode separator is a visual change on the native shell — the token resolves correctly (`--border` defined in the dark `:root` block of `index.css`) and renders in jsdom, but the actual dark-mode appearance on iPhone/iPad was not re-checked in a simulator. **Deferred (documented, not fixed):** SVG-accepting upload filter (LOW–MED security), duplicated `768` breakpoint constant (LOW), viewport-width tablet classification for landscape phones (LOW), and the `MobileTabBar` re-export shim delete-candidate (cleanup) — all filed to the audit summary for the codebase-cleanup backlog.

## 2026-07-03 — Audit finding #3 fixed: upload MIME trust (SVG stored-XSS vector)

**Claim:** Closed the LOW–MED upload finding — `server/routes/uploads.ts` accepted any file whose *client-declared* Content-Type began with `image/`, so `image/svg+xml` (script-capable, executes on top-level navigation to the presigned URL) passed, and a lied mimetype (SVG bytes labeled `image/png`) also passed and was stored with the attacker's declared ContentType.

**Evidence (this session):**
- **Root cause confirmed real:** pre-change `fileFilter` was `if (!file.mimetype.startsWith("image/")) cb(new Error("Images only"))`; both `PutObjectCommand`s stored `ContentType: req.file.mimetype` (client-controlled). Verified no test exercised the filter, so no behavioral test was silently relying on the hole (`rg` over tests/server).
- **Fix — content-based allowlist (the authoritative control):** new dependency-free `server/lib/image-signature.ts` → `detectImageType(buffer)` identifies PNG/JPEG/WebP/GIF/HEIC/HEIF/AVIF by magic bytes and returns `null` for anything else. SVG is XML text with no binary signature, so it is rejected *regardless of the declared mimetype* — this defeats the lied-mimetype bypass, which a mime allowlist alone would not. `file-type`/`sharp` are not deps and were intentionally not added (KISS; smaller supply-chain surface).
- **Wiring:** both `/avatar` and `/fault-image` now (a) reject at the multer filter if the declared type isn't `image/*` or is exactly `image/svg+xml` (cheap early reject, never buffers an SVG), then (b) after buffering, `detectImageType(req.file.buffer)` → 400 `INVALID_FILE_TYPE` on `null`, and (c) store `ContentType: detectedType` — never the client's claim. `rg` confirms zero remaining `req.file.mimetype` used as ContentType.
- **Tests:** new `tests/image-signature.test.ts` (5 cases): positive detection for all allowed formats incl. HEIC/AVIF/HEIF `ftyp` brands; SVG rejected in three framings (`<?xml`, bare `<svg`, BOM+whitespace) incl. an `onload`/`<script>` payload; HTML + a real video `ftyp` brand (`qt  `) rejected; empty/short/`null` buffers return `null` without throwing; content-only invariant (PNG bytes stay PNG whatever the name). **5 passed.**
- **Gates:** `pnpm typecheck` (frontend + server) → **exit 0**. Upload suites `upload-filename` + `object-storage` + `image-signature` + `profile-avatar-upload` → **19 passed / 4 files**.

**Verdict:** VERIFIED at gate + unit level. **Not exercised this session:** a live multipart POST against the running route (the route wiring is thin — filter + `detectImageType` + `PutObject` with the detected type — and the decision function is unit-tested directly). **Further hardening left as a note (not done):** `Content-Disposition: attachment` on stored objects as belt-and-suspenders for navigation is now redundant given only genuine raster types are stored with correct raster ContentType; the client `accept="image/*"` was left as-is since the server is the authority.

## 2026-07-03 — Audit findings #4 + #5 fixed: tablet-viewport single source + landscape-phone classification

**Claim:** Consolidated the duplicated tablet-breakpoint logic (#4) and fixed the viewport-width tablet misclassification of large phones in landscape (#5), on the same branch.

**Evidence (this session):**
- **Scoped the blast radius first (mandatory before the behavioral #5 change):** `rg` showed the `(min-width: 768px)` reactive hook was hand-rolled in **three** places — `src/native/NativeShell.tsx` (`useIsTablet`, forks sidebar vs tab bar), `src/features/settings/MoreSheet.tsx` (drag-to-dismiss gating), and `src/lib/scan-affordance.ts` (fab vs tab). Critically, `PlatformRouter` routes **mobile-web** users into `NativeShell` too (`WebShell.tsx:19`), and **desktop web uses `WebShell`, not `NativeShell`** — so changing `NativeShell`'s classifier affects touch phones/tablets (native + mobile-web) but **not** desktop web (no desktop sidebar regression risk).
- **#4 — single source of truth:** new `src/lib/use-tablet-viewport.ts` exports `TABLET_MIN_WIDTH=768`, `TABLET_MIN_HEIGHT=500`, `TABLET_MEDIA_QUERY` (built from the constants — no drift), a pure `isTabletViewport(w,h)`, an SSR-safe `matchesTabletViewport()`, and the reactive `useIsTabletViewport()`. All three call sites now import it; their local hooks/`matchMedia` copies were removed (and now-unused `useEffect`/`useState` imports trimmed). `rg "min-width: 768px"` over `src` returns only the module's own doc comment.
- **#5 — `(min-width: 768px) and (min-height: 500px)`, not shorter-side-768:** the min-height guard drops landscape phones to the phone shell. 500 sits in the empty gap between the largest phone short side (~430pt, iPhone Pro Max) and the smallest tablet short side (~744pt, iPad mini). Verified this does **not** regress iPad mini: its landscape height 744 ≥ 500 stays tablet, and its portrait (744 width < 768) stays phone — identical to the previous width-only behavior. A naive "shorter-side ≥ 768" fix WOULD have regressed iPad mini landscape (744 < 768); that trap was explicitly avoided.
- **Tests:** new `tests/tablet-viewport.test.ts` (4 cases) locks the device matrix — phones non-tablet in both orientations (incl. the landscape 932×430 case that was the bug), iPad mini no-regression, standard/Pro iPads tablet both ways, inclusive floors, and the media-query-built-from-constants invariant. Existing `tests/scan-affordance.test.ts` (the pure `scanAffordance({isNative,isTablet})` gate — unchanged signature) stays green, as does `tests/mobile-shell.test.tsx` (renders the shell/tab bar). **28 passed across the 3 files.**
- **Gates:** `pnpm typecheck` (frontend + server) → **exit 0**.

**Verdict:** VERIFIED at gate + unit level. **Behavior change (honest ceiling):** the only runtime difference vs before is that large phones in **landscape** now render the phone shell (bottom tab bar + flat scan tab) instead of the tablet sidebar + FAB — the intended #5 fix. No iPad behavior changes. Not device-verified in a simulator this session; the change is reasoned against the concrete device dimension matrix (unit-tested) and touches only the phone-landscape case. **Deferred (cleanup, not started):** the `MobileTabBar` / `MobileShell` re-export shims (delete-candidates pending the `rg` consumer confirmation).

## 2026-07-03 — Shift chat: clear messages when the shift ends (BUG-001 residual)

**Claim:** Fixed "on shift chat the messages still appear" — the panel now shows only the current open shift's messages and empties immediately when the shift ends / there is no open shift (user-confirmed target: "empty immediately").

**Evidence (this session):**
- **Root cause (traced, not guessed):** the server (`server/routes/shift-chat.ts:57–73`) is already authoritative — it returns only the open shift's messages and `{ messages: [] }` when no shift is open, and honors incremental `after` (`gt(createdAt, afterDate)`). The client accumulates across polls, and the previous `mergeSessionScoped` **early-returned on an empty batch** (`incoming.length === 0 → return prev`), so a shift ending (server → `[]`) left the old messages pinned on screen. An empty batch was ambiguous ("no new messages" vs "no open shift"), so the client couldn't clear safely.
- **Fix — server-authoritative session id:** server now includes `shiftSessionId: shift?.id ?? null` in **both** response paths (`shift-chat.ts:59` no-shift, `:140` normal). Added to the `MessagesResponse` type. New `reconcileMessages(prev, incoming, prevSessionId, currentSessionId)` replaces `mergeSessionScoped`: `currentSessionId === null` → clear immediately; `!== prevSessionId` → swap in the incoming batch (rollover); same session → append + dedupe by id. `useShiftChat` tracks `sessionRef` and reconciles every poll against `data.shiftSessionId` (reset on open/close).
- **Empty state:** `ShiftChatPanel` already renders `<EmptyState message={t.shiftChat.panel.empty}>` at 0 messages, so a shift-end clears gracefully (verified `ShiftChatPanel.tsx:194–197`).
- **Tests:** rewrote `tests/shift-chat-session-scoping.test.ts` for `reconcileMessages` (8 cases): the headline `null → []` clear, empty-stays-empty by reference, first-open full batch, same-session append/dedupe/empty-by-ref, rollover swap, boundary-mixed scoping. **8 passed.** Server response-shape test (`server/tests/shift-chat.test.ts:40`) checks additively (`"pinnedMessage" in body` + arrays) — the new field does not break it.
- **Gates:** `pnpm typecheck` (frontend + server) → **exit 0**. No stale `mergeSessionScoped` references remain.

**Verdict:** VERIFIED at gate + unit level. **Not exercised this session:** a live shift-rollover against the running server (unit-tested the pure reconcile + confirmed the server now emits the disambiguating field; the poll wiring is a thin effect over it).

## 2026-07-03 — Equipment search: on iPhone + iPad (adaptive) with live typeahead; placeholder no longer cut off

**Claim:** The equipment search entry (desktop-only, `hidden lg:flex`) is now on iPhone and iPad, adaptively (inline field on iPad, icon→overlay on iPhone), with a live typeahead dropdown; and the cut-off "Search by name, serial number, model…" placeholder now fits. User-confirmed target: "adaptive + dynamic dropdown as user starts typing."

**Evidence (this session):**
- **Shared logic, no extra fetch:** new `src/features/equipment/hooks/use-equipment-search.ts` filters the SAME `["/api/equipment"]` query the shell already caches (NativeHeader alerts), so the typeahead adds zero network and filters in-memory (no debounce needed). `matchesEquipmentQuery` reuses the exact fields the list search uses (name/nameHe/serial/model/location).
- **Shared component:** `src/components/search/EquipmentSearchBox.tsx` — tone-aware (`bar` = navy topbar, `surface` = themed), input + results dropdown, keyboard nav (↑/↓/Enter/Esc), click→`/equipment/:id`, Enter→`/equipment?q=…`. Dropdown hides when there are no matches (so no new "no results" i18n key was needed — **zero new i18n keys**, parity untouched).
- **Adaptive placement (via the unit-tested `useIsTabletViewport`):** `NativeHeader` renders the inline field on tablet and `EquipmentSearchButton` (leading icon → top search overlay) on phone — placed at the LEADING edge so it doesn't crowd the centered wordmark or the settings/profile/alerts trio. Desktop `TopbarSearch` now delegates to `EquipmentSearchBox tone="bar"` (keeps the "/" focus shortcut) in a wider `w-[min(340px,30vw)]` container — the width fix for the cut-off placeholder (the old 240px field + kbd badge truncated it).
- **Tests:** `tests/equipment-search.test.ts` (matcher, 8) + `tests/equipment-search-box.test.tsx` (happy-dom typeahead: type→filtered results, click→detail nav, Enter→filtered list, no-match→no dropdown, 4). **12 passed.** `pnpm typecheck` (frontend + server) → **exit 0**.
- **Browser-verified (dev :5000, Chrome MCP, 1440px desktop):** the topbar placeholder renders in FULL ("Search by name, serial number, model…") — no longer cut off; typing "monitor" showed a live dropdown with "QA Test Monitor"; clicking it navigated to `/equipment/1111…` (the detail). Screenshots captured.

## 2026-07-03 — PR #39 CodeRabbit review remediation

**Claim:** Addressed CodeRabbit's review on PR #39 — fixed the 2 Major + 4 lesser findings that verified against the code; skipped 1 out-of-scope nit.

**Evidence (this session):**
- **Major — upload fileFilter → 500 (`server/routes/uploads.ts`):** confirmed real — `upload.single("image")`'s `fileFilter` rejection flows to `next(err)` and the app-level handler (`server/index.ts:375`) returns a generic 500, never the route `catch`. So SVG/non-image uploads returned 500 instead of the intended 400. Fix: new `uploadSingleImage` middleware maps multer errors (`LIMIT_FILE_SIZE`, "Images only", other) to 400 `apiError`; removed the now-dead "Images only" catch branches in both handlers.
- **Trivial (#9) — duplicated validation:** extracted `validateImageBuffer(buffer, res, requestId)` (magic-byte check + shared 400 response) used by both `/fault-image` and `/avatar`.
- **Major — modal a11y (`EquipmentSearchButton.tsx`):** the phone search overlay (`role="dialog"`) had no Escape-to-close and no focus trap. Added an `open`-scoped `keydown` effect: Escape → `setOpen(false)`, Tab/Shift+Tab cycle within the dialog's focusables (`dialogRef`).
- **Minor — Enter on stale index (`EquipmentSearchBox.tsx`):** `results[active]!.id` could throw if a background refetch shrank `results`; guarded with `active < results.length` and dropped the non-null assertion.
- **Minor — auth guard (`use-equipment-search.ts`):** added `enabled: !!userId` (via `useAuth`) so the shared `["/api/equipment"]` query matches sibling queries and never fires pre-auth. Component test now mocks `@/hooks/use-auth`.
- **Minor — restate-the-code comments (`message-scoping.ts`):** removed the three per-branch comments (top-level doc already explains the why), per the project comment guideline.
- **Test coverage (#7):** added an ArrowDown→Enter keyboard-nav test to `equipment-search-box.test.tsx` (exercises the `active`/`results.length` path). Removed the redundant content-only PNG assertion from `image-signature.test.ts` (#8 — no name/mime param, duplicated the first case).
- **Skipped (#6, TASKS.md):** the "expand inventory-deduction removal task" nit is about a *future* cleanup task's completeness (touching `dispense.service.ts` + `start-schedulers.ts`) — out of scope for this remediation PR; not a defect in this PR's code.
- **Gates:** `pnpm typecheck` (frontend + server) → **exit 0**. Affected suites (image-signature, equipment-search + box, shift-chat scoping) → **25 passed / 4 files**.

**Verdict:** VERIFIED at gate + unit level. Not re-exercised live: the upload 400-vs-500 path (thin middleware over multer, reasoned + typechecked) and the overlay focus trap (needs the mobile shell, unreachable in-browser here — same ceiling as the feature's original mobile verification).

## 2026-07-03 — PR #39 follow-up: extract shared useFocusTrap (CodeRabbit re-review)

**Claim:** Addressed the one remaining CodeRabbit nitpick from the re-review — centralized the overlay Tab/Escape handling into a shared `useFocusTrap` hook.

**Evidence (this session):**
- **Verified the premise (partly false):** `MoreSheet` did NOT actually have a Tab focus-trap — only `dialogRef.focus()` on open + an element-level `onKeyDown` Escape (`MoreSheet.tsx:50,54`). So the logic wasn't literally "duplicated"; the honest framing is that extracting a shared hook creates a real second consumer AND upgrades MoreSheet's a11y (it now traps Tab). That flips my earlier skip (a single-caller hook would have violated the repo's own hooks guideline) into a justified change.
- **New `src/hooks/use-focus-trap.ts`:** `useFocusTrap({ active, containerRef, onEscape })` — Escape → `onEscape`, Tab/Shift+Tab cycle within the container's focusables. Initial focus stays with each caller (search overlay = input `autoFocus`; MoreSheet = `dialogRef.focus()`). `onEscape` read via a ref so inline callbacks don't re-subscribe the listener each render.
- **Consumers:** `EquipmentSearchButton` replaced its inline effect with the hook (behavior-preserving). `MoreSheet` adopted the hook and dropped its element-level Escape `onKeyDown` (Escape now global-while-open; drag/touch handlers untouched).
- **Tests:** new `tests/use-focus-trap.test.tsx` (4) — Escape fires `onEscape`, Tab wraps last→first, Shift+Tab wraps first→last, inactive is a no-op. `mobile-shell` (renders MoreSheet) + `equipment-search-box` still green.
- **Gates:** `pnpm typecheck` (frontend + server) → **exit 0**; focus-trap 4/4; mobile-shell + search-box 23/2.

**Verdict:** VERIFIED at gate + unit level. The MoreSheet a11y upgrade (now traps Tab) is unit-tested via the hook but not re-exercised on the live mobile shell this session.

## 2026-07-03 — Equipment search (original verification, retained below)

**Claim:** VERIFIED at gate + unit + component level, plus live desktop browser (placeholder fit + typeahead + result navigation). **Verification ceiling (honest):** the mobile adaptive rendering (iPhone leading icon + search overlay, iPad inline field) could NOT be rendered in-browser this session — `resize_window` to phone/tablet widths reported success but the extension kept screenshotting at desktop width, so the app never dropped into the mobile `NativeShell`. The mobile paths are covered by the component test (the same `EquipmentSearchBox`), the unit-tested `useIsTabletViewport` gate, and typecheck; they still want an on-device/simulator pass. The placeholder uses more horizontal room on mobile (iPad field maxWidth 460, iPhone overlay full-width) than the desktop 340px where it was confirmed fitting.

## 2026-07-03 — iOS Simulator install (iPhone + iPad): scan-affordance on-device pass + Clerk blocker

**Claim:** Built the current tree (HEAD `85f092c2`, includes af9f0310/8a22a618/1fc9d14f/4453481f), installed the Capacitor iOS app on both an iPhone and an iPad simulator, and captured the on-device evidence the prior entries flagged as still-owed. Result: scan-affordance model CONFIRMED on device; a pre-existing Clerk multi-version crash blocks all routed page content in the bundled shell.

**Evidence (this session):**
- **Build pipeline (three artifacts, verified fresh):** `pnpm build` → `dist/public` buildTag `1.1.2-mr4jpitr` (builtAt 06:21:48Z). `npx cap sync ios` copied it into `ios/App/App/public` — synced `build-info.json` byte-matches the fresh one (same buildTag/builtAt), proving the native webdir is not stale. `xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO` → **BUILD SUCCEEDED** (universal arm64+x86_64 sim slice, VetTrackControl.appex embedded).
- **Installed + launched on both:** iPhone 17 Pro (`9821AC5F…`, PID 63955) and iPad Pro 11-inch M5 (`8B8E788A…`, PID 63966), bundle `uk.vettrack.app`. Screenshots: `tmp/iphone-01.png`, `tmp/ipad-01.png`.
- **Scan affordance CONFIRMED on device (the owed simulator pass):**
  - iPhone (portrait, native shell): bottom `NativeTabBar` shows a **flat "סריקה" scan tab** (QR icon) inline between חירום and ציוד — NOT a raised FAB. Matches `scanAffordance({isNative,isTablet:false}) → "tab"`.
  - iPad (landscape, native shell): scan affordance is a **raised purple QR floating action button** (bottom trailing), distinct from the flat tab. Matches `scanAffordance({isTablet:true}) → "fab"`.
  - Both headers render the restored **alerts bell + settings gear** (Unit 4, af9f0310); the iPad header renders the **inline equipment search field** ("חיפוש לפי שם, מספר סידורי, דגם…", 4453481f), the iPhone header renders the compact leading search icon — the adaptive placement the prior entry could not show in-browser.
- **Verification ceiling (honest — a real blocker, not just a gap):** every routed page renders the app error boundary — **"Page rendering failed: useUser can only be used within the <ClerkProvider /> component … Check for multiple versions of the `@clerk/shared` package."** Root cause confirmed in the dep tree: **4 resolved copies of `@clerk/shared`** (`2.22.0`, `3.47.3`, `3.47.7`, `4.6.0`) with a frontend skew — `@clerk/clerk-react@5.61.3` (bundles shared 3.47.x) vs pinned `@clerk/clerk-js@5.125.13` (needs shared 4.6.0). Clerk's React context lives in `@clerk/shared`, so provider-copy ≠ hook-copy → `useUser` throws. Because the SHELL is outside the error boundary I could confirm header/tabbar/FAB, but I could NOT verify: routed page content, the legacy `layout.tsx` equipment-detail-skeleton flat-tab (1fc9d14f's exact transient surface, unreachable behind the crash), or live search typeahead behavior on device.
- **Impact flag:** this bundled shell is the App Store deliverable (Option B, mandatory for social OAuth). At current HEAD it boots to a crashed content area on every route. NOT fixed this session — a dependency realignment (single `@clerk/shared` via pnpm overrides + `clerk-react` compatible with `clerk-js@5.125.13`) is out of scope for an "install" request and needs a deliberate decision.

**Verdict:** Install on both simulators — DONE. Scan-affordance + header-chrome on-device — VERIFIED (closes the owed simulator pass). Routed page content — BLOCKED by a pre-existing Clerk `@clerk/shared` multi-version crash; surfaced with root cause, deliberately not fixed.

## 2026-07-03 — CORRECTION: the "Clerk crash" was a wrong-build-command artifact, not a code/version bug

**Supersedes** the earlier same-day entry that diagnosed the native-shell "Page rendering failed / useUser… multiple versions of @clerk/shared" as a Clerk `@clerk/shared` version/chunk-duplication blocker. **That diagnosis was WRONG.** Corrected root cause + evidence below.

**Real root cause:** the app was built with plain `pnpm build` (raw `vite build`), which did NOT bake `VITE_CLERK_PUBLISHABLE_KEY`. The console proved it: `[auth-mode] client=dev-bypass publishableKey=(none) env=production`. With no key, `CLERK_ENABLED=false` (`src/main.tsx:35`), so `main.tsx` renders the app WITHOUT `<ClerkProvider>` (the `clerkRuntime ? <ClerkProvider>… : appShell` branch, main.tsx:245-251) — yet `ClerkModeAuthProvider`/`<SignIn>` still call `useUser()`, which throws. Clerk's error text lists "multiple versions of @clerk/shared" as possible-cause #2, which misled the whole investigation; the actual cause was #1 (no provider mounted). The two `@clerk/shared` copies in the bundle were real but irrelevant.

**The fix (zero code change):** build the native shell with `scripts/build-native-shell.sh` (`pnpm cap:build:native`), which loads `VITE_CLERK_PUBLISHABLE_KEY` from `.env` and runs `vite build` with it set. Verified:
- `build-native-shell.sh --ios` → console now logs `[auth-mode] client=clerk publishableKey=pk_live env=production`, **no STARTUP JS ERROR**.
- **iPhone** (`9821AC5F…`) + **iPad** (`8B8E788A…`) both render the full sign-in screen: VetTrack logo, role chips, native "Sign in with Apple"/"Google" buttons (`NativeSocialButtons`), the Clerk prebuilt `<SignIn>` card ("Sign in to VetTrack… Continue"), "Secured by clerk". Screenshots `tmp/iphone-fixed2.png`, `tmp/ipad-fixed.png`.
- Scan affordance re-confirmed on the WORKING build: iPhone bottom nav = **flat "סריקה" tab**; iPad = **raised QR FAB**. Both headers show bell + gear + search.

**What was reverted:** an exploratory `@clerk/clerk-react@5`→`@clerk/react@6` (core-2→core-3) migration + clerk-js 5.125.13→6.23.0 bump, undertaken while chasing the wrong (version) diagnosis. It type-checked clean and preserved the auth flows via `@clerk/react/legacy` hooks, BUT it introduced a NEW core-3 regression: clerk-js@6 ships headless (UI split out), so the native `new Clerk()` instance lacked UI components and `<SignIn>` threw `Error: Clerk was not loaded with Ui components`. v5's clerk-js is monolithic (UI included) and renders `<SignIn>` fine. All migration edits reverted (`git checkout` of package.json, pnpm-lock.yaml, and 12 src files); tree is back to v5, `pnpm typecheck` exit 0, net code change = **zero**.

**Standing gotcha (also saved to memory):** the bundled native shell MUST be built via `scripts/build-native-shell.sh` / `pnpm cap:build:native`, never plain `pnpm build` + manual `cap sync`. The latter omits the Clerk key and produces a dev-bypass build that hard-crashes in the native shell with a misleading `useUser`/`@clerk/shared` error. Production/App-Store archives already use the correct script, so **production was never affected** — this was purely a local build-command mistake during simulator verification.

**Verdict:** Original "install on iPhone + iPad" task — DONE. Scan-affordance on-device pass — VERIFIED (flat tab iPhone / FAB iPad, on a working authed build). The "crash" — root-caused to a wrong build command, fixed by using the project's native build script, zero code change. Exploratory v6 migration — reverted.

## 2026-07-03 — UX overhaul Phase 1: native navigation sourced once; iPad scan → sidebar

**Claim:** Consolidated the triplicated native nav (tab bar / iPad sidebar / Menu drawer each hardcoding their own list) into one model. The iPad sidebar now renders the full grouped nav; the iPad Menu drawer and QR scan FAB are removed; the phone drawer no longer duplicates Today/Equipment; Scan is a first-class iPad nav item. Phone-native tab bar and web-desktop chrome are unchanged.

**Evidence (this session — gate + unit):**
- New `src/lib/routes/native-nav-model.ts` — single grouped-nav source (`getNativeNavSections`, longest-prefix `isNavItemActive`), consumed by `NativeTabSidebar` (all sections, admin-filtered) and `MoreSheet` (phone drawer, hides `inPhoneTabBar` items → Today/Equipment dupes gone).
- `src/native/NativeTabSidebar.tsx`: full grouped nav; Menu button + `<ScanFab/>` removed; `onMorePress` prop dropped. `src/native/NativeShell.tsx` tablet branch no longer mounts `MoreSheet`.
- `src/lib/scan-affordance.ts`: native tablet `"fab"` → `"none"` (Scan lives in the sidebar). **This supersedes the prior on-device entries in this log that show iPad = raised QR FAB — intentional per the UX review (reduce iPad to one scan entry point).** Orphaned `src/native/ScanFab.tsx` + its two barrel re-exports deleted (grep-confirmed the only remaining ref was the dead legacy `layout.tsx renderScanFab`, unrelated).
- Today scan card retained in source but now renders on no device (gate `=== "fab"` never satisfied) — reconciles the review's "one iPad scan entry point" with the pinned Stage-3 source contract (`tests/stage-3-today-token-consistency.test.js`).
- **`pnpm typecheck`** (frontend + server) → **exit 0**. **`pnpm test`** → **386 files / 3811 tests pass** (updated `tests/scan-affordance.test.ts` to tablet→none; updated `tests/mobile-shell.test.tsx` to the model's `isNavItemActive` + a `useAuth` mock). **`pnpm i18n:check`** → deep key parity (no new keys — reused existing `t.nav.*`/`t.more.*`).

**Verification ceiling (honest):** gate + unit ONLY. NOT re-verified on iPhone/iPad simulator this session. The iPad sidebar full-nav, the drawer + FAB removal, and the retired card need a native build (`pnpm cap:build:native`) + simulator screenshots — owed. The scan-affordance change is unit-confirmed; its on-device appearance (sidebar Scan item, no FAB, no Today card) is not yet screenshotted.

**Verdict:** Phase 1 — DONE at gate + unit level; on-device simulator pass owed.

## 2026-07-03 — UX overhaul Phase 2: chat relocated to iPad header; one float owner per device

**Claim:** On the native tablet the shift-chat is now a header button (`NativeHeader`) rather than a floating FAB; the global float mounts only on phone/web. A shared `ShiftChatLauncher` guarantees exactly one `useShiftChat` per device (no double subscription). The launcher also hides on focused fullscreen routes to stop the reported overlap with bottom-anchored actions.

**Evidence (gate + unit):**
- New `src/native/tablet/useIsNativeTablet.ts` — context-independent native-tablet gate (`capacitorPlatform() !== "web" && useIsTabletViewport()`), usable outside NativeShell (needed for the global chat mount, which lives outside the shell provider).
- New `src/features/shift-chat/components/ShiftChatLauncher.tsx` — owns eligibility + `isOpen` + the single `useShiftChat` + `ShiftChatPanel`, exposes a render-prop trigger. `ShiftChatFab.tsx` reduced to the float trigger; `NativeHeader.tsx` renders a `MessageCircle` chat button (unread badge) on tablet via the same launcher.
- `src/main.tsx` — the global float is wrapped in `GlobalShiftChat`, which returns null on native tablet so its `useShiftChat` never runs on iPad.
- `ShiftChatLauncher` now hides on auth/landing AND fullscreen routes (`/code-blue`, `/crash-cart`, `/scan`, `/handoff`).
- **`pnpm typecheck`** → exit 0. **`pnpm test`** → 386 files / 3811 tests pass (shift-chat broadcast/session-scoping + mobile-shell suites green).

**Verification ceiling (honest):** gate + unit ONLY; NOT re-verified on simulator. The iPad header chat button (placement/badge) and the phone float clearance need a native build + on-device pass. Intentional behavior change: chat is now hidden on the four fullscreen focused routes on BOTH devices (previously the phone float showed on `/code-blue`) — resolves the reported "float overlaps the continue link" observation.

**Verdict:** Phase 2 — DONE at gate + unit; on-device pass owed.

## 2026-07-03 — UX overhaul Phase 3.0 + 3.1: two-pane plumbing + Equipment master-detail (iPad)

**Claim:** Added the reusable two-pane primitive and wired Equipment as the reference iPad master-detail via a single native-tablet-gated combined route `/equipment/:id?`. Phone/web keep the separate list + detail routes with push navigation, byte-for-byte.

**Evidence (gate + unit):**
- New `src/native/tablet/TwoPaneLayout.tsx` (RTL via logical props; `height:100%` + `minHeight:0` panes so it nests in NativeShell's content scroller without double-scroll), `src/native/tablet/SelectItemPlaceholder.tsx` (localized empty right pane), `src/features/equipment/tablet/EquipmentMasterDetail.tsx` (reads `useParams`, master = `EquipmentListScreen`, detail = `EquipmentDetailScreen` + new `hideBack` prop, placeholder when no id).
- `src/app/routes.tsx`: `useIsNativeTablet()` gate — on native tablet the `/equipment` list route is dropped and `/equipment/:id?` (kept AFTER the reserved `/equipment/new|tasks|board`, `/:id/edit|qr` siblings) renders `EquipmentMasterDetail`; else the original two routes. Conditional Route children stay direct `<Switch>` children (no fragments, which wouter's Switch won't descend into).
- i18n: `common.selectItemTitle` / `common.selectItemSubtitle` added to both locales; `pnpm i18n:generate-types` regenerated `i18n.generated.d.ts`; `pnpm i18n:check` deep parity ✓.
- `pnpm typecheck` → exit 0. `pnpm test` → 386 files / 3811 tests pass. In jsdom `useIsNativeTablet` resolves false, so `deep-link-router` + route-contract tests exercise the UNCHANGED non-tablet routes — the tablet branch is purely additive.

**Verification ceiling (honest):** gate + unit ONLY. The two-pane is the "real design work" and needs a native iPad build (`pnpm cap:build:native` + simulator) to confirm: list + detail visible together; row-tap swaps the detail while the list stays mounted + keeps scroll; deep-link to `/equipment/:id`; hardware Back; no flexbox double-scroll. Deferred to a consolidated Phase-3 device pass (owed).

**Verdict:** Phase 3.0 + 3.1 — DONE at gate + unit; on-device two-pane pass owed.

## 2026-07-03 — UX overhaul Phase 3.2: Inventory catalog two-pane (iPad); restock deferred

**Claim:** Wired the inventory CATALOG (`/inventory-items/:id?`) as an iPad two-pane mirroring Equipment. The restock page (`/inventory`) two-pane is DEFERRED — direct inspection shows its horizontal chip selector + scroll-based restock-session UI + non-fixed-height layout don't map to a fixed-height two-pane without risky restructuring of session/scan logic; the catalog delivers the Inventory master-detail intent.

**Evidence (gate + unit):**
- New `src/features/inventory/tablet/InventoryItemsMasterDetail.tsx` — master = `InventoryItemsPage` (Link rows unchanged), detail = `InventoryItemDetailPage` (reads the shared `:id`; its "back" → `/inventory-items` resolves to the placeholder = clears selection without unmounting the master), placeholder when no id.
- `routes.tsx`: native-tablet → single `/inventory-items/:id?`; else the original detail + list routes (no reserved siblings to order around).
- `pnpm typecheck` → exit 0. `pnpm test` → 386 files / 3811 pass (non-tablet routes unchanged in jsdom).

**Verification ceiling:** gate + unit; on-device two-pane pass owed (consolidated Phase-3 device pass). Restock two-pane intentionally NOT implemented — documented scope adjustment based on the page's workflow-specific layout.

**Verdict:** Phase 3.2 — catalog DONE at gate + unit; restock two-pane deferred (documented); device pass owed.

## 2026-07-03 — UX overhaul Phase 3.3 + 3.4: Rooms two-pane (iPad); Admin two-pane deferred

**Claim:** Wired Rooms (`/rooms/:id?` + `/locations/:id?`) as an iPad two-pane (single-column master list + room-radar detail). Admin two-pane is DEFERRED — its inline per-tab-badge tab bar + horizontal `border-b-2` tab styling need a vertical-rail restyle that's disproportionate surgery on an admin-only screen, and its content already expands to `lg:max-w-[1120px]` so the "wide empty middle" is a row-layout issue a width tweak wouldn't fix.

**Evidence (gate + unit):**
- New `src/features/rooms/tablet/RoomsMasterDetail.tsx` — master = `RoomsListPage singleColumn`, detail = `RoomRadarPage` (reads shared `:id`; back → `/rooms` = placeholder), placeholder when no id.
- `rooms-list.tsx`: added optional `singleColumn?: boolean` prop (`grid-cols-2`→`grid-cols-1` in the narrow master pane; defaults false → phone/web unchanged).
- `routes.tsx`: native-tablet → `/rooms/:id?` + `/locations/:id?` → `RoomsMasterDetail`; else the original list + detail routes for both aliases.
- `pnpm typecheck` → exit 0. `pnpm test` → 386 files / 3811 pass.

**Verification ceiling:** gate + unit; device pass owed. Admin + restock two-panes intentionally deferred (documented, direct-inspection rationale).

**Verdict:** Phase 3.3 — Rooms DONE at gate + unit; 3.4 Admin deferred (documented). Phase 3 (iPad master-detail) delivers Equipment + Inventory-catalog + Rooms two-panes; device pass owed for all.

## 2026-07-03 — UX overhaul Phase 6a/6b/6d/6e: cleanups

**Claim:** Four independent review cleanups, all gate + unit verified.

**Evidence:**
- **6a — untranslated location-card strings:** the four English `reasoning` literals in `use-equipment-detail.ts` (three interpolated `${email}`/`${room}`, one static) now use new `equipmentDetail.locationCard.reasoning.{checkedOut,rfid,lastKnown,none}` keys — both locales, hand-listed accessor in `i18n.ts`, types regenerated. `EquipmentLocationCard` renders localized copy on the Hebrew UI.
- **6b — Code Blue checkbox semantics:** the pre-check items (`code-blue.tsx` `QUICK_CHECK_ITEMS`) swap the decorative radio-circle `<span>` for the crash-cart affordance (`CheckCircle2`/`Circle`) + `aria-pressed` on each toggle button. Pass/fail (`passed`) semantics and `handleStart` gating unchanged — frozen Code Blue runtime respected.
- **6d — header touch targets:** `NativeHeader` bumped 44→48px (nav-bar height, wordmark zone, `iconBtn`, and the dependent dropdown-panel offset 46→50px), matching the VetTrack 48px convention already used by `MobilePageHeader`'s back button + the panel rows.
- **6e — Rooms grid spacing:** wired the orphaned `--content-gap` (responsive 16/24/32) as the grid gutter and `--inline-margin` as the page's outer padding (the wrapper had NO horizontal padding → the grid touched screen edges), and trimmed `RoomCard` `p-4`→`p-3` — fixing the inside-vs-between imbalance the review flagged.
- **`pnpm typecheck`** → exit 0. **`pnpm i18n:check`** parity ✓. **`pnpm test`** → 386 files / 3811 pass.

**Verification ceiling:** gate + unit. The visual results (localized location card, Code Blue checkbox, 48px header, Rooms spacing) want a device/screenshot pass — part of the owed consolidated device verification.

**Verdict:** Phase 6a/6b/6d/6e — DONE at gate + unit; visual/device pass owed.

## 2026-07-03 — UX overhaul Phase 4: unified attention taxonomy + aggregated/tiered/capped bell (native + web)

**Claim:** The bell no longer shows a wall of identical low-urgency warnings (the "60"). A shared attention module defines one tier vocabulary (critical|urgent|maintenance) and aggregates per-equipment alerts into ranked, counted groups; both the native (`NativeHeader`) and web (`alerts-dropdown`, the approved web exception) bell panels render the aggregated tiered groups with a 9+ capped badge. The Rooms 24h staleness threshold now sources from the same module.

**Evidence (gate + unit):**
- New `src/lib/attention/index.ts` — `AttentionTier` (critical|urgent|maintenance), `tierForAlert` (critical severity → urgent(issue/overdue) → maintenance), `aggregateAlerts` (one group per type, sorted tier-then-count → "12 devices not scanned in 14+ days" as one row), `formatBadgeCount` (9+ cap), canonical `STALE_THRESHOLD_MS` (24h).
- Web bell `alerts-dropdown.tsx`: flat `slice(0,6)` → tiered group rows (type label + `itemCount`); singleton groups deep-link to the equipment, multi-count → `/alerts`; badge via `formatBadgeCount`.
- Native bell `NativeHeader.tsx`: flat `slice(0,5)` → the same tiered group rows; badge `99+` → `formatBadgeCount` (9+). Distinct icon shape per tier (AlertCircle critical / AlertTriangle otherwise) keeps WCAG 1.4.1.
- Rooms staleness unified: `rooms-list.tsx` + `room-radar.tsx` import `STALE_THRESHOLD_MS` instead of inlining `24*60*60*1000`.
- New `tests/attention.test.ts` (8 tests). `pnpm typecheck` → exit 0. `pnpm test` → **387 files / 3819 tests pass**.

**Scope note (honest):** the shared TIER vocabulary + aggregation + cap ship across both bells and the Rooms threshold is centralized. The equipment "needs attention" recovery-adapter detection logic remains its own derivation (NOT merged) — its per-entity rules are tested and higher-risk to collapse; unifying that DETECTOR onto one `computeAttention` is a bounded follow-up. The user-visible "alarm fatigue" fix (aggregate + tier + cap, native + web) is complete.

**Verification ceiling:** gate + unit; the rendered aggregated panels (native + web) want a device/browser screenshot pass (owed).

**Verdict:** Phase 4 — DONE at gate + unit (taxonomy + aggregation + cap across native + web + rooms threshold); recovery-adapter detector merge noted as follow-up; visual pass owed.

## 2026-07-03 — UX overhaul Phase 5: actionable off-shift empty states (Today + Scan)

**Claim:** Off-shift Today and Scan are no longer dead ends — both show the caller's next scheduled shift + a "Browse equipment" action. Backed by an additive, read-only `nextShift` read that does not touch authority or on-shift gating.

**Evidence (gate + unit):**
- Backend: new `resolveNextShift()` in `server/lib/role-resolution.ts` — the caller's next upcoming roster shift (future date, or today not-yet-started), matched by the SAME normalized-name key + name-match SQL the current-shift resolver uses, ordered `asc(date), asc(startTime)`, LIMIT 1. Read-only; documented as never consulted for authority (Strategy A byte-for-byte intact).
- `server/routes/home-dashboard.ts`: `resolveNextShift` joins the parallel fetch; `buildShiftWindow` param loosened to structural `{date,startTime,endTime,role}` (reused for both shifts); response gains `nextShift: { startsAt, endsAt, role } | null`.
- `src/types/tasks.ts`: `HomeDashboardPulse.nextShift`. `src/hooks/use-active-shift.ts`: exposes `nextShift` from the shared dashboard query (no extra request).
- Frontend: `home.tsx` `noshift` branch + `ScanScreen.tsx` off-shift block render `t.common.nextShiftLabel` + locale-formatted `startsAt` (when scheduled) + a "Browse equipment" action → `/equipment` (reachable off-shift; no technician schedule page exists, so browse is the concrete next step).
- i18n: `common.nextShiftLabel` + `common.browseEquipment` (both locales); types regenerated.
- `pnpm typecheck` (frontend + server) → exit 0. `pnpm i18n:check` parity ✓. `pnpm test` → 387 files / 3819 pass.

**Verification ceiling (honest):** gate + unit. The `resolveNextShift` roster query is NOT exercised against a live DB this session (no DB integration test added) — it needs a DB/device pass to confirm real next-shift resolution end-to-end. The rendered empty states want a screenshot pass.

**Verdict:** Phase 5 — DONE at gate + unit; live-DB roster query + rendered empty states owed a device/DB pass.

## 2026-07-03 — UX overhaul Phase 6c: system appearance tri-state + Dynamic Type (native bridge owed)

**Claim:** Appearance now defaults to the OS (system|light|dark) and text size respects a Dynamic Type scale. The web/TS halves are fully gate-verified; the native iOS content-size bridge is delivered as code (TS seam + Swift plugin) but is NOT registered in the Xcode target and is UNVERIFIED — the owed device step.

**Evidence (gate + unit):**
- Appearance tri-state: `darkMode: boolean` → `appearance: "system"|"light"|"dark"` (default "system") in `user-settings-storage.ts`, with a v1→v2 migration (v1 explicit darkMode:true → "dark"; v0's untrusted darkMode → "system"). `use-settings.tsx` resolves the dark class via `isDarkActive` (honors `prefers-color-scheme` when "system") + a `matchMedia` listener that re-applies on OS scheme change while following the system.
- Dynamic Type: `textScale: "s"|"m"|"l"|"xl"` → a `--type-scale` multiplier on `<html>`; the 8 `--text-*` tokens in `index.css` wrapped in `calc(<value> * var(--type-scale, 1))` (canonical values unchanged; default 1 = no change). Settings gains an Appearance 3-option select + a Text-size select.
- Quick toggles updated across `NativeHeader`, web `TopbarSettingsMenu`, and the dead-but-compiled `layout.tsx` (dark ↔ system).
- Native bridge: new `src/lib/dynamic-type.ts` (`getNativeContentSizeScale()` — null on web / until the plugin is registered) + `ios/App/App/DynamicTypePlugin.swift` (reads `preferredContentSizeCategory`). `SettingsProvider` seeds text size from the OS once, only if the user hasn't chosen — a no-op until the plugin is wired.
- **NOT DONE (deliberate, documented):** the Swift plugin is NOT added to the Xcode App target (project.pbxproj) — hand-editing it is error-prone and unverifiable without a build. SourceKit's "No such module 'Capacitor'" on that file is expected (it's outside the build). Registering it + `pnpm cap:build:native` on a device is the owed step.
- Tests updated: `settings-sound-toggle-no-remount` (darkMode→appearance), `stage-1-token-values` (--text-* calc form; canonical values still asserted). `pnpm typecheck` (frontend + server) → exit 0. `pnpm i18n:check` parity ✓. `pnpm test` → 387 files / 3819 pass.

**Verification ceiling (honest):** appearance tri-state + in-app Dynamic Type are gate-verified. The native iOS Dynamic Type bridge is UNVERIFIED — needs Xcode-target registration + a native build. Both also want a device/screenshot pass.

**Verdict:** Phase 6c — appearance + in-app Dynamic Type DONE at gate + unit; native iOS content-size bridge delivered as code but UNREGISTERED + UNVERIFIED (owed device step).

## 2026-07-03 — UX overhaul: consolidated native iOS simulator verification pass

**Claim:** Built the native shell (`scripts/build-native-shell.sh` → Vite build with the Clerk key + `cap sync ios`) and installed the app on an iPad (A16, `DA8D1142`) and an iPhone 17 Pro (`9821AC5F`) simulator via `scripts/install-ios-sim.sh`. The prior proof entries' "owed device pass" is now substantially closed for the visible surfaces.

**Evidence (on-device screenshots, authed app rendering — `tmp/.../ipad-launch.png`, `iphone-launch.png`):**
- **`** BUILD SUCCEEDED **` on BOTH simulators** — every phase (appearance tri-state, `calc()` type tokens, two-pane routing, attention module, `resolveNextShift`, `dynamic-type.ts`) compiles + runs natively. `cap sync` reported 8 plugins; the unregistered `DynamicTypePlugin` is correctly ABSENT (consistent with the documented owed step).
- **iPad — Phase 1 CONFIRMED:** the sidebar renders the FULL grouped nav (Operations: Today/Equipment/**Scan**/Emergency/Tasks/Critical-kit/Rooms[active]/Mine/Alerts/Inventory · Management · Account · End-shift). No Menu button, no QR FAB.
- **iPad — Phase 3.0 + 3.3 + 6e CONFIRMED:** Rooms renders as a true two-pane — single-column room list (master) + the localized `SelectItemPlaceholder` ("בחר פריט…") in the detail pane.
- **iPad — Phase 2 CONFIRMED:** chat is a header button (speech-bubble icon, unread badge), not a FAB.
- **iPhone — Phase 5 CONFIRMED:** off-shift Today hero shows the "עיון בציוד / Browse equipment" action (dead-end resolved). Next-shift line correctly absent (no upcoming roster shift for this user).
- **iPhone — Phase 2 CONFIRMED:** exactly one chat float (bottom-leading), clear of content; lean 5-item tab bar preserved.
- **Both — Phase 4 CONFIRMED:** bell badge reads "+9" (not "60") — the aggregation cap is live on both devices.

**Verification ceiling (still owed — finer interactions not driven this pass):** two-pane row-tap → detail swap (structure confirmed via placeholder + master list, but selection not exercised); the aggregated bell PANEL contents (cap confirmed, panel not opened); Equipment/Inventory two-panes specifically (same `TwoPaneLayout` primitive as Rooms, not individually screenshotted); the 6c Settings appearance/text-size controls + their runtime effect; `resolveNextShift` against real roster data (this user had none); and the 6c native iOS Dynamic Type bridge (still UNREGISTERED in the Xcode target).

**Verdict:** Native build + install on iPad + iPhone — DONE, BUILD SUCCEEDED both. Core visible changes (Phases 1, 2, 3.0/3.3, 4, 5, 6e) CONFIRMED on device via screenshots. Remaining: finer interaction drills + the 6c native bridge registration.

## 2026-07-04 — Phase 0: shift-chat re-anchored to roster window (stale 3-week transcript root cause)

**Claim:** Shift chat no longer derives its conversation from the orphaned `vt_shift_sessions` clock-in table. The session is now the caller's roster shift window (`vt_shifts` via `resolveCurrentRole`) with a deterministic synthetic id (`win:<clinic>:<date>:<start>`); message reads/writes scope by `createdAt ∈ [start, end)` + `clinicId`. This is the server-side root cause the three prior client-only fixes (message-scoping.ts) could not reach.

**Evidence (gate + DB regression, all actually run):**
- New `server/lib/shift-window.ts` (pure window math + ids; no db import) and `server/lib/shift-chat-window.ts` (`getCurrentShiftWindow`, `windowMessagesWhere` — shared by route and test). `home-dashboard.ts` now imports the shared `buildShiftWindow` (local copy deleted).
- `server/routes/shift-chat.ts`: `getOpenShift` (the `endedAt IS NULL … limit(1)` no-orderBy query) is GONE — GET /messages, POST /messages, pin, and pinned-message queries all window-scope; returned rows are normalized to the viewer's window id (the client's `reconcileMessages` drops rows whose `shiftSessionId` differs — verified against `message-scoping.ts:30,36`). Archive gains a `win:` branch (roster lookup for bounds; stamped-id fallback; clinic-mismatch → 404). `postSystemMessage` (`shift-chat-presence.ts`) stamps the clinic's earliest active roster window; no-op when none.
- Schema: `vt_shift_messages.shift_session_id` FK dropped (`migrations/159_shift_messages_drop_session_fk.sql`, both name variants, IF EXISTS) — the legacy table's ON DELETE CASCADE was a latent chat-history-loss bug. Migration applied locally: `✅ Applied migration: 159…`.
- **DB regression test run against real Postgres** (`pnpm exec tsx tests/shift-chat-window.integration.test.ts` → "✅ all assertions passed"): seeded a never-ended `vt_shift_sessions` row + 3-week-old messages + a two-block roster; asserted (1) session id is roster-derived `win:…`, not the stale id; (2) `windowMessagesWhere` returns ONLY the in-window message; (3) window rollover changes the id; (4) off-window ⇒ null; (5) off-roster user ⇒ null. Excluded from default vitest (DB group) per house convention.
- Pure contract tests `tests/shift-window.test.ts` (overnight bounds, id round-trip incl. `:` in clinic id, rollover, legacy-id rejection) run in the default suite.
- `pnpm typecheck` (frontend + server) → exit 0. `pnpm test` → 388 files / 3830 pass.

**Verification ceiling (owed):** iOS Simulator end-to-end (stale session seeded → panel shows only current-window messages; off-shift panel empty + POST 409 toast) — scheduled with the batched device pass alongside the other phases. Client untouched by design; `reconcileMessages` behavior is covered by the existing `tests/shift-chat-session-scoping.test.ts`.

**Verdict:** Phase 0 DONE at gate + DB-regression level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Phase 1 (C1): CODE BLUE start button always responds

**Claim:** The start button can no longer render armed while silently no-oping. Root cause was twofold: (a) `disabled` gated on `managerId` only while `handleStart` also required `managerName`; (b) `managerName` was seeded into `useState` at mount from `useAuth().name`, which can populate after mount — the state never re-seeded, permanently blanking the name. The manager is now DERIVED at render (identity = id; display name cosmetic with a localized fallback), the disabled state and the click gate are the same `canStart` condition, the in-flight state disables + spins, and success transitions via `refetch()` of server truth (no local session flip — frozen-surface rule held).

**Evidence (gate + unit, actually run):**
- `src/pages/code-blue.tsx` `PreCheckGate`: `managerId`/`managerName` states replaced by derived `manager` (eligible → `{id: userId, name: name.trim() || t.codeBlue.managerFallbackName}`; else picker state). `disabled={!canStart}` where `canStart = manager !== null && !starting` — identical to the `handleStart` guard. Disabled reason line (`t.codeBlue.startDisabledReason`, role="status") when no manager; muted disabled styling (accent/35); `proceedWithoutFullCheck` secondary button also gated (it previously dead-tapped too). Spinner + `t.codeBlue.startingSession` label while starting.
- `CodeBluePage`: `starting` threaded into `PreCheckGate`; after `sessions.start()` resolves → `await refetch()` on `useCodeBlueSession` (server-confirmed transition instead of waiting out the 2 s poll). Catch-branch toasts unchanged and now reachable.
- i18n: `codeBlue.managerFallbackName`, `codeBlue.startDisabledReason`, `codeBlue.startingSession` added to he+en; `pnpm i18n:check` parity ✓; types regenerated.
- New `tests/code-blue-precheck-gate.test.tsx` (happy-dom): empty-name eligible manager CAN start with fallback name (the C1 regression); named manager passes name through; non-eligible without picked manager → disabled + reason + no call; starting → disabled + in-flight label. 4/4 pass.
- `pnpm typecheck` (both configs) → exit 0. `pnpm test` → 3834 pass.

**Verification ceiling (owed):** simulator drill — tap "פתח CODE BLUE" with/without checklist; confirm spinner → `ActiveSession` only after server confirmation. Scheduled with the batched device pass.

**Verdict:** Phase 1 DONE at gate + unit level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Phase 2 (C2 + H1): no fake 0% KPI; availability reconciled with the bell

**Claim:** The equipment header can no longer show a computed "0% availability" during load or a no-match search (C2), and when equipment is unverified 14+ days the header carries a "not verified" readout computed from the SAME `isInactive` predicate + `/api/equipment` query the alert bell uses — the two surfaces can no longer disagree (H1, additive per the settled decision; `availabilityPct` semantics unchanged when data exists).

**Evidence (gate + unit, actually run):**
- `use-equipment-list.ts`: `availabilityPct` is now `number | null` (null when `total === 0` — loading AND no-match); added the full-list `["/api/equipment"]` query (cache-shared with `NativeHeader`/`useAlertsFeed`) and `verifiedCount`/`notVerifiedCount` via `isInactive` (`shared/constants` `INACTIVE_THRESHOLD_DAYS`).
- `EquipmentLargeTitle.tsx`: explicit `isLoading` prop; renders "—" in muted white (never orange, never 0%) until a real percentage exists; count placeholder while loading; new `verifiedSplit` readout line (`{ok} תקין · {stale} לא אומתו {days} ימים+`) rendered only when `notVerified > 0`.
- `EquipmentStatStrip` (shared with desktop `equipment-list.tsx:877`): attention cell tone neutral when 0 (was hardcoded `err` red); new `showUptime` prop — native list passes `false` (hero already shows the number; kills the same-viewport duplicate), desktop default keeps it (no hero there).
- `EquipmentListScreen.tsx`: no-match body now uses the shared `EmptyState` (Package icon, filtered-vs-empty subMessage, localized clear-filters action → `/equipment`), replacing the bare text div.
- i18n: `equipmentList.verifiedSplit` (+ hand-listed interpolated accessor in `i18n.ts` — the buildTranslations gotcha), `equipmentList.empty.clearFilters` (he+en); parity ✓; types regenerated.
- New `tests/equipment-kpi-placeholders.test.tsx` (9 tests): placeholder while loading / no-match, real % when data exists, readout text via the same `t` accessor + threshold constant, readout omitted at 0, strip zero-attention not red / non-zero red, uptime hidden with `showUptime=false`, kept by default. All pass.
- `pnpm typecheck` (both) → exit 0. `pnpm i18n:check` ✓. `pnpm test` → 3843 pass.

**Verification ceiling (owed):** simulator — cold-load Equipment (placeholder, not 0%), no-match search (EmptyState + clear filters), readout count vs bell count on the demo dataset. Scheduled with the batched device pass.

**Verdict:** Phase 2 DONE at gate + unit level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Phase 3 (H2): native /alerts routed through the grouped pro view + badge bidi

**Claim:** The native alerts wall (flat, non-interactive, no ack — audit H2 "alert fatigue") now renders the SAME grouped, worst-first, navigable, acknowledgeable `AlertsProView` the browser-mobile path already used, via a new shared `useAlertsController` consumed by BOTH the desktop page and the native screen (real duplication removed, not copied). Count badges are bidi-isolated — the on-device "+9" reversal (photographed in the 2026-07-03 pass) is fixed at all three render sites.

**Evidence (gate + unit, actually run):**
- New `src/features/alerts/hooks/use-alerts-controller.ts`: equipment+acks queries, ack/unack mutations (toasts + haptics preserved), acksMap/locationMap/activeAlertCount, ownership role gate — extracted verbatim from `AlertsPageDesktop`, which now consumes it (`ack` destructured as `acknowledgeAlert` — the per-card `const ack = acksMap.get(...)` shadowed it; caught by `tsc` TS2722, fixed).
- `AlertsScreen.tsx`: keeps its pull-to-refresh shell + title; body renders `<AlertsProView/>` with the full desktop prop set (nav → `/equipment/:id`, ack/unack, canOwn, formatRelativeTime). Acked alerts are no longer silently hidden (the old feed filtered them out with no way to see/undo).
- Deleted: `AlertRow.tsx` + `use-alerts-feed.ts` (orphaned by the rewire; verified sole consumers).
- Badges: `dir="ltr"` on the NativeHeader bell span, NativeHeader chat-launcher span, and `ShiftChatFab` span — device evidence for the reversal already existed in this log ("bell badge reads '+9'"), so this did not wait for the batched pass.
- knip: `AlertRow`/`use-alerts-feed` absent from the report (clean removal). `src/design-system-entry.ts` false-flag now registered in `knip.json` ignore (the PR-#40 trap the plan told us to close). Remaining knip findings are pre-existing baseline noise (`.design-sync/previews/**`, `.agents/**`, legacy types).
- New `tests/alerts-screen-grouped.test.tsx` (3 tests, mocked api + auth, real Query cache): worst-first hero + both section labels render; row click navigates to `/equipment/eq-stale`; take-ownership posts `acknowledge("eq-issue","issue")`. Updated `tests/phase-6-state-consistency.test.js` stale markers (`refetchEq();` → `useAlertsController()` + `onRetry={refetch}`) — intent unchanged, mechanism moved into the shared hook.
- `pnpm typecheck` (both) → exit 0. `pnpm test` → 391 files / 3846 pass.

**Verification ceiling (owed):** simulator — native /alerts grouped + ack + navigate on device; badge renders "9+" not "+9". Scheduled with the batched device pass.

**Verdict:** Phase 3 DONE at gate + unit level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Phase 4 (H4 + H5): horizontal safe areas + FAB clearance

**Claim:** In landscape, native chrome and page content clear the camera housing: the phone scroll container, the `NativeHeader` row (12px → `calc(12px + env(safe-area-inset-left/right))`), and the `NativeTabBar` all pad the horizontal safe areas (previously only top/bottom were owned — the fixed `inset:0` shell escaped the body's env padding). The floating chat FAB no longer covers the last rows: the equipment and alerts scrollers reserve `calc(72px + env(safe-area-inset-bottom))` (16px base + 48px FAB + 8px gap).

**Evidence:** `NativeShell.tsx` phone scroller, `NativeHeader.tsx:99-103`, `NativeTabBar.tsx` nav style, `EquipmentListScreen.tsx` + `AlertsScreen.tsx` bottom padding. Static regression `tests/native-safe-area-fab-clearance.test.js` (5 checks, house phase-6-state-consistency style) locks all five sites. `pnpm typecheck` → 0 errors; `pnpm test` → 392 files / 3851 pass. Portrait unaffected (side insets resolve to 0). Tablet branch untouched (no housing on iPad; audit scoped this to iPhone landscape).

**Verification ceiling (owed):** simulator — rotate iPhone to landscape: search field + "כל הסטטוסים" chip clear the housing; FAB clears the last equipment row and alert card. Batched device pass.

**Verdict:** Phase 4 DONE at gate + static-check level; simulator drill owed.

## 2026-07-04 — Phase 5 (H3 + M2 + M1): dead-end form, bidi, localization sweep, Day-field overflow

**Claim:** The task-creation form explains itself when no technician can be selected (H3); the pinned-chat banner and iPad room initials are bidi-isolated and the settings chevrons are direction-aware (M2); the M1 sweep is done for everything i18n-fixable — equipment status vocabulary now resolves through `t.status.*` everywhere ("OK" chips no longer leak English), the location card composes localized reasoning client-side from the structured inference fields (no server change needed), the "1 מחוברים" plural is ICU, the timezone label renders a localized zone name instead of the raw IANA id, and the Task Controls "Day" date input can no longer overflow its grid cell on iPhone.

**Evidence (gate + unit, actually run):**
- i18n keys (he+en, parity ✓, types regenerated): `appointmentsPage.{todayHeading,whyThisTask}` (existing `noEligibleTechnicians` wired), `status.{critical,needs_attention}`, `roomRadarPage.{unknownHolder,roomFallback,nfcVerifyAllBody}`, `roomsListPage.{healthRingTitle,healthRingHelp}`, `equipmentDetail.locationCard.reasoning.{dock,scan}`, `shiftChat.panel.onlineCount` → ICU plural (`one {מחובר אחד} other {# מחוברים}` / `one {1 online} other {# online}`).
- H3 (`appointments.tsx`): empty/errored `metaQuery.data.vets` renders `t.appointmentsPage.noEligibleTechnicians` under the booking select (`role="alert"`), explaining the blocked submit. Day `<Input type="date">` gains `min-w-0` (grid child kept intrinsic width on iOS/WebKit — the user-reported overflow); localized `USER_TIMEZONE_LABEL` via `Intl.DateTimeFormat(...).formatToParts` keyed off `document.documentElement.lang`.
- M2: `ShiftChatPanel` pinned body wrapped in `<Bdi>`; `room-radar` verifier initials wrapped in LRI/PDI isolates; `TopbarSettingsMenu` + `NativeHeader` menu rows `ChevronRight` → `ForwardChevron`. Checklist-flip left untouched pending device verify (plan's verify-first instruction).
- M1 status vocabulary: new `src/lib/equipment-status-label.ts` (`t.status.*` → legacy dict → raw fallback) consumed at ALL render sites: `qr-scanner:928`, `EquipmentDetailActivityTab:91`, `EquipmentDetailStatusStrip:89`, `my-equipment:238`, `equipment-list:1310`, `room-radar:253`, `equipment-detail:{1617,1689,1918}`. `equipment-list` "Clear all filters"/"Add Equipment" literals → existing keys; `equipment-detail:1932` "Location:" → `locationCard.title`. `admin.tsx` + `status-badge.tsx` inspected: local dicts (tickets / already-localized) — not the leak.
- Location card: `EquipmentLocationCard` now builds reasoning from `signalSource`/`accountablePerson`/`inferredLocation` via `t.…reasoning.*` (server English prose ignored; `· relative-time` suffix only when the accountable-person row isn't already showing the timestamp).
- New `tests/i18n-ux-audit-sweep.test.ts` (21 tests): key existence both locales, `equipmentStatusLabel` full he mapping + critical/needs_attention + unknown fallback, ICU singular≠plural with no `#`/`{`/`plural` leakage + en exact renders, reasoning dock/scan interpolation. All pass.
- Gates: `pnpm typecheck` (both configs) → 0 errors; `pnpm i18n:check` ✓; `pnpm test` → **393 files / 3872 pass**.

**Out-of-band incident (recorded, not mine):** during the session-limit pause, `src/pages/appointments.tsx` was renamed to `src/pages/Tasks.tsx` in the working tree (file mtime 00:57) and `routes.tsx` repointed (mtime 03:28). This broke 7 test files that read the path from disk and violates the frozen rule "no appointment→task renames of internal surfaces" (Phase 6 §17). Restored: `mv Tasks.tsx appointments.tsx` (diff vs HEAD verified = Phase 5 content edits ONLY — zero foreign content lost) + router import reverted. If the rename is wanted, it needs a deliberate pass over the 7 guard tests + doctrine.

**Residue (explicit):** `equipment-detail.tsx` `actionLabel: \`Status updated to …\`` ×2 (:562/:578, toast-history strings) and `:1928` "In use by {email}" remain English — noted for the Phase 6 polish or Plan 2; deferred native date-picker locale text per settled scope.

**Verification ceiling (owed):** simulator — Day field at 320/375 widths + landscape; empty-technician message; pinned "!Hi everyone" renders upright; status chips Hebrew on room radar/scan result; checklist-flip re-verify. Batched device pass.

**Verdict:** Phase 5 DONE at gate + unit level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Phase 6 (M4–M9 + polish): consistency sweep

**Claim:** The scan header no longer invites scanning while off-shift (M5); the Code Blue setup screen drops its redundant back-to-home button inside the native shell where Emergency is a tab root with an always-visible tab bar/sidebar, keeping it on web (M6); nav labels no longer collide (M7); "End shift" disappears from the drawer and iPad sidebar when there is no active roster shift (M9); the room-radar verify-all button ellipsizes on one line and the equipment card title truncates on the content's trailing end in RTL (M4 a+b); the Code Blue "מנהל ההפצה" ("distribution manager") mistranslation is corrected to event-manager copy in BOTH locales.

**Evidence (gate + unit, actually run):**
- M5: `ScanScreen.tsx` subtitle `scanBlocked ? t.scan.offShiftSubtitle : t.scan.scanPrompt`; new `scan.offShiftSubtitle` (he+en) + hand-listed accessor (`t.scan` is hand-built).
- M6: `code-blue.tsx` leave-setup button gated `{!inNativeShell && …}` via `useNativeShellContext()` (default false → web + existing unit tests keep the button). Verified `NativeTabBar` mounts unconditionally in the phone shell (only `NativeHeader` hides on fullscreen routes) — no escape is lost on native, deep-link included.
- M7: he `nav.admin` "ניהול"→"ניהול מערכת" (was byte-identical to `nav.managementSection`), `nav.mine` "שלי"→"הציוד שלי", `nav.inventoryItems` "פריטי מלאי"→"קטלוג פריטים" (vs "מלאי ומתכלים"); en `Item catalog`. Copy-only — consumed via `t.nav.*` by `native-nav-model`/`MoreSheet`/`NativeTabSidebar`, no code edit.
- M9: `getNativeNavSections(opts?: {hasActiveShift?})` filters the `session` section when `false`; `MoreSheet` + `NativeTabSidebar` pass `shiftLoading || hasActiveShift` (row stays during load — no flash-in of a destructive row). `useActiveShift` dedupes on the `/api/home/dashboard` key — no new request.
- M4: verify-all button `flex-1 min-w-0` + `truncate` spans (all three states, icons `shrink-0`); card title `<p dir="auto">` so a Latin device name truncates at its own trailing end; (c) checked in source — `TwoPaneLayout` master width is a fixed px prop and `room-radar` has no inner max-width narrower than the pane (only a modal `max-w-sm` and empty-state `max-w-xs`).
- Polish: `codeBlue.{managerLabel,managerLabelShort,managerInstruction,managerOnlyHint}` → event-manager copy he+en. Monospace audit: only `formatElapsed` timer + gateway-code input use `font-mono` — both are codes/digits, no change needed. CSV import-preview disabled button: shadcn disabled affordance + per-row errors render directly above; remaining gap is untranslated dialog copy → Plan 2 Wave 4 (CsvImportDialog decision).
- New `tests/phase-6-consistency-polish.test.ts` (11 tests): session-section gating (false/true/legacy), consumer wiring markers, M5 swap marker + key existence, M6 gate-before-button ordering, M4 truncation markers, manager-copy contracts (en literal + he "הפצה" absence), nav-collision assertions. All pass.
- `tests/mobile-shell.test.tsx` harness updated: renders now wrap in `QueryClientProvider` (the sidebar legitimately reads the shift query; disabled without a user id — no fetch). Contract assertions unchanged.
- Gates: `pnpm typecheck` (both) → 0 errors; `pnpm i18n:check` ✓; `pnpm test` → **393 files / 3883 pass**.

**Residue (explicit):** "loading-state consistency (every loader gets a timeout/error state)" is unbounded across the app — not attempted here; carry to Plan 2 or a dedicated pass. CSV import dialog copy untranslated (Plan 2 Wave 4).

**Verification ceiling (owed):** simulator — off-shift scan subtitle; Emergency tab shows no back button (native) while web keeps it; drawer/sidebar hide End-shift off-shift; long room name verify-all button single-line; Latin card title ellipsis side. Batched device pass.

**Verdict:** Phase 6 DONE at gate + unit level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Phase 7: cross-surface dead-end fixes (parity investigation)

**Claim:** All five verified UI dead-ends now lead somewhere. (1) The scanner's "Mark Issue" deep link (`?action=issue`) is read by the slim native detail, which mounts a minimal issue sheet submitting the same scan-status-`issue` endpoint the desktop uses. (2) A reservation-ready push landing on native detail now shows the `ReservationBanner` (shared `["equipment-waitlist", id]` query key with desktop) with claim → `api.equipment.checkout`, off-shift-gated identically to the desktop choke point. (3) `SyncQueueSheet` + the `vettrack:open-sync-queue` listener are mounted globally in `main.tsx` (`GlobalSyncQueue`) — the sync-failure toast's "view queue" action and the detail button no longer fire into the void. (4) iPad-landscape Home's "View all" (→ WebOnlyGuard-walled `/audit-log`) is hidden on native; the feed stays. (5) `/equipment?scan=1` redirects to `/scan` inside the mobile shell.

**Evidence (gate + unit, actually run):**
- **Plan correction found while implementing:** the plan said to mount the "existing self-contained `ReportIssueDialog`" for fix 1 — that component files a *support ticket* (`api.support.create`), NOT an equipment issue. Desktop's `action=issue` actually opens an inline dialog submitting `api.equipment.scan(id, {status:"issue", note, photoUrl})` (`equipment-detail.tsx:738-806`). Implemented accordingly: new lean `ReportEquipmentIssueSheet` (note-only) in the detail feature folder; desktop-only extras (photo attach, undo timer, WhatsApp share) intentionally not ported (→ Plan 2 Wave 1 if wanted).
- `EquipmentDetailScreen.tsx`: `useSearch()` effect opens the sheet on `action=issue`; waitlist query (enabled on `userId`), `shouldShowReservationBanner`, checkout mutation with cache write + waitlist invalidation + savedOffline/checkedOut toasts; `useActiveShift` gate reusing `t.scan.offShiftBody` (same message as the desktop `handleCheckout` gate). Banner placed above the location card; `showNextInLine` on `myPosition === 1`.
- `GlobalSyncQueue` mounted inside `SyncProvider` next to `SyncStatusBanner` (`main.tsx`). Residue: the legacy `layout.tsx` copy of the listener still exists but only mounts transiently inside the desktop detail's loading skeleton — a duplicate-open needs the event to fire during that flash; goes away entirely when Plan 2 deletes `layout.tsx`.
- `home.tsx`: `/audit-log` link wrapped in `!isCapacitorNative()`; `equipment-list.tsx` `EquipmentListPage` fork redirects `?scan=1` → `/scan` (`replace: true`) in the shell before rendering the slim list.
- New `tests/phase-7-dead-end-fixes.test.ts` (10 static contracts): action=issue read + sheet mount, scan-status-issue submit, shared waitlist key on BOTH pages, banner + checkout + off-shift gate markers, global listener + mount + both dispatchers alive, View-all gate ordering, scan=1 redirect. All pass.
- Gates: `pnpm typecheck` (both) → 0 errors; `pnpm i18n:check` ✓ (no new keys — reused components carry their own); `pnpm test` → **394 files / 3893 pass**.

**Verification ceiling (owed):** simulator — scanner Mark Issue opens the sheet on slim detail and the issue lands in logs; simulated `notified` waitlist state shows the banner and claim checks out; sync-failure toast "view queue" opens the sheet on web + native; iPad landscape Home shows no View-all; `/equipment?scan=1` lands on the scanner. Batched device pass.

**Verdict:** Phase 7 DONE at gate + unit level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Phase 8 (M3): iPad Home dashboard

**Claim:** On the native iPad app, Home no longer renders the phone page centered at 720px (greeting + one card + emptiness). A new `HomeTabletDashboard` composes the reconciled surfaces into a 2-column bento: the roster `ShiftHero` (same component the phone Today uses), an equipment tile (availability % from the triage tier + the Phase-2 `isInactive` not-verified readout via `t.equipmentList.verifiedSplit`), a worst-first alerts tile fed by the shared Phase-3 `useAlertsController` (rows navigate to the device, count badge bidi-isolated), and room verification bars sorted worst-first (same pct + color thresholds as the rooms HealthRing). Code Blue keepalive banner kept above the tiles (display-only, frozen-surface safe). Phone/desktop Home is untouched (renamed inner component only).

**Evidence (gate + unit, actually run):**
- **Predicate correction:** the plan said fork on `useIsTabletViewport()`, but that is viewport-width-only and would hijack desktop web Home too. Used the existing precise gate `useIsNativeTablet()` (tablet viewport AND Capacitor non-web) — the audit finding was native-iPad-only.
- `home.tsx`: component-level fork (`isNativeTablet ? <HomeTabletDashboard/> : <HomePhoneAndDesktop/>`) — NOT an early return, so hook order survives a runtime predicate flip (iPad Split View resize). The phone body is byte-identical except the function rename.
- `HomeTabletDashboard.tsx`: no new endpoints — `/api/home/dashboard`, `/api/equipment`, `/api/rooms`, and the alerts controller's queries, all with the app's existing query keys (cache-shared). Availability computed over the FULL list (no ≤50-page caveat). Designed loading (skeleton rows / "—" placeholder — the C2 rule holds: no computed 0% during load) and empty states (alerts-clear message, rooms help line); tiles link to their full surfaces; Latin names bidi-isolated (`Bdi` + `dir="auto"`), pct/count badges `dir="ltr"`.
- New `tests/home-tablet-dashboard.test.tsx` (6 tests, happy-dom, mocked api/auth/realtime, HelmetProvider+QueryClientProvider): four tiles render; availability 67% from a 1-attention-of-3 fixture; verifiedSplit(0,3,14) rendered from the same isInactive predicate; alert row navigates to `/equipment/eq-issue`; room bars sort ICU(50%) before Surgery 1(100%); static fork contract on home.tsx. All pass.
- Gates: `pnpm typecheck` (both) → 0 errors; `pnpm i18n:check` ✓ (zero new keys — every label reused); `pnpm test` → **395 files / 3899 pass**.

**Verification ceiling (owed):** simulator — iPad portrait + landscape render the bento (no 720px cap), tiles navigate, phone Home unchanged. Batched device pass.

**Verdict:** Phase 8 DONE at gate + unit level; simulator drill owed in the consolidated device pass.

## 2026-07-04 — Sanctioned rename: src/pages/appointments.tsx → src/pages/Tasks.tsx

**Claim:** The client page-file rename (made out-of-band during the session pause, reverted pending a decision, now confirmed by the user) is applied deliberately: `git mv` (history preserved), router lazy import → `@/pages/Tasks`, all 7 guard tests that read the path from disk updated, and the doctrine amended in three places (frozen-surfaces bullet, i18n terminology note, operational-doctrine bullet) to carve out exactly this one client-file rename. The genuinely frozen surfaces are untouched: `appointmentsPage.*` key namespace, `vt_appointments` table, `/api/appointments` server route, and the `/appointments` URL redirect — and the `i18n-appointments-tasks.test.ts` "internal identifiers frozen (§17)" assertions still enforce them.

**Evidence:** `git mv` shows `R src/pages/appointments.tsx -> src/pages/Tasks.tsx`. Updated: `routes.tsx:52`, `tests/{phase-6-state-consistency,phase-3-3-recall-production,phase-3-ui-token-consistency,appointments-scheduling,epic8-slice2-tasks-scheduling}.test.js`, `tests/{appointment-datetime-contract,i18n-appointments-tasks}.test.ts`, `CLAUDE.md` ×3. Gates: `pnpm typecheck` (both) → 0; `pnpm test` → **395 files / 3899 pass** (the 7 previously-broken files included).

## 2026-07-04 — Phase 9: design-sync re-mirror to "VetTrack Design System"

**Claim:** The claude.ai/design mirror reflects the shipped remediation. Incremental push (user-authorized), NOT a full re-upload.

**Evidence (driver report + push receipts):**
- Pre-flight per the NOTES recipe: `pnpm build` → fresh `dist/public/assets/index-B_PGumjN.css` copied to `.design-sync/compiled.css` (byte-identical to committed — no Tailwind output change; remediation styling was inline/env()); `.ds-sync` staged patches verified intact (bundle.mjs `exts` ''-last at :144, dts.mjs DS_* env at :100-112); remote `_ds_sync.json` fetched in full and confirmed byte-equivalent to the local anchor (bundleSha12 5308096e99bc, 110/110/330 hash entries) — no anchor rewrite needed.
- Driver run (`resync.mjs` + DS_SRC_GLOB/DS_TS_BASEURL/DS_TS_PATHS + DS_CHROMIUM_PATH system Chrome): `anchor: ok`, build ✓, diff ✓. Validate exit 1 = exactly the 7 known triaged warns from NOTES ("do NOT re-chase") — verified by parsing `.render-check.json`: flagged set == {AppErrorBoundary, PageErrorBoundary, ShiftSummarySheet, SyncQueueSheet, SwUpdateBanner, SyncStatusBanner, UpdateBanner}, zero new.
- Diff verified against the plan's expected table: `renderChurned: []`, `changed/added/removed: []` at card level; upload set = EquipmentStatStrip (its `.d.ts` + `.prompt.md` — the new `showUptime` prop is the sole interface change) + bundle + styling. EmptyState/AlertsProView/ReservationBanner/SyncQueueSheet correctly show NO diff (caller-only changes), exactly as the plan predicted. Code-behavior changes ride `_ds_bundle.js` (sha 5308096e99bc → 81fb922e86ae) since component cards are re-export stubs.
- Push: `finalize_plan` (plan_6dfabeea606647e6_0400736e2859, 6 writes, 0 deletes) → `write_files` → `{"written":6}`. Paths: `_ds_bundle.js`, `_ds_bundle.css`, `styles.css`, `_ds_sync.json`, `components/equipment/EquipmentStatStrip/EquipmentStatStrip.d.ts`, `…prompt.md`.
- Post-push: `ds-bundle/_ds_sync.json` → `.design-sync/.cache/remote-sync.json` (re-anchored for the next diff).
- This commit also lands the pre-existing intended `.design-sync/config.json` + `NOTES.md` + `src/design-system-entry.ts` (SidebarDivider barrel) working-tree state that this sync ran against, per the plan's working-tree note.

**Verdict:** Phase 9 DONE — targeted 6-path mirror push confirmed written; anchor cycle closed.

## 2026-07-04 — SUPERSEDING: Phase 5 Day-field claim refuted on-device; fixed post-merge

**Supersedes:** the Phase 5 entry's claim that the Task-Controls Day field "stays inside its cell". The adversarial branch audit (2026-07-04) refuted it on-device: on iPhone 17 Pro portrait RTL the date input's end-side edge rendered ~30 device-px outside the white card (two independent captures, `iphone-10-task-controls.png`). `min-w-0` reduced but did not eliminate the WebKit intrinsic-width escape.

**Claim:** `appearance-none` added to the date `Input` (`src/pages/Tasks.tsx:1123`, commit adf9d164c on main post-merge) resets the UA styling so the `w-full/max-w-full/min-w-0` clamp actually applies; static tripwire extended (`tests/epic8-slice2-tasks-scheduling.test.js` — "resets UA appearance" assertion).

**Evidence:** epic8 file 41/41 pass; full gates below. **Owed:** simulator re-drill after the next native-shell rebuild — this entry stays open until the device capture shows the field inside the card.

## 2026-07-04 — Chat bubble bidi isolation (audit residue #2)

**Claim:** `MessageBubble` body is now wrapped in `<Bdi dir="auto">` (`src/features/shift-chat/components/MessageBubble.tsx`, commit 7cd198e7f) — the audit reproduced "!Hi everyone" in bubbles while only the pinned banner had been Bdi-wrapped in M2.

**Evidence:** new `tests/shift-chat-bubble-bidi.test.tsx` (2 tests, happy-dom): Latin body renders inside `<bdi dir="auto">`; @mention highlighting stays inside the isolate. Both fail without the wrap (closest("bdi") === null). 2/2 pass.

## 2026-07-04 — Merge to main + design-sync follow-up (audit disposition)

**Claim:** `claude/refine-local-plan-jjrebb` fast-forward-merged to main (99b8bc906 → 5624f69b2); pre-merge working-tree debris (34 tracked files byte-identical to main + untracked stale `appointments.tsx` differing from `Tasks.tsx` by one comment word) preserved via stash + scratchpad, not discarded. Design-sync follow-ups landed (commit 5fee44f53): NativeList `showUptime={false}` preview variant, NOTES count 110→111, stale floor-cards risk bullet replaced. Targeted re-sync pushed exactly 6 paths (`_ds_bundle.js`, `_ds_bundle.css`, `styles.css`, `_ds_sync.json`, `_preview/EquipmentStatStrip.js`, StatStrip `prompt.md`); remote anchor pre-verified byte-equivalent (bundleSha12 81fb922e86ae) — the audit-session Claude Design prompts touched no synced artifacts, as they reported.

**Evidence (run, not assumed):** driver verdict: anchor ok, diff changed=[EquipmentStatStrip] only, renderChurned=[], validate exit 1 == exactly the 7 known triaged warns (parsed `.render-check.json`: flagged set == {AppErrorBoundary, PageErrorBoundary, ShiftSummarySheet, SyncQueueSheet, SwUpdateBanner, SyncStatusBanner, UpdateBanner}, zero new); `write_files` → `{"written":6}`; re-anchored `.cache/remote-sync.json` (new bundleSha12 e12d5243d0a4). Gates on main post-fixes: `pnpm typecheck` (both tsconfigs) exit 0; `pnpm i18n:check` deep parity ✓; `pnpm test` (dev env) → **397 files / 3902 tests, 0 failed** — including the two files the audit flagged as pre-existing failures.

**Verdict:** Merge DONE; fixes A (Day field) + B (bubble bidi) + C (design-sync) landed. Owed: deploy + post-deploy chat drill, Day-field + bubble sim drills (logged when run).

## 2026-07-04 — Device drills: Day-field + bubble bidi PASS (closes the superseding entry's owed capture)

**Claim:** Both client-side fixes verified on-simulator against the freshly built native shell (bundle `Tasks-D9zXaCKE.js`, installed on iPhone 17 Pro + iPad A16 sims).

**Evidence (observed on device, screenshots in session scratchpad):**
- **Day field (drill-day-field-fixed.png, device-resolution 1206×2622):** iPhone 17 Pro portrait RTL, Tasks → בקרות משימות — the date input ("4 Jul 2026") renders fully inside the white card, edge-aligned with the technician select / hours / interval inputs. The audited ~30 device-px end-side escape is gone. The superseding Phase 5 entry's owed capture is now closed.
- **Bubble bidi (iPad chat panel, zoomed capture):** the Latin message bubble renders "Hi everyone!" — trailing punctuation at the end, identical to the pinned banner above it. The audit's "!Hi everyone" reordering no longer reproduces.
- **Still owed:** chat empty-state drill (off-shift → no weeks-old transcript) — blocked on production deploy; the Railway CLI/MCP token expired (`invalid_grant`) and re-login is interactive. `vettrack.uk` still runs the pre-branch server at drill time, which is also why the transcript remains visible on-device (consistent with the audit's Phase 0 ceiling).

**Verdict:** 2 of 3 post-merge drills PASS at device level; chat drill remains deploy-gated.

## 2026-07-04 — Production deploy + chat empty-state drill PASS (Phase 0 closed end-to-end)

**Claim:** The merged server is live on vettrack.uk and the audit's CEILING drill (chat off-shift) now passes on production.

**Evidence:**
- Deploy path was CI, not local CLI: pushes to origin/main triggered ci.yml runs 28715881342 (5f3746c2b) + 28716199830 (0a5456387), both success incl. the "🚢 Deploy to Railway" job (repo-secret RAILWAY_TOKEN; local CLI token expired and was never needed). Live `build-info.json`: buildTag 1.1.2-mr6q19ux, builtAt 2026-07-04T18:54:47Z; live index bundle references `Tasks-4Mcq3vG8.js` — a chunk that exists only post-merge.
- **Chat drill (drill-chat-offshift.png):** iPhone 17 Pro sim, off-shift, fresh chat-panel open against production → empty state "אין הודעות עדיין", presence "0 מחוברים", no weeks-old transcript. Read-only; nothing posted.
- Note: the Railway CLI link on this machine is stale (registered for /Users/dan/vettrack, token expired) — irrelevant while CI deploys main, but fix before any manual `railway up`.

**Verdict:** All three post-merge drills PASS. Phase 0 verified at code, test, AND production-behavior level. No owed items remain from the audit's merge conditions except the deferred Claude Design prompts.

## 2026-07-05 — /init: CLAUDE.md drift audit + corrections

**Claim:** CLAUDE.md re-verified against the live repo; six drift points fixed, no rewrite of the accurate core (frozen surfaces, realtime, authority, i18n untouched).

**Evidence (each checked against the actual file, not assumed):**
- `package.json` read in full: `architecture:gates` → `scripts/architecture/run-architecture-gates.mjs` runs tsc (frontend) + tsc (`tsconfig.server-check.json`) + depcruise + madge cycles only — tenant:lint and knip are NOT in the gate suite (script grepped, lines 26–41). Commands section corrected.
- Capacitor native shell absent from CLAUDE.md despite `cap:*` scripts, `ios/`/`android/` dirs, and `scripts/build-native-shell.sh` (header read: reads `VITE_CLERK_PUBLISHABLE_KEY`/`VITE_API_ORIGIN` from `.env` only, never sets `CAPACITOR_SERVER_URL`). Added commands + gotcha paragraph + layout line.
- `server/lib/auth-mode.ts` grepped: clerk mode requires secret AND `CLERK_ENABLED !== "false"`; `CLERK_ENABLED=false` → dev-bypass (`clerk-explicitly-disabled`). Auth modes section corrected.
- `vite.config.ts` exclude list read: `tests/shift-chat-window.integration.test.ts` had been added (file header read — requires DATABASE_URL + migration 159, runs via `pnpm exec tsx`). Tests section updated; dedicated runners' actual include lists verified in `vitest.db-integration.config.ts` (equipment-operational-state only) and `vitest.integration.ops.config.ts` (+ waitlist) — first draft overstated their coverage and was corrected.
- `ls src/features/` → 12 modules (was documented as 4); `server/domain/` exists (equipment/ + service-task.adapter.ts, README cross-checked) and was missing from the layout; `server/app/routes.ts` has 46 imports / `server/routes/` 49 files (was "~44").
- Architecture intro updated to post-scope-change reality (README scope note: medication/billing/ER removed in migrations 142–143; legacy routes are redirects).

**Verdict:** CLAUDE.md now matches the repo at commit time. Not re-verified here: worker table, telemetry enums, rate-limit numbers (unchanged text, not re-audited).

## 2026-07-05 — F1/P0: quick-scan now enforces waitlist + precondition gates (committed with this entry)

**Claim:** `quickScanEquipmentCustody()` now calls `evaluateCheckoutV1Preconditions()` + `assertWaitlistCheckoutAllowed()` before checkout (mirroring `toggleEquipmentCustody()`), and `POST /api/equipment/scan` maps `CheckoutPreconditionError` / `EquipmentWaitlistError` to their documented 4xx codes instead of 500.

**Evidence:**
- RED first (TDD): before the fix, `tests/equipment-quick-scan-gates.test.ts` failed with `expected Error: TX_SENTINEL to be an instance of EquipmentWaitlistError` — proving all three denial scenarios (reserved-by-other, untracked, staged-conflict) reached `db.transaction` ungated. Integration RED: quick-scan by non-reserved userC returned `200` (expected 409) in `tests/equipment-waitlist.integration.test.ts`, reproducing the audit's runtime evidence.
- `server/services/equipment-custody-toggle.service.ts:832-833` — checkout branch of `quickScanEquipmentCustody` now runs `evaluateCheckoutV1Preconditions(...)` then `assertWaitlistCheckoutAllowed(...)`, and threads `preCheck.v1StageClaimId`/`v1NewUsageState` into `performEquipmentCheckout` + `finalizeCheckoutSideEffects` (same order/args as toggle at lines 726-751).
- `server/routes/equipment.ts` — `/scan` catch now handles `CheckoutPreconditionError` (STAGING_CONFLICT→409, BUNDLE_INCOMPLETE→422, else `err.httpStatus`) and `EquipmentWaitlistError` (WAITLIST_RESERVATION_HELD_BY_OTHER→409 via `apiErrorI18n`), mirroring `/toggle`.
- Test: `pnpm test -- tests/equipment-quick-scan-gates.test.ts tests/equipment-scan-lifecycle.test.ts` → 2 files, 39 tests passed.
- Test: `DATABASE_URL=postgres://…/vettrack pnpm exec vitest run --config vitest.integration.ops.config.ts tests/equipment-waitlist.integration.test.ts` → 8 passed (includes new "quick-scan by non-reserved user is denied while reservation held (F1 regression)": userC scan → 409 `equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER`, custody stays `returned`, reserved userB scan → 200 checkout, row `fulfilled`).
- Command: `pnpm typecheck` → clean (both tsconfigs). `pnpm test` → 400 files / 3914 tests passed.
- Pre-existing noise ruled out: `tests/equipment-operational-state.integration.test.ts` fails 10-11 sweep/metrics tests IDENTICALLY with my changes stashed (`git stash` → 11 failed → `git stash pop`) — environment-dependent, unrelated to this fix.
- Note: `vitest.integration.ops` suite silently self-skips unless `DATABASE_URL` is exported in the shell — `tests/vitest-setup.ts:3-5` injects a dummy `vettrack_test` URL before the test file's `dotenv/config` runs, so the reachability probe fails and `describe.skipIf` skips all 57 tests.

**Verdict:** VERIFIED

## 2026-07-05 — F2/P1: explicit express.json limit + 413/400 body-parser error mapping (committed with this entry)

**Claim:** `express.json()` now has an explicit `5mb` limit (aligned with the multer upload limits), and body-parser failures return 413/400 via a shared, testable terminal handler instead of the blanket 500.

**Evidence:**
- RED first (TDD): `tests/body-parser-errors.test.ts` failed on missing module `server/lib/body-parser-errors.js` before implementation.
- `server/lib/body-parser-errors.ts` — exports `JSON_BODY_LIMIT = "5mb"`, `classifyBodyParserError()` (`entity.too.large`→413 PAYLOAD_TOO_LARGE, `entity.parse.failed`/SyntaxError+400→400 INVALID_JSON, other typed body-parser 4xx→own status, unrelated errors→null), and `terminalErrorHandler()` (classify-first, blanket 500 otherwise).
- `server/index.ts` — `app.use(express.json({ limit: JSON_BODY_LIMIT }))` replaces the unlimited default; the inline terminal handler is replaced by `app.use(terminalErrorHandler)`. Raw-body webhook mount order unchanged (still before express.json).
- Test: `pnpm test -- tests/body-parser-errors.test.ts` → 11 passed (classifier units + behavioral tests mounting the REAL exported handler on a live express app: 6 MB body → 413, `{"broken":` → 400, valid JSON → 200, unrelated throw → 500).
- Runtime proof on the real server (`PORT=3102 tsx server/index.ts`, same probes as the audit): 6 MB JSON POST `/api/shifts/import/preview` → `HTTP 413 {"error":"Request body exceeds the 5mb limit","code":"PAYLOAD_TOO_LARGE"}`; malformed JSON → `HTTP 400 {"error":"Request body is not valid JSON","code":"INVALID_JSON"}`. Audit had recorded 500 for both.
- Ripple fixed: `tests/integration-adapter.test.js` "mounts raw body route before express.json for HMAC" searched the literal `app.use(express.json())`; search loosened to `app.use(express.json(` and a `> -1` guard added so the ordering invariant is still enforced.
- Command: `pnpm typecheck` → clean. `pnpm test` → 401 files / 3925 tests passed (includes the new file).

**Verdict:** VERIFIED

## 2026-07-05 — F3/P2: shift CSV role-label classification + skipped-row visibility at confirm (committed with this entry)

**Claim:** Roster CSV rows with vet/student labels are no longer skipped with a misleading "not relevant to VetTrack" reason; skipped counts now surface in the confirm audit log and as a warning toast in the admin UI.

**Evidence:**
- Root cause re-verified before fixing: the wetcheck run hit `parseShiftsCsvContent`→`detectShiftRole` (Employee-name CSV, `scripts/wetcheck/simulate.mjs` p1ShiftImport), and the 2 dropped rows were `וטרינר בוקר` (vet) + `סטודנט בוקר` (student) — NOT night variants (`טכנאי לילה`/`בכיר לילה` match טכנאי/בכיר and import fine). Mapping vet/student INTO the roster is intentionally not done: `vt_shift_role` pg enum is closed (`technician|senior_technician|admin`, server/schema/ops.ts:10) and `shared/authority.ts` documents students as never shift-elevated; vet schedules import via the doctor CSV path (`vt_doctor_shifts`).
- `server/routes/shifts.ts` — new `classifyUnsupportedRosterRole()` + `skippedRoleReason()`: vet labels (וטרינר/רופא/vet/doctor) → reason pointing at the doctor CSV path; student labels (סטודנט/student) → "students are not part of the on-shift roster"; other labels keep the generic reason. Confirm `logAudit` metadata now includes `skippedRows`. (File is on the i18n Hebrew-in-source allowlist; `pnpm i18n:check` → deep parity ✓.)
- `src/pages/admin-shifts.tsx` — confirm success with `skippedRows > 0` now shows `toast.warning(importSuccessWithSkipped(inserted, skipped))` instead of a plain success toast (audit's "silent bulk confirm"). New key in `locales/en.json`+`he.json`, parametrized accessor added in `src/lib/i18n.ts` (hand-built namespace gotcha), types regenerated via `pnpm i18n:generate-types`.
- TDD: `tests/shift-csv-role-labels.test.ts` written first → 4 failed (vet/student reasons missing, audit metadata missing, toast missing) → after fix 5/5 pass. Exercises the real POST /api/shifts/import/preview route (Hebrew + English labels, recognized roles unaffected).
- Command: `pnpm typecheck` → clean. `pnpm test` → 3930 passed. `pnpm i18n:check` → parity ✓.

**Verdict:** VERIFIED

## 2026-07-05 — F4/P2: waitlist promotion deferred until asset-typed units are deployable (committed with this entry)

**Claim:** Reservations are no longer hollow for asset-typed gear: return of an asset-typed unit no longer promotes the head waiter (the checkout bundle gate cannot pass while custody is "returned"); promotion fires from the existing dock-return path once the unit is fully deployable, and the TTL-expiry sweep applies the same deployability check.

**Evidence:**
- Root cause re-verified: `computeBundleReadinessGate` hard-requires `custodyState === "docked"` (server/services/equipment-operational-state.service.ts:43), so a just-returned asset-typed unit can NEVER be checked out by the promoted user — the reservation TTL burned down un-redeemably. Chosen remedy is the audit's option (b): promote only when deployable (matches the dock-return path's existing `isEquipmentFullyDeployable` guard at server/routes/equipment-operational-state.ts:372-376).
- `server/services/equipment-custody-toggle.service.ts` — `performEquipmentReturn` now calls `promoteNextWaitlistInTx` only when `existing.assetTypeId` is null; non-asset units keep promote-on-return byte-identical.
- `server/services/equipment-waitlist.service.ts` — `promoteEquipmentWaitlistIfEligible` (dock_return + ttl_expiry triggers) additionally requires `isEquipmentFullyDeployable(...)` for asset-typed units, so the sweep cannot re-issue a hollow reservation either.
- TDD RED first: new integration case "asset-typed return defers promotion…" failed with `expected 1 to be +0` (return promoted immediately) and the sweep case failed the same way (next waiter promoted onto an unverified unit).
- Test: `DATABASE_URL=… vitest run --config vitest.integration.ops.config.ts tests/equipment-waitlist.integration.test.ts` → **10 passed**, including unchanged pre-existing behavior: "return → promotes head waiter" (non-asset), "TTL expiry → expires and promotes next" (non-asset), "dock-return → promotes head waiter when unit becomes deployable". New case proves the reservation is redeemable: dock-return with verified condition → promotion → reserved user `/checkout` → 200.
- Command: `pnpm typecheck` → clean. `pnpm architecture:cycles` → 0 cycles, matches baseline (new import `equipment-waitlist.service` → `equipment-operational-state.service` is acyclic). `pnpm test` → full default suite green.

**Verdict:** VERIFIED

## 2026-07-05 — P2: RFID suite teardown + prepare-real-db purge tool hardened (committed with this entry)

**Claim:** The RFID integration suite no longer leaks `rfid-test-*` clinics, and `scripts/wetcheck/prepare-real-db.ts` no longer crashes mid-purge — it discovers all clinic child tables dynamically, runs atomically, and gates audit-row purging behind an explicit flag.

**Evidence:**
- Root cause discovered during teardown work: `vt_audit_logs` is append-only (`no_delete_audit_logs` rule, `DO INSTEAD NOTHING` — migrations/013) while its clinic FK is `ON DELETE RESTRICT` — so ANY clinic that ever wrote an audit row is undeletable via plain SQL. This is why the dev DB accumulated ~390 orphan test clinics: even the test file's own `db.delete(auditLogs)` calls (now removed) were silent no-ops.
- `tests/rfid-ingest.test.ts` — audit assertions converted from DB reads to a `logAudit` spy (same mock pattern as the waitlist integration suite), so the test clinics never acquire audit rows; `afterAll` deletes children→parents and asserts zero residue (fails the suite loudly on regression). No audit-rule DDL anywhere — an earlier draft that transactionally dropped/re-created the rule was flagged by the permission classifier and replaced with this cleaner design.
- Verified live: `DATABASE_URL=…vettrack pnpm test -- tests/rfid-ingest.test.ts` → 1 file / 8 tests passed; `rfid-test` clinic count before=392, after=392 (previous behavior: +2 per run and the count grew 384→392 across the broken iterations of this session).
- `scripts/wetcheck/prepare-real-db.ts` — three latent bugs fixed: (1) its `DELETE FROM vt_audit_logs` silently no-oped against the rule, so `--execute` would ALWAYS have crashed at the clinic delete; (2) its hardcoded 25-table list missed 18 RESTRICT-FK tables (verified via pg_constraint: e.g. vt_po_lines, vt_purchase_orders, vt_push_subscriptions, vt_clinical_check_ins…); (3) no transaction — a mid-purge failure left a partial purge. Now: child tables + delete order discovered from pg_constraint (children before referenced parents via `orderTablesForDeletion`), whole purge in one `db.transaction`, audit-row purge requires the NEW `ALLOW_AUDIT_LOG_PURGE=1` flag (preflight aborts cleanly before any delete otherwise; rule drop/re-create happens inside the same transaction so the invariant can't be left off). `main()` now runs only on direct invocation so the module is unit-testable.
- Test: `pnpm test -- tests/prepare-real-db-order.test.ts` → 5 passed (chain, diamond, cycle, self-ref, determinism).
- Dry-run against dev DB (safe, verified no changes): discovers **56 child tables** (was 25 hardcoded), reports 398 test clinics / 9,648 equipment / **10,459 audit rows** with the flag guidance. NOT verified: the `--execute` path was not run anywhere (destructive; requires the human CONFIRM_PURGE gate) — first real run should be against a throwaway DB.
- Command: `pnpm typecheck` → clean; `pnpm test` → 3937 passed.

**Verdict:** VERIFIED (teardown + dry-run); PARTIAL (execute path unexercised by design — human-gated)

## 2026-07-05 — Origin hygiene: read-only reconciliation report (committed with this entry)

**Claim:** Produced docs/audit/ORIGIN_RECONCILIATION_2026-07-05.md from live origin state; no branches merged, deleted, or pushed.

**Evidence:**
- Command: `git fetch origin --prune` → three of the audit's four cursor/* branches deleted upstream during prune (output listed them); the fourth (alerts-dropdown) was already gone.
- Command: `git rev-list --left-right --count origin/main...main` → `0 6` (local main strictly ahead; the two Bugbot fixes 57423a3d7/4b2beed02 the audit tracked are now IN origin/main).
- Command: per-branch `git rev-list --left-right --count origin/main...<branch>` for all 21 origin branches + `gh pr list` (16 open PRs) → table in the report; `feat/legal-pages-privacy-terms-support` measured 0 ahead (fully merged).
- Nothing state-changing was run: no push, no merge, no branch deletion (prune only removed local remote-tracking refs for branches already deleted server-side).

**Verdict:** VERIFIED

## 2026-07-05 — PR #42 merged: wet-check remediation shipped to production (c9c394c67; this entry committed locally, unpushed)

**Claim:** All 8 remediation commits went through PR #42 with Cursor + CodeRabbit review, all findings addressed, merged green, and the CI deploy to Railway production succeeded with runtime verification.

**Evidence:**
- PR: https://github.com/exposwifty31/vettrack/pull/42 — branch `fix/wetcheck-audit-remediation`, merged via merge commit `c9c394c67`, branch deleted.
- Cursor Bugbot: APPROVED, "no findings requiring human review" (both review rounds).
- CodeRabbit: 5 inline findings → 4 fixed in `6c147c9ef` (shared `mapCheckoutGateError()` for /scan + /toggle with updated contract test; `PROTECTED_ACCOUNT_EMAIL` env override + masked console output, hard-coded default kept as the documented fail-safe; cycle-break comment corrected; `pool.end()` errors logged) and 1 answered with rationale (audit-rule swap stays in the single transaction — splitting it would let a crash leave the append-only rule off; ACCESS EXCLUSIVE lock + maintenance-window requirement now documented in the script header). CodeRabbit replied `review_comment_addressed` on the threads, final review APPROVED.
- CI on the PR (both rounds): Tests & typecheck, Architecture gates, Integration ops, Playwright E2E ×2, Merge gate — all pass. Local before push: 403 files / 3,938 tests green.
- Post-merge main run: all jobs success including "🚢 Deploy to Railway".
- Production verification (vettrack.uk, buildTag `1.1.2-mr73syhp`, builtAt 2026-07-05T01:20:08Z): malformed JSON POST → `400 {"code":"INVALID_JSON"}` ×3; 6 MB JSON POST → `413 {"code":"PAYLOAD_TOO_LARGE"}`; 300 KB body parses (old 100 KB default gone). Note: one probe fired mid-rollover hit the outgoing container and returned the old 500 — re-probed after the new container settled (buildTag flip observed) and confirmed 400.

**Verdict:** VERIFIED

## 2026-07-05 — App Store archive preflight: system prepared, one user-gated blocker (committed with this entry)

**Claim:** Finished the interrupted Codex release review; ship + dev lanes clean, native shell rebuilt from current main, 14/15 verify gates pass — the only remaining blocker is the sk_live Clerk key for the two [2.1a] admin-config gates (user action: `railway login` or export CLERK_SECRET_KEY).

**Evidence:**
- Codex session findings triaged: its pnpm-11/install churn was its own sandbox (this shell runs the repo-pinned pnpm 9.15.9, `node_modules/.bin` intact); its "CLERK_SECRET_KEY not available locally" stall was the verify script not reading `.env` — fixed (sk_live-only guard, b2ce9bafa) after discovering `.env` carries the DEV sk_test key which must NOT feed the prod gates.
- Tree hygiene (ca5163cbb): audit deliverables committed (docs/audit reports, scripts/wetcheck tooling, .claude project skills, docs/design-system.md); recreatable agent artifacts ignored (.agents/, .codex/, design-sync previews, 12MB "VetTrack Design System/") in .gitignore + shared .git/info/exclude → dev lane (/Users/dan/vettrack, branch main-sync) porcelain 0, ship porcelain 0.
- Command: `REPO=$PWD ./scripts/build-native-shell.sh` → vite build + cap sync ios, 8 plugins; bundled `ios/App/App/public/build-info.json` shows buildTag `1.1.2-mr74k1yp`, builtAt 2026-07-05T01:40:57Z; clerk-native-instance chunk present; tree still clean after sync.
- Command: `DEV_LANE=/Users/dan/vettrack SHIP_LANE=$PWD ./scripts/archive-from-clean-tree.sh --skip-build` → ship CLEAN @ b2ce9bafa on main, dev-lane guard passed, no debug instrumentation, bundled-shell invariant OK; verify-resubmission **PASS 14 / FAIL 1** — sole FAIL is "CLERK_SECRET_KEY not set". Demo login gate (top re-rejection risk) = complete; CORS, icon (1024/no-alpha), build number 21, bundled shell, pk_live + vettrack.uk baked, signin chunk 16.7KB, Control-widget files, AASA + entitlements all PASS.
- Command: `pnpm typecheck && pnpm test` → exit 0 (typecheck clean, full vitest suite green — completes the run Codex left unfinished).
- Railway CLI + MCP both `Unauthorized` (OAuth token expired) — the sk_live pull path needs interactive `railway login`; credential scanning outside the repo was declined by policy, deliberately left to the user.
- NOT verified: the two Clerk-admin gates (redirect URL + allowed_origins) and the Xcode archive/upload itself (§D human step). Xcode MARKETING_VERSION=1.1.0 / CURRENT_PROJECT_VERSION=21 vs web bundle appVersion 1.1.2 noted (cosmetic; ASC uses 1.1.0 (21)).

**Verdict:** VERIFIED (preflight preparation); PARTIAL (2 Clerk-admin gates + archive await user)

## 2026-07-05 — Archive preflight FULL PASS after Railway re-auth (committed with this entry)

**Claim:** All 16 resubmission gates pass; archive-from-clean-tree reports zero blockers. System is ready for the human Xcode archive (§D).

**Evidence:**
- User re-ran `railway login` (danerez5@gmail.com); verify script's Railway fallback pulled the live key; the .env sk_test guard printed its skip note as designed.
- Command: `REPO=$PWD ./scripts/verify-resubmission.sh` → **PASS: 16 FAIL: 0** — including the two previously-blocked [2.1a] gates: redirect URL `vettrack://oauth-callback` present, `allowed_origins` includes `capacitor://localhost`; demo login still `complete`.
- Command: `DEV_LANE=/Users/dan/vettrack SHIP_LANE=$PWD ./scripts/archive-from-clean-tree.sh --skip-build` → ship CLEAN @ 21f859134 on main, verify PASS, "Blockers: none", next step = Xcode archive.
- Earlier this session: fresh bundled shell `1.1.2-mr74k1yp` (build-native-shell), simulator smoke BUILD SUCCEEDED + installed on iPad sim, typecheck + full vitest green.

**Verdict:** VERIFIED — remaining work is the human §D/§E flow: Xcode archive as 1.1.0 (21) → Upload → resubmit with reviewer credentials; bump to 22 via agvtool only if ASC reports a duplicate build number.

## 2026-07-05 — TestFlight 1.1.0 (21) device findings fixed: bare auth shell, dark Clerk card, stale What's New (committed with this entry)

**Claim:** The three device-only regressions from the user's TestFlight screenshots are fixed on main (809b5b59d, 6cb9046b5): signed-out /signin no longer renders inside the native chrome, the Clerk card follows dark mode, and What's New shows 1.1.0 content. Build 21 will NOT be submitted; a fixed build 23 supersedes it.

**Evidence:**
- Root causes read from source, not inferred: `PlatformRouter` wraps every route in `NativeShell` (no auth carve-out — chrome + dead tabs around /signin); `clerkAppearance.variables` were static light colors (white card on `.dark`); `locales/*.json whatsNew.currentVersion` was "1.0.1"/"Build 20" while the dismissal key deliberately re-surfaces the sheet on version change. All three invisible in the simulator: dev-bypass never lands on /signin, and the sim defaults to light appearance.
- Dark-mode "default" itself was diagnosed as system-follow (`appearance: "system"` default + device auto-dark at 06:18) — kept by user decision; only the dark styling was fixed.
- Command: `pnpm test -- tests/native-auth-surface.test.ts` → 5 passed (new source-contract suite: chrome renders only after the auth-route early return; dark palette swaps variables but not element classes; both auth pages pass the reactive flag).
- Command: `pnpm i18n:generate-types && pnpm i18n:check` → deep key parity green after replacing the five `whatsNew.items.*` keys.
- Command: `pnpm typecheck` (both tsconfigs) → clean, twice (after each commit's file set).
- Command: `pnpm test -- tests/i18n-parity.test.ts tests/native-auth-surface.test.ts tests/phase-6-consistency-polish.test.ts` → 20 passed.
- `git diff --stat locales/` verified surgical (40 lines/file, whatsNew block only — no whole-file reformat).
- NOT verified yet: on-device rendering of the three fixes (requires build 23 via build-native-shell.sh → archive → TestFlight; next step).

**Verdict:** VERIFIED (code + contracts); PARTIAL (device verification awaits build 23)

## 2026-07-05 — Device findings round 2: quick-toggle tri-state loss, search overlay stacking trap, stale system scheme (committed with this entry)

**Claim:** Three further device reports fixed: (1) dark→light via the header quick toggle landed on "system" (lossy binary over a tri-state — explicit light/dark now, keyed on the ACTIVE mode via useIsDarkActive, both NativeHeader and TopbarSettingsMenu); (2) phone search overlay + typed query painted behind page content (the header's backdrop-filter stacking context trapped the position:fixed overlay — now portaled to document.body, matching the header's own panels, which were already rendered outside </header> for exactly this reason); (3) "system" resolving dark on a LIGHT phone — no native forcing exists (Info.plist/AppDelegate/capacitor.config all checked clean), diagnosis is WKWebView missing the prefers-color-scheme change while suspended; hardened with a visibilitychange/pageshow re-query.

**Evidence:**
- Root causes read from source: NativeHeader.tsx:361 `"dark" ? "system" : "dark"` (and its TopbarSettingsMenu twin); NativeHeader.tsx:113 `backdropFilter: blur(12px)` + EquipmentSearchButton's fixed overlay rendered INSIDE the header; the pre-existing comment at the panels block ("fixed to the viewport so the header's backdrop-filter … doesn't trap them") confirms the trap class was known — the search overlay just never got the treatment.
- Command: `pnpm test -- tests/native-header-controls.test.ts tests/native-auth-surface.test.ts` → 10 passed (new suite pins toggle semantics, portal usage, panels-outside-header, and the foreground re-query).
- Command: `pnpm typecheck` → clean (both tsconfigs).
- NOT verified: on-device behavior of "system" after the resume re-query — if the user's light phone still renders dark under "system" on the new build with the app foregrounded during an OS appearance flip, escalate to a native trait plugin (UITraitCollection → JS), since the web-side signal would be proven unreliable on this device.

**Verdict:** VERIFIED (code + contracts); PARTIAL (device verification awaits next build)

## 2026-07-06 — CLAUDE.md refresh: document platform-routing seam + grown src/ hexagonal layout (`/init`)

**Claim:** `CLAUDE.md` was refreshed (doc-only, +23/−1) to close two gaps found by verifying the doc against the live code: (1) the `src/app/platform/` platform-routing seam (`PlatformTarget` resolution order, `PlatformRouter`, `WebOnlyGuard`) was undocumented; (2) the `src/` tree omitted the newer hexagonal layer (`core/`, `infrastructure/`, `native/`, `desktop/`, `shell/`, `types/`, `app/platform/`). Also added a one-line pointer to the `docs/design/program-plan.md` forward-looking program. Existing command block and every architecture subsection were left unchanged (command block re-verified accurate against `package.json`).

**Evidence:**
- Seam facts read from source, not inferred: `src/app/platform/index.ts` (`PlatformTarget` union + `resolvePlatformTarget()`:36 / `usePlatformTarget()`:51, native→marketing→touch-narrow→desktop order; marketing paths `/signin /signup /privacy /terms /support`; touch-narrow `(max-width: 767px) and (pointer: coarse)`), `PlatformRouter.tsx` (mobile→NativeShell else passthrough), `guards/WebOnlyGuard.tsx` (native Redirect + <1024px guard screen).
- `WebOnlyGuard` fenced set re-grepped in `src/app/routes.tsx` rather than copied from the plan's II.1 subset — actual set is broader: `/equipment/board`, `/equipment/:id/qr`, `/print`, `/code-blue/display`, `/emergency-equipment-wall`, `/audit-log`, `/procurement`, `/analytics{,/shift-leaderboard}`, `/dashboard`. Doc describes it by format-category to stay accurate.
- Hexagonal layer confirmed by listing dirs + barrels: `src/core/{entities,ports,use-cases}` (use-cases has `offline-emergency-block.ts`), `src/infrastructure/{api,auth,db,platform}` (`infrastructure/index.ts` re-exports `equipmentCache/syncQueue` + `haptics/nfc/deepLink`), `src/shell/index.ts` self-labels "legacy compat". Migration-in-progress caveat sourced from those barrel comments + branch names.
- Command: every path named in the new text resolves — `ls -d src/{app/platform,core,infrastructure,native,desktop,shell,types}` + `WebOnlyGuard.tsx` + `offline-emergency-block.ts` + `docs/design/{program-plan,plan-validation-register,platform-strategy-research}.md` all present.
- Command: `git diff --stat CLAUDE.md` → 1 file changed, +23/−1 (no code touched).
- Command: `pnpm typecheck` (both tsconfigs) → exit 0, clean — sanity that the doc-only change perturbed nothing.

**Verdict:** VERIFIED (doc matches code; all referenced paths resolve; typecheck green)
