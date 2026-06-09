# VetTrack — Phase A Audit
**Date:** 2026-06-09  
**Branch:** transformation/vnext (at main HEAD — no divergence yet)  
**Auditor:** Claude Code (claude-sonnet-4-6)  
**HQ pages read:** VetTrack HQ root, Architecture, Runtime & Operations, Planning & Governance (Technical Debt, System Risk Registry)  
**Input documents:** VetTrack_CLI_Master_Prompt.txt, VetTrack_Figma_AI_Master_Prompt.txt, VetTrack_Refactor_Roadmap_2.md  

---

## Pre-Audit Status Note

Phase 1 of the Refactor Roadmap (T1.1–T1.5, "Consistency layer") was executed on branch `refactor/phase-1-consistency` and merged to main (commit `753d67d8`). The audit therefore reflects the **post-Phase-1** state. Files changed in Phase 1: `locales/en.json`, `locales/he.json`, `AlertsProView.tsx`, `OperationalMetricsDashboard.tsx`, `Topbar.tsx`, `skeleton.tsx`, `status-badge.tsx` (new), `src/index.css`, `design-tokens.ts`, `tailwind.config.ts`.

**Phase 1 completion status found during audit:**
- T1.1 (radius/shadow tokens): ✅ Complete
- T1.2 (Topbar detox): ✅ Mostly complete — one regression: `bg-ivory-green` remains in `UserAvatar` (`Topbar.tsx:102`)
- T1.3 (StatusBadge): ✅ Complete — but `status-badge.tsx` uses `t` from `@/lib/i18n` (not `useTranslation`) which is the actual repo i18n API; spec mismatch is harmless
- T1.4 (arbitrary radii/sizes): ⚠️ **Incomplete** — `min-h-[Npx]` variants not caught by the T1.4 grep pattern; `h-[88px]/w-[88px]` in `first-scan-celebration.tsx`; `rounded-[7px]` in AlertCard.tsx and StatCard.tsx; `rounded-[6px]` and `w-[30px]/h-[30px]` in IconSidebar.tsx
- T1.5 (bare buttons): ⚠️ **Incomplete** — 3 bare `<button>` remain in the T1.5 scope: `EquipmentRoomSweepSheet.tsx:73`, `EquipmentConfirmInRoomSheet.tsx:76`, `AlertsProView.tsx:127`

---

## 1. Executive Summary

VetTrack is a mature, multi-clinic veterinary hospital operations platform. The frontend codebase has undergone significant architectural investment (realtime SSE, clinical invariant enforcement, offline-first PWA) but carries design-system debt that makes theme switching unreliable and creates accessibility risks on clinical surfaces.

**Critical issues (3):**
1. Hebrew text hardcoded directly in `phone-sign-in.tsx` — violates the bilingual parity invariant and the no-Hebrew-in-source test
2. Two competing layout shells (`src/components/layout.tsx` and `src/components/layout/PageShell.tsx`) — causes divergent navigation state and double chrome on several pages
3. `node_modules` absent — TypeScript and lint checks cannot run; build cannot be verified locally

**High issues (6):**
1. Phase 1 incomplete: T1.4 and T1.5 not fully done
2. Extensive default Tailwind palette usage (`bg-amber-*`, `bg-red-*`, `bg-blue-*`, `bg-green-*`) across equipment, alert, badge, and management surfaces
3. RTL logical property violations (`pl-/pr-/left-/right-`) in layout.tsx and several pages
4. Raw hex values remaining in `AlertCard.tsx`, `StatCard.tsx`, `IconSidebar.tsx`
5. nav-model.ts does not exist — T2.1 not started; Topbar still has a local `SECTIONS` array with hardcoded English labels
6. Interactive targets below 44px on multiple clinical surfaces

**Medium issues (5):**
1. Arbitrary `text-[Npx]` in shift-chat, qr-scanner, and several components
2. Bare `<button>` elements beyond the T1.5 scope (pages/equipment-detail, pages/inventory-page, etc.)
3. Color-only status indicators remain in `DeployabilityBadge.tsx` and `badge.tsx`
4. `pdf-parse@1.1.4` unmaintained since 2021
5. Locale path discrepancy between master prompt (`src/lib/locales/`) and actual paths (`locales/` at root)

**Low issues (2):**
1. `bg-ivory-green` in `Topbar.tsx:102` UserAvatar — T1.2 regression
2. `src/components/layout/Topbar.tsx:59` — `rounded-[4px]` on nav items (same as the StatusBadge allowlist, but not listed as allowlisted for Topbar)

---

## 2. Product Understanding

