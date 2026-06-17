# VetTrack — Native ship checklist (Capacitor TestFlight / App Review)

**Purpose:** Human release gate for Capacitor **iOS** submission. Every row must **PASS** before "Submit for Review." Mirrors `nfc-ship-checklist.md` structure.

**Grill-me locked (2026-06-15):** All `src/app/routes.tsx` screens · iPhone + iPad · portrait + landscape · bundled-only iteration · 100% green gate.

**Operator guide:** [native-mobile-implementation-manual.md](./native-mobile-implementation-manual.md) (skills + burn-down workflow).  
**Human vs agent split:** tennis Phase 1 in [native-ship-master-prompt.md](./native-ship-master-prompt.md).

---

## PASS criteria (all required per row)

| Layer | Requirement |
|-------|-------------|
| **Functional** | No crash; primary action reachable |
| **Clinical UX** | Primary CTAs not clipped; keyboard does not hide inputs; primary taps ≥44px |
| **Design polish** | Spacing/typography acceptable; no awkward wraps on titles/equipment names |
| **WCAG 2.2 AA** | Manual audit — document violations fixed or N/A with note |

**Shift chat:** `ShiftChatFab` + `ShiftChatPanel` must PASS on iPhone and iPad (tier 1 — fix before broad burn-down).

---

## Prerequisites (Mac, before device matrix)

| Gate | Command / check | Result | Notes |
|------|-----------------|--------|-------|
| Legal pages | Browser: `/privacy`, `/terms`, `/support` | PASS (after deploy) | Public routes ship policy, terms, and support copy — verify on production before store URLs. See [../legal-pages.md](../legal-pages.md). |
| Resubmission script | `./scripts/verify-resubmission.sh` | PASS | **16/16 gates (2026-06-16)** — demo login `complete`, Clerk OAuth, CORS, icon, build 12, bundled shell, `vettrack.uk` baked in bundle, widgets, AASA. (First run showed 15/16: stale `dist/public` missing `vettrack.uk`; cleared by rebuilding the bundled shell — see below.) |
| Demo login | `RESUBMISSION_RUNBOOK.md` §C curl | `LOGIN: complete` | Demo account sign-in verified on device (2026-06-15); re-confirmed by gate script (2026-06-16) |
| Bundled shell | `./scripts/build-native-shell.sh` | synced | Rebuilt + `cap sync ios` (2026-06-16) — bakes `VITE_API_ORIGIN=https://vettrack.uk` from `.env` only (ignores empty `.env.local` override); no `server.url` in `ios/App/App/capacitor.config.json` |
| Build number | Xcode `CURRENT_PROJECT_VERSION` | 12 | Bump per upload |
| Simulator smoke | `./scripts/install-ios-sim.sh` | PASS | iPad (A16) sim: BUILD SUCCEEDED, app launches, boots to `/signin` with live Clerk card (Apple/Google/demo `0501234567`, "Secured by Clerk") — confirms bundled auth reaches real backend, not a blank shell (2026-06-16) |

---

## Burn-down tiers (fix order)

1. **Tier 1 — Shift chat + auth:** shift chat panel, `/signin`, `/signup`
2. **Tier 2 — Bedside:** `/home`, `/equipment` family, `/rooms`, `/alerts`, `/my-equipment`
3. **Tier 3 — Emergency:** `/code-blue` family, `/crash-cart`, `/handoff`
4. **Tier 4 — Platform:** inventory, tasks, analytics, procurement, dashboard
5. **Tier 5 — Admin:** `/admin` family, `/settings`, `/help`, `/audit-log`, `/shift-chat/:shiftId`

---

## Route matrix

Use one row per **route × device × orientation**. Replace `<uuid>` with a real equipment id; `<shiftId>` with a real shift.

