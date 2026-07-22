# Pre-Resubmission 4-Flow Audit — 2026-07-18

> Findings-only audit before App Store resubmission (v1.2.0 build 26). Scope: iPhone / iPad / Website / Board across navigation, crashes, layout/RTL, Sign-in-with-Apple (§F chain), account deletion, demo account, push VAPID, frozen-surface proximity.
> Method: 8 parallel auditors (7 code + 1 live Playwright walk on the dev-bypass server) → every critical/moderate finding adversarially verified against the real files. 23 agents, ~2M tokens. Context: RESUBMISSION_RUNBOOK.md §A/C/F/G/H, FLOW_MATRIX.md §1/§8, docs/account-deletion.md.

**Totals: 42 findings — 1 CRITICAL · 14 moderate · 27 low. All 15 critical/moderate findings CONFIRMED by adversarial verification.**

## Verdict

**One resubmission blocker.** Everything else is ship-with-notes. The live walk is green (147 rows: 145 pass, 0 broken, 2 known-degraded — no regression vs the 2026-07-16 baseline), the §F Sign-in-with-Apple chain is fully intact, and no frozen surface is violated by any finding.

## iPhone (native Capacitor phone)

### IPHONE-1 · 🟠 MODERATE — layout-safe-area

**`src/components/handover-artifact-panel.tsx:53`** — /handoff is a FULLSCREEN_ROUTE (NativeHeader hidden) but its panel adds no env(safe-area-inset-top), so the back button and title render under the iPhone status bar / Dynamic Island.

- **Failure scenario:** Technician (or admin reviewer with an active roster shift) taps Menu → End shift on a notched iPhone: NativeHeader.tsx:21 lists "/handoff" in FULLSCREEN_ROUTES and returns null (line 97), NativeShell.tsx phone branch has no top padding by design (line 115 comment: 'NO paddingTop here — NativeHeader owns the top safe area'; each fullscreen page must add its own), but the panel root is only `p-4` (16px). The back affordance and page title sit under the status bar — clipped and hard to tap; the screen looks broken to a reviewer.
- **Evidence:** handover-artifact-panel.tsx:53 `<div className="flex flex-col gap-4 p-4">` (no safe-area inset; grep for safe-area in the file returns nothing) + NativeHeader.tsx:21 `const FULLSCREEN_ROUTES = ["/code-blue", "/crash-cart", "/scan", "/handoff"]` and :97 `if (isFullscreen) return null;` + NativeShell.tsx:115 comment. Contrast: the other three fullscreen pages DO pad — crash-cart.tsx:137 `paddingTop: "calc(env(safe-area-inset-top) + 16px)"`, ScanScreen.tsx:35, code-blue.tsx:133.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPHONE-2 · 🟠 MODERATE — navigation-dead-affordance

**`src/pages/equipment-detail.tsx:915`** — The equipment-detail Tools sheet shows 'Print QR' unconditionally on native, but its target /equipment/:id/qr is WebOnlyGuard-walled — on the Capacitor shell the tap can never show a QR page and at best bounces the user to /home.

- **Failure scenario:** Admin demo reviewer opens any equipment detail → Tools sheet → taps Print QR. handlePrintQr calls `window.open(`/equipment/${id}/qr`, "_blank")` (equipment-detail.tsx:913-916). The route is `<Route path="/equipment/:id/qr"><AuthGuard><WebOnlyGuard>…` (routes.tsx:160) and WebOnlyGuard.tsx:26-28 does `if (isCapacitorNative()) return <Redirect to={fallback} replace />` with fallback "/home". Whether the shell treats window.open as a same-WebView load (full app reload → route → redirect to /home) or a no-op, the button silently fails or dumps the reviewer back on Home — an obviously broken affordance a poking reviewer can hit.
- **Evidence:** equipment-detail.tsx:915 `window.open(`/equipment/${id}/qr`, "_blank")`; EquipmentDetailToolsSheet.tsx:40 renders the Print QR button with no native gate (unlike the audit-log link, which IS gated: RecentActivityCard.tsx:64-69 `{!isCapacitorNative() && <Link href="/audit-log">…}` with the comment 'on native the link silently bounced to /home' — the same class of bug already acknowledged and fixed elsewhere).
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPHONE-3 · 🟠 MODERATE — dependency-drift-adjacent-to-frozen-chain