VetTrack is a multi-tenant veterinary hospital platform serving:
- **Primary users:** Technicians and vets performing clinical tasks on mobile (iOS/Android) during active shifts
- **Secondary users:** Admins managing equipment, rooms, billing, and integrations
- **Display users:** Ward display screens (TV/large monitors) showing real-time patient/equipment state

**Critical UX context:**
- Hebrew RTL is the default locale — every layout decision has bidirectional implications
- Clinical safety is load-bearing: Code Blue sessions, medication dispense, and crash cart checks have zero tolerance for misleading UI state
- Offline-first: technicians in dead-zone hospital areas must see last-known state and queue mutations
- PWA: installed on iOS home screens; Safari rendering quirks apply

**Architecture notes relevant to Phase C:**
- Frozen surfaces (realtime SSE, Code Blue, sync-engine, event-publisher) must not be touched
- `vt_appointments` / `/api/appointments` must not be renamed
- Tier 0 modules: `server/lib/event-publisher.ts`, `src/lib/request-core.ts`, `src/lib/sync-engine.ts`, `server/app/start-schedulers.ts`

---

## 3. Information Architecture Audit

### 3.1 Route count and sprawl

**Problem:** 41 routes in `src/app/routes.tsx` with ~18 legacy redirects. Nav destinations (Home, Equipment, Alerts, Rooms, Admin) are interspersed with platform-only routes (analytics, procurement, shift-leaderboard, stability) and deprecated aliases.  
**Evidence:** `src/app/routes.tsx:141–226` — 41 `<Route>` elements  
**User Impact:** No clear primary navigation hierarchy. Routes like `/meds`, `/patients`, `/billing`, `/er` resolve to `/equipment` silently — confusing if staff type URLs or follow old bookmarks.  
**Recommendation:** Execute T2.3 — collapse to 6 primaries with nested children; keep aliases.  
**Expected Result:** Clear 6-destination IA; legacy URLs still resolve. [MEDIUM]

### 3.2 Duplicate nav destinations

**Problem:** `SECTIONS` in `Topbar.tsx` (line 16–22) defines 5 nav items using hardcoded English labels. `src/components/layout.tsx` (the legacy shell) defines its own independent nav. `src/components/layout/IconSidebar.tsx` has a third nav data source. Three sources of truth for the same navigation.  
**Evidence:** `src/components/layout/Topbar.tsx:16–22`, `src/components/layout.tsx:600+`, `src/components/layout/IconSidebar.tsx:28–50`  
**User Impact:** Nav items can fall out of sync. Admin-only items could appear/disappear inconsistently across the two shells.  
**Recommendation:** Execute T2.1 (create nav-model.ts) and T2.2 (wire all nav to NAV model).  
**Expected Result:** One nav data source consumed by all chrome. [HIGH]

### 3.3 Canonical route conflicts

**Problem:** `/appointments` and `/display` are the production-used routes but Phase C targets `/equipment/tasks` and `/equipment/board` as canonical. The redirect layer exists (T2.3 creates it) but the canonical mounts do not yet exist.  
**Evidence:** `src/app/routes.tsx:180–181` shows `/appointments` and `/display` as direct renders, not aliases  
**User Impact:** Current state is fine; this is a pre-Phase-2 pre-flight requirement.  
**Recommendation:** T2.3 creates canonical mounts first, then converts originals to redirects.  
**Expected Result:** /equipment/tasks and /equipment/board become canonical. [LOW — tracked for Phase C]

---

## 4. Navigation Audit

### 4.1 Hardcoded English labels in nav

**Problem:** `Topbar.tsx` `SECTIONS` array contains English labels (`"Home"`, `"Equipment"`, `"Equipment Tasks"`, `"Equipment Command Board"`, `"Admin"`) hardcoded directly. Not resolved through the i18n `t` accessor.  
**Evidence:** `src/components/layout/Topbar.tsx:17–22`  
**User Impact:** Nav items always display in English regardless of active locale. Hebrew users see English nav on every page.  
**Recommendation:** T2.1 + T2.2 — replace SECTIONS with NAV model; render labels via `t(n.labelKey)`.  
**Expected Result:** Nav labels honor active locale. [HIGH]

### 4.2 pilotHidden flag not applied

**Problem:** `SECTIONS` has `pilotHidden: true` on `"Equipment Tasks"` but `visibleSections` filter only checks `adminOnly`, ignoring `pilotHidden`:
```ts
const visibleSections = SECTIONS.filter((s) => ( !s.adminOnly || isAdmin));
```
**Evidence:** `src/components/layout/Topbar.tsx:29–31`  
**User Impact:** "Equipment Tasks" appears in nav for all users, regardless of pilot status.  
**Recommendation:** Add `!s.pilotHidden` to the filter, or remove the flag entirely if pilot is over.  
**Expected Result:** Pilot-hidden items hidden as intended. [MEDIUM]

