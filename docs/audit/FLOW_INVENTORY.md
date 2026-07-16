# Flow Inventory (Phase 0)

**Generated:** 2026-07-06 · **Branch:** `claude/phase-0-baseline` · **Source of truth:** `src/app/routes.tsx` + `src/app/platform/` guards.

Per rule III.6, every flow in the app must be provable 100% functioning across platform × role. This is the living inventory. It is re-stamped by every phase for the flows its diff can affect, and fully re-verified at Phase 10.

## What is verified here vs. pending

- ✅ **Verified now (static, from code):** route registration, guard, and therefore **platform availability** (native / web / board / marketing). These are read directly from `routes.tsx` and the platform resolver — not inferred.
- ✅ **Live walk EXECUTED (2026-07-16):** the III.6 end-to-end walk ran in the real running app across every surface — the four platform targets (web · board · native iPhone · native iPad) **plus** the marketing surface, five in total. **Web + board + marketing** (Playwright, desktop 1440×900, all 5 role archetypes): **147 rows — 145 pass, 0 broken, 2 degraded**. **Native iPhone** (Appium/XCUITest, iPhone 17 sim, admin + student): **68/68 pass**. **Native iPad** (iPad Pro 11-inch (M5) sim): **68/68 pass**. Evidence: `docs/audit/evidence/flow-walk-web-matrix-2026-07-16.json` + `flow-walk-native-{iphone,ipad}-2026-07-16.txt` (149 row screenshots in gitignored `artifacts/flow-walk/`). The 2 degraded rows are one real finding (shift-chat archive 404 — see the Shift-ops row).

**Status legend (for the live walk):** `pass` · `broken` · `degraded` · `unreachable` · `⏳ pending` (not yet walked).

> **Executable harness (2026-07-15).** This inventory is now machine-readable +
> walkable: `tests/flow-walk/` (see its `README.md`). `flow-inventory.manifest.ts`
> is the reconciled row set (web via Playwright, iPhone/iPad via Appium);
> `flow-inventory.manifest.test.ts` is a **drift guard** that fails if a route's
> guard classification diverges from `src/app/routes.tsx`. Run the web/board walk
> with `pnpm dev:walk` + `pnpm test:playwright:flow-walk` (never plain `pnpm dev` —
> the per-IP API rate limiter poisons auth ~9 pages in; `dev:walk` sets
> `PLAYWRIGHT_E2E=true`, the sanctioned skip). Two corrections it encodes that
> this table (generated 2026-07-06) predates: several rows are now redirects
> (`/equipment/scan|maintenance|intelligence`, `/shift-handover`, `/pending*`,
> `/equipment/board`·`/display`→`/board`), and **the desktop web app is
> management-only** (T-31/R-WEB-01: `AuthGuard` shows `ManagementWebGate` to
> non-`management.web` roles on every desktop route — the per-role notes below
> describe the *native* target, where that gate is inert).

## Platform availability rules (verified from guards)

| Guard (in `routes.tsx`) | iPhone | iPad | Web (≥1024) | Board | Marketing |
|---|:--:|:--:|:--:|:--:|:--:|
| Marketing path (`isMarketingPathname`) | — | — | — | — | ✅ chrome-free |
| `AuthGuard` only | ✅ | ✅ | ✅ | ✅¹ | — |
| `AuthGuard > WebOnlyGuard` | redirect→fallback² | redirect→fallback² | ✅ | ✅³ | — |