| Tier | Route | iPhone P | iPhone L | iPad P | iPad L | PASS | Notes |
|------|-------|----------|----------|--------|--------|------|-------|
| 1 | Shift chat (FAB + panel) | PASS | PASS | PASS | partial | | iPhone P re-verified (2026-06-16 batch 5): FAB opens panel — "1 online", message bubble + reactions, composer (megaphone/input/send) visible, not clipped (`qa-screenshots/iphone-p-shift-chat.png`). **iPhone L PASS** (2026-06-16 batch 6): shift-chat panel readable in landscape letterbox — `iphone-l-equipment-final-raw.png` (review **raw** PNG; do not `sips --rotate -90`). iPad P (2026-06-16). iPad L: not isolated this session. |
| 1 | `/signin` | PASS | | PASS | | | iPhone P (2026-06-16): renders clean on phone, full login (email+password → /home) driven via idb. iPad P (2026-06-16): Clerk card + demo/Apple/Google all visible, login completes. WCAG manual audit still pending. Landscape pending. |
| 1 | `/signup` | | | | | | Not reached this session (session persisted; no sign-out path exercised). |
| 2 | `/home` | PASS | PASS | PASS | PASS | | iPhone P dashboard loads post-auth (`iphone-p-post-login.png`, 2026-06-16 batch 5). **iPhone L PASS** (2026-06-16 batch 6): portrait-letterbox per `manifest.json` `orientation: portrait` — readable; no dedicated landscape reflow expected (`iphone-l-home-raw.png`, review raw). iPad P (2026-06-16). iPad L (`ipad-l-home-raw.png` / `land-tabsweep.png`): top tab bar + left icon rail, multi-column reflow, no clipping. |
| 2 | `/equipment` | PASS | PASS | PASS | PASS | | ~~title wrap~~ **FIXED** + re-verified iPhone P (`iphone-p-equipment.png`). iPad P portrait. **iPad L PASS** (`ipad-l-equipment-raw.png`): list reflows, filters + CTAs visible. **iPhone L PASS** (portrait-letterbox; readable equipment list when navigated from portrait — batch 5 `iphone-l-equipment-raw.png`). |
| 2 | `/equipment?scan=1` | partial | | PASS | | | iPad P (2026-06-16): scanner UI correct; simulator camera overlay is artifact only. iPhone P: Scan FAB opens scanner in portrait when sim frame is 402×874; automated capture unreliable when orientation slips — spot-check manually before submit. `vettrack://scan` opens system "Open in VetTrack?" sheet — dismiss before auditing. |
| 2 | `/equipment/new` | | | PASS | | | iPad P (2026-06-16): clean empty Add-equipment form w/ helpful placeholders. iPhone P not isolated. |
| 2 | `/equipment/tasks` | PASS | | PASS | | | iPad P (2026-06-16). **iPhone P PASS** (`iphone-p-crash-cart.png`): Tasks empty state + Create task CTA. |
| 2 | `/equipment/board` | PASS | | PASS | | | iPhone P (`iphone-p-tasks.png`): fullscreen "THE WARD · CRITICAL EQUIPMENT" kiosk — LIVE clock, readiness, checkmark empty state. iPad P (2026-06-16). Landscape pending. |
| 2 | `/equipment/<uuid>` | | | PASS | | | iPad P (2026-06-16): rich detail — "Operational truth" (custody/location/honest gaps/evidence), Asset Copilot Explain, In Use/Issue/Status/Move actions. Clean. |
| 2 | `/equipment/<uuid>/edit` | | | PASS | | | iPad P (2026-06-16): Edit form (Basic info: name/Hebrew name/serial/RFID/model/mfr; Organization: folder/location/floor note). Clean. |
| 2 | `/equipment/<uuid>/qr` | | | partial | | | iPad P (2026-06-16): reached via item "⋯ → Tools → Print QR". Action invokes print/share; a dedicated /qr page view was not confirmed via tap. Entry point present. |
| 2 | `/alerts` | PASS | | PASS | PASS | | iPad P (2026-06-16). **iPad L PASS** (`ipad-l-inventory-raw.png` — misnamed file; content is Alerts with "Worst First" card + maintenance list). **iPhone P PASS** (`iphone-p-inventory.png`): Worst First card + maintenance list, 61 active alerts badge. |
| 2 | `/my-equipment` | PASS | | PASS | | | iPhone P (`iphone-p-inventory-try.png`): empty state + Shift summary CTA. iPad P (2026-06-16). |
| 2 | `/rooms` | PASS | | PASS | | | iPhone P (`iphone-p-rooms.png`): Asset radar 2-col grid, filters, stale badges — clean narrow reflow. iPad P (2026-06-16). |
| 2 | `/rooms/<uuid>` | | | PASS | | | iPad P (2026-06-16): ICU room detail — Synced status, Available/In-Use counts, Verify-all, equipment card (Check out/Move), Room Activity. Clean. |
| 2 | `/print` | | | PASS | | | iPad P (2026-06-16): Print QR — searchable equipment list w/ QR thumbnails, Select all. Clean. |
| 3 | `/code-blue` | PASS | PASS | PASS | PASS | | iPhone P (`iphone-p-emergency.png`, batch 5): arming screen clean — manager, readiness checklist, Open CTA. ~~iPhone L ISSUE (rotated labels)~~ **WITHDRAWN** — false positive from `sips --rotate -90` on already-correct raw captures; **raw** `iphone-l-code-blue-fix-raw.png` shows horizontal checklist labels. App is **portrait-locked** (`public/manifest.json`); landscape shows letterboxed portrait UI (expected). **Code fix (batch 6):** `useDirection()` replaces hardcoded `dir="rtl"` in [code-blue.tsx](../../src/pages/code-blue.tsx) + explicit `[writing-mode:horizontal-tb]` on checklist labels. iPad P (2026-06-16). **iPad L PASS** (`ipad-l-code-blue-raw.png`): centered portrait column, labels horizontal. |
| 3 | `/code-blue/display` | | | n/a | | | Requires an active Code Blue session to render meaningfully; not started (would be a live prod emergency mutation). Verify on a staging clinic with a seeded session. |
| 3 | `/crash-cart` | | | PASS | | | iPad P (2026-06-16): Daily Crash Cart Inspection, RTL checklist renders correctly, check-history, save-with-missing flow. iPhone P: menu Y calibration not re-captured cleanly — verify on device or repeat portrait menu tap to "Critical Kit Check". |
| 3 | `/handoff` | | | n/r | | | Route **still mounted** (`src/app/routes.tsx` `/handoff` → `HandoffPage`). Not in Menu drawer or bottom tabs — n/r via standard nav (confirmed iPad P + iPhone menu audit). |
| 3 | `/admin/code-blue-history` | | | PASS | | | iPad P (2026-06-16): "CODE BLUE History" + "No events in history" empty state. Fullscreen (no tab bar). |
| 4 | `/inventory` | PASS | | PASS | | | iPhone P (`iphone-p-analytics.png`): carts, steppers, Take consumables CTA. Minor polish: filter tab labels truncate ("ER Supply C…"). iPad P (2026-06-16). |
| 4 | `/inventory-items` | PASS | | PASS | | | iPad P (2026-06-16). **iPhone P PASS** (`iphone-p-admin.png`): category accordion (Emergency/Hospital/Internal Medicine), search, New item. |
| 4 | `/procurement` | PASS | | PASS | | | iPad P (2026-06-16). **iPhone P PASS** (`iphone-p-admin-shifts.png`): status filter chips, New order, "No purchase orders" empty state. |
| 4 | `/analytics` | PASS | | PASS | | | iPhone P (`iphone-p-settings-try.png`): stat cards, donut, English "Shift scan leaderboard" link. iPad P (2026-06-16). |
| 4 | `/analytics/shift-leaderboard` | | | PASS | | | iPad P (2026-06-16): ~~rendered entirely in Hebrew under EN locale~~ **FIXED** — added `shiftLeaderboard` namespace to `locales/{en,he}.json` + wired `t.shiftLeaderboard.*` in [shift-leaderboard.tsx](../../src/pages/shift-leaderboard.tsx). Verified on-device: full English copy, LTR table. Parity + no-Hebrew-in-source tests pass; tsc clean. |
| 4 | `/dashboard` | PASS | | PASS | PASS | | iPad P (2026-06-16). **iPhone P PASS** (`iphone-p-procurement.png`): 62 Available / 0 In use / 62 Issues cards, critical-alerts list, Refresh/Report. **iPad L PASS** (`ipad-l-settings-raw.png` — misnamed file; content is Dashboard). |
| 4 | `/whats-new` | PASS | | PASS | | | **iPhone P PASS** (`iphone-p-whats-new-banner.png`): v**1.0.1** · Build 12, clinical design / a11y / native iOS / sign-in / navigation cards. iPad P: same copy verified pre-locale on `ipad-p-whats-new-v1.1.2.png` (badge showed 1.1.2 before rebuild); re-spot after archive if needed. |
| 5 | `/admin` | PASS | | PASS | | | iPad P (2026-06-16). **iPhone P PASS** (`iphone-p-print.png`): Folders tab, RTL folder names, edit/delete, New. |
| 5 | `/admin/shifts` | | | PASS | | | iPad P (2026-06-16): Shift management — EZShift CSV import (Upload/Preview/Confirm/Clear) + import history. iPhone P not re-captured cleanly. |
| 5 | `/admin/asset-types` | | | n/r | | | Route **still mounted** (`routes.tsx` → `AdminAssetTypesPage`). In `nav-model.ts` admin children but **not** in Menu `managementMenuItems` — intentionally unlinked from drawer. |
| 5 | `/admin/docks` | | | n/r | | | Route **still mounted** (`routes.tsx` → `AdminDocksPage`). Not linked from standard nav. |
| 5 | `/admin/metrics` | | | n/r | | | Route **still mounted** (`routes.tsx` → `OperationalMetricsDashboardPage`). In `nav-model` only — not in Menu drawer. |
| 5 | `/settings` | PASS | | PASS | | | iPad P (2026-06-16). **iPhone P PASS** (`iphone-p-settings-gear.png`): Display (Clinical theme, haptics on, English), Sound section visible. |
| 5 | `/help` | | | PASS | | | iPad P (2026-06-16): Quick Guide — daily-tasks, status legend, asset-radar reference sections. iPhone P: menu scroll coords not stable in automation — spot-check on device. |
| 5 | `/audit-log` | | | PASS | | | iPad P (2026-06-16): filters (staff/action/date) + paginated entries w/ action badges (47 entries). iPhone P not re-captured cleanly. |
| 5 | `/print` | PASS | | PASS | | | iPad P (2026-06-16). **iPhone P PASS** (`iphone-p-audit-log-v3.png`): Print QR list, search, Select all, QR thumbnails. |
| 5 | `/shift-chat/<shiftId>` | | | | | | |