### 4.3 Active-state logic duplicated

**Problem:** `resolveNavItemActive` is already extracted to `src/lib/routes/resolve-nav-active.ts`, but `src/components/layout.tsx` (legacy shell) contains its own inline active-state logic for its nav items.  
**Evidence:** `src/lib/routes/resolve-nav-active.ts` exists; `src/components/layout.tsx:895–960` uses independent active checks  
**User Impact:** Active highlighting can disagree between the two shells.  
**Recommendation:** T2.4/T2.5 — merge shells; single resolver.  
**Expected Result:** One active-state resolver used everywhere. [MEDIUM]

---

## 5. Design System Audit

### 5.1 Raw hex values in components

**Problem:** Raw hex colors bypass the token system, breaking theme switching.

**Evidence:**
- `src/components/alerts/AlertCard.tsx:14–16` — `#fff1f1`, `#b91c1c`, `#fca5a5`, `#fffbeb`, `#b45309`, `#fcd34d`, `#f0fdf4`, `#15803d`, `#a7f3bd`
- `src/components/stats/StatCard.tsx:31–33` — `#dcfce7`, `#166534`, `#fee2e2`, `#991b1b`, `#f0ede6`
- `src/components/layout/IconSidebar.tsx:31,46,51` — `#f0ede6`, `#aab8ac`, `#f0ede6`
- `src/components/alerts-dropdown.tsx:40` — `#8ab89a`
- `src/components/layout/Topbar.tsx:102` — `bg-ivory-green` (semantic class, not a CSS var; T1.2 regression)
- `src/components/layout.tsx` — multiple: `#0a1509`, `#4cde6a`, `#8ab89a` (legacy shell)

**User Impact:** Theme switching (forest/clinical/dark) produces stuck colors on alert cards, stat cards, sidebar icons.  
**Recommendation:** Replace with nearest semantic token. `AlertCard` → `--status-issue-bg/fg/border` and `--status-maintenance-*`; `StatCard` → `--status-ok-bg`, `--status-issue-bg`; `IconSidebar` → `--ivory-bg`, `--ivory-text-3`, `--ivory-err`.  
**Expected Result:** Theme switch produces no stuck literals. [HIGH] — MANDATORY

### 5.2 Default Tailwind palette colors (bg-{color}-{n})

**Problem:** Extensive use of Tailwind's default palette bypasses the semantic token layer.

**Evidence (non-exhaustive):**
- `src/components/alerts/AlertCard.tsx` — all card variants use raw `bg-red-100`, `text-red-800`, etc.
- `src/components/equipment/DeployabilityBadge.tsx:30–42` — `bg-blue-100`, `bg-red-100`, `bg-purple-100`, `bg-amber-100` for deployability states
- `src/components/equipment/EquipmentDetailStatusStrip.tsx:31–35` — `text-red-600`, `bg-red-100`, `text-amber-600`, `bg-amber-100`, `text-blue-600`, `bg-blue-100`
- `src/components/equipment/EquipmentTruthCard.tsx:129,153` — `border-blue-200/80`, `bg-blue-50/80`, `bg-amber-50`, `border-amber-200/80`
- `src/components/equipment/EquipmentHeroCoverageStrip.tsx:38` — `border-amber-200/80`, `bg-amber-50/90`
- `src/components/ui/badge.tsx:15–16` — `border-red-200`, `bg-red-100`, `text-red-800`, `border-amber-200`, `bg-amber-100`, `text-amber-800`
- `src/components/sync-queue-sheet.tsx:139–221` — amber/orange/red throughout
- `src/components/shift-summary-sheet.tsx:397–436` — amber, red throughout
- `src/pages/management-dashboard.tsx:171–179` — emerald/amber/red
- `src/pages/inventory-page.tsx:963` — `bg-emerald-600 hover:bg-emerald-700`
- `src/features/shift-chat/components/ShiftChatPanel.tsx:112` — `text-amber-300`
- `src/features/shift-chat/components/BroadcastCard.tsx` — indigo/green throughout

**User Impact:** Clinical status colors (issue, maintenance, ok) render from hardcoded palette instead of the semantic token ramp. Dark mode and theme switching produce incorrect or inaccessible contrast.  
**Recommendation:** Map each usage to the nearest `--status-*` or `--brand-*` token. For status-bearing surfaces, use `<StatusBadge kind={…}>`. For chat/informational surfaces, use `--status-info` or `--ivory-text-*`.  
**Expected Result:** No `bg-{color}-{n}` in feature code. [HIGH] — MANDATORY