**`package.json:96`** — @clerk/express was major-bumped 1.7.77 -> 2.1.41 (dependabot 6ca1ee9be, merged 2026-07-14) AFTER the native sign-in chain was device-confirmed; this is the server-side library that validates the native session JWT (azp = capacitor://localhost) on every /api call from the shell, and no device/production re-confirmation of the full Apple-sign-in -> /api round-trip has happened since (the 2026-07-16 flow walks ran dev-bypass, where clerkMiddleware is skipped entirely).

- **Failure scenario:** Reviewer completes Apple sign-in in the system browser (Clerk FAPI side works), but the first authenticated /api/users/sync call from capacitor://localhost fails 401 if clerkMiddleware v2 changed header/azp/acceptsToken semantics versus v1 — reviewer sees a sign-in that appears to succeed then dead-ends, reproducing a 2.1(a)-shaped rejection. FLAG-ONLY: the chain is frozen; the remedy is owner live verification, not code change.
- **Evidence:** git log -S '@clerk/clerk-js' shows the clerk-js pin untouched since 76b1eeeb6, but 6ca1ee9be (2026-07-14 19:00 +0300) bumped @clerk/express to ^2.1.41 (caret range, unlike the exact clerk-js pin). Consumption path read: server/index.ts:299-303 mounts clerkMiddleware({ authorizedParties: resolveClerkAuthorizedParties(isProduction) }); server/lib/clerk-authorized-parties.ts:11 includes capacitor://localhost + ionic://localhost; server/lib/clerk-session-auth.ts:15 uses getAuth(req, { acceptsToken: "any" }) (a v2-style call — code compiles and typechecks, so the API surface is compatible, but runtime verification of a real native session JWT under v2 has not been evidenced anywhere I could find).
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPHONE-4 · 🟠 MODERATE — demo-account-locale-not-applied

**`src/lib/i18n.ts:84`** — The 'reviewer lands locale=en' guarantee does not exist client-side: UI language is localStorage-only and defaults to Hebrew on a fresh install; vt_users.preferred_locale (set to en for the reviewer per runbook §A/§H) is only read by notification/handover code paths and is never applied to the app UI after sign-in.

- **Failure scenario:** Reviewer installs the build on a fresh device and signs in as reviewer@vettrack.uk: getStoredLocale() finds no stored key and returns 'he' ('Default to Hebrew in native context'), DEFAULT_USER_SETTINGS.locale inherits it, and no post-sign-in sync reads the account's preferred_locale — the reviewer gets a Hebrew RTL UI until they manually find Settings → language, despite the runbook listing 'English locale' as part of the 2.1 demo-account fix.
- **Evidence:** src/lib/i18n.ts:80-89 `getStoredLocale(): ... if (!stored) return "he"; // Default to Hebrew in native context`. src/lib/user-settings-storage.ts:39 `locale: getStoredLocale()` (DEFAULT_USER_SETTINGS). server/schema/core.ts:47 `preferredLocale ... .default("he")` — grep shows its only consumers are server/lib/resolve-user-locale.ts, shift-handover-generator.ts, role-notification-scheduler.ts, notification.worker.ts; server/routes/users.ts /me (users.ts:112) returns no preferredLocale and grep for preferredLocale in src/ is empty. ClerkLocaleBridge (src/components/clerk-locale-bridge.tsx:10-13) only makes the Clerk card follow the app locale, not the reverse. RESUBMISSION_RUNBOOK.md:21/171 claim 'account promoted to admin + English locale' as the fix.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPHONE-5 · 🟠 MODERATE — needs-client-trust-unhandled

**`RESUBMISSION_RUNBOOK.md:161`** — Confirmed: `needs_client_trust` has zero in-app handling (grep of src/ returns no hits), so if Clerk silently re-enables Client Trust, the demo password login fails with no recovery path visible to the reviewer; the only mitigation is the procedural §G/§C gate (dashboard 'Revert update' + pre-archive login curl printing 'LOGIN: complete').

- **Failure scenario:** Clerk's 24-hour 'Revert update' lapses or Client Trust is re-enabled between the §C check and the review window: reviewer taps sign-in with the demo credentials, the FAPI sign-in returns status needs_client_trust (an email-code wall the reviewer cannot pass — the demo mailbox is unreadable to them), the app shows a generic sign-in failure, and the 2.1 'demo account login failed' rejection recurs. If it triggers during review this is critical; it is rated moderate here because the runbook documents the owner-run gate and no code change is proposed (§G explicitly says an in-app handler is NOT a fix).
- **Evidence:** `grep -rn needs_client_trust src/` → no matches (only docs + RESUBMISSION_RUNBOOK.md). RESUBMISSION_RUNBOOK.md:161 (§G): 'Client Trust re-enabling (HIGH — this is what to watch)... If it turns back on, demo login fails again (needs_client_trust)... the in-app needs_client_trust email-code handler is NOT a fix here because the reviewer can't read the demo mailbox.' §C:67-78 is the owner-run pre-archive login check; scripts/verify-resubmission.sh:41-66 carries the same gate and skips it when REVIEWER_PASSWORD is unset.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPHONE-6 · 🟠 MODERATE — native-push-platform-gap

**`src/pages/settings.tsx:309`** — On the Capacitor shell (iPhone AND iPad) push does not exist at all and fails silently: the hook has no Capacitor.isNativePlatform() awareness (grep: zero matches in hook/settings), WKWebView lacks PushManager/Notification so supported=false (use-push-notifications.tsx:117-124), the whole Settings push section is hidden by `{push.supported && …}`, main.tsx:106 skips SW registration on native, and there is no @capacitor/push-notifications/APNs dependency in package.json.

- **Failure scenario:** App Review opens the iOS app: no notifications UI exists anywhere, no permission prompt ever fires, yet the shipped privacy policy copy (locales/en.json:4060) tells the reviewer the app collects "device push notification tokens (if you enable notifications)" and lists notifications under device permissions. Neither the 503 nor the baked-key failure mode is reachable on iPhone/iPad — the winning failure mode is silent feature absence. Not a crash, unlikely to reject alone, but a claims-vs-behavior inconsistency in the flow the reviewer actually exercises.
- **Evidence:** Read src/pages/settings.tsx:309 (section gated on push.supported); src/hooks/use-push-notifications.tsx:116-124 (feature-detect only, no Capacitor guard; sets permission "unsupported"); src/main.tsx:105-114 (isCapacitorNative → returns before SW registration); package.json grep: only server-side web-push@3.6.7 + @types/web-push, no Capacitor push plugin; locales/en.json:4060 privacy copy.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPHONE-7 · 🟡 LOW — layout-css-bare-triplet

**`src/pages/code-blue.tsx:370`** — Active Code Blue screen uses `borderTop: "3px solid var(--destructive)"` where --destructive is a bare HSL triplet ('4 78% 52%'), producing an invalid computed value — the emergency red top border silently never renders. FLAG-ONLY: cosmetic CSS on the frozen Code Blue surface; no contract change proposed.

- **Failure scenario:** During an active Code Blue on the phone, the computed style is `3px solid 4 78% 52%` — invalid at computed-value time, so the whole border-top shorthand resets to initial (no border). The intended emergency visual emphasis is missing. Same hazard class exists at code-blue-display.tsx:130 (`4px solid var(--destructive)` / `var(--border)`) on the web wall display (cross-flow).
- **Evidence:** code-blue.tsx:370 `borderTop: "3px solid var(--destructive)"`; index.css:38 `--destructive: 4 78% 52%;` (HSL triplet intended for `hsl(var(--destructive))`, as used everywhere else, e.g. NativeHeader.tsx:223 `background: "hsl(var(--destructive))"`); code-blue-display.tsx:130 same pattern.
- **Verification:** unverified (low — not sent to verification)

### IPHONE-8 · 🟡 LOW — i18n-hardcoded-locale

**`src/pages/not-found.tsx:19`** — The 404 page body is hardcoded Hebrew (allowlisted debt), so the English-locale reviewer account sees an untranslated Hebrew-only error page on any bad route/deep link.

- **Failure scenario:** Reviewer (account explicitly set to English locale per RESUBMISSION_RUNBOOK §A 2.1 fix) lands on a nonexistent route (typo'd universal link, stale notification URL) and sees 'הדף לא נמצא' / 'הדף שחיפשת אינו קיים.' / 'לדף הבית' with no English. Recovery works (Home button → /home) but the page reads as broken localization.
- **Evidence:** not-found.tsx:19-24 hardcoded Hebrew strings while line 12 uses the typed `t.notFoundPage.title` for the meta title, proving keys exist; tests/i18n-no-hebrew-in-source.test.ts:48 lists "src/pages/not-found.tsx" in KNOWN_DEBT_ALLOWLIST (sanctioned, but still reviewer-visible).
- **Verification:** unverified (low — not sent to verification)

### IPHONE-9 · 🟡 LOW — navigation-guard-gap

**`src/app/routes.tsx:143`** — The /board route's comment claims the platform target 'already does the gating WebOnlyGuard would: native → mobile (NativeShell)', but NativeShell only wraps chrome — on a native iPhone /board would render the kiosk CommandBoardScreen (live SSE board) inside the phone shell. Latent: no native nav item or deep link reaches /board. FLAG-ONLY: CommandBoardScreen owns the frozen SSE/outbox realtime path.

- **Failure scenario:** If any future native surface links to /board (or a notification carries that URL), the iPhone renders the dark TV-grade Command Center inside the phone tab-bar chrome instead of redirecting — dense kiosk layout in a 375pt viewport with a live realtime subscription. Today unreachable: native-nav-model.ts has no /board item, deep-link-router.ts handles only vettrack://scan, vettrack://oauth-callback, and universal equipment links.
- **Evidence:** routes.tsx:139-147 — `/board` wrapped only in AuthGuard (or bare when isDisplayPaired), with the comment asserting platform gating; PlatformRouter.tsx:19-20 native → `<NativeShell>{children}</NativeShell>` (renders children, never redirects); platform resolution order in src/app/platform/index.ts puts Capacitor-native before the board-path check, so native never gets BoardShell.
- **Verification:** unverified (low — not sent to verification)

### IPHONE-10 · 🟡 LOW — navigation-suspense-flash

**`src/App.tsx:36`** — The only Suspense boundary sits ABOVE PlatformRouter/NativeShell, so the first navigation to each lazy page suspends the whole tree and momentarily replaces the entire phone shell (tab bar + header) with RouteFallback.

- **Failure scenario:** User taps a tab whose page chunk isn't loaded yet: the lazy import suspends, the nearest boundary is App.tsx's single top-level Suspense, and the whole NativeShell unmounts to show the fallback — tab bar visibly blinks out and back on every first visit to each page. In the bundled shell chunk loads are local-file-fast, so this is a brief flash, not a hang; AppRoutes' inner PageErrorBoundary (routes.tsx:116) adds no Suspense of its own.
- **Evidence:** App.tsx:36-42 `<Suspense fallback={<RouteFallback />}><PageErrorBoundary…><PlatformRouter><AppRoutes /></PlatformRouter>…` — NativeShell (inside PlatformRouter) is inside the suspending subtree; routes.tsx:19-80 declares every page via `lazy()`; no other Suspense exists between NativeShell and the routes (NativeShell.tsx renders children directly).
- **Verification:** unverified (low — not sent to verification)

### IPHONE-11 · 🟡 LOW — navigation-duplicate-entry

**`src/lib/routes/native-nav-model.ts:58`** — Custody-only (student) phone users get 'My Equipment' twice: as the swapped-in 'Mine' bottom tab AND as a MoreSheet row, because the nav model's static inPhoneTabBar flag doesn't reflect the custody tab-bar swap.

- **Failure scenario:** Student signs in on iPhone: NativeTabBar.tsx:103-105 swaps Emergency for a Mine tab (`custodyOnly ? [{ id: "mine", href: "/my-equipment", … }]`), but native-nav-model.ts:58 declares `mine` WITHOUT `inPhoneTabBar: true`, so MoreSheet.tsx:87's `filter((item) => !item.inPhoneTabBar)` keeps it — the drawer lists My Equipment even though it is already a tab. Duplicate nav entry, cosmetic only.
- **Evidence:** native-nav-model.ts:58 `{ id: "mine", href: "/my-equipment", label: t.nav.mine, Icon: User }` (no inPhoneTabBar) vs :51-54 where today/equipment/scan/emergency carry `inPhoneTabBar: true`; NativeTabBar.tsx:102-105 custody swap; MoreSheet.tsx:83-88 filter; experience-model.ts:287-301 CUSTODY_ONLY_NAV_KEYS includes "mine" so it survives the custody filter.
- **Verification:** unverified (low — not sent to verification)

### IPHONE-12 · 🟡 LOW — navigation-signed-out-chrome

**`src/native/NativeShell.tsx:28`** — AUTH_ROUTE_PATTERN only exempts /signin and /signup, so a signed-out native user reading /privacy, /terms, or /support (linked from the sign-in footer) gets the full signed-in app chrome — header with NFC/chat/settings controls plus a tab bar whose every tab bounces back to /signin.

- **Failure scenario:** Reviewer on the sign-in screen taps Privacy: /privacy renders inside NativeShell with NativeHeader (NFC toggle, chat launcher, settings, avatar — all for a user who isn't signed in; header queries are disabled via `enabled: !!userId` so no crash) and the bottom tab bar; tapping any tab routes through AuthGuard → Redirect /signin (routes.tsx guards + AuthGuard.tsx:122). Recoverable — the legal page's own 'Back to sign-in' link works (privacy-policy.tsx:31-32 backHref="/signin") — but the dead chrome reads unpolished during exactly the legal-page check reviewers perform.
- **Evidence:** NativeShell.tsx:28 `const AUTH_ROUTE_PATTERN = /^\/(signin|signup)(\/|$)/;` and :37-59 bare branch only for those; routes.tsx:123-125 /privacy /terms /support are public routes with no chrome exemption; signin.tsx:172 renders LegalFooterLinks; AuthGuard.tsx:122 `if (!isSignedIn) return <Redirect to="/signin" replace />`.
- **Verification:** unverified (low — not sent to verification)

### IPHONE-13 · 🟡 LOW — verified-benign-drift

**`src/main.tsx:53`** — Commit 12b70064f (flow-walk PR #109) changed the client Clerk-enable gate from Boolean(PUBLISHABLE_KEY) to isClerkEnabled(), which adds a VITE_FORCE_DEV_BYPASS escape hatch — verified benign for the shipped shell because the divergence requires import.meta.env.DEV === true, which is false in any production native build.

- **Failure scenario:** None in the shipped archive. Residual latent risk only: if a future build script ever set VITE_FORCE_DEV_BYPASS=true in .env AND produced a dev-mode bundle for the shell, Clerk would silently disable and the shell would boot into dev-bypass; scripts/build-native-shell.sh produces a production build, so this cannot happen through the sanctioned path today.
- **Evidence:** src/lib/auth-fetch.ts:35-45: isClerkEnabled() returns false only when hasKey && env.DEV === true && VITE_FORCE_DEV_BYPASS === "true"; the accompanying comment (lines 32-33) states it is byte-identical to Boolean(key) outside dev. Diff of 12b70064f on src/main.tsx read directly (git show).
- **Verification:** unverified (low — not sent to verification)

### IPHONE-14 · 🟡 LOW — pre-archive-gate-state

**`ios/App/App.xcodeproj/project.pbxproj:391`** — CURRENT_PROJECT_VERSION (25) currently equals ios/.last-shipped-build (25), so the runbook §C build-number gate will fail until `pnpm resubmit` bumps it — expected §B.1 state, recorded so the archive step is not attempted from this tree as-is.

- **Failure scenario:** Archiving without running `pnpm resubmit` first would upload a duplicate CFBundleVersion that App Store Connect rejects. Runbook line 97 already documents exactly this; no code defect.
- **Evidence:** RESUBMISSION_RUNBOOK.md:93-97 ("currently pbxproj=25 and last-shipped=25 → run `pnpm resubmit` to bump to 26 first") — matches the §B.1 documented flow; not drift, logged for the Final-QA aggregation.
- **Verification:** unverified (low — not sent to verification)


## iPad (native tablet master-detail)

### IPAD-1 · 🟠 MODERATE — state-management

**`src/features/equipment/hooks/use-equipment-filters.ts:20`** — On the iPad combined /equipment/:id? route, equipment filters live in the URL query but every selection/filter navigation drops the other half of the URL state: selecting an item clears active filters in the still-visible master list, and searching/filtering while a detail is open closes the detail pane and destroys its history entry.

- **Failure scenario:** iPad reviewer taps the 'maintenance' chip (/equipment?status=maintenance), then taps a row: EquipmentTriageList's Link href=`/equipment/${eq.id}` (src/components/equipment/EquipmentTriageList.tsx:68) drops the query, so the mounted master list re-derives statusFilter='all' and search='' from the new URL — the filtered list silently reloads unfiltered and the search box clears (EquipmentListScreen.tsx:26-28 syncs inputValue from URL). Conversely, with a detail open at /equipment/<id>, typing in the master search or tapping a chip calls setSearch/setStatusFilter which navigate to hardcoded `/equipment?...` with replace:true — the detail pane snaps to the placeholder mid-interaction and Back cannot return to it.
- **Evidence:** use-equipment-filters.ts:20 `navigate(qs ? \`/equipment?${qs}\` : "/equipment", { replace: true })` (same at :31) — base path hardcoded, :id never preserved; EquipmentTriageList.tsx:68 `href={\`/equipment/${eq.id}\`}` — query never preserved. Tablet-only impact: routes.tsx:161-162 keeps EquipmentListScreen mounted while the URL changes; on phone the list unmounts and Back restores the full query. Rooms/inventory master panes are unaffected (local useState filters: rooms-list.tsx:220, inventory-items.tsx:62).
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPAD-2 · 🟠 MODERATE — responsive-layout

**`src/native/tablet/TwoPaneLayout.tsx:34`** — Fixed 380px master pane + fixed 220px sidebar leave the detail pane only ~210-234px wide on 11"-class iPads in portrait — narrower than any supported phone — with no responsive fallback (no min-width on detail, no masterWidth reduction, no single-pane collapse).

- **Failure scenario:** Reviewer holds an iPad Air/Pro 11" (820/834pt) or iPad 10.2" (810pt) in portrait and opens any equipment/room/inventory detail: content column = width − 220 (NativeTabSidebar.tsx:117) − 380 (TwoPaneLayout.tsx:34 default, no caller overrides) = 210-234px; after EquipmentDetailScreen's 16px side padding ~180-200px remain. The 2-col glance grid (EquipmentGlanceGrid.tsx:66 repeat(2, minmax(0,1fr))) compresses to ~90px cells; RoomRadarPage renders in a sliver. Cramped/clipped but not overflowing (minmax(0,1fr) + truncation), so reviewer-visible layout degradation rather than a crash.
- **Evidence:** TwoPaneLayout.tsx:34 `masterWidth = 380` with :43-44 `width: masterWidth, flexShrink: 0` and detail `flex: 1` (:54); NativeTabSidebar.tsx:117 `width: 220, flexShrink: 0`; Info.plist:41-47 declares all four iPad orientations, so portrait is a supported, reviewer-reachable state. No media query or width clamp anywhere in TwoPaneLayout/consumers.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPAD-3 · 🟠 MODERATE — state-loss-on-reclassification

**`src/app/routes.tsx:161`** — The tablet/phone route sets are swapped live on the reactive viewport predicate, so crossing the 768px boundary mid-session (iPad mini rotation to portrait — 744pt < 768 — or a Split View/Stage Manager resize) remounts the current route into a different component tree (EquipmentMasterDetail <-> EquipmentDetailPage), losing all in-page state.

- **Failure scenario:** On iPad mini (744x1133 logical) in landscape master-detail at /equipment/<id> with the report-issue sheet open, the reviewer rotates to portrait: matchMedia fires (use-tablet-viewport.ts:44-49), isNativeTablet flips false, routes.tsx:161-163 swaps the matched Route to EquipmentDetailPage — full remount, open dialog/scroll/pull-state discarded, whole shell swaps sidebar->tab-bar (NativeShell.tsx:61/105), and the newly-mounted lazy chunk can flash the app-level Suspense fallback (App.tsx:36). Same trigger by dragging the Split View divider on any iPad (Info.plist has no UIRequiresFullScreen).
- **Evidence:** routes.tsx:110 `const isNativeTablet = useIsNativeTablet()` inside AppRoutes with conditional Route elements at :132, :161-163, :173-178, :234-236; use-tablet-viewport.ts:25-26 thresholds 768/500 and tests/tablet-viewport.test.ts:25 `expect(isTabletViewport(744, 1133)).toBe(false)` proving iPad mini portrait is phone-class by design — the classification is tested, the mid-session flip consequences are not handled anywhere.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### IPAD-4 · 🟡 LOW — error-handling

**`src/features/equipment/tablet/EquipmentMasterDetail.tsx:33`** — No per-pane error boundary in any of the three tablet master-detail composites: a render crash in the detail pane is caught only by the Switch-level PageErrorBoundary (routes.tsx:116), which replaces the ENTIRE two-pane view — master list included — with the inline error card.

- **Failure scenario:** A malformed equipment record makes EquipmentDetailScreen throw during render on iPad: instead of the detail pane alone degrading (the master list is healthy and independently useful), the whole route subtree unmounts to the compact error card; the reviewer loses the list they were navigating. Same for RoomsMasterDetail.tsx:22 and InventoryItemsMasterDetail.tsx:24.
- **Evidence:** EquipmentMasterDetail.tsx:28-36 renders master/detail directly into TwoPaneLayout with no boundary; the nearest boundaries are routes.tsx:116 (above the whole Switch) and App.tsx:37 — both above NativeShell content, none pane-scoped. PageErrorBoundary's own doc (page-error-boundary.tsx:18-20: 'Wraps a page section so a single component crash cannot take down the entire page') is exactly the granularity the tablet panes lack.
- **Verification:** unverified (low — not sent to verification)

### IPAD-5 · 🟡 LOW — accessibility-tap-target

**`src/features/today/HomeTabletDashboard.tsx:458`** — Room readiness rows on the iPad-only ops home dashboard are 32px-tall tappable Links — below the 44pt iOS HIG floor and the app's own documented 48px convention.

- **Failure scenario:** Admin/lead on iPad (home.tsx:24-25 renders HomeTabletDashboard only when isNativeTablet) tries to tap a specific room bar in the Rooms tile; at minHeight:32 with 10px gaps the touch target is under HIG minimum, causing mis-taps to adjacent rooms — an a11y polish item Apple occasionally notes but rarely rejects on.
- **Evidence:** HomeTabletDashboard.tsx:458 `style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minHeight: 32 }}` on the room `<Link>`; contrast with the sibling alerts rows at :384 `minHeight: 44` and the stated convention at NativeHeader.tsx:471 '48px hit area (VetTrack convention, above the 44pt iOS HIG floor)'. Sidebar itself is clean (NativeTabSidebar.tsx:42 minHeight 52).
- **Verification:** unverified (low — not sent to verification)

### IPAD-6 · 🟡 LOW — consistency-a11y

**`src/native/tablet/RoomsMasterDetail.tsx:19`** — Master-detail composites are inconsistent: RoomsMasterDetail omits detailLabel (detail <section> renders with aria-label undefined), and only equipment suppresses the in-pane full-page Back button (hideBack) — rooms and inventory detail panes keep phone-style Back buttons inside the pane.

- **Failure scenario:** VoiceOver user on iPad lands in the rooms detail region with no accessible name (TwoPaneLayout.tsx:52-54 renders aria-label={detailLabel} = undefined). Sighted users see a Back control inside the inventory/rooms detail pane (inventory-item-detail.tsx:41 navigate('/inventory-items'); room-radar.tsx:558 Link to /rooms) that merely clears the selection, while the equipment pane has no such control (EquipmentMasterDetail.tsx:33 hideBack) — two different navigation grammars across three identical layouts. Also, back from /locations/<id> targets /rooms, remounting the master (different Route pattern at routes.tsx:173 vs :176) and dropping list scroll.
- **Evidence:** RoomsMasterDetail.tsx:19-29 passes masterLabel but no detailLabel; TwoPaneLayout.tsx:14-15 detailLabel optional, :53 `aria-label={detailLabel}`; EquipmentMasterDetail.tsx:33 `hideBack` vs InventoryItemsMasterDetail.tsx:24 `<InventoryItemDetailPage />` (no equivalent prop exists on that page).
- **Verification:** unverified (low — not sent to verification)

### IPAD-7 · 🟡 LOW — dead-end-help-copy

**`src/pages/help.tsx:234`** — The Help page unconditionally renders "Push alerts — Enable push notifications in Settings -> Push Notifications…" (locales/en.json:1727-1728) on the native shells, directing users/reviewers to a Settings section that is hidden on iPhone/iPad because push.supported=false.

- **Failure scenario:** Reviewer or user on iPad/iPhone opens Help → Alerts, follows the instruction to Settings, and finds no "Push Notifications" section (settings.tsx:309 hides it in WKWebView). Dead-end instruction; reads as a broken/unfinished feature during review. Applies equally to iPhone.
- **Evidence:** Read src/pages/help.tsx:222-237 (CheatItem with t.helpPage.pushAlertsTitle/Description, no platform gate); locales/en.json:1727-1728 copy; settings.tsx:309 gate confirmed hidden when unsupported.
- **Verification:** unverified (low — not sent to verification)


## Website (vettrack.uk browser)

### WEBSITE-1 · 🟠 MODERATE — push-vapid-key-source-mismatch

**`server/lib/push.ts:70`** — getVapidPublicKey() returns process.env.VAPID_PUBLIC_KEY unconditionally, while initVapid() only signs with the env pair when BOTH VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set (line 22), otherwise signing with DB-stored keys — so setting only the public env var hands browsers a key the server never signs with.

- **Failure scenario:** Railway sets VAPID_PUBLIC_KEY without VAPID_PRIVATE_KEY. initVapid falls to the vt_server_config pair (isVapidReady=true), but GET /api/push/vapid-public-key serves the env key. Browser subscribes with applicationServerKey != signing key; every webpush.sendNotification is rejected 403 by the push service; dispatchToSub maps 4xx (non-429) to "invalid" (push.ts:192-203) and cleanupExpiredEndpoints DELETES the subscription row (push.ts:354). Settings still shows "enabled" (localStorage endpoint matches the browser sub, use-push-notifications.tsx:140-147) while /api/push/test returns 409 PUSH_SUBSCRIPTION_NOT_FOUND — silent, self-destroying push.
- **Evidence:** Read server/lib/push.ts:19-27 (env pair only when both set), :69-80 (env public returned unconditionally), :187-203 (403→"invalid"), :354/:676 (cleanupExpiredEndpoints deletes). server/routes/push.ts:279-310 (test 409). Live walk server: curl GET /api/push/vapid-public-key → HTTP 200 {"publicKey":"BHBbhUP8jc6n…"} (DB-generated), so the bug is latent, one env var away in prod.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### WEBSITE-2 · 🟡 LOW — stale-metadata

**`src/pages/signin.tsx:75`** — 12 pages still declare rel=canonical against the dead legacy origin https://vettrack.replit.app (signin, signup, home shell, equipment list/detail/new, my-equipment, alerts, qr-print, analytics, admin, dashboard), while the legal pages correctly use https://vettrack.uk.

- **Failure scenario:** Search engines receive conflicting canonical signals for the production site vettrack.uk and may index/prefer the retired Replit origin; brand/SEO inconsistency on the exact auth page a reviewer opens. Not App-Review-visible (App Store fields point at vettrack.uk legal pages, which use the correct canonical).
- **Evidence:** Read src/pages/signin.tsx:75 (`<link rel="canonical" href="https://vettrack.replit.app/signin" />`). Grep confirmed 12 occurrences: signup.tsx:49, features/today/surfaces/HomeShell.tsx:98, my-equipment.tsx:142, new-equipment.tsx:319, equipment-list.tsx:447, qr-print.tsx:143, alerts.tsx:105, equipment-detail.tsx:1018, analytics.tsx:134, admin.tsx:87, management-dashboard.tsx:104. Contrast: privacy-policy.tsx:30, terms-of-use.tsx:31, support.tsx:25 all use https://vettrack.uk/*.
- **Verification:** unverified (low — not sent to verification)

### WEBSITE-3 · 🟡 LOW — dead-link

**`src/pages/signin.tsx:174`** — The '→ More about VetTrack' link (and the logo links to "/" on signin/signup/legal shell) is a no-op self-loop for signed-out users: RootRoute redirects signed-out visitors straight back to /signin and no marketing landing page exists.

- **Failure scenario:** Signed-out visitor on vettrack.uk/signin clicks 'More about VetTrack' → navigates to / → RootRoute (routes.tsx:104) immediately redirects back to /signin. The affordance visibly does nothing and implies a marketing page that was removed (FLOW_MATRIX still lists /landing as public; only ShiftChatLauncher.tsx:40 still references it).
- **Evidence:** Read src/pages/signin.tsx:173-178 (Link href="/" + t.authPage.moreAboutVetTrack) and src/app/routes.tsx:89-105 (RootRoute: !isSignedIn → <Redirect to="/signin" replace/>). Same href="/" pattern at signup.tsx:57,156 and components/legal-document-shell.tsx:43. No /landing route exists in routes.tsx (unknown paths fall to NotFoundPage). Also note the hardcoded LTR '→' glyph does not mirror under the RTL default locale.
- **Verification:** unverified (low — not sent to verification)

### WEBSITE-4 · 🟡 LOW — i18n

**`src/pages/not-found.tsx:18`** — The 404 page is hardcoded Hebrew-only ('הדף לא נמצא' / 'הדף שחיפשת אינו קיים.' / 'לדף הבית'), ignoring the active locale — an English-locale user (the App Review demo account is deliberately set to preferred_locale=en per RESUBMISSION_RUNBOOK §A/§H) sees untranslated Hebrew on any mistyped URL.

- **Failure scenario:** English-locale reviewer or manager on vettrack.uk hits any unknown path (e.g. /landing, a stale bookmark) → NotFoundPage renders Hebrew-only copy plus a hardcoded English meta description; no t.* accessor used for the body strings.
- **Evidence:** Read src/pages/not-found.tsx:8-29 (hardcoded Hebrew h1/p/button inside AppShell). Known debt: the file is explicitly allowlisted in tests/i18n-no-hebrew-in-source.test.ts:48 (KNOWN_DEBT_ALLOWLIST entry "src/pages/not-found.tsx"), so the parity gate intentionally tolerates it — filing so the resubmission owner can decide whether to clear it.
- **Verification:** unverified (low — not sent to verification)

### WEBSITE-5 · 🟡 LOW — doc-drift

**`FLOW_MATRIX.md:35`** — FLOW_MATRIX §1/§8 and the route index have drifted from routes.tsx: AUTH-03 lists /pending as a pending-screen route but /pending now redirects to /equipment (the pending UI lives inside AuthGuard); the route index still lists /landing and /patients/:id as live public/gated routes; §8 lists /display as a UI route (it is now a redirect to /board — behavior preserved).

- **Failure scenario:** A future verification pass scripted from FLOW_MATRIX rows would assert the wrong surfaces: expecting a /pending screen route (gets /equipment redirect), a /landing page (gets Hebrew-only 404), or a /display screen (gets redirect). The underlying gate contracts still hold — pending/blocked screens render from AuthGuard.tsx:124-139, and /display + /equipment/board redirect to /board via RedirectPreserveSearch — so this is documentation, not behavior.
- **Evidence:** Read FLOW_MATRIX.md:35 (AUTH-03 `/pending` row), :148-153 (§8 /display rows), :212-213 (route index: Public includes /landing; gated includes /patients/:id). Cross-checked src/app/routes.tsx:258 (`/pending` → Redirect /equipment), :256-257 (/patients → /equipment), :167-168 (/display, /equipment-board → RedirectPreserveSearch /board), and AuthGuard.tsx:124-139 (pending/blocked full-screen states). Fresh walk matrix rows board-alias-redirect + app-surfaces-redirect pass for all five roles.
- **Verification:** unverified (low — not sent to verification)

### WEBSITE-6 · 🟡 LOW — deletion-unreachable-on-desktop-for-non-management-roles

**`src/features/auth/components/AuthGuard.tsx:174`** — On the desktop website, ManagementWebGate blocks every route (including /settings and therefore the Danger-zone deletion surface) for roles without management.web (vet, technician, student), so those users cannot delete their account from the web console and must use the mobile UI.

- **Failure scenario:** A technician-role user opens vettrack.uk on a desktop browser to delete their account: AuthGuard's final clause `if (platformTarget === "desktop" && !experience.can("management.web")) return <ManagementWebGate />` renders the gate instead of any page, so Settings → Danger zone is unreachable on that surface. Not App-Review-relevant (Apple reviews the iOS app, where the path works for active accounts) — latent data-rights/parity gap only.
- **Evidence:** AuthGuard.tsx:170-176 (T-31/R-WEB-01 comment + gate), routes.tsx:225 `/settings` wrapped only in AuthGuard so the platform gate applies before SettingsPage; memory/runbook confirm management.web = admin + senior/lead technician only.
- **Verification:** unverified (low — not sent to verification)

### WEBSITE-7 · 🟡 LOW — i18n-hardcoded-error-copy

**`src/hooks/use-push-notifications.tsx:91`** — All subscribe() failure strings are hardcoded English — "Failed to fetch VAPID key" (line 91, the actual surface of the server 503 PUSH_NOT_CONFIGURED), "Service worker initialization timed out" (line 54, the only 'activation'-type error), "Push not supported" (line 177), "Permission denied" (line 184) — and settings.tsx:349 toasts push.error verbatim, so a Hebrew-default UI shows raw English on the Enable toggle; the localized server apiError message is discarded for the GET (only POST /subscribe's message is read, lines 216-217).

- **Failure scenario:** Hebrew-locale user clicks Enable in Settings → Push while the server VAPID config is missing (GET 503): toast shows untranslated "Failed to fetch VAPID key" instead of the server's localized "Push notifications not configured". If instead the SW stalls installing/waiting >8s, toast shows "Service worker initialization timed out". Trigger is the toggle click only — mount-path errors are swallowed (hook lines 148-154), so nothing surfaces on page load. Answers the audit question: the 503 is NOT what surfaces as the activation error; they are two distinct failure strings.
- **Evidence:** Read src/hooks/use-push-notifications.tsx:46-64 (timeout), :85-94 (503→"Failed to fetch VAPID key"), :176-184, :215-217 (server message used only for POST /subscribe), :223-227 (catch → state.error); src/pages/settings.tsx:333-349 (toast.error(push.error || t.settingsPage.pushEnableFailed)); server/routes/push.ts:55-69 (503 PUSH_NOT_CONFIGURED). Live server currently returns 200, so this path does not reproduce on the walk server.
- **Verification:** unverified (low — not sent to verification)

### WEBSITE-8 · 🟡 LOW — sw-registration-url-drift

**`src/hooks/use-push-notifications.tsx:72`** — The hook's fallback registration uses unversioned "/sw.js" while boot registration uses "/sw.js?v=<BUILD_TAG>" with updateViaCache:"none" (main.tsx:130) — in the rare path where the boot registration is absent (e.g. dev, where main.tsx:116-123 actively unregisters SWs, or a failed boot register), enabling push installs a differently-URLed SW registration outside the build-tag versioning scheme.

- **Failure scenario:** On the dev walk server, boot unregisters all SWs; clicking Enable then registers plain /sw.js, which can intercept Vite HMR and diverges from the Phase-9 build-tag cache-name contract. In production it only occurs after a failed boot registration, then leaves a registration whose script URL never carries the version query. Flag-only proximity to the frozen PWA build-tag surface — the fix must not alter the __VT_BUILD_TAG__/cache-name contract.
- **Evidence:** Read src/hooks/use-push-notifications.tsx:66-83 (registerServiceWorkerSafe("/sw.js") when getRegistration() is null); src/main.tsx:115-135 (dev unregister loop; versioned register with updateViaCache none).
- **Verification:** unverified (low — not sent to verification)

### WEBSITE-9 · 🟡 LOW — degraded-console-error

**`artifacts/flow-walk/web-matrix.json:365`** — Live walk degraded (not broken) on /shift-chat/:id for 2 of 5 roles (admin, senior_technician): the page renders but fires a 404 console error from GET /api/shift-chat/archive/:shiftId — the only non-pass rows in the entire 147-row walk, unchanged from the 2026-07-16 baseline.

- **Failure scenario:** A management-web user opens a shift-chat history page for a shift id that has no vt_shift_sessions row (the walk fixture id 943a335b-31ec-4843-86ae-aa3b3254d47d); the client's archive fallback request hits server/routes/shift-chat.ts:615-617 which returns 404 SHIFT_NOT_FOUND, and the browser logs 'Failed to load resource: 404'. The UI still renders (actual=render, expected=render), so a user only sees console noise, not a broken screen. This is a desktop management-console surface (shift-chat archive requires senior_technician+, shift-chat.ts:557), not part of the iPhone reviewer path — very unlikely to be App-Review-visible. Known deferred issue.
- **Evidence:** artifacts/flow-walk/web-matrix.json (generatedAt 2026-07-18T10:19:08.585Z, target http://127.0.0.1:5000) rows at lines 365 and 1266, verbatim: {rowId:'shift-chat', group:'core', path:'/shift-chat/943a335b-31ec-4843-86ae-aa3b3254d47d', platform:'web', role:'admin' | 'senior_technician', expected:'render', actual:'render', status:'degraded', finalUrl:same path, consoleErrors:['Failed to load resource: the server responded with a status of 404 (Not Found)'], failedRequests:['404 http://127.0.0.1:5000/api/shift-chat/archive/943a335b-31ec-4843-86ae-aa3b3254d47d'], notes:'rendered with 1 console error(s)', screenshots: artifacts/flow-walk/screenshots/web__core__shift-chat__admin.png and web__core__shift-chat__senior_technician.png}. 404 origin read at server/routes/shift-chat.ts:615-617 (no vt_shift_sessions row for the id → 404 SHIFT_NOT_FOUND). Identical two rows (same rowId/roles/404) were the only non-pass rows in the 2026-07-16 baseline matrix.
- **Verification:** unverified (low — not sent to verification)


## Board (/board Command Center kiosk)

### BOARD-1 · 🟠 MODERATE — auth-routing

**`src/app/routes.tsx:114`** — Display pairing dead-ends in Clerk builds: after a successful /board/pair claim, the client-side navigate to /board renders a stale AuthGuard-wrapped branch (isDisplayPaired read once at AppRoutes render), redirecting the freshly-paired headless display to /signin until a manual page reload.

- **Failure scenario:** Production (Clerk) build, headless TV: operator opens /board/pair, enters a valid code, claim succeeds, token is stored, navigate("/board") fires (board-pair.tsx:48). AppRoutes never re-renders — it is a referentially-stable child of PlatformRouter (App.tsx:38-40) and calls no location hook — so wouter's Switch matches the /board Route whose children were baked with isDisplayPaired=false, i.e. <AuthGuard><CommandBoardScreen/></AuthGuard>. AuthGuard sees no Clerk user and renders <Redirect to="/signin"/> (AuthGuard.tsx:122). The wall display lands on the sign-in page it cannot complete; pairing appears to have failed. Recovery only via manual reload of /board (fresh AppRoutes render reads the stored token). Invisible on the dev-bypass walk server because AuthGuard passes there.
- **Evidence:** routes.tsx:114 `const isDisplayPaired = hasStoredDisplayToken();` is a plain read during AppRoutes render; routes.tsx:143-147 bakes the ternary into Route children; board-pair.tsx:47-49 onSuccess = setStoredDisplayToken + wouter navigate (no full-page load); AuthGuard.tsx:122 `if (!isSignedIn) return <Redirect to="/signin" replace />;`. tests/board-pair.test.tsx only asserts the memory-location path becomes /board (line 91) — it renders BoardPairPage in isolation and never exercises the AppRoutes-level handoff.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### BOARD-2 · 🟡 LOW — error-states

**`src/pages/board-pair.tsx:127`** — All pairing-claim failures (invalid code, expired code, 429 rate-limit, 500, network timeout) collapse to one generic message — a rate-limited operator is told the code is bad and may burn additional valid codes.

- **Failure scenario:** Operator fat-fingers a code 5 times in a minute → authSensitiveLimiter (server/routes/display.ts:710, 5/min per IP) returns 429 → the UI shows t.boardPair.error ("That code didn't work. Ask an admin for a new one.") → admin issues a fresh code → still 429 → repeat. No dead end (form stays usable, 15s AbortController in claimDisplayPairing prevents a stuck spinner), but the copy misdirects.
- **Evidence:** board-pair.tsx:126-130 renders the single t.boardPair.error string for any mutation.isError; server distinguishes INVALID_PAIRING_CODE (400, display.ts:417-425) from rate-limit and INTERNAL_ERROR (display.ts:452-459) but the client discards the code. Live-verified: POST /api/display/pair/claim with code ZZZZZZZZ → 400 {"code":"INVALID_PAIRING_CODE","reason":"INVALID_OR_EXPIRED_PAIRING_CODE"}.
- **Verification:** unverified (low — not sent to verification)

### BOARD-3 · 🟡 LOW — navigation

**`src/app/routes.tsx:145`** — /board hardcodes kioskMode for every visitor, so a signed-in user who follows the legacy /equipment/board redirect loses the exit button that route used to show without ?kiosk=1, and BoardShell additionally force-fullscreens on their first click.

- **Failure scenario:** A lead technician on a tablet PWA (standalone, no browser chrome) taps a bookmark to /equipment/board → RedirectPreserveSearch to /board (routes.tsx:138) → kioskMode is passed unconditionally (routes.tsx:145-146) → CommandBoard hides the exit button (CommandBoard.tsx:468 `{!kioskMode && <button …board-exit…>}`) and the first tap triggers document.documentElement.requestFullscreen (BoardShell.tsx:54-71). With no browser back UI in a standalone PWA the user is trapped on the board without an in-app way out.
- **Evidence:** routes.tsx:145-146 passes kioskMode in both paired and AuthGuard branches; CommandBoardScreen.tsx:72 `kioskModeProp ?? kioskModeFromUrl` means the prop always wins on /board; CommandBoard.tsx:411-414 + 467-481 gate the only exit affordance on !kioskMode. The pre-Phase-10 /equipment/board mount left kioskMode undefined so non-?kiosk=1 visitors got the exit button (CommandBoardScreen.tsx:12-14 comment).
- **Verification:** unverified (low — not sent to verification)

### BOARD-4 · 🟡 LOW — rtl-i18n

**`src/features/command-board/components/CommandBoard.tsx:434`** — Board surfaces hardcode dir="rtl" (CommandBoard, PressureMain, loading skeleton, fallback pane, CodeBlueOverlay) while the sibling /board/pair screen is locale-aware via useDirection — an English-locale clinic gets English copy laid out RTL on the kiosk.

- **Failure scenario:** Clinic with preferred_locale=en opens /board: t.board.* resolves English strings but the root div stays dir="rtl" (CommandBoard.tsx:434), so header order, ms-auto margins, and text alignment render mirrored around English copy; the pairing screen one route away renders LTR (board-pair.tsx:62 uses useDirection()), an inconsistent pair on the same physical device.
- **Evidence:** Hardcoded dir="rtl": CommandBoard.tsx:434 and :350 (PressureMain), CommandBoardScreen.tsx:148 (skeleton) and :188 (fallback pane), CodeBlueOverlay.tsx:44. Locale-aware: board-pair.tsx:19 imports useDirection, :62 `dir={dir}`. Behavior is a verbatim relocation of the Hebrew-first WardDisplayPage, so likely deliberate for the primary deployment, but the inconsistency with /board/pair is real.
- **Verification:** unverified (low — not sent to verification)

### BOARD-5 · 🟡 LOW — layout-overflow

**`src/features/command-board/components/CodeBlueOverlay.tsx:69`** — FLAG-ONLY (frozen Code Blue wall surface): inside BoardShell's fixed inset-0 overflow-hidden host, the CodeBlueOverlay's three columns have no internal scroll, so on low-height wall displays the bottom (newest) timeline entries and long linked-equipment lists clip silently with no way to reach them.

- **Failure scenario:** 720p wall TV during an active Code Blue with 15 timeline entries plus a tall header (many presence chips wrapping): the body row is sized to the viewport remainder, columns overflow visibly, and BoardShell's overflow-hidden (BoardShell.tsx:86) clips everything past the fold — the newest log lines (rendered last by `session.logEntries.slice(-15)`, CodeBlueOverlay.tsx:41) are the ones hidden. Pre-BoardShell, the /display document could scroll; under the kiosk host nothing can. Calm/pressure modes are unaffected (their <main> has overflow-auto, CommandBoard.tsx:497/351).
- **Evidence:** BoardShell.tsx:86 `fixed inset-0 h-full w-full overflow-hidden`; CodeBlueOverlay.tsx:44 root `flex flex-col min-h-screen`, :69 body `flex flex-1 divide-x` with columns at :71/:89/:112 having no overflow-auto; :41 slice(-15) puts newest entries at the clipped bottom. Frozen surface — reporting proximity only, no change proposed.
- **Verification:** unverified (low — not sent to verification)

### BOARD-6 · 🟡 LOW — frozen-surface-proximity

**`src/board/BoardShell.tsx:50`** — FLAG-ONLY: BoardShell mounts the R-RTC-1.3 socket.io co-presence channel (useBoardCoPresence) — a second realtime transport running adjacent to the frozen SSE/outbox path on the board surface; doctrine says no parallel realtime path, and the code asserts this one is a sanctioned distinct ephemeral+advisory channel.

- **Failure scenario:** Not a defect today: the channel never gates board rendering, degrades to a null socket when no bearer token exists (collab-socket.ts:150-152 — a paired display has no Clerk token, so the kiosk never even opens the socket), and CommandBoardScreen's SSE/snapshot/keepalive path is untouched. Flagged because any future change that lets co-presence state influence snapshot/keepalive reconciliation, or that runs the infinite-reconnect socket loop on a token-less display, would erode the frozen envelope.
- **Evidence:** BoardShell.tsx:18-24 + 45-50 documents and mounts useBoardCoPresence; the frozen SSE path stays solely owned by CommandBoardScreen (CommandBoardScreen.tsx:79-96 connectRealtime/replay, :102 heartbeat, :109-112 keepalive reconciliation — all canonical hooks). useBoardAutoReload reads the snapshot cache read-only and defers reload until the server snapshot drops codeBlueSession (useBoardAutoReload.ts:63-70, 123-130) — consistent with 'no optimistic local termination'.
- **Verification:** unverified (low — not sent to verification)


## Cross-flow

### CROSS-FLOW-1 · 🔴 CRITICAL — account-deletion-unreachable-for-new-accounts

**`server/middleware/auth.ts:460`** — A freshly created Sign-in-with-Apple account lands status 'pending' and can neither reach nor invoke in-app account deletion: strict requireAuth returns 403 ACCOUNT_PENDING_APPROVAL before the delete-account handler runs, and the AuthGuard pending screen offers only a sign-out button — the exact deletion test path advertised in the App Review notes dead-ends.

- **Failure scenario:** App Reviewer follows the runbook §E/§K notes ('To test account deletion, sign in with a personal Apple ID, then Settings → Danger zone → Delete account'): the new Apple account bootstraps with defaultStatus='pending' (non-admin email), AuthGuard renders the pending screen (sign-out only) on every route including /settings, and even a direct DELETE /api/users/delete-account returns 403 ACCOUNT_PENDING_APPROVAL. The account created in-app cannot be deleted in-app → Guideline 5.1.1(v) re-rejection risk.
- **Evidence:** auth.ts:459-461 `const adminEmail = clerkEmail ? isAdminEmail(clerkEmail) : false; const defaultStatus = adminEmail ? "active" : "pending";` — new non-ADMIN_EMAILS accounts are pending. auth.ts:633-659: `if (result.user.status === "pending") { ... return res.status(403).json({...buildAccessDeniedBody("ACCOUNT_PENDING_APPROVAL", ...)}) }` runs before next(). server/routes/users.ts:1355 `router.delete("/delete-account", requireAuth, authSensitiveLimiter, ...)` uses that strict middleware (requireAuthAny, which admits pending users, is used only for PATCH /:id/display_name at users.ts:643). src/features/auth/components/AuthGuard.tsx:124-129: pending state renders only `<Button ... onClick={signOut}>` — no deletion affordance, and /settings (routes.tsx:225) is behind this AuthGuard. RESUBMISSION_RUNBOOK.md:145 documents the personal-Apple-ID deletion test path given to Apple.
- **Verification:** **CONFIRMED** (adversarial verifier; severity critical)
- **Verifier reasoning:** Every cited particular verified against the actual files. (1) server/middleware/auth.ts:459-461 bootstraps any non-ADMIN_EMAILS account as status='pending' (allowlist is env-only, server/lib/admin-email-allowlist.ts — a personal/private-relay Apple ID is never on it). (2) Strict requireAuth (auth.ts:633-659) returns 403 ACCOUNT_PENDING_APPROVAL before next(), and DELETE /api/users/delete-account (server/routes/users.ts:1355) uses that strict middleware — the pending-admitting requireAuthAny is wired only to PATCH /:id/display_name (users.ts:643). So a direct API deletion attempt by a pending account 403s. (3) Client-side, the only deletion affordance is delete-account-dialog.tsx reached from /settings, which sits behind AuthGuard (src/app/routes.tsx:225); AuthGuard.tsx:124-130 renders the pending state with a sign-out button only, and use-auth.tsx maps the 403 ACCOUNT_PENDING_APPROVAL to status='pending'. (4) RESUBMISSION_RUNBOOK.md:145 and §K:212-218 advertise to Apple exactly this dead-end path ('sign in with a personal Apple ID, then Settings → Danger zone → Delete account') and require a screen recording of it. (5) tests/signup-flow.spec.ts T4/T5 confirm pending-then-403 is the designed flow for new non-admin signups, not a misreading. Nuance: a truly fresh Apple ID with no Clerk org membership may dead-end even earlier at MISSING_CLINIC_ID (auth.ts:397-403) depending on production Clerk org-enrollment config (unverifiable from repo), but that equally makes the advertised deletion path unreachable — substance unchanged. On severity: git history shows the pending gate (2026-04) predates the deletion feature (2026-06-17) and Apple did approve build 20 with this behavior, so rejection is probabilistic, not certain. Critical is still right for a pre-resubmission gate: the review notes hand Apple a test script that provably 403s for any freshly created account, the §K recording cannot be produced with a genuinely fresh Apple ID, and real self-serve pending users cannot delete their in-app-created account — a live Guideline 5.1.1(v) compliance gap affecting real users, not just reviewers.

### CROSS-FLOW-2 · 🟠 MODERATE — navigation-dead-affordance

**`src/app/routes.tsx:145`** — The canonical /board route mounts <CommandBoardScreen kioskMode /> unconditionally, so the board's operator exit button can never render on any path — a desktop admin who clicks the Topbar 'Board' nav item is dropped into a full-bleed dark kiosk with no in-app way back (browser Back only).

- **Failure scenario:** Admin on vettrack.uk desktop clicks 'Board' in the Topbar → /equipment/board → RedirectPreserveSearch → /board → BoardShell kiosk. CommandBoard.tsx:414 computes kioskMode = kioskModeProp ?? url, and the prop is hardcoded true for both the display-paired and AuthGuard branches (routes.tsx:144-146), so the `{!kioskMode && <button data-testid="board-exit">}` block (CommandBoard.tsx:468-481) is dead code; the routes.tsx:137 comment '?kiosk=1 preserved' is inert because the query param no longer changes anything. A reviewer or manager exploring the web console appears trapped in the kiosk.
- **Evidence:** Read src/app/routes.tsx:143-147 (both branches pass kioskMode boolean-shorthand true); src/features/command-board/components/CommandBoard.tsx:411-414 ('The /board route passes kioskMode explicitly; it wins over the URL read') and :467-481 (exit button gated on !kioskMode); src/features/command-board/CommandBoardScreen.tsx:66-72 (same precedence). Fresh walk matrix board-kiosk rows (artifacts/flow-walk/web-matrix.json, 2026-07-18T10:19Z) show every role lands in kiosk mode at /board. Flag-only proximity: the board consumes the frozen SSE /api/display/snapshot contracts — no change to those surfaces is implied; the defect is purely the client exit-affordance wiring.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### CROSS-FLOW-3 · 🟠 MODERATE — anonymize-tombstone-pii-residue

**`server/services/account-deletion.service.ts:107`** — The anonymize fallback (taken whenever RESTRICT FKs block a hard delete, i.e. for any user with operational history) strips email/name/displayName but leaves vetLicenseNumber and avatarUrl on the tombstone row, contradicting the service's own 'the PII is gone either way' contract and the deletion representation given to Apple.

- **Failure scenario:** A vet who signed up with a license number (vt_users.vet_license_number) and has scan/audit history deletes their account: eraseUserData hits a 23503 FK violation, anonymizeUser rewrites email/name/displayName/status only, and the personal license number plus the avatar URL persist indefinitely in vt_users. Not reviewer-visible, but a real gap in the 5.1.1(v) 'deletes the account and personal data' promise (docs/account-deletion.md:26-30).
- **Evidence:** account-deletion.service.ts:100-116 — the update .set() covers exactly {email, name, displayName, status, deletedAt, deletedBy}; server/schema/core.ts shows vt_users also carries `vetLicenseNumber: varchar("vet_license_number")` (documented as a personal verification artifact) and `avatarUrl: text("avatar_url")`, neither touched. Service header comment lines 7-9: 'otherwise anonymize + soft-delete as a tombstone ... either way the PII is gone' — inaccurate for these two columns.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### CROSS-FLOW-4 · 🟠 MODERATE — push-vapid-buildtime-precedence

**`src/hooks/use-push-notifications.tsx:188`** — Client prefers a build-time VITE_VAPID_PUBLIC_KEY over the server's runtime key (`import.meta.env.VITE_VAPID_PUBLIC_KEY || await getVapidPublicKey()`, also lines 86-89), and .env.example:122 ships a literal sample key — any build that bakes it subscribes against a key the server cannot sign for, triggering the same silent 403→delete loop.

- **Failure scenario:** Someone copies .env.example to .env (or CI/.env.local gains VITE_VAPID_PUBLIC_KEY). Vite auto-loads .env/.env.local during `pnpm exec vite build`, so both the web build AND the native-shell build bake the key — scripts/lib/native-shell-env.sh:23-24 allowlists only VITE_CLERK_PUBLISHABLE_KEY + VITE_API_ORIGIN and does NOT prevent vite from picking up other VITE_ vars (build-native-shell.sh:51-53 passes env additively). Baked key != server key (live server key BHBbhUP8… differs from the sample BLboFm…): pushManager.subscribe succeeds, POST /api/push/subscribe stores it, every send fails 403 and the row is deleted. Currently NOT baked (.env verified to contain only the two allowlisted keys), so latent — but it is the canonical "VAPID bug" arming mechanism.
- **Evidence:** Read src/hooks/use-push-notifications.tsx:85-94,188; .env.example:122 (sample key BLboFm_5c43…); grep of .env/.env.local key names shows no VITE_VAPID_PUBLIC_KEY today; scripts/build-native-shell.sh:51-53 and scripts/lib/native-shell-env.sh:14-42 (two-var allowlist only); live curl returned a different key (BHBbhUP8…), proving a baked sample would mismatch.
- **Verification:** **CONFIRMED** (adversarial verifier; severity moderate)

### CROSS-FLOW-5 · 🟡 LOW — i18n-hardcoded-copy

**`src/pages/rooms-list.tsx:382`** — Hardcoded English strings in the rooms list (which is the iPad master pane): empty-state hint, 'Add First Room', 'No rooms in {zone}', 'Show all rooms' — rendered untranslated in the Hebrew-default app.

- **Failure scenario:** Hebrew-locale user (default) on iPad or iPhone opens Rooms with no rooms created, or zone-filters to an empty zone: mixed Hebrew UI with raw English sentences. The i18n guard test only rejects Hebrew-in-source (tests/i18n-no-hebrew-in-source.test.ts per CLAUDE.md), so English strings slip through the 'no hardcoded copy in source' rule.
- **Evidence:** rooms-list.tsx:382 `"No rooms have been created yet. Ask an admin to set them up."`, :388 `Add First Room`, :402 `No rooms in {roomZoneLabels[activeZone]}`, :404 `Show all rooms` — all sibling strings on the same screen use t.roomsListPage.* (:378, :381).
- **Verification:** unverified (low — not sent to verification)

### CROSS-FLOW-6 · 🟡 LOW — protected-list-env-override-replaces-default

**`server/services/account-deletion.service.ts:38`** — ACCOUNT_DELETION_PROTECTED_EMAILS replaces (does not merge with) the built-in reviewer@vettrack.uk default, so setting the Railway var without re-listing the demo email silently makes the App Review demo account self-deletable mid-review.

- **Failure scenario:** An operator sets ACCOUNT_DELETION_PROTECTED_EMAILS='someother@clinic.com' on Railway to protect an additional account: protectedDeletionEmails() returns only that list, isAccountDeletionProtected('reviewer@vettrack.uk') → false, and a reviewer poking the Danger zone on the demo account hard-deletes it — demo login then fails for the rest of the review (2.1 rejection pattern).
- **Evidence:** account-deletion.service.ts:37-44: `const raw = process.env.ACCOUNT_DELETION_PROTECTED_EMAILS?.trim(); if (!raw) return DEFAULT_PROTECTED_EMAILS; return raw.split(",")...` — env value fully replaces DEFAULT_PROTECTED_EMAILS (line 28). docs/account-deletion.md:59-60 frames this as 'Override the list', so it is by-design but remains a one-env-var-from-unprotected hazard; nothing in scripts/verify-resubmission.sh checks it.
- **Verification:** unverified (low — not sent to verification)


## Final QA rows

| Flow | Screenshot | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| iPhone | code-audit — no screenshot (artifacts/flow-walk/screenshots contains only web-matrix captures; no native/iPhone set) | Every route reachable in the phone shell (tab bar / MoreSheet / in-page links) or cleanly web-only with a working native fallback; no dead links or back-button traps; /display + /equipment/board redirect to /board; scan/NFC deep links handled incl. cold launch; all lazy routes inside error boundarie | Navigation graph verified sound: nav-model hrefs all resolve, aliases redirect (incl. /display & /equipment/board → /board with search preserved, T-38 ordering correct), deep links covered (vettrack://scan, universal equipment links, cold launch; oauth-callback correctly left to native-oauth per §F), WebOnlyGuard native fallbacks work, /handoff has the deep-link back fallback, boundaries stacked ( | **PASS-WITH-NOTES** |
| iPad | code-audit — no screenshot | iPad native tablet (useIsNativeTablet): combined /equipment/:id?, /rooms\|locations/:id?, /inventory-items/:id? render a persistent master pane with swappable detail; deep-link /equipment/<uuid> shows BOTH panes; bare path shows placeholder; /display + /equipment/board redirect to /board; sidebar na | Structure verified in code: deep-link renders both panes (EquipmentMasterDetail.tsx:32-34), master stays mounted detail-to-detail (routes.tsx:161-162), ?scan=1/?status= deep-links honored, /display + /equipment/board are RedirectPreserveSearch to /board (routes.tsx:167,138), sidebar rows 52px with logical properties (NativeTabSidebar.tsx:42,124). 3 moderate defects: (1) equipment URL-filter/select | **PASS-WITH-NOTES** |
| Website | artifacts/flow-walk/screenshots/web__core__home__admin.png | Desktop web (vettrack.uk): every routes.tsx route reachable for admin with Topbar NAV + Management dropdown links all resolving; non-management roles (vet/technician/student) fully walled by ManagementWebGate; marketing paths (/signin /signup /privacy /terms /support) public; /display + /equipment/b | Code audit + fresh 2026-07-18 walk matrix (147 rows: 145 pass, 0 broken, 2 known-degraded shift-chat archive 404) confirm all of the above: all 17 NAV/12 management hrefs map to declared routes; ManagementWebGate fires after every AuthGuard clause (AuthGuard.tsx:174) and walk shows management-web-gate for student/technician/vet on all desktop routes; redirects verified in code + matrix; loop guard | **PASS-WITH-NOTES** |
| Board | artifacts/flow-walk/screenshots/board__web-only__board-kiosk__admin.png | /board renders the BoardShell kiosk (dark full-bleed RTL, no app chrome, live snapshot + SSE); /display, /equipment/board, /equipment-board redirect into it preserving ?kiosk=1; coarse-pointer TV browsers resolve the board target before touch-narrow; crashes show a dark auto-recovering panel (never  | Kiosk renders green (2026-07-18 flow-walk screenshot, all 5 roles); redirects confirmed at routes.tsx:138/167/168; resolver ordering confirmed (platform/index.ts:104-108); BoardErrorBoundary gives dark reconnecting panel + bounded auto-reset + storm reload, and auto-reload defers during Code Blue (tests/board-auto-reload.test.ts). Live probe: invalid pairing code returns 400 INVALID_PAIRING_CODE w | **PASS-WITH-NOTES** |
| SIWA §F chain | code-audit — no screenshot | All six §F Sign-in-with-Apple fixes present and unweakened: (1) system-browser OAuth in native-oauth.ts; (2) _is_native=1 + Authorization-header client-JWT transport in clerk-native-instance.ts; (3) allowedRedirectProtocols [capacitor:, vettrack:]; (4) standardBrowser:false on native; (5) Clerk-prop | All six items verified intact at exact lines (native-oauth.ts:69/164/176; clerk-native-instance.ts:47-62; clerk-capacitor-config.ts:61/62/6-11; main.tsx:242-254 + clerk-locale-bridge.tsx:45; server/index.ts:114-118/182-191/301). clerk-js pinned exact 5.125.13 everywhere, touched only by the original fix commit. Full git-history sweep of every chain file: all post-fix diffs read and benign (key-cen | **PASS-WITH-NOTES** |
| Deletion + demo | code-audit — no screenshot | In-app deletion chain complete (403 guard for demo account, Apple revoke → DB erase → Clerk delete → audit), reachable in documented steps on iPhone/iPad/website with no board surface; demo account guaranteed admin+en; reviewer-facing hot queries clinic-scoped. | Guard, deletion chain, audit kinds, board-surface absence, /display + /equipment/board redirects, and clinicId filters on equipment list / board snapshot / tasks all verified in code. FAILS on two demo-readiness gaps: (1) a fresh Sign-in-with-Apple account lands status 'pending' and cannot reach or call deletion (AuthGuard pending screen has sign-out only; API 403 ACCOUNT_PENDING_APPROVAL) — the e | **FAIL** |
| Push/VAPID | code-audit — no screenshot (live evidence: curl GET http://127.0.0.1:3001/api/push/vapid-public-key → HTTP 200 {"publicK | One consistent VAPID key end-to-end: client fetches the server key, subscribes, server-signed pushes deliver; native flows either support push (APNs) or degrade explicitly; board unaffected. | Website: chain green against the walk server (200, DB-generated key); 503 PUSH_NOT_CONFIGURED surfaces as hardcoded English "Failed to fetch VAPID key", NOT as the "Service worker initialization timed out" activation error (distinct failure). iPhone/iPad: VAPID chain unreachable — no APNs plugin, WKWebView feature-detect hides the whole Settings push section, yet Help + privacy copy still advertis | **PASS-WITH-NOTES** |
| Live walk | artifacts/flow-walk/web-matrix.json | pnpm test:playwright:flow-walk (PW_SUITE=flow-walk) against the already-running dev-bypass walk server walks all web + board + marketing rows across 5 role archetypes with 0 broken rows; /display, /equipment/board, /equipment-board redirect to the canonical /board kiosk; marketing (/signin, /signup, | Suite ran clean: 6/6 Playwright tests passed, exit 0, 2.0m. Fresh matrix 2026-07-18T10:19:08Z: total 147 / pass 145 / broken 0 / degraded 2 / observe 0 / unreachable 0. All board rows passed incl. board-kiosk (/board), board-alias-redirect (/equipment/board, /display, /equipment-board → /board; redirects also code-verified at src/app/routes.tsx:138,167,168), emergency-wall, and all marketing rows. | **PASS-WITH-NOTES** |

## Owner-run verification checklist (credentialed — not attempted by the audit)

### iPhone

Needs OWNER credentials / device to verify live (not attempted per instructions): (1) RESUBMISSION_RUNBOOK §C pre-archive checks — demo login must return LOGIN: complete (Client Trust re-enable is the §G HIGH risk), redirect-URL + allowed-origins checks, icon alpha check, build-number gate — all require CLERK_SECRET_KEY + REVIEWER_PASSWORD. (2) On-device confirmation of the two moderate findings on the bundled shell (iOS Simulator/device): /handoff status-bar overlap with an active roster shift, and actual window.open behavior for 'Print QR' inside WKWebView (code guarantees it cannot succeed, but whether it no-ops or reloads the app to /home needs device observation). (3) §F native-OAuth chain proximity: all findings are outside the frozen chain; deep-link-router.ts:58-66 correctly no-ops vettrack://oauth-callback so native-oauth.ts keeps sole ownership of the nonce — flagged as intact, no changes proposed. (4) Frozen-surface proximity flags only: the code-blue.tsx border finding is cosmetic CSS on the Code Blue surface, and the /board finding touches the CommandBoardScreen SSE host — both reported without proposing contract changes. (5) No native flow-walk screenshot evidence exists under artifacts/ (only web captures); the 2026-07-16 native walk (68/68 green per project memory) stored its evidence elsewhere — consider copying it into artifacts/ before Final QA. (6) Live walk server verified healthy read-only (GET /api/health: db/clerk/vapid ok; Vite serving /board and /handoff)."

### iPad

Owner-verification needed (cannot be done from the dev-bypass browser walk server): useIsNativeTablet requires capacitorPlatform() !== \"web\", so NO browser can exercise the tablet route set — there is zero iPad evidence in artifacts/ (artifacts/flow-walk has web-matrix + iPhone screenshots only). Before archiving, run an iPad simulator smoke (scripts/install-ios-sim.sh against an iPad Air 11-inch target, per RESUBMISSION_RUNBOOK §C): (a) portrait orientation with an equipment detail open — confirm the ~220px detail pane is acceptable or ship a masterWidth clamp first; (b) filter chip -> tap row -> observe the filter reset (finding 1); (c) on iPad mini sim, rotate landscape->portrait at /equipment/<id> to observe the shell/route flip. The simulator native shell talks to production Clerk (bundled build) — signing in there needs the owner's reviewer@vettrack.uk credentials from the password manager (per runbook §C/§E; I attempted no credentialed login). Frozen-surface proximity: none — the tablet flow touches no SSE/outbox, Code Blue, vt_appointments internals, or native-OAuth chain code; /equipment/tasks stays the canonical alias with the frozen appointmentsPage.* namespace untouched. Stale doc note (not filed as a finding): useIsNativeTablet.ts:9-10 cites a \"global chat mount in main.tsx\" consumer that no longer exists (main.tsx:47-49 gates the chat FAB on platform target instead).

### Website

Needs OWNER credentials / production session to verify (not attempted from here): (1) RESUBMISSION_RUNBOOK §C pre-archive block — demo reviewer@vettrack.uk password login must return LOGIN: complete (Client Trust §G re-enable is the #1 re-rejection risk; needs CLERK_SECRET_KEY + REVIEWER_PASSWORD). (2) Production auth gates in Clerk mode: the walk server runs dev-bypass, so every request resolves DEV_USER — e.g. GET /api/display/snapshot returned 200 unauthenticated locally, which is expected in dev-bypass but says nothing about the production 401 contract (FLOW_MATRIX DISP-01); a signed-out curl of https://vettrack.uk/api/display/snapshot and /api/users/me should be run with/without a real session to confirm 401s. (3) ManagementWebGate against real Clerk-role accounts on vettrack.uk (walk evidence is dev-bypass role-override only). Verified read-only from here: production /, /signin, /privacy, /terms, /support, /board all 200 and the prod bundle embeds pk_live_ for clerk.vettrack.uk (dev-bypass impossible: client force-bypass flag is DEV-gated in auth-fetch.ts:35-45, server honors x-dev-role-override only when isDevelopment && dev-bypass in server/middleware/auth.ts:310-325, and STABILITY_TOKEN is per-process random + loopback-gated in production). Frozen-surface proximity (flag-only, no changes proposed): /board consumes the frozen SSE/outbox + /api/display/snapshot emergency-denylist contracts; /equipment/tasks mounts the sanctioned src/pages/Tasks.tsx rename with /appointments alias redirect and appointmentsPage.* namespace untouched. Skills used: audit (structured audit protocol); findings each verified against read file+line.

### Board

OWNER-CREDENTIAL VERIFICATIONS NEEDED: (1) Finding 1 (pairing handoff → /signin) only manifests in Clerk builds — the dev-bypass walk server masks it because AuthGuard passes for the hardcoded dev user. To confirm live: on production (vettrack.uk, Clerk mode), issue a pairing code from /admin/displays, claim it on a signed-out browser at /board/pair, and observe whether the immediate client-side handoff lands on the kiosk or on /signin (then confirm a manual reload of /board recovers). (2) Displays console pair-issue path (POST /api/display/pair/issue) requires a production admin session — not exercised here. FROZEN-SURFACE NOTE: everything under findings 5 and 6 is flag-only proximity reporting per instructions — the board's SSE/snapshot/keepalive usage is the canonical frozen path and was verified consistent (server-confirmed Code Blue end, reload deferred until snapshot calm, no polling fallback, display-token SSE is an additive fetch-reader on the same /api/realtime/stream). App-Review relevance: none of these findings are reviewer-reachable (the board is a browser/kiosk surface; Capacitor-native at /board resolves to the mobile shell), so nothing here blocks resubmission on its own.

### SIWA §F chain

Needs OWNER credentials / device to close out (I attempted no credentialed logins): (1) Run the full §C pre-archive block with CLERK_SECRET_KEY + REVIEWER_PASSWORD — especially the demo-login `LOGIN: complete` check and the Clerk dashboard Client Trust status (§G names re-enablement the #1 re-rejection watch item; only the dashboard/Backend API can confirm it, not the repo). (2) Because @clerk/express went 1.7.77 -> 2.1.41 on 2026-07-14 (moderate finding), device-confirm one full production Apple sign-in from the bundled shell INCLUDING the post-sign-in /api round-trip (e.g. reviewer lands on the app shell with data, not just the OAuth completion) — the 2026-07-16 flow walks ran dev-bypass and never exercised clerkMiddleware v2. (3) §C's [2.1a] Backend-API checks (redirect URL vettrack://oauth-callback allowlisted; instance allowed_origins contains capacitor://localhost) are dashboard state — §F item 6's server half is verified in code, but the Clerk-side half is only verifiable with the secret key. (4) Before archiving, run `pnpm resubmit` (build 25 == last-shipped 25, gate will otherwise fail). Chain is FROZEN — every finding above is flag-only; no fixes were made and none should be applied to §F code without re-running the §C device confirmation.

### Deletion + demo

OWNER-RUN (needs credentials — not attempted here): (1) §C demo-login curl must print 'LOGIN: complete' with REVIEWER_PASSWORD exported, and Clerk → Configure → Updates must show Client Trust reverted, not on a 24h timer (RESUBMISSION_RUNBOOK.md §C:67-78, §G:161). (2) Prod DB: confirm vt_users row for reviewer@vettrack.uk has role='admin' and status='active' (code guarantees persistence once set — auth.ts:472-500 onConflictDoUpdate excludes role — but the initial promotion was manual; note preferred_locale='en' does NOT drive the UI language, see moderate finding). (3) Railway: confirm ACCOUNT_DELETION_PROTECTED_EMAILS is unset or includes reviewer@vettrack.uk (env value REPLACES the default list), and that all four APPLE_* revocation vars are set — isAppleRevocationConfigured() silently no-ops revocation otherwise (server/lib/apple-auth.ts:47). (4) The §K live 403 check (DELETE https://vettrack.uk/api/users/delete-account with a reviewer session JWT → 403) requires minting a reviewer session; scripts/verify-resubmission.sh has NO delete-account/role/locale gates, so this stays manual. FLAG-ONLY proximity (no changes proposed): the deletion flow depends on the frozen §F native-OAuth chain (Apple authorizationCode capture via src/lib/native-apple-link.ts from native-social-buttons.tsx feeding POST /api/users/apple-link) and on the closed AuditActionType union (all four deletion audit kinds already members, server/lib/audit.ts:16-19). The critical pending-account finding needs an OWNER DECISION on remedy (e.g. approve-then-delete guidance in App Review notes vs allowing pending self-deletion) — deliberately not proposed here since requireAuth semantics border the frozen auth contract. Dev walk server used read-only (GET /api/health, GET /api/users/me); the DELETE endpoint was NOT exercised against the live dev DB (it would erase the dev-bypass user row — dev-admin-001 is not in the protected list).

### Push/VAPID

OWNER-credential verification needed (not attempted): (1) On Railway (VetTrack + Worker services) check whether VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set — the dangerous state is public-set-without-private (server/lib/push.ts:70 vs :22); either set BOTH or NEITHER, and confirm GET https://vettrack.uk/api/push/vapid-public-key matches the pair that actually signs (compare with the vt_server_config vapid_public_key row in prod DB). (2) Signed-in production web: enable push, then Settings → Send test — if it 409s (PUSH_SUBSCRIPTION_NOT_FOUND) right after enabling, the key-mismatch loop is live in prod. (3) Real-device iPhone check that Settings shows no push section (WKWebView feature-detect) — I verified only by code + platform semantics, no simulator run. Frozen-surface proximity (FLAG-ONLY, no changes proposed): server/lib/push.ts writes NOTIFICATION_SENT/NOTIFICATION_FAILED through insertRealtimeDomainEvent into vt_event_outbox (lines 245-249, 267-273) — any push fix must leave the outbox/SSE contract untouched; likewise the hook's SW interaction sits next to the frozen __VT_BUILD_TAG__ cache-name contract (public/sw.js), and nothing here touches the §F native-OAuth chain. Board context confirmed per terminology brief: /board renders BoardShell→CommandBoardScreen; /display (src/app/routes.tsx:167) and /equipment/board (:138) are RedirectPreserveSearch redirects, and a paired display has no Clerk user (:111-113), so the push hook (sole consumer: src/pages/settings.tsx:77) cannot mount in the board flow. Docs cross-check: RESUBMISSION_RUNBOOK.md §§A/C/F/G/H and FLOW_MATRIX.md §§1/8 contain no push/VAPID item — the push bug is not on the rejection-item chain; docs/archive/2026/production-overhaul-report.md:27,36 recorded prod VAPID as PASS (200) at last audit.

### Live walk

Owner-credential items this walk CANNOT cover (dev-bypass only, per instructions no credentialed logins attempted): (1) RESUBMISSION_RUNBOOK §C [2.1] demo login must report 'LOGIN: complete' against production Clerk — needs REVIEWER_PASSWORD; 'needs_client_trust' would mean Client Trust re-enabled (§G HIGH risk, the 24h dashboard revert). (2) §C [2.1a] Clerk config gating Apple sign-up (both EXPECT: True checks) — needs Clerk dashboard/API access. (3) Production legal pages /privacy /terms /support on https://vettrack.uk after deploy (walk verified them only on the local walk server). (4) §K demo-account deletion protection (403 ACCOUNT_DELETION_PROTECTED) needs a reviewer-session JWT. (5) Real /board/pair device-token redemption against production (walk exercised render only). Frozen-surface proximity (FLAG-ONLY, no change proposed): the walked board rows touch the SSE /api/realtime/stream + /api/display/snapshot emergency cache-denylist surfaces and /code-blue/display — all rendered pass under the frozen contract; nothing in this walk modifies them. Run log: /tmp/flow-walk-run.log (EXIT=0). Suite: tests/flow-walk/web-board-walk.spec.ts via playwright.shared.ts 'flow-walk' allowlist.