¹ The `board` PlatformTarget **shipped in Phase 4** (PR #55). `/board` is `AuthGuard`-only and renders `BoardShell` (dark kiosk chrome, wake-lock, self-heal); `/equipment/board` remains a `WebOnlyGuard` web route during the transition (end-state decided at Phase 10).
² Capacitor-native redirects to the guard's `fallback` (e.g. `/equipment/board` → `/my-equipment`); browser < 1024px shows the dark guard screen.
³ This column is the **WebOnlyGuard** web route `/equipment/board` (plus the other WebOnlyGuard large-format surfaces) rendering on a board-class display — **not** the `AuthGuard`-only `/board` kiosk in row ¹. The two board surfaces are distinct: `/board` (AuthGuard only → `BoardShell` kiosk) vs `/equipment/board` (`AuthGuard > WebOnlyGuard` web route).

## Marketing (unauthenticated, chrome-free)

| Path | Component | Live-walk |
|---|---|---|
| `/signin`, `/signin/*?` | signin | pass ✅ 2026-07-16 (authed walk bounces → /home by design) |
| `/signup`, `/signup/*?` | signup | pass ✅ 2026-07-16 (authed walk bounces → /home by design) |
| `/privacy` · `/terms` · `/support` | legal/support | pass ✅ 2026-07-16 |

## Core operational (AuthGuard — all app platforms, all roles unless nav-gated)

| Path | Purpose | Role gating (⚠️ nav-linkage re-verified Phase 2) | Live-walk |
|---|---|---|---|
| `/` , `/home` | Root / home surface | all | pass ✅ 2026-07-16 (web ×5 roles + iPhone + iPad) |
| `/equipment`, `/equipment/new`, `/equipment/:id`, `/equipment/:id/edit` | Equipment list/detail/edit | all (vet/admin actions gated in-page) | pass ✅ 2026-07-16 (detail/edit against a seeded UUID) |
| `/equipment/tasks` | Unified task model (Tasks) | all | pass ✅ 2026-07-16 (native student → /equipment custody redirect, by design) |
| `/scan`, `/equipment/scan` | Scan / custody | all | pass ✅ 2026-07-16 (desktop self-redirects → /equipment?scan=1; shell renders /scan, alias chains → /scan) |
| `/equipment/maintenance`, `/equipment/intelligence` | Equipment ops | all | pass ✅ 2026-07-16 (redirects confirmed) |
| `/alerts` · `/my-equipment` · `/my-profile` | Alerts, custody, profile | all | pass ✅ 2026-07-16 |
| `/rooms`, `/rooms/:id`, `/locations`, `/locations/:id` | Rooms / locations | all | pass ✅ 2026-07-16 |
| `/code-blue` · `/crash-cart` · `/handoff` | Emergency + handover | all (initiate gated server-side) | pass ✅ 2026-07-16 |
| `/critical-kit-check` · `/emergency-equipment-log` · `/emergency-equipment-history` | Emergency kit | all | pass ✅ 2026-07-16 |
| `/inventory`, `/inventory-items`, `/inventory-items/:id` | Inventory | all | pass ✅ 2026-07-16 |
| `/settings` · `/help` · `/whats-new` · `/app-tour` · `/stability` | App surfaces | all | pass ✅ 2026-07-16 (/app-tour + /stability now redirect → /home — drift) |
| `/shift-chat/:shiftId` · `/shift-handover` · `/pending` · `/pending-emergencies` | Shift ops | all | degraded ⚠️ 2026-07-16 (/shift-chat/:id renders but GET /api/shift-chat/archive/:id 404s → console error, admin+senior web — finding logged; redirects pass) |

## Web-only / large-format (AuthGuard > WebOnlyGuard — web + board; native redirects)

| Path | Purpose | Role gating | Live-walk |
|---|---|---|---|
| `/equipment/board` | **Legacy alias → `/board`** (not a distinct board surface) | all | pass ✅ 2026-07-16 (redirects to the canonical `/board` kiosk; the ¹²³ guard footnotes above record the pre-Phase-4 structure — `/board` is the sole canonical kiosk entry now) |
| `/equipment/:id/qr` · `/print` | QR / print sheets | all | pass ✅ 2026-07-16 |
| `/code-blue/display` · `/emergency-equipment-wall` | Emergency wall displays | all | pass ✅ 2026-07-16 |
| `/dashboard` | Management dashboard | admin/management | pass ✅ 2026-07-16 (management.web renders; others T-31 gate by design) |
| `/analytics`, `/analytics/shift-leaderboard`, `/analytics/outcome-kpi` | Analytics | admin/management | pass ✅ 2026-07-16 |
| `/procurement` | Procurement | admin/management | pass ✅ 2026-07-16 |
| `/audit-log` | Audit log | admin | pass ✅ 2026-07-16 (admin renders; senior_technician → T22 access-denied by design) |

## Admin / management (AuthGuard; nav `adminOnly` — **not** all WebOnly-fenced today, II.1)

| Path | Purpose | Fenced? | Live-walk |
|---|---|---|---|
| `/admin` · `/admin/metrics` | Admin home / metrics | **not** WebOnlyGuard-fenced (Phase 6 restages) | pass ✅ 2026-07-16 (admin renders; senior → T22 access-denied by design) |
| `/admin/shifts` · `/admin/asset-types` · `/admin/docks` | Admin config | AuthGuard | pass ✅ 2026-07-16 (admin renders; senior → T22 access-denied by design) |
| `/admin/code-blue-history` · `/admin/medication-integrity` | Admin history | AuthGuard | pass ✅ 2026-07-16 (senior renders history; medication-integrity → /admin redirect) |

## Legacy redirects & removed scope (expected: redirect, not render)

Per `docs/scope-change-2026.md` (migrations 142–143), patient/ER/med domains were removed and survive only as redirects. **A live walk that finds any of these rendering a real page is a blocking finding.**

| Path | Expected | Live-walk |
|---|---|---|
| `/appointments`, `/equipment-tasks` | → `/equipment/tasks` | pass ✅ 2026-07-16 (native student chains on → /equipment, by design) |
| `/display`, `/equipment-board` | → `/equipment/board` | pass ✅ 2026-07-16 (→ **/board**, the canonical kiosk — target updated post-Phase-4) |
| `/meds` · `/pharmacy-forecast` | removed → redirect | pass ✅ 2026-07-16 (redirect confirmed — nothing renders) |
| `/patients`, `/patients/:id` | removed → redirect | pass ✅ 2026-07-16 (redirect confirmed — nothing renders) |
| `/billing`, `/billing/:rest*` | removed → redirect | pass ✅ 2026-07-16 (redirect confirmed — nothing renders) |
| `/er`, `/er/:rest*` | removed → redirect | pass ✅ 2026-07-16 (redirect confirmed — nothing renders) |

## How to re-run the live walk (III.6 — executed 2026-07-16; re-stamp per phase)

1. **Web + board:** `pnpm dev:walk` (dev-bypass + `PLAYWRIGHT_E2E=true`, `clinicId=dev-clinic-default`), then `pnpm test:playwright:flow-walk`. Cycles all 5 role archetypes automatically and writes `artifacts/flow-walk/web-matrix.json` + screenshots.
2. **iPhone + iPad:** live-reload shell — `CAPACITOR_SERVER_URL=http://localhost:5000 npx cap sync ios && npx cap run ios --target <sim-udid>` (NOT `cap:build:native`, which strips the env by design), then `cd tests/flow-walk/native && SIM_UDID=<udid> npm run walk:iphone` / `walk:ipad`. See `tests/flow-walk/native/README.md`.
3. **Role note (II.1):** the server collapses `lead_technician`/`vet_tech` → `student`; exercise the **lead** archetype via `senior_technician` and **tech** via `technician`. `admin` is the dev-bypass default when the override is cleared.
4. Re-stamp touched rows in every phase; Phase 10 re-verifies the full inventory across all four platforms.

> **⚠️ Role-gating column caveat:** precise per-role nav visibility (`adminOnly` flags across nav models) is only partially verified in Part II.1 and is re-grepped authoritatively at Phase 2 start. The gating notes above are the current best read from `IconSidebar`/`MoreSheet` + guard placement, not a final contract.

## Reconciliations (Phase 7R)

**R4 — inventory-deduction "no-op vs live" conflict (docs-only; no code change).** Two docs disagreed, and both are half-right about different objects:
- `scope-change-2026.md:28` labels `server/workers/inventory-deduction.worker.ts` a **no-op stub** — correct: `processInventoryDeductionJob` returns immediately ("kept for job-runtime wiring compatibility"), and `startInventoryDeductionWorker` warns "worker disabled".
- `RELEVANCE_BASELINE.md:70` flags it **LIVE via `dispense.service.ts`** — also correct, but about the *queue*, not the worker: `dispense.service.ts:609` still **enqueues** a deduction job post-TX (the live import), which the no-op worker then ignores.
- The **actual** inventory deduction runs **inline** at dispense completion (`dispense.service.ts:634`, per the worker's own `@deprecated` note).

Resolution: **intentionally preserved** post-migration-143 — the no-op worker + still-enqueued-but-ignored queue are wiring-compat scaffolding; the real deduction is inline. **Not removed** (this surfaces the conflict rather than acting on the audit's removal suggestion, per program-plan Phase 7R R4).