### 5.3 Arbitrary text sizes (text-[Npx])

**Problem:** Arbitrary font sizes escape the Tailwind type scale.

**Evidence:**
- `src/features/shift-chat/components/ShiftChatPanel.tsx:102,112,123,136,183,201,209,212` — `text-[11px]`, `text-[10px]`
- `src/features/shift-chat/components/BroadcastCard.tsx:24,29,33,44,52,69,75,83` — `text-[11px]`, `text-[15px]`, `text-[12px]`, `text-[10px]`, `text-[13px]`
- `src/features/shift-chat/components/MessageBubble.tsx:30,41,54` — `text-[9px]`, `text-[10px]`
- `src/components/qr-scanner.tsx:562,732,792` — `text-[11px]`
- `src/components/alerts-dropdown.tsx:57,83,113` — `text-[9px]`, `text-[11px]`
- `src/components/pwa-install-prompt.tsx:112,122` — `text-[10px]`
- Many others in pages and features

**User Impact:** Custom sizes accumulate visual inconsistency; sizes below `text-xs` (12px) may fail WCAG AA at standard viewport zoom.  
**Recommendation:** Map via the conversion table: `text-[9–10px]` → `text-[0.625rem]` or `text-xs`; `text-[11px]` → `text-xs`; `text-[12–13px]` → `text-sm`; `text-[15px]` → `text-base`. Where text-xs is too large for a badge/dot context, accept and document.  
**Expected Result:** No `text-[Npx]` in src/. [MEDIUM]

### 5.4 Arbitrary radii and dimensions (incomplete T1.4)

**Problem:** T1.4 used `rounded-\[[0-9]+px\]|h-\[[0-9]+px\]|w-\[[0-9]+px\]` which does not match `min-h-[Npx]` or `max-w-[Npx]`. Many non-standard radii and dimensions remain.

**Evidence (confirmed remaining):**
- `src/components/alerts/AlertCard.tsx:23` — `rounded-[7px]` (should be `rounded-sm`)
- `src/components/stats/StatCard.tsx:47,68` — `rounded-[7px]`, `rounded-[4px]` (unlisted exception)
- `src/components/layout/IconSidebar.tsx:43,63` — `rounded-[6px]`, `w-[30px] h-[30px]`, `w-[22px]`
- `src/components/layout/Topbar.tsx:59` — `rounded-[4px]` (inherits StatusBadge allowlist? Not listed)
- `src/components/first-scan-celebration.tsx:31,34` — `h-[88px] w-[88px]` (decorative — acceptable, but document)
- `src/components/home/ShiftProgressHero.tsx:82,88` — `rounded-[18px]`, `h-[92px] w-[92px]`
- `src/pages/home.tsx:236,238` — `rounded-[20px]`, `w-[3px]`
- Many `min-h-[Npx]` in DispenseSheet, move-room-sheet, layout.tsx, equipment-list.tsx, etc.

**User Impact:** Visual inconsistency across surfaces; shape mismatch between skeleton and loaded content.  
**Recommendation:** Extend T1.4 fix to cover `min-h-[Npx]`, `rounded-[7px]`/`[18px]`/`[20px]`. Map `h-[88px]` → `h-22`; `rounded-[18–20px]` → `rounded-2xl`; `rounded-[6–7px]` → `rounded-sm`.  
**Expected Result:** Zero arbitrary px dimensions outside documented allowlist. [MEDIUM]

### 5.5 Token vocabulary path discrepancy

**Problem:** The master prompt and Refactor Roadmap reference `src/lib/locales/he.json` / `src/lib/locales/en.json`, but the actual locale files are at `locales/he.json` / `locales/en.json` (repository root). The parity check scripts in the master prompt will fail with `MODULE_NOT_FOUND`.  
**Evidence:** `find . -name "*.json" | grep -i locale` → `./locales/en.json`, `./locales/he.json`  
**User Impact:** Verification commands in master prompt and roadmap will error. Locale parity check appears to fail on first run.  
**Recommendation:** Update the verification commands in any future automation to use `./locales/` not `./src/lib/locales/`.  
**Expected Result:** Parity check runs without path errors. [LOW]

---

## 6. Component Consistency Audit

### 6.1 Duplicate status/badge patterns

**Problem:** Three overlapping badge/status implementations:
1. `src/components/ui/badge.tsx` — still has `issue` and `maintenance` variants using raw Tailwind palette (`bg-red-100`, `bg-amber-100`)
2. `src/components/ui/status-badge.tsx` (new from T1.3) — correct semantic tokens
3. `src/components/equipment/DeployabilityBadge.tsx` — standalone component using raw Tailwind palette