Also run `docs/mobile/nfc-ship-checklist.md` device rows before submission (NFC / deep links).

---

## Live simulator audit — findings log

**Method (2026-06-16).** Driven on the bundled production shell (`uk.vettrack.app`, build 12) via `idb` (tap/type) + `simctl` (screenshots), signed in with the demo admin account `reviewer@vettrack.uk`. Cell legend: `PASS` ok · `ISSUE` defect · `partial` entry reached, full view unconfirmed · `n/a` needs special state · `n/r` not reachable via standard nav.

**Coverage summary:**
- **Batch 1 — iPad (A16) portrait, iOS 26.4:** ~30 routes reached + visually audited (the bulk of the matrix). 2 real defects found → both FIXED + on-device verified.
- **Batch 2 — iPad landscape (partial):** `/home` landscape reflow verified (`land-tabsweep.png` — top tabs + left rail, multi-column cards).
- **Batch 3 — iPhone 17 Pro portrait (partial):** `/signin`, `/home`, `/equipment` verified (2026-06-16).
- **Batch 5 — iPhone 17 Pro portrait + landscape spot-pass (2026-06-16):** idb login + Menu drawer navigation. **15+ routes** screenshot-audited under `docs/mobile/qa-screenshots/iphone-p-*.png`. iPhone L: `/code-blue` landscape defect found. iPad L: `/home` re-confirmed; per-route landscape blocked when ⌘→ stopped changing idb frame (820×1180 stuck).
- **Batch 6 — Code Blue fix + landscape burn-down (2026-06-16):** Rebuilt bundled shell after `useDirection()` fix in `code-blue.tsx`. **iPad L:** `/home`, `/equipment`, `/alerts`, `/dashboard`, `/code-blue` captured raw (`ipad-l-*-raw.png`). **iPhone L:** shift chat, home, code-blue precheck (raw — horizontal labels). **Defect #4 withdrawn** — `sips --rotate -90` was rotating already-correct landscape PNGs, creating faux 90° label rotation; always review `*-raw.png` for iPhone landscape. **Portrait lock:** `public/manifest.json` `"orientation": "portrait"` — iPhone landscape cells are portrait-letterbox, not full reflow.
- **Batch 7 — iPhone portrait menu burn-down (2026-06-16):** After sim reboot to 402×874, calibrated menu taps captured iPhone P for alerts, inventory, analytics, dashboard, procurement, admin, inventory-items, equipment/tasks, settings (gear), whats-new (banner link), print. Filenames often mislabel route (e.g. `iphone-p-inventory.png` = Alerts) — always verify PNG content. **Do not use** batch-7 `iphone-p--*.png` or captures taken while idb frame was 874×402.
- **Still open (non-blocking for TestFlight archive):** iPhone P `/help`, `/audit-log`, `/crash-cart`, `/admin/shifts`, `/equipment?scan=1` (partial), `/signup`, iPad L per-route landscape beyond spot-checks, `/shift-chat/<shiftId>`, `/code-blue/display`, formal `/signin` Safari Audits import. **Advisory:** update banner still shows web version **v1.1.2** from `/api/version` while What's New page shows native **v1.0.1 · Build 12**.

