# Flow Inventory (Phase 0)

**Generated:** 2026-07-06 · **Branch:** `claude/phase-0-baseline` · **Source of truth:** `src/app/routes.tsx` + `src/app/platform/` guards.

Per rule III.6, every flow in the app must be provable 100% functioning across platform × role. This is the living inventory. It is re-stamped by every phase for the flows its diff can affect, and fully re-verified at Phase 10.

## What is verified here vs. pending

- ✅ **Verified now (static, from code):** route registration, guard, and therefore **platform availability** (native / web / board / marketing). These are read directly from `routes.tsx` and the platform resolver — not inferred.
- ⏳ **Pending live-walk:** the III.6 requirement is an end-to-end walk **in the real running app** (sim/browser), never inferred from unit tests. No booted simulator or running app was available in this session, so **no row below is stamped `pass`** — doing so would violate III.4 (verify before claiming). Each flow's live status is `⏳ pending`. The walk protocol is at the end; it uses the Phase 0 dev-role switcher to cycle roles.

**Status legend (for the live walk):** `pass` · `broken` · `degraded` · `unreachable` · `⏳ pending` (not yet walked).

## Platform availability rules (verified from guards)

| Guard (in `routes.tsx`) | iPhone | iPad | Web (≥1024) | Board | Marketing |
|---|:--:|:--:|:--:|:--:|:--:|
| Marketing path (`isMarketingPathname`) | — | — | — | — | ✅ chrome-free |
| `AuthGuard` only | ✅ | ✅ | ✅ | n/a¹ | — |
| `AuthGuard > WebOnlyGuard` | redirect→fallback² | redirect→fallback² | ✅ | ✅³ | — |

¹ The `board` PlatformTarget does not exist yet (Phase 4). Today `/equipment/board` is a `WebOnlyGuard` web route.
² Capacitor-native redirects to the guard's `fallback` (e.g. `/equipment/board` → `/my-equipment`); browser < 1024px shows the dark guard screen.
³ Board-class (large-format) surfaces are the WebOnlyGuard set by design.

## Marketing (unauthenticated, chrome-free)

| Path | Component | Live-walk |
|---|---|---|
| `/signin`, `/signin/*?` | signin | ⏳ pending |
| `/signup`, `/signup/*?` | signup | ⏳ pending |
| `/privacy` · `/terms` · `/support` | legal/support | ⏳ pending |

## Core operational (AuthGuard — all app platforms, all roles unless nav-gated)

| Path | Purpose | Role gating (⚠️ nav-linkage re-verified Phase 2) | Live-walk |
|---|---|---|---|
| `/` , `/home` | Root / home surface | all | ⏳ pending |
| `/equipment`, `/equipment/new`, `/equipment/:id`, `/equipment/:id/edit` | Equipment list/detail/edit | all (vet/admin actions gated in-page) | ⏳ pending |
| `/equipment/tasks` | Unified task model (Tasks) | all | ⏳ pending |
| `/scan`, `/equipment/scan` | Scan / custody | all | ⏳ pending |
| `/equipment/maintenance`, `/equipment/intelligence` | Equipment ops | all | ⏳ pending |
| `/alerts` · `/my-equipment` · `/my-profile` | Alerts, custody, profile | all | ⏳ pending |
| `/rooms`, `/rooms/:id`, `/locations`, `/locations/:id` | Rooms / locations | all | ⏳ pending |
| `/code-blue` · `/crash-cart` · `/handoff` | Emergency + handover | all (initiate gated server-side) | ⏳ pending |
| `/critical-kit-check` · `/emergency-equipment-log` · `/emergency-equipment-history` | Emergency kit | all | ⏳ pending |
| `/inventory`, `/inventory-items`, `/inventory-items/:id` | Inventory | all | ⏳ pending |
| `/settings` · `/help` · `/whats-new` · `/app-tour` · `/stability` | App surfaces | all | ⏳ pending |
| `/shift-chat/:shiftId` · `/shift-handover` · `/pending` · `/pending-emergencies` | Shift ops | all | ⏳ pending |

## Web-only / large-format (AuthGuard > WebOnlyGuard — web + board; native redirects)

| Path | Purpose | Role gating | Live-walk |
|---|---|---|---|
| `/equipment/board` | Command Center board | all (kiosk) | ⏳ pending |
| `/equipment/:id/qr` · `/print` | QR / print sheets | all | ⏳ pending |
| `/code-blue/display` · `/emergency-equipment-wall` | Emergency wall displays | all | ⏳ pending |
| `/dashboard` | Management dashboard | admin/management | ⏳ pending |
| `/analytics`, `/analytics/shift-leaderboard`, `/analytics/outcome-kpi` | Analytics | admin/management | ⏳ pending |
| `/procurement` | Procurement | admin/management | ⏳ pending |
| `/audit-log` | Audit log | admin | ⏳ pending |

## Admin / management (AuthGuard; nav `adminOnly` — **not** all WebOnly-fenced today, II.1)

| Path | Purpose | Fenced? | Live-walk |
|---|---|---|---|
| `/admin` · `/admin/metrics` | Admin home / metrics | **not** WebOnlyGuard-fenced (Phase 6 restages) | ⏳ pending |
| `/admin/shifts` · `/admin/asset-types` · `/admin/docks` | Admin config | AuthGuard | ⏳ pending |
| `/admin/code-blue-history` · `/admin/medication-integrity` | Admin history | AuthGuard | ⏳ pending |

## Legacy redirects & removed scope (expected: redirect, not render)

Per `docs/scope-change-2026.md` (migrations 142–143), patient/ER/med domains were removed and survive only as redirects. **A live walk that finds any of these rendering a real page is a blocking finding.**

| Path | Expected | Live-walk |
|---|---|---|
| `/appointments`, `/equipment-tasks` | → `/equipment/tasks` | ⏳ pending |
| `/display`, `/equipment-board` | → `/equipment/board` | ⏳ pending |
| `/meds` · `/pharmacy-forecast` | removed → redirect | ⏳ pending (confirm redirect) |
| `/patients`, `/patients/:id` | removed → redirect | ⏳ pending (confirm redirect) |
| `/billing`, `/billing/:rest*` | removed → redirect | ⏳ pending (confirm redirect) |
| `/er`, `/er/:rest*` | removed → redirect | ⏳ pending (confirm redirect) |

## How to complete the live walk (the pending III.6 step)

1. **Web + board:** `pnpm dev` (dev-bypass auth, `clinicId=dev-clinic-default`), then walk each web/board/marketing row in a desktop browser (≥1024px). Use the **Phase 0 dev-role switcher** (Settings → *Developer · role override*) to cycle `admin → vet → senior_technician → technician → student` and re-walk role-gated rows. Stamp each `pass/broken/degraded/unreachable`.
2. **iPhone + iPad:** `pnpm cap:build:native && pnpm cap:install:ios-sim`; walk the AuthGuard rows on both device classes; confirm every WebOnlyGuard row **redirects** (never renders a broken desktop layout) on native.
3. **Role note (II.1):** the server collapses `lead_technician`/`vet_tech` → `student`; exercise the **lead** archetype via `senior_technician` and **tech** via `technician`. `admin` is the dev-bypass default when the override is cleared.
4. Re-stamp touched rows in every phase; Phase 10 re-verifies the full inventory across all four platforms.

> **⚠️ Role-gating column caveat:** precise per-role nav visibility (`adminOnly` flags across nav models) is only partially verified in Part II.1 and is re-grepped authoritatively at Phase 2 start. The gating notes above are the current best read from `IconSidebar`/`MoreSheet` + guard placement, not a final contract.