All three render status information in different visual styles.  
**Evidence:** `src/components/ui/badge.tsx:15–16`; `src/components/equipment/DeployabilityBadge.tsx:30–42`  
**User Impact:** Same status value (e.g., "issue") renders with different colors on different screens.  
**Recommendation:** Phase 3 (T3.1): migrate `DeployabilityBadge` to use `<StatusBadge>`; update `badge.tsx` `issue`/`maintenance` variants to consume `--status-*` tokens.  
**Expected Result:** One visual style for each status kind. [MEDIUM]

### 6.2 Bare `<button>` elements (T1.5 incomplete + broader scope)

**Problem:** T1.5 targeted `src/components/equipment/` and `src/components/alerts/` but 3 bare buttons remain in that scope. Beyond T1.5 scope, dozens more bare buttons exist in pages and other components.

**Evidence in T1.5 scope (MANDATORY):**
- `src/components/equipment/EquipmentRoomSweepSheet.tsx:73`
- `src/components/equipment/EquipmentConfirmInRoomSheet.tsx:76`
- `src/components/alerts/AlertsProView.tsx:127`

**Evidence beyond T1.5 scope (Phase C cleanup):**
- `src/pages/equipment-detail.tsx:1229,1240,1576,1655,1747`
- `src/pages/inventory-page.tsx:689,887,1011`
- `src/pages/home.tsx:186,308`
- `src/pages/rooms-list.tsx:326,398`
- `src/components/move-room-sheet.tsx:70,94`
- `src/components/layout.tsx:671,1039,1120,1236,1303`
- Many others

**User Impact:** Bare buttons lack the `disabled:opacity-50`, `focus-visible:ring`, `aria-busy`, and `motion-safe:active:scale-[0.97]` contracts that `<Button>` provides. Clinical actions (dispense, confirm, acknowledge) may not communicate loading state.  
**Recommendation:** Complete T1.5 for the 3 remaining in-scope buttons (MANDATORY). Track broader scope for T4.1 pass.  
**Expected Result:** All interactive controls in equipment/alerts use `<Button>`. [HIGH] — MANDATORY (T1.5 scope)

### 6.3 Duplicate card patterns

**Problem:** At least three card frame implementations:
1. `src/components/ui/card.tsx` (reference, `rounded-2xl shadow-card`)
2. Custom card frames in home.tsx using `rounded-[20px]`, `rounded-2xl`
3. `AlertCard.tsx` using its own frame with `rounded-[7px]`

**Evidence:** `src/pages/home.tsx:236`; `src/components/alerts/AlertCard.tsx:23`  
**User Impact:** Visual inconsistency; some cards have different corner radii on the same screen.  
**Recommendation:** Home and AlertCard should use `<Card>` or document why they cannot.  
**Expected Result:** One card frame shape. [LOW]

---

## 7. Accessibility Audit

### 7.1 Hebrew hardcoded in source (CRITICAL)

**Problem:** `src/components/phone-sign-in.tsx` contains extensive Hebrew strings hardcoded directly in JSX, violating the no-Hebrew-in-source invariant and the i18n bilingual parity rule.

**Evidence:** `src/components/phone-sign-in.tsx:32,46,66,73,86,88–89,95,102,111,122,124,133,142,144,148,156,176,183` — ~20+ Hebrew strings including `"התחברות עם טלפון"`, `"הזן מספר טלפון"`, error messages, labels, and button text.  
**User Impact:** These strings cannot be translated to English. English users see Hebrew-only UI. Violates the test enforced by `tests/i18n-no-hebrew-in-source.test.ts` — this test should currently be failing.  
**Recommendation:** Move all Hebrew strings to `locales/he.json` under an appropriate namespace (`phoneSignIn.*`), add English equivalents to `locales/en.json`, replace with `t.phoneSignIn.*` accessors.  
**Expected Result:** `tests/i18n-no-hebrew-in-source.test.ts` passes. [CRITICAL] — MANDATORY

### 7.2 RTL logical property violations

**Problem:** Numerous `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-` properties violate the logical-properties-only rule. These are physical properties that flip incorrectly in RTL.

**Evidence:**
- `src/components/report-issue-dialog.tsx:132` — `mr-2`
- `src/components/crash-cart-admin-sheet.tsx:175` — `ml-1`
- `src/components/sync-status-banner.tsx:27,56` — `left-0 right-0`, `ml-1`
- `src/components/shift-summary-sheet.tsx:315,363,388,419` — `ml-auto` (×4)
- `src/components/sync-queue-sheet.tsx:239,243` — `pl-5` (×2)
- `src/components/layout.tsx:704,751,898,899,904,952,953,958` — `right-0.5`, `right-2`, `right-0`, `pl-4`, `pr-3`, `left-0`
- `src/components/layout/Topbar.tsx:59` — `rounded-[4px]` (not RTL, but noted)
- `src/pages/equipment-detail.tsx:1648,1740` — `right-1`
- `src/features/shift-chat/components/ShiftChatFab.tsx:36` — `-right-1`