**Defects found (iPad portrait) — both FIXED + on-device verified (2026-06-16):**
1. ✅ **FIXED — `/equipment` title wrapped to "Equi/pm/ent".** Heading broke across 3 lines because the action-button row squeezed the title column. Fix: `whitespace-nowrap` on the h1 + `flex-wrap` on the header so buttons drop to the next row ([equipment-list.tsx:425](../../src/pages/equipment-list.tsx#L425)). Rebuilt bundle → verified one-line title on device.
2. ~~`/equipment?scan=1` — debug text on scanner~~ **WITHDRAWN (simulator artifact).** The timer / frame-rate / preset-size text and color bars are the **iOS Simulator's fake-camera diagnostic overlay**, not app UI — the strings appear nowhere in `src/`. Will not appear on a real device. The scanner UI itself (target frame, "Enter code manually" fallback) renders correctly.
3. ✅ **FIXED — `/analytics/shift-leaderboard` not localized.** Rendered entirely in Hebrew under an English account. Fix: added a `shiftLeaderboard` namespace to both locale files (parity holds) and wired the page through the typed `t` ([shift-leaderboard.tsx](../../src/pages/shift-leaderboard.tsx)). Regenerated i18n types; `tsc`, parity, and `i18n-no-hebrew-in-source` all green. Verified full English + LTR table on device.

**Defects found (Batch 5 — 2026-06-16):**
4. ~~**ISSUE — `/code-blue` iPhone landscape.** Equipment-readiness checklist row labels render **rotated 90°**~~ **WITHDRAWN (batch 6).** Root cause: `sips --rotate -90` applied to `simctl` PNGs that were already in the correct viewing orientation. Raw capture `iphone-l-code-blue-fix-raw.png` shows horizontal checklist labels. App is portrait-locked (`manifest.json`). **Kept code fix:** `useDirection()` + `[writing-mode:horizontal-tb]` on checklist labels in `code-blue.tsx` (correct for EN locale; removes hardcoded RTL).
5. **Minor polish — `/inventory` iPhone portrait.** Supply-cart filter chips truncate ("ER Supply C…", "Hospital Sup…"). Functional but tight on 402pt width.

**Performance (DevTools network analysis — 2026-06-16):**
6. ✅ **FIXED — `jspdf` (688 kB) eagerly bundled.** `shift-summary-sheet.tsx` had a top-level `import { jsPDF } from "jspdf"`, pulling the library into the eager chunk. Converted to a lazy `await import("jspdf")` inside `handleDownloadPdf` (matches the existing pattern in [generate-report.ts:162](../../src/lib/generate-report.ts#L162)); failure path toasts `common.toast.unexpectedError` ([shift-summary-sheet.tsx:280](../../src/components/shift-summary-sheet.tsx#L280)). jsPDF now loads only on PDF download. The `en.json` / `i18n.ts` / `@vite/client` / 304 entries in the same trace are **dev-server (Vite) artifacts** — pre-bundled + cached in the production shell, no code change warranted. `tsc` green.
7. ✅ **FIXED — `html5-qrcode` eagerly bundled on `/home` (and 3 other routes).** `<QrScanner />` is mounted-but-closed by default (`{scannerOpen && …}`), yet `qr-scanner.tsx` statically imported the heavy `html5-qrcode` lib, dragging it into the eager chunk for `/home`, `/equipment`, `/management-dashboard`, and the layout shell. Made the top import type-only and deferred the runtime lib to `await import("html5-qrcode")` inside `startScanner` (loads only when the user actually opens the scanner; fallback drops to manual-entry phase on import failure) ([qr-scanner.tsx:5](../../src/components/qr-scanner.tsx#L5), [qr-scanner.tsx:317](../../src/components/qr-scanner.tsx#L317)). The trace's other items are **dev-mode (Vite) artifacts**: the 190-request waterfall and "scripts discovered after execution" are unbundled-ESM dev serving (rollup bundles + auto-injects `modulepreload` in the production shell); the home dashboard queries already fire **in parallel** (5 independent `useQuery` hooks gated on `!!userId`, no dependent waterfall) — no change warranted. `tsc` green.

8. ✅ **PASS (declined) — bottom-nav grid `gap` / `justify-items-center` suggestion.** DevTools flagged the bottom-nav grid ([layout.tsx:1360](../../src/components/layout.tsx#L1360)) as missing `gap` and `justify-items: center`. Evaluated and **declined** — applying either would regress: (a) each tab `<Link>` is already `flex flex-col items-center` with no width constraint, so it stretches to fill its `1fr` column and centers content; `justify-items-center` would collapse tabs to content width and **shrink the horizontal tap target** (≥44px bedside guidance) and break edge-to-edge fill; (b) `gap-x-2` would break the active-pill positioning math at [layout.tsx:1368](../../src/components/layout.tsx#L1368) (`calc(index * (100/n)% + (100/n/2)% - 12px)` assumes gapless equal columns — a column-gap shifts real column centers and the pill drifts off the active tab). Current gapless, full-bleed, child-centered layout is intentional. No code change.

9. ✅ **PASS (verified) — `/api/version` 184ms TTFB.** DevTools flagged the version check as doing per-request disk I/O / shell exec. **False for this handler:** `appVersion` is read from `package.json` once at module load ([index.ts:45](../../server/index.ts#L45)); `loadBuildInfo()` is already memoized via a module-level `cached` guard ([build-info.ts:18](../../server/lib/build-info.ts#L18)) so disk is touched at most once per process; `resolveBackendPilotMode()` is a constant. The recommended in-memory caching is already implemented. The 184ms is **dev-server overhead** (full Express stack + Vite dev middleware + cold module graph); production responds from memory. `connection: close` + `304` are dev-proxy artifacts. Note: `/api/version` intentionally stays behind CORS middleware (echoes `capacitor://localhost` ACAO — enforced by [security.test.ts:54](../../server/tests/security.test.ts#L54)), so it cannot be middleware-shortcut like `/api/health`. No code change.

10. ✅ **PASS (verified) — `/api/version` "missing security headers."** Captured on a **304** (content headers stripped). Source proves coverage: middleware order is helmet ([index.ts:110](../../server/index.ts#L110)) → CORS ([index.ts:161](../../server/index.ts#L161)) → handler ([index.ts:218](../../server/index.ts#L218)), so every 200 carries customized CSP + helmet defaults (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, HSTS — none disabled in the config). CORS callback echoes a specific allowlisted origin or `false`, **never `*`**, with the localhost-any bypass gated behind `!isProduction` ([index.ts:163](../../server/index.ts#L163)). HSTS absent on `localhost` (plain HTTP) is expected; prod behind Railway TLS gets it. No code change.
11. ✅ **PASS (verified — recommendation rejected as unsafe) — `/api/shift-chat/messages` "early ETag to skip DB."** The suggested "return 304 before the DB query" pattern would **break presence**: the GET intentionally calls `touchPresence(clinicId, userId, userName)` on every poll ([shift-chat.ts:54](../../server/routes/shift-chat.ts#L54)) as the online/typing heartbeat — short-circuiting the handler would silently drop users offline. The observed "304 after DB work" is Express's standard content-based weak ETag (app-wide, not an endpoint defect). Query is already scoped to the open shift's `shiftSessionId` + optional incremental `after`, with acks/reactions **batched via `inArray`** (no N+1) ([shift-chat.ts:67](../../server/routes/shift-chat.ts#L67)). 169ms = dev-stack overhead (auth → role lookup → i18n → tenant → limiter + sequential dev DB roundtrips); prod is fast. No code change.

12. ✅ **FIXED (WCAG 4.1.2 / 1.3.1) — shift-chat panel dialog had no accessible name or description.** Console showed Radix `DialogContent requires a DialogTitle` + `Missing Description or aria-describedby` from `ShiftChatPanel` (via `sheet.tsx`). The visible header span was promoted to `<SheetTitle>` (Radix `aria-labelledby`) and a visually-hidden `<SheetDescription className="sr-only">` added (`aria-describedby`) ([ShiftChatPanel.tsx:124](../../src/features/shift-chat/components/ShiftChatPanel.tsx#L124)). New `shiftChat.panel.description` key added to both locales (parity holds; types regenerated; `i18n-parity` + `i18n-no-hebrew-in-source` green). `SheetTitle` renders an `<h2>` but twMerge keeps the original `text-sm` size — no visual change. `tsc` green. **Side observation (not a defect):** the repeated `/api/shift-chat/messages` console lines are the intended 3s poll while the panel is open (`refetchInterval: isOpen ? 3000 : false`, no background/focus refetch — [useShiftChat.ts:24](../../src/features/shift-chat/hooks/useShiftChat.ts#L24)), not a render loop.
    - **Stale-bundle re-sighting (2026-06-16):** Same `DialogTitle` + `Description` warning later appeared from a minified production bundle (`index-CnTaxzRP.js` / `vendor-charts-a1iMZBlz.js`) — but those hashes predate the current `dist` (`vendor-charts-C8S_P4pL.js`, 07:21) and the source fix above. `vendor-charts` in the stack is unreliable minified attribution (react-dom is in `vendor-react`; Radix's title warning fires from a commit-phase `useEffect`). Verified **current source has zero titleless dialogs**: per-file + per-instance Content-vs-Title audits balanced, no conditional-title patterns, no direct `@radix-ui/react-dialog`/`vaul`/`cmdk` bypass. **Resolution: rebuild the bundled shell to clear it — no new code change.**

13. ✅ **PASS (verified) — `QUERY RUN:` console.log in `queryClient.ts`.** Already gated behind `import.meta.env.DEV` ([queryClient.ts:35](../../src/lib/queryClient.ts#L35)). The bundled shell builds with `pnpm exec vite build` ([build-native-shell.sh:53](../../scripts/build-native-shell.sh#L53)) — production mode sets `import.meta.env.DEV = false`, so the whole subscribe block is dead-code-eliminated and never ships. Visible only on the `localhost` dev server. Correct dev-only-diagnostic pattern; no code change.

14. ✅ **FIXED (WCAG 1.4.3) — notification count badges failed contrast.** White text on `bg-red-500` (`#ef4444`) = **3.76:1** (< 4.5:1 AA). Darkened to `bg-red-700` (`#b91c1c`) = **6.47:1** (verified) on the two white-on-red count badges: header alerts bell ([alerts-dropdown.tsx:57](../../src/components/alerts-dropdown.tsx#L57)) and shift-chat FAB ([ShiftChatFab.tsx:45](../../src/features/shift-chat/components/ShiftChatFab.tsx#L45)). (Initially red-600 = 4.83:1, already AA-pass; bumped to red-700 per follow-up audit requesting more headroom — comfortable margin + keeps both badges consistent.) Existing Tailwind token, matches the project's AA-darkening convention; `tsc` green. **Not changed:** (a) the `layout.tsx` menu badge uses `Badge variant="issue"` (CSS-var token, not `#ef4444`) — different color pair, not this finding; (b) the `text-[9px]` size was left as-is — WCAG has no minimum font-size rule (1.4.4 is about resize, which px text still honors via zoom), and 12px would overflow the 14–16px badge circle for "9+". **Haptics/audio findings = testing methodology** (require a physical Android device + system haptics; audio gated by autoplay policy) — no code defect asserted, no change.

15. ✅ **PASS (verified) + alt-text localization — axe `image-alt` (WCAG 1.1.1).** Audited every `<img>` in source: all have `alt` (decorative PWA icons → `alt=""`; photos → descriptive/localized). The one `role="img"` ([landing.tsx:471](../../src/pages/landing.tsx#L471)) has `aria-label` with inner stars `aria-hidden`; no `<input type="image">`; no `<img>` in `index.html`. **No missing-alt violation in current source** — the axe flag is a stale bundle or a Clerk-rendered `/signin` image (Clerk owns those). **In-domain fix applied:** two hardcoded English `alt="Issue photo"` ([equipment-detail.tsx:1695](../../src/pages/equipment-detail.tsx#L1695), [:1787](../../src/pages/equipment-detail.tsx#L1787)) passed axe but gave Hebrew screen-reader users English alt — localized both to `t.equipmentDetail.issuePhoto` (key already existed in both locales; matches [EquipmentDetailActivityTab.tsx:102](../../src/components/equipment/EquipmentDetailActivityTab.tsx#L102)). `tsc` green.

16. ⚠️ **CHARACTERIZED (no code change) — Lighthouse `/home` perf (FCP 5.3s / LCP 9.9s, prod web).** Measured on `vettrack.uk/home`, mobile-throttled. Caveats that make this non-representative of the native ship: (a) it's the **web app over throttled 4G**, not the bundled shell (which serves assets from local disk via `capacitor://localhost` — no asset-network latency); (b) Lighthouse's own `runWarnings` flagged **IndexedDB stored data** — not an incognito/clean run (app uses Dexie heavily); (c) mobile 4× CPU + slow-4G emulation; (d) **predates + excludes** the shipped jspdf + html5-qrcode code-splits (undeployed); (e) `/home` is an auth-gated dashboard so LCP is render-delay-dominated (AuthGuard → auth bootstrap → 5 parallel dashboard queries before the largest card paints). Verified the home critical path has **no eager heavy-lib imports** (recharts/framer-motion/xlsx/date-fns/Sentry are all route-lazy; jspdf+html5-qrcode already split). **Next step:** deploy shipped fixes → re-measure in incognito → if still high, pull `largest-contentful-paint-element` to target precisely. Native launch→first-paint is covered by the simulator smoke test (boots to `/signin`).

17. ✅ **PASS (verified) — Lighthouse `/` landing perf (FCP 5.0s / LCP 7.2s, prod web).** Same class as #16 (web app, mobile-throttled, IndexedDB-confounded per `runWarnings`, predates undeployed fixes). Additionally: (a) **`/` is not in the native app path** — bundled shell boots to `/signin`, guests never load the marketing `/` in-app, so this is web-only SEO/first-impression, not a native-ship blocker; (b) landing already does the right things — hero LCP element is **text `<h1>`** ([landing.tsx:141](../../src/pages/landing.tsx#L141)) with fonts on `display=swap` + Google-Fonts preconnect ([index.html:245](../../index.html#L245)); only image (video poster) is already `loading="lazy"` below the fold — nothing to preload/optimize; (c) **metrics internally inconsistent** — `final-screenshot` at 2152ms + filmstrip painted by ~1.5–2.6s vs FCP reported 5.0s → unreliable lab run. No code change.

**Remote prod audit (`curl` vs `vettrack.uk`, 2026-06-16):** CORS (capacitor/vettrack allow, evil.com block), AASA (both paths, JSON content-type, appID `87F5G378M6.uk.vettrack.app`), helmet headers on `/api/*`, HSTS, VAPID, push-auth-gating, health, `pilotMode.mismatch:false` — all **PASS** live.

18. ✅ **FIXED (low sev, F-1) — `x-powered-by: Express` leaked on `/api/health`.** `/api/health` is registered ([index.ts:57](../../server/index.ts#L57)) **before** the helmet chain ([index.ts:110](../../server/index.ts#L110)), so helmet's `hidePoweredBy` never fired for it and the header leaked. `app.disable("x-powered-by")` was not set. Added it as an **app-level** setting right after `app = express()` ([index.ts:49](../../server/index.ts#L49)) so the header is suppressed globally regardless of route order. `tsc` green. Not a TestFlight blocker (Apple doesn't probe `/api/health`); fix ships on next prod deploy. **Advisories (no code change):** A-1 version mismatch (API `1.1.2` vs native `1.0.1·Build 12`) = same as #16, resolves once backend is tagged to the shipped native build; A-2 `gitCommit:null` — version endpoint already reads `RAILWAY_GIT_COMMIT_SHA`/`GITHUB_SHA` ([index.ts:69](../../server/index.ts#L69)), so this is a **CI env** gap (pass the SHA at build), not a code defect; A-3 AASA scope `/equipment/*` only = intentional (Capacitor uses `capacitor://localhost` for in-app nav; Universal Links only needed for external QR/NFC deep links).

**Unreachable / special routes (confirmed 2026-06-16):**
- `/handoff`, `/admin/asset-types`, `/admin/docks`, `/admin/metrics` — **routes still mounted** in `src/app/routes.tsx`; **not linked** from Menu drawer (n/r via standard nav).
- `/code-blue/display` — **n/a** without an active session (not started on prod).
- `/shift-chat/<shiftId>` — **n/a** this session (FAB panel verified; archive route needs real `shiftId`).
- `capacitor://localhost/...` and `https://vettrack.uk/...` (non-equipment) — `simctl openurl` does not navigate the bundled shell; use in-app nav only.

**WCAG 2.2 AA manual audit (partial — 2026-06-16):**

| Area | Result | Notes |
|------|--------|-------|
| Sign-in Clerk LTR wrapper | not re-run | Prior fix for email autocapitalize; run Safari Audits import (`vettrack-native-ship-audit.json`) on `/signin` before submit. |
| Tap targets (bottom nav, FAB, primary CTAs) | PASS (spot) | Scan FAB, shift-chat send, Code Blue Open CTA appear ≥44pt on iPhone + iPad screenshots. |
| Colour contrast (dashboard, equipment, Code Blue) | PASS (spot) | White on navy/green/red pairs read clearly; grey timestamps ("23 days ago") are decorative secondary — verify with Audits if strict. |
| Code Blue landscape label orientation | PASS (withdrawn FAIL) | Raw PNG review; portrait-lock expected. See defect #4 withdrawal. |
| Inventory chip truncation | **Advisory** | See defect #5 — not WCAG per se but affects readable name. |
| Shift chat composer + keyboard | PASS (iPhone P) | Composer not clipped in `iphone-p-shift-chat.png`. |

**Simulator tooling notes (Batch 5 + 6):**
- Portrait bottom-tab coords (iPad 820×1180): Today ≈(164,1145), Equipment ≈(246,1145), Scan ≈(410,1145), Emergency ≈(574,1145), Menu ≈(656,1145). iPhone 402×874: Today ≈(80,835), Equipment ≈(121,835), Scan ≈(201,835), Emergency ≈(281,835), Menu ≈(361,835).
- **Landscape screenshots:** Review `simctl` **raw** PNGs first. Only apply `sips --rotate -90` when the capture is clearly portrait-oriented (status bar on long edge). Batch 5 falsely rotated already-landscape iPhone captures, creating a phantom Code Blue label bug.
- `idb ui tap` does not hit landscape top-tab bar reliably; use **portrait navigate → rotate → screenshot** when ⌘→ works. If idb frame is 874×402, rotate back to portrait (⌘←) before menu-drawer taps.
- App **portrait-locked** via `public/manifest.json` — iPhone landscape matrix cells document letterboxed portrait UI, not full responsive reflow.

**Batch 2 — iPad landscape (partial, 2026-06-16):** rotation unblocked after granting Accessibility to Cursor (⌘→ via System Events). **Responsive landscape layout verified on `/home`:** the bottom tab bar is replaced by a persistent **top tab bar** (Today · Equipment · Command Board · Alerts · Rooms · Emergency · Admin) plus a **left icon rail**; multi-column content reflows cleanly, no clipping/overlap. Per-route landscape navigation was not completed automatically: `simctl` captures in the sensor's portrait orientation (content rotated 90°) and `idb ui tap` appears to address the native-portrait coordinate space rather than the rotated UI, so tab taps require a per-tab coordinate transform that wasn't worth calibrating for low marginal signal. The two fixes (equipment title, leaderboard i18n) live in orientation-agnostic shared components / locale already verified in portrait, so they hold in landscape. **Recommend a human landscape spot-pass** (rotate ⌘→, walk the top tabs) to formally fill the iPad-L / iPhone-L columns.

**Note:** a stray nav tap toggled one Daily Crash Cart checklist item on the demo clinic during setup — harmless demo data.

## Sign-off

| Role | Name | Date | Build (`CURRENT_PROJECT_VERSION`) |
|------|------|------|-----------------------------------|
| QA / release | Cursor release QA (simulator matrix + screenshots) | 2026-06-16 | 12 |
| Engineering | Dan Erez | | 12 |

**Gate status (2026-06-16):**
- `./scripts/verify-resubmission.sh` — **16/16 PASS**
- Demo login — `LOGIN: complete`
- Bundled shell build 12, `MARKETING_VERSION` **1.0.1**, What's New locale **1.0.1 · Build 12**
- Route matrix — **iPad P complete**; **iPhone P tier 1–4 largely PASS** (screenshot-audited); landscape columns spot-checked (portrait-letterbox on iPhone); 5 iPhone P menu routes + signup remain for human spot-check
- NFC device matrix (`nfc-ship-checklist.md`) — **not run** on physical TestFlight hardware this session

**Release blocked if:** any matrix cell FAIL; resubmission script FAIL; demo login not `complete`; shift chat tier not green.
