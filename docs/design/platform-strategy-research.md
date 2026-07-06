# Platform-Strategy Research + Per-Phase Execution Playbooks (Phase R.2 + R.3)

> **Produced 2026-07-06** by Phase R of the VetTrack program (`here-is-a-draft-wise-thimble.md`).
> **R.2** = platform-strategy findings across six topics, each with cited references and concrete "copy this" examples.
> **R.3** = one actionable playbook per downstream phase (0–10): validated approach · 2–3 real-team pitfalls + avoidance · references to copy · what NOT to do.
> Every claim carries a source URL. Findings that would contradict Part I.4 or the Frozen list are omitted (none arose). Companion: `plan-validation-register.md` (R.1).

---

# R.2 — Platform-strategy findings

## Topic 1 — Distinct phone-vs-tablet experiences inside one Capacitor shell
**Findings.** Apple HIG: an iPad is "not a big iPhone." In regular width classes, replace the phone tab bar with a **sidebar**, and use two/three-column **`NavigationSplitView`** master-detail; a stretched iPhone layout "wastes space and feels wrong." iPad additionally expects pointer, keyboard shortcuts, multitasking, and drag-and-drop. **App Review 4.2** is the enforcement teeth: an app "not sufficiently different from a web browsing experience" is rejected; a blank screen or browser-style error (instead of a native offline state) instantly flags a wrapper. Reviewers reward native nav, push/APNs, real offline handling, and biometric APIs.
**Copy this.** VetTrack already has `NativeTabSidebar` + `useIsNativeTablet` master-detail routes — this *is* the HIG pattern; extend it, don't flatten it. Keep the phone tab bar for compact width, sidebar+split for regular width.
**Pitfalls.** (1) Reusing a phone screen verbatim on iPad → 4.2 risk + wasted space. (2) Emitting a browser error page when offline → reads as a wrapper. (3) Letting the console (web) design leak onto tablet — they are different products (III.1).
**Sources:** [Apple HIG — Split views](https://developer.apple.com/design/human-interface-guidelines/split-views) · [Apple HIG — Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) · [Apple — App Review Guidelines 4.2](https://developer.apple.com/app-store/review/guidelines/) · [MobiLoud — webview wrapper rejections](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper)

## Topic 2 — Web management console ≠ mobile mirror
**Findings.** Desktop users tolerate much higher information density than mobile; brief-glance users want compact layouts, deep-analysis users want breathing room. Users scan dashboards in **F/Z patterns** and abandon screens with **>7 competing elements above the fold**. **Tables** are the right form for dense desktop comparison data, with granular tables deeper in the page for drill-down. **Cognitive load — not aesthetics — is the top predictor of dashboard abandonment**; limiting visible info to what each role needs beats any restyle. Consoles converge on tables + detail drawers + keyboard navigation.
**Copy this.** Console IA = role-limited landing (admin full, lead read-only) → dense sortable/filterable tables → detail **drawer** (not full-page nav) → keyboard affordances. Put summary/preattentive signals top-left (F-pattern start in LTR; top-right in RTL).
**Pitfalls.** (1) Porting mobile cards to desktop → low density, high scroll, no comparison. (2) >7 top-level tiles → abandonment. (3) Modal-per-row instead of a drawer → loses list context.
**Sources:** [NN/g — Designing Tables for Desktop Apps with Lots of Data](https://www.nngroup.com/videos/designing-tables-desktop-apps/) · [NN/g — Dashboards / preattentive processing](https://www.nngroup.com/articles/dashboards-preattentive/)

## Topic 3 — Kiosk / wall-display engineering (always-on)
**Findings.** **Screen Wake Lock API** keeps the screen awake but the sentinel is released by the system on low battery / when the document becomes hidden — so the correct pattern is to **re-acquire the lock on `visibilitychange`** when the page is visible again. A **service worker on a never-closing kiosk page may never activate a pending update** — an always-on display needs a proactive reload path (a passive "close tab to update" never fires). Production signage stacks (Fully Kiosk, MDM/UEM) add watchdog/auto-recovery beyond the browser APIs. Enterprise signage expects RBAC + audit logs + per-device revoke.
**Copy this.** BoardShell: unconditional wake lock **+ re-acquire on `visibilitychange`/`pageshow`**; error boundary that resets to `/board` rather than dying; auto-reload on a *confirmed byte-different* new worker with a loop-guard, deferred while an emergency is on screen (see R.1-K4).
**Pitfalls.** (1) Acquiring the wake lock once and never re-acquiring → screen sleeps after the first backgrounding. (2) Forcing reload on every `update()` tick → reload loops. (3) Reloading mid-Code-Blue → drops the emergency view operators are watching.
**Sources:** [MDN — Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) · [Chrome/Workbox — Handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates) · [Fully Kiosk Browser](https://www.fully-kiosk.com/en/)

## Topic 4 — Per-role adaptive UX in ops/clinical products
**Findings.** Role-specific EHR views measurably cut cognitive load, burnout, and error risk; "clinicians feel less overwhelmed when EHRs adapt to them." The literature separates **role-based** (stable per-role) personalization from **dynamically adaptive** (expertise-detecting, interface-reshaping) engines. In safety-critical clinical contexts, predictability/stability is itself a safety property — which is why VetTrack's I.4 choice (capabilities overlay only, no mid-shift reflow) is well-founded: it banks the role-specificity win without the disorientation cost of mid-task reshaping.
**Copy this.** Homes differ by *permanent* role (ops vs floor in v1; five archetypes later). Surface only role-relevant state; keep layout shape stable across a shift; signal shift elevation with a badge, not a relayout.
**Pitfalls.** (1) Hiding a capability in the UI but not enforcing it server-side (UI gating ≠ security — R.1-K3). (2) Over-adapting the interface at runtime → operators lose their spatial memory. (3) One-size-fits-all home → cognitive overload for floor staff, under-service for ops.
**Sources:** [empower.md — Role-specific EHR experiences](https://www.empower.md/the-rise-of-role-specific-ehr-experiences-why-the-future-of-healthcare-depends-on-personalizing-clinical-workflows/) · [HyperTrends — Adaptive UX engine for healthcare](https://www.hypertrends.com/2026/04/the-adaptive-ux-engine-for-healthcare-when-software-learns-how-skilled-you-are/)

## Topic 5 — Full-native migration paths off a Capacitor PWA
**Findings.** Migrating Capacitor → full native (React Native, or SwiftUI/Kotlin) is a **UI-layer rebuild**, not a lift-and-shift — HTML/CSS screens have no direct native equivalent — but **business logic, API calls, and data models in TS carry over with light changes**. Recommended: **staged, screen-by-screen** migration keeping portable logic isolated, not a single-switch rewrite (a "high-risk endeavor," "massive upfront investment"). For regulated healthcare apps, native rendering reduces the WebView attack surface (a governance argument). Long WebView lifespans accrue browser-engine-coupling tech debt.
**Copy this.** Exactly the plan's I.2 thesis: keep the experience model, capability contracts, and typed API surface UI-framework-free so a future native shell consumes them as spec; migrate screen-by-screen behind a stable logic core. Three candidate paths for the Phase 10 roadmap: (a) incremental native screens alongside the shell; (b) SwiftUI/Kotlin ground-up with the TS logic ported; (c) React Native reusing TS logic + RN UI. Score each on cost/risk/reuse.
**Pitfalls.** (1) Big-bang rewrite → months of dual-maintenance risk. (2) Migrating before logic is de-tangled from UI → re-derivation cost dominates. (3) Assuming CSS screens port → they don't; budget UI rebuild explicitly.
**Sources:** [nextnative.dev — Capacitor vs React Native (2025)](https://nextnative.dev/blog/capacitor-vs-react-native) · [Bacancy — Capacitor vs React Native 2026 Decision Guide](https://www.bacancytechnology.com/blog/capacitor-vs-react-native)

## Topic 6 — 2026 UI benchmarks (ops consoles, role homes, wall displays, clinical/field)
**Findings.** The defining 2026 ops-console pattern is the **Cmd+K command palette** (Linear, Vercel, GitHub, Slack, Raycast) — a keyboard-first command surface for create/assign/navigate. Reference design languages: **Vercel** (black/white precision, Geist), **Linear** (ultra-minimal, precise, single purple accent). Open-source calibration target: **shadcn-admin** (Vite+React, Cmd+K, RBAC, OKLCh color tokens, **RTL support**) — notably close to VetTrack's stack (Vite+React+shadcn, RTL Hebrew, indigo accent). **Bento-grid** dashboards are a current layout idiom for glanceable, hierarchy-rich boards — directly relevant to the Command Center's calm-mode composition. Clinical/field UI trends: role-limited density, reduced cognitive load, large touch targets.
**Copy this (the III.2 calibration set).** Ops console → Linear/Vercel restraint + Cmd+K affordance + shadcn-admin structure. Wall display (calm mode) → bento-grid hierarchy, 3-metre glanceable scale contrast. Role homes → role-limited, preattentive summary first.
**Pitfalls.** (1) "Default shadcn dashboard" look = fails III.2 — the benchmark is *opinionated* restraint (Linear/Vercel), not stock components. (2) Bento grid with uniform tiles = no hierarchy → defeats glanceability. (3) Command-palette-as-decoration without real command coverage.
**Opportunity (surfaced, not applied — exceeds Phase R fence):** a Cmd+K palette over console actions is a strong future console affordance; owner to decide whether to scope it into a console phase.
**Sources:** [techinterview — Build a Command Palette (Cmd+K like Linear/Vercel)](https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/) · [AdminLTE — Best SaaS admin dashboard templates 2026 (shadcn-admin: Cmd+K, RBAC, RTL)](https://adminlte.io/blog/saas-admin-dashboard-templates/) · [Orbix — Bento grid dashboard design 2026](https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics)

---

# R.3 — Per-phase execution playbooks (checklists)

### Phase 0 — Baseline, audits, dev-role switcher
- **Approach:** run the full III.8 gate on the merged default as the baseline; produce `RELEVANCE_BASELINE.md` + `FLOW_INVENTORY.md`; add the client `x-dev-role-override` switcher (dev-bypass only) + a Clerk-inertness test.
- **Pitfalls:** (1) Testing "lead"/"tech" with client-only role names — the server collapses `lead_technician`/`vet_tech`→`student` (test lead via `senior_technician`, tech via `technician`). (2) Shipping the switcher active in Clerk builds → gate on `!VITE_CLERK_PUBLISHABLE_KEY`. (3) Deleting dead code found during the audit — Phase 0 is report-only.
- **Copy:** the existing `isMarketingPathname` gating style for the dev-only guard.
- **Do NOT:** touch `server/middleware/auth.ts`, `auth-mode.ts`, or widen `normalizeUserRole`.

### Phase 1 — Web management design brief
- **Approach:** author `web-management-brief.md` per module (exists-vs-net-new, inputs, hard constraints); attach the R.2-6 benchmark set as the III.2 calibration references.
- **Pitfalls:** (1) Briefing mobile-card layouts for a desktop console (R.2-2: density/tables/drawers). (2) >7 competing top-level tiles (NN/g abandonment threshold). (3) Omitting empty/loading/error + RTL spot-checks from the requested deliverables.
- **Copy:** Linear/Vercel restraint + shadcn-admin structure; NN/g F/Z-pattern for tile placement.
- **Do NOT:** propose renames of frozen surfaces; propose new transport; write any code.

### Phase 2 — Role-experience model (behavior-preserving)
- **Approach:** pure-TS `experience-model.ts` + `use-experience.ts`; total 7→5 archetype map, no default fallthrough; migrate scattered `isAdmin` checks to `can()`.
- **Pitfalls:** (1) A non-total map (missing a client role) → runtime gap; assert all 7. (2) Behavioral drift during the refactor → generate PRE-refactor snapshots first, assert byte-identical. (3) Editing a consumer the draft listed but that's since moved → re-grep `isAdmin|adminOnly|role ===` first.
- **Copy:** centralized-capability model (R.1-K3, LogRocket/Oso); keep server as the enforcement boundary.
- **Do NOT:** change `use-auth.tsx` contract, server enforcement, or `NativeTabBar.tsx` (stays static this phase).

### Phase 3 — Ops vs floor home + nav (v1)
- **Approach:** add the `homeSurface` fork alongside the existing `isNativeTablet` fork (component-level, not early return — preserves hook order); compose `OpsHomeSurface`/`FloorHomeSurface` from existing pieces.
- **Pitfalls:** (1) Early-return fork → hook-order violation on predicate flip (see the file's M3 comment). (2) Forking a shared card instead of adding a prop. (3) Dynamically reshaping on shift elevation — I.4 forbids it; badge only.
- **Copy:** role-limited EHR homes (R.2-4); preattentive summary-first (R.2-2).
- **Do NOT:** touch route registration or server code; rewrite `HomeTabletDashboard` internals.

### Phase 4 — `/board` fourth-platform entry + kiosk hardening
- **Approach:** add `"board"` `PlatformTarget` via `/board` prefix in both resolvers (after native, before touch-narrow); `BoardShell`; **move-not-rewrite** the board screen into `src/features/command-board/` so Phase-9 realtime wiring exists exactly once.
- **Pitfalls (from R.1-K4 + R.2-3):** (1) Wake lock acquired once, never re-acquired on `visibilitychange` → screen sleeps. (2) Auto-reload on every `update()` tick → loops; reload only on a **confirmed byte-different** worker + loop-guard. (3) **Reloading while an emergency is on screen** → defer until calm. (4) Extraction that "rewrites" → must diff clean (only import paths change).
- **Copy:** the `main.tsx` sessionStorage loop-guard; `isMarketingPathname` prefix predicate; MDN wake-lock re-acquire pattern.
- **Do NOT:** touch `public/sw.js`, SSE internals, snapshot cadence, `server/routes/display.ts`, or the emergency cache denylist (all Frozen).

### Phase 5 — Snapshot enrichment + calm/pressure modes
- **Approach:** OPTIONAL additive `power?`/`docks?`/`waitlist?`/`staging?`; 4 clinicId-filtered aggregates via `Promise.all`, each try/caught; populate `byLocation` from the room join already in the query.
- **Pitfalls (from R.1-K2):** (1) Making a field required → breaks the live client (backward-incompat). (2) Client assuming a block exists → **tolerant reader**: render gracefully when any block is `undefined`. (3) One slow aggregate tripping the 2500ms timeout → per-block try/catch degrades only that block.
- **Copy:** tolerant-reader pattern (Confluent); bento-grid calm-mode hierarchy (R.2-6).
- **Do NOT:** alter existing snapshot fields, poll cadence, or the timeout envelope.

### Phase 6 — Web chrome restage + headless pre-build
- **Approach:** new `web-management-nav-model.ts`; route skeletons behind `WebOnlyGuard`+capability; typed clients written against **actual** server handlers; `src/desktop/management/` primitives (data-table/drawer/form).
- **Pitfalls (from R.1-K5 + R.2-2/A6):** (1) Coding a client against an assumed handler shape → read the handler first. (2) Primitives that aren't domain-neutral → block the human-medicine vertical. (3) RTL built as an afterthought → use CSS **logical properties** from the first component; don't flip functionally-directional controls.
- **Copy:** headless/skinless components + tokens (R.1-K5); shadcn-admin table/RTL structure (R.2-6).
- **Do NOT:** touch `src/native/**`, `native-nav-model.ts`, or edit server route logic (read only). Rebase `IconSidebar`/`Topbar` on Phase 2's merged result (the one Wave-2 overlap).

### Phase 7 — Console module builds (as designs return)
- **Approach:** skin each returned design into a working module (7a–7e), independently shippable; typed client + Phase 6 primitives only.
- **Pitfalls:** (1) Guessing a design gap → it's an owner question. (2) Round-tripping secrets to the client (7b) → never. (3) A "default shadcn" result → fails III.2; match Linear/Vercel restraint (R.2-6).
- **Copy:** the returned `.dc.html` verbatim as the skinning target; NN/g density/table guidance (R.2-2).
- **Do NOT:** invent server endpoints — propose + review against the existing route file first; append audit kinds to the closed union, never inline a new string.

### Phase 8 — Five-archetype differentiation
- **Approach:** vet/tech/student surfaces; enumerate remaining ad-hoc checks FIRST (grep), migrate each behavior-identically; any new server restriction ships as a shadow-first evaluator.
- **Pitfalls:** (1) Skipping the up-front grep → missed scattered checks (R.1-K3). (2) A new server denial in enforce mode on day one → shadow first. (3) Student scope guessed → it's a deferred owner question.
- **Copy:** the extended Phase 2 snapshot suite (per-archetype); role-limited clinical homes (R.2-4).
- **Do NOT:** reshape on shift elevation (I.4); edit routes/server beyond the shadow evaluator + its wiring.

### Phase 9 — Display pairing + Displays console
- **Approach:** `vt_display_devices` (one new table, no ALTERs); pairing-code issue/claim; display token scoped to **only** read-only snapshot + heartbeat + SSE; Displays page (rename/revoke/heartbeat); deny-list tests before the allow path.
- **Pitfalls (from R.1-A3):** (1) A token broader than the three read-only endpoints → write deny-list tests first. (2) Editing `resolveAuthUser` in place → add a NEW additive resolver branch; existing auth suite must stay byte-identical. (3) Skipping per-device revoke/audit → enterprise-signage table stakes.
- **Copy:** 6-char pairing → claim → scoped token flow (signageOS/OptiSigns).
- **Do NOT:** ALTER existing tables; touch existing auth modes; log a non-union audit kind.

### Phase 10 — Close, roadmaps, App Store handoff
- **Approach:** full-inventory re-verification on all four platforms; native-migration roadmap; product-growth roadmap; Cowork App-Store-resubmission prompt grounded in the real pipeline.
- **Pitfalls (from R.1-A1/A7):** (1) A resubmission prompt not verified against `build-native-shell.sh` → verify scripts first. (2) A big-bang native recommendation → stage screen-by-screen behind the portable logic core. (3) Closing a broken/unreachable flow row without a recorded owner decision.
- **Copy:** staged migration strategy (R.2-5); 4.2 review-notes emphasis on native affordances (R.2-1).
- **Do NOT:** change code except the single `/equipment/board` redirect line *if* the owner decides it.