**User Impact:** In RTL (Hebrew) mode, alert banners, sync status, shift summary badges, and nav active indicators appear on the wrong side. Particularly visible in the sidebar active-state pill (`left-0` active bar).  
**Recommendation:** Replace physical with logical: `ml-*` → `ms-*`; `mr-*` → `me-*`; `pl-*` → `ps-*`; `pr-*` → `pe-*`; `left-0` → `start-0`; `right-0` → `end-0`. For full-bleed overlays (`left-0 right-0`) → `inset-x-0`.  
**Expected Result:** No `ml-/mr-/pl-/pr-/left-/right-` in feature components. [HIGH] — MANDATORY

### 7.3 Interactive targets below 44px

**Problem:** Several interactive elements are 28px (h-7) tall, below the 44px minimum.

**Evidence:**
- `src/components/cop-discrepancy-banner.tsx:61` — `h-7 shrink-0` on a button
- `src/components/crash-cart-admin-sheet.tsx:155,161` — `<Button size="sm" className="h-7 px-2">` (h-7 overrides the sm default of h-9)
- `src/components/sync-status-banner.tsx:51` — `h-7 shrink-0 px-2` on a button
- `src/components/alerts/AlertsProView.tsx:154` — `h-7 w-7` on the un-ack button

**User Impact:** Glove-wearing clinical staff and users with motor impairments cannot reliably tap these controls on mobile. The un-ack button on the alerts screen is a safety-adjacent action.  
**Recommendation:** Replace `h-7` on interactive elements with `h-11` (44px) minimum. Use `size="icon-sm"` (h-9) as the smallest acceptable icon button per `button.tsx`.  
**Expected Result:** All interactive targets ≥ 44px. [HIGH] — MANDATORY

### 7.4 Color-only status indicators

**Problem:** `DeployabilityBadge.tsx` communicates deployability state entirely via background color with no accompanying text label accessible to screen readers. The tone color bar in `AlertsProView.tsx` (3px bar) was retained as spec'd, but the StatusBadge added in T1.3 provides the text label — this is correct. However, `DeployabilityBadge` and `badge.tsx` `issue`/`maintenance` variants still have no visual dot+label pair that works without color.

**Evidence:** `src/components/equipment/DeployabilityBadge.tsx` — renders a colored pill with text only in some states; no `role` or `aria-label` encoding the semantic status value for AT.  
**User Impact:** Color-blind users and screen reader users cannot determine deployability state.  
**Recommendation:** Either adopt `<StatusBadge>` for all deployability states, or add `aria-label={t("deployability.{state}")}` to the badge element.  
**Expected Result:** Status readable without relying on color. [HIGH] — MANDATORY

### 7.5 Missing `aria-hidden` on decorative icons (partial)

**Problem:** Some icon usages in `qr-scanner.tsx` and layout files lack `aria-hidden="true"` on decorative SVGs.

**Evidence:** `src/components/qr-scanner.tsx:783–786` — QR corner-bracket SVGs without `aria-hidden`. `src/features/shift-chat/components/ShiftChatFab.tsx:36` — badge dot without aria-hidden.  
**User Impact:** Screen readers may announce decorative icons redundantly.  
**Recommendation:** Add `aria-hidden="true"` to all decorative icons.  
**Expected Result:** No decorative icons announced by screen readers. [MEDIUM]

---

## 8. User Flow Redesign

### 8.1 Equipment triage flow

**Current state:** Equipment list shows a flat list. Users must open each item to determine deployability. Status is communicated by `StatusBadge` (post-T1.3) on the list row, but the full verdict (location + custodian + bundle gate) requires opening the detail page.

**Target state (T3.2):** Triage-tier grouping (attention → in_use → operational) using existing `equipmentTriageTier` + `TRIAGE_ORDER` from `design-tokens.ts`. Worst-first ordering matches clinical mental model.

**Evidence:** `src/lib/design-tokens.ts:34–54` — triage helpers already exist.

### 8.2 Home screen answer-first

**Current state:** Home screen shows shift progress, scan CTA, and some quick stats. Does not surface the most urgent equipment issue or pending task.

**Target state (T3.3):** "Answer-first" home that leads with the single most urgent item (worst equipment alert, open task, Code Blue if active).

**Evidence:** `src/pages/home.tsx:186–340` — current quick-action layout.

### 8.3 Navigation mental model

