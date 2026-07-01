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