**Current state:** Two nav instances (Topbar with SECTIONS, legacy Layout with bottom nav) can disagree on active state.

**Target state (T2.4):** Single `AppShell` with sidebar (desktop) and bottom-nav (mobile) both driven by `NAV` model.

---

## 9. Visual Design Direction

The existing design system is strong. Tokens cover all necessary brand, surface, status, and motion values. The primary issue is **compliance gaps**: existing components bypass the token system rather than extending it.

**Preserve:**
- Ivory/off-white base with dark green action elements — distinctive and clinical
- StatusBadge dot+label pattern (just established in T1.3)
- EquipmentTruthCard verdict-first layout — reference pattern for Phase 3

**Correct:**
- Replace all raw hex and default-palette Tailwind with tokens
- Unify card frame radii (one `rounded-2xl` shape)
- Correct RTL layout in sidebar active indicator and nav items

**Theme verification (forest/clinical/dark):** All three themes exist in `src/index.css` but raw hex values in `AlertCard`, `StatCard`, and `layout.tsx` will not respond to theme switches. This must be resolved in Phase B.

---

## 10. Figma Design System Specification

### Token map (source: `src/index.css`)

| Purpose | Token |
|---|---|
| App background | `--ivory-bg` |
| Surface (card, panel) | `--ivory-surface` / `--card` |
| Primary border | `--ivory-border` |
| Primary text | `--ivory-text` |
| Secondary text | `--ivory-text-2` |
| Tertiary / muted text | `--ivory-text-3` / `--muted-foreground` |
| Brand action | `--brand` / `--action` |
| Brand deep | `--brand-deep` |
| Nav background | `--brand-navy` |
| Nav active | `--brand-green-mid` |
| Status: ok | `--status-ok` / `--status-ok-bg` / `--status-ok-fg` / `--status-ok-border` |
| Status: issue | `--status-issue` + companions |
| Status: maintenance | `--status-maintenance` + `--status-maint-*` |
| Status: sterilized | `--status-sterilized` + `--status-steril-*` |
| Status: info | `--status-info` (base only; borrows steril surface) |
| Radius sm | `--radius-sm` (8px) |
| Radius md | `--radius-md` (10px) |
| Radius lg | `--radius` (12px) |
| Radius xl | `--radius-xl` (16px) |
| Radius 2xl | `--radius-2xl` (20px) |

### Component inventory

| Component | Status | Location |
|---|---|---|
| `Button` | ✅ Reference | `src/components/ui/button.tsx` |
| `Card` | ✅ Reference | `src/components/ui/card.tsx` |
| `StatusBadge` | ✅ New (T1.3) | `src/components/ui/status-badge.tsx` |
| `Badge` | ⚠️ Needs palette fix | `src/components/ui/badge.tsx` |
| `Skeleton` | ✅ Fixed (T1.1) | `src/components/ui/skeleton.tsx` |
| `DeployabilityBadge` | ⚠️ Raw palette | `src/components/equipment/DeployabilityBadge.tsx` |
| `EquipmentTruthCard` | ✅ Reference pattern | `src/components/equipment/EquipmentTruthCard.tsx` |
| `AlertCard` | ❌ Raw hex | `src/components/alerts/AlertCard.tsx` |
| `StatCard` | ❌ Raw hex | `src/components/stats/StatCard.tsx` |

---

## 11. Screen-by-Screen Refactoring Plan

### `/equipment` (Equipment List)
- **Remaining T1.4 issues:** `EquipmentTriageList.tsx:66` `min-h-[56px]` (acceptable), `w-[3px]` tone bar
- **Phase 3 target:** Triage-tier grouping (T3.2)
- **RTL:** List rows use logical classes ✅

### `/alerts`
- **Remaining T1.5:** `AlertsProView.tsx:127` bare `<button>`
- **Remaining palette:** `AlertCard.tsx` — all raw hex
- **Interactive target:** Un-ack button `h-7 w-7` below 44px
- **Phase B fix:** All three items above are MANDATORY

### `/home`
- **Raw radius:** `rounded-[20px]`, `w-[3px]`, `h-[60px]`, `h-[76px]` (some min-h, OK; some h- that need mapping)
- **Arbitrary text:** None found
- **Phase 3 target:** Answer-first layout (T3.3)

### `/admin/metrics` (OperationalMetricsDashboard)
- **T1.3 done:** Amber pill replaced with StatusBadge ✅
- **T1.5 done:** Date-range bare buttons replaced ✅

### `/equipment/:id` (Detail)
- **RTL violations:** `right-1` on hover buttons
- **Bare buttons:** 5 bare `<button>` elements
- **Phase B:** RTL fixes MANDATORY; buttons tracked for T4.1

### `/display` (Ward Display / Command Board)
- **Per T4.2:** Already refactored — verify-and-align only in Phase C
- **Audit status:** Not re-audited; treat as frozen pending T4.2 verification

---

## 12. Prioritized Roadmap

### Phase B — MANDATORY FIXES (before Phase C continues)

These must be complete before T2.1:

| Task | Finding | Severity |
|---|---|---|
| B.1 | Locale parity check | FULL_PARITY_OK ✅ — no action needed |
| B.2-A | Move Hebrew from `phone-sign-in.tsx` to locales | CRITICAL |
| B.2-B | Raw hex in `AlertCard.tsx`, `StatCard.tsx`, `IconSidebar.tsx` | HIGH |
| B.2-C | Default Tailwind palette in `DeployabilityBadge.tsx`, `badge.tsx` issue/maintenance variants | HIGH |
| B.3 | Complete T1.5: fix 3 remaining bare buttons in equipment/alerts | HIGH |
| B.4-A | Fix `h-7` interactive targets → `h-11` minimum | HIGH |
| B.4-B | RTL violations: `ml-/mr-/pl-/pr-/left-/right-` in `sync-status-banner`, `shift-summary-sheet`, `crash-cart-admin-sheet`, `layout.tsx` active indicator | HIGH |
| B.5 | `server/routes/test.js` and `cursor-bug-fixer.js` — CONFIRMED DELETED ✅ — no action needed |
| B.6 | `node_modules` absent — `pnpm install` required before TypeScript check can run | CRITICAL (env) |
| B.7 | Topbar `bg-ivory-green` regression (T1.2) → `bg-[var(--brand-green-mid)]` or `bg-[var(--brand)]` | LOW |

### Phase C Task Annotations (Refactor Roadmap 2.md → audit findings)

| Task | Closes findings |
|---|---|
| T1.4 (extend) | 5.4 — remaining arbitrary radii including `rounded-[7px]`, `min-h-[Npx]` |
| T1.5 (complete) | 6.2 — 3 remaining bare buttons |
| T2.1 | 4.1 — nav-model.ts; closes hardcoded labels |
| T2.2 | 4.1, 4.2, 4.3 — nav source-of-truth, pilotHidden filter, active-state |
| T2.3 | 3.3 — canonical route mounts |
| T2.4 | 3.2, 4.3 — merge shells, single active-state |
| T2.5 | 4.3 — shared resolver, equipment breadcrumb |
| T3.1 | 6.1 — extract DeployabilityVerdict as pure component |
| T3.2 | 8.1 — triage-tier grouping in equipment list |
| T3.3 | 8.2 — answer-first home screen |
| T4.1 | 7.5, 6.2 (broader) — motion cap, decorative icon aria-hidden, remaining bare buttons in pages |
| T4.2 | Ward Display verify-and-align |
| T4.3 | 7.1 (remaining after B.4), 5.3 — AA contrast, RTL parity sweep, text-[Npx] |

---

## MANDATORY_FIXES (must complete before Phase C continues)

1. **[CRITICAL] Hebrew in `phone-sign-in.tsx`** — ~20 strings must move to locales
2. **[CRITICAL] `node_modules` absent** — run `pnpm install` before any TypeScript or lint verification
3. **[HIGH] Raw hex in `AlertCard.tsx`, `StatCard.tsx`, `IconSidebar.tsx`** — B.2-B
4. **[HIGH] Default Tailwind palette in `DeployabilityBadge.tsx`, `badge.tsx`** — B.2-C
5. **[HIGH] Complete T1.5**: bare buttons in `EquipmentRoomSweepSheet.tsx`, `EquipmentConfirmInRoomSheet.tsx`, `AlertsProView.tsx`
6. **[HIGH] `h-7` interactive targets** on `cop-discrepancy-banner`, `crash-cart-admin-sheet`, `sync-status-banner`, `AlertsProView` un-ack button
7. **[HIGH] RTL violations** — `ml-auto` ×4 in `shift-summary-sheet`, `pl-5` ×2 in `sync-queue-sheet`, `ml-1` in `sync-status-banner` and `crash-cart-admin-sheet`, `left-0` active indicator in `layout.tsx`

## PHASE_C_TARGETS (Refactor Roadmap T1.1–T4.3 mapped to audit)

See Section 12 table above. All 13 tasks remain valid. Pre-conditions:
- MANDATORY_FIXES 1–7 must be resolved before starting T2.1
- `pnpm install` must be run before any DONE-WHEN verification
- Locale path in verification commands: `./locales/` not `./src/lib/locales/`

---

*Audit complete. No code changed. Proceed to Phase B.*
