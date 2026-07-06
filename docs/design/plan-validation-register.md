# Plan-Validation Register (Phase R.1)

> **Produced 2026-07-06** by Phase R of the VetTrack program (`here-is-a-draft-wise-thimble.md`).
> Each row extracts a load-bearing assumption from the plan, tests it against current web sources, and stamps it **CONFIRMED / REFUTED / ADJUSTED** with ≥1 cited source URL. REFUTED/ADJUSTED rows produced amendment proposals, applied inline in the plan and collected in the plan's "Phase R amendment log."
>
> **Governance:** No finding contradicts Part I.4 (locked decisions) or the Globally-Frozen list. Where a finding brushed against either, it is recorded here as *reinforcing* (not contradicting) and flagged accordingly. Nothing in this register was applied to I.4 or the Frozen list.
>
> **Scope note:** Web research validates *approaches and patterns*. It does **not** resolve the plan's ⚠️ code-fact items (exact line numbers, schema column names) — those are resolved only by re-reading the code at each phase's start (rule III.4). This register never upgrades a ⚠️ code fact to ✅ on the strength of web research.

## Verdict summary

| # | Assumption (plan location) | Verdict |
|---|---|---|
| K1 | Path-prefix fourth `PlatformTarget` (`/board`) is the right pattern for a kiosk/TV shell (IV.2-C, Phase 4) | ✅ CONFIRMED |
| K2 | Additive optional fields are the safe evolution path for a shared snapshot type consumed live (IV.2 / Phase 5) | ✅ CONFIRMED (+ tolerant-reader reinforcement) |
| K3 | A closed capability-union models per-role UX better than scattered role checks (IV.2-A) | ✅ CONFIRMED |
| K4 | In-app auto-reload on build-tag mismatch is safe for an always-on unattended display (Phase 4) | ⟲ ADJUSTED — safe *only* with loop-guard + confirmed-version + emergency-defer |
| K5 | Pre-building headless structure before designs return is faster than building after (Phase 6→7) | ✅ CONFIRMED |
| A1 | The Capacitor shell carries real App Review 4.2 rejection risk; distinct native experience mitigates it (I.2, Phase 10) | ✅ CONFIRMED |
| A2 | iPad must be a distinct composition, not a scaled-up iPhone (III.1, Phases 3/8) | ✅ CONFIRMED |
| A3 | Pairing-code → clinic-scoped revocable display token is the right fleet-auth model (Phase 9) | ✅ CONFIRMED |
| A4 | Role-based homes reduce clinician cognitive load; keeping shape stable (no mid-shift reflow, I.4) is defensible | ✅ CONFIRMED (reinforces I.4) |
| A5 | Console IA should be role-limited, dense, table/drawer-driven — not a mobile mirror (Phases 1/6/7) | ✅ CONFIRMED |
| A6 | RTL-Hebrew-first with logical properties is the correct primary rendering (III.4) | ✅ CONFIRMED |
| A7 | Incremental-native off Capacitor (not a big-bang rewrite) is the lower-risk migration path (I.2, Phase 10 roadmap) | ✅ CONFIRMED |

---

## K1 — Path-prefix fourth PlatformTarget for the kiosk shell — ✅ CONFIRMED
**Plan says:** add `"board"` to `PlatformTarget`, resolved by `/board` path prefix in both resolvers, mirroring the existing `isMarketingPathname` predicate; `PlatformRouter` dispatches to `BoardShell` (IV.2-C, Phase 4).
**Research shows:** resolving a distinct app shell by URL path prefix is the idiomatic SPA pattern. React Router v7 ships `prefix()` + `layout()` specifically to give a set of routes their own layout shell without adding path segments, and documents the exact "marketing layout vs authenticated-app layout vs kiosk layout" split as the canonical use case. VetTrack uses wouter rather than react-router, but the pattern is framework-agnostic (resolve shell from `location.pathname` prefix) and VetTrack *already* does this for `marketing`. Adding a fourth prefix-resolved shell is a mechanical extension of a proven in-repo pattern.
**Sources:** [React Router — Routing (`prefix`/`layout`)](https://reactrouter.com/start/framework/routing) · [react-router multiple layouts pattern](https://dev.to/xavivzla/react-router-v5-multiple-layouts-4fo4)
**Applied to plan:** Part II platform-seam claim annotated "pattern validated (R.1-K1)." No behavioral change.

## K2 — Additive optional fields for the shared snapshot type — ✅ CONFIRMED (+ tolerant-reader reinforcement)
**Plan says:** Phase 5 adds `power?`, `docks?`, `waitlist?`, `staging?` as OPTIONAL additive fields on the snapshot shared with the live client; existing fields untouched.
**Research shows:** additive optional fields are the textbook definition of a *backward-compatible* schema change — a consumer on the new type can read data written without the field. The load-bearing companion is the **tolerant-reader pattern**: consumers must ignore unknown fields and handle missing optional fields gracefully for additive evolution to be non-breaking. The plan's `?`-optional typing enforces "may be absent" at the type level, and its per-block try/catch degradation matches tolerant-reader — but the *rendering* side must also render gracefully when a block is `undefined` (not assume presence).
**Sources:** [Confluent — Schema Evolution & Compatibility (backward = add optional fields)](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html) · [Backward Compatibility in Schema Evolution guide](https://www.dataexpert.io/blog/backward-compatibility-schema-evolution-guide)
**Applied to plan:** Phase 5 reinforced with an explicit tolerant-reader requirement (client renders gracefully on any absent block; never assumes a new field exists). Logged as an amendment (reinforcement).

## K3 — Closed capability-union vs scattered role checks — ✅ CONFIRMED
**Plan says:** `Capability` is a closed string-literal union consumed via `can()`; per-role UX is centralized in `experience-model.ts` (IV.2-A). The plan migrates ad-hoc `isAdmin`/`role ===` checks to `can()`.
**Research shows:** "scattered permission checks throughout the codebase" is named explicitly as the anti-pattern — it makes access logic brittle and makes "who can do what?" unanswerable. The recommended cure is exactly the plan's: centralized, declarative capability definitions enforced consistently, with the frontend adapting UI by capability while **true enforcement stays at the API**. The plan's keystone-A note ("server stays the enforcement boundary; client shaping is UX only") matches the research's most emphasized caveat verbatim.
**Sources:** [LogRocket — Choosing the best access control model for your frontend](https://blog.logrocket.com/choosing-best-access-control-model-frontend/) · [Oso — How to build a role-based access control layer](https://www.osohq.com/learn/rbac-role-based-access-control) · [Permit.io — Implementing RBAC in React](https://www.permit.io/blog/implementing-react-rbac-authorization)
**Applied to plan:** no change (plan already aligned); Part IV-A annotated "validated (R.1-K3)."

## K4 — In-app auto-reload on build-tag mismatch for an unattended display — ⟲ ADJUSTED
**Plan says:** BoardShell auto-reloads on a confirmed `SW_UPDATED`/build-tag mismatch after a safety window, reusing the `main.tsx` sessionStorage loop-guard (Phase 4).
**Research shows:** two facts in tension. (1) A service worker on a page that *never closes* (a kiosk left open forever) may never activate a pending update — so an always-on display genuinely needs a proactive reload path; a passive "close the tab to update" never fires. (2) The prevailing kiosk guidance is to **prompt** rather than force-reload — but that guidance assumes an *attended* screen where a human can click "update." An **unattended** wall display has nobody to click, so a prompt is inert; auto-apply is required. The risk auto-apply introduces is reload loops and interrupting a live view. The plan's loop-guard addresses looping; research adds two more guardrails the plan should state explicitly: **(a)** reload only on a *confirmed byte-different* new worker (not on every `update()` tick — `ServiceWorkerRegistration.update()` installs only if the script is not byte-identical), and **(b)** never auto-reload while the board is showing an active emergency/Code Blue — defer until the board returns to calm — which also aligns with the plan's own "no optimistic termination of emergency state" doctrine.
**Sources:** [Chrome for Developers / Workbox — Handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates) · [whatwebcando.today — Handling Service Worker updates](https://whatwebcando.today/articles/handling-service-worker-updates/) · [MDN — ServiceWorkerRegistration.update()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)
**Applied to plan:** Phase 4 amendment — auto-reload guarded by (loop-guard) + (confirmed byte-different worker) + (defer while emergency active). Does **not** touch frozen SW mechanics — this governs only the *new* BoardShell reaction to `SW_UPDATED`. Logged in the amendment log.

## K5 — Pre-build headless structure before designs return — ✅ CONFIRMED
**Plan says:** Phase 6 pre-builds all web-console structure headless (nav model, route skeletons, typed clients, data-table/drawer/form primitives) while Claude Design produces screens; Phase 7 skins each returned design.
**Research shows:** separating a component's structure/logic from its styling (headless / "skinless" UI) is an established way to let design and development proceed in parallel against shared design tokens, with the returning visual design becoming a skinning pass. Keeping code components and tokens in sync (single source of truth) and building/documenting components in isolation (Storybook-style) are the named success factors — both already present in VetTrack (Stage 1 tokens synced via `.design-sync/`, 111 components).
**Sources:** [Mindnow — Headless, Boneless, and Skinless UI](https://mindnow.io/en/blog/headless-boneless-skinless/) · [Martin Fowler — Headless Component pattern for React UIs](https://martinfowler.com/articles/headless-component.html) · [Design Tokens — Headless UI guide](https://www.design-tokens.dev/guides/headless-ui)
**Applied to plan:** no change (plan already aligned); Phase 6 annotated "validated (R.1-K5)."

## A1 — App Review 4.2 rejection risk is real — ✅ CONFIRMED
**Plan says:** the shipped Capacitor shell risks App Review 4.2 ("minimum functionality") if it reads as a web wrapper; distinct native experiences and the `build-native-shell.sh` pipeline (never setting `CAPACITOR_SERVER_URL`) mitigate it (I.2, CLAUDE.md, Phase 10 handoff).
**Research shows:** Apple rejects apps "not sufficiently different from a web browsing experience"; a blank screen or a browser-style error instead of a native offline state instantly flags a wrapper. Reviewers look for native affordances (native navigation, push/APNs, real offline handling, biometric APIs). VetTrack already has push, offline-first PWA, native shell nav — so the per-role native surfaces (Phases 3/8) and the distinct iPad composition strengthen the 4.2 posture, and the Phase 10 review notes ("real native experience, not a web wrapper") are correctly scoped.
**Sources:** [Apple — App Review Guidelines (4.2 Minimum Functionality)](https://developer.apple.com/app-store/review/guidelines/) · [MobiLoud — Will your webview app be rejected?](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper)
**Applied to plan:** no change; Phase 10 handoff annotated "4.2 risk confirmed real (R.1-A1)."

## A2 — iPad ≠ scaled-up iPhone — ✅ CONFIRMED
**Plan says:** iPad gets distinct tablet compositions (`NativeTabSidebar`, `useIsNativeTablet` master-detail), not scaled phone screens (III.1, Phases 3/8).
**Research shows:** Apple HIG is explicit — on iPad, use a split view / sidebar rather than a stretched tab bar; "iPad is not a big iPhone"; regular width classes should replace the phone tab bar with a sidebar and use two/three-column `NavigationSplitView` master-detail. VetTrack's existing `NativeTabSidebar` + master-detail routes already embody this.
**Sources:** [Apple HIG — Split views](https://developer.apple.com/design/human-interface-guidelines/split-views) · [Apple HIG — Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
**Applied to plan:** no change; III.1 annotated "validated (R.1-A2)."

## A3 — Pairing-code → clinic-scoped revocable display token — ✅ CONFIRMED
**Plan says:** Phase 9 issues a pairing code, claims it to mint a clinic-scoped read-only display token accepting only snapshot + heartbeat + SSE, revocable from a Displays console page.
**Research shows:** the 6-character pairing/verification code shown on the device → claimed in the dashboard → device bound to org with a scoped token/policy is the standard signage-fleet provisioning flow (signageOS, OptiSigns). Enterprise signage additionally expects RBAC, audit logs, and per-device revoke — all present in the plan.
**Sources:** [signageOS — Provisioning & Devices](https://developers.signageos.io/devices/) · [OptiSigns — Mass provisioning](https://support.optisigns.com/hc/en-us/articles/4416542923667-How-to-Perform-Mass-Provisioning-with-OptiSigns)
**Applied to plan:** no change; Phase 9 annotated "validated (R.1-A3)."

## A4 — Role-based homes help; stable shape (no mid-shift reflow) is defensible — ✅ CONFIRMED (reinforces I.4)
**Plan says:** per-role homes (Phases 3/8); shift elevation overlays capabilities only, never home/nav shape — no mid-shift UI reflow (I.4).
**Research shows:** role-specific EHR views measurably reduce cognitive load and clinician burnout; limiting visible info to what a role needs cuts time-to-insight more than any visual redesign. The literature also distinguishes *role-based* (stable) personalization from *dynamically adaptive* interfaces — and in safety-critical clinical settings, interface stability/predictability is a virtue. The I.4 decision to keep home/nav shape tied to permanent role (capabilities overlay only) is therefore *supported*, not contradicted: it captures the cognitive-load win of role-specificity while avoiding the disorientation risk of mid-task reshaping.
**Sources:** [empower.md — The rise of role-specific EHR experiences](https://www.empower.md/the-rise-of-role-specific-ehr-experiences-why-the-future-of-healthcare-depends-on-personalizing-clinical-workflows/) · [NN/g — Dashboards: preattentive attributes / role-limited info](https://www.nngroup.com/articles/dashboards-preattentive/)
**Applied to plan:** no change to I.4 (locked). Recorded as reinforcing evidence; Phase 3/8 playbooks cite it.

## A5 — Console IA: role-limited, dense, tables/drawers, not a mobile mirror — ✅ CONFIRMED
**Plan says:** web = management console with desktop density, tables, drawers, keyboard; distinct from the mobile mirror (I.1, III.1, Phases 1/6/7).
**Research shows:** desktop users tolerate far higher information density than mobile; users scan dashboards in F/Z patterns and abandon screens with >7 competing elements above the fold; tables are the right form for dense comparison data on desktop with granular tables deeper in the page. Cognitive load — not aesthetics — is the top predictor of dashboard abandonment; role-limiting visible info beats any restyle. This directly calibrates the Phase 1 brief IA and the III.2 bar for console surfaces.
**Sources:** [NN/g — Designing Tables for Desktop Apps with Lots of Data](https://www.nngroup.com/videos/designing-tables-desktop-apps/) · [NN/g — Dashboards / preattentive processing](https://www.nngroup.com/articles/dashboards-preattentive/)
**Applied to plan:** no change; Phase 1/6/7 playbooks cite it as the density/IA calibration.

## A6 — RTL-Hebrew-first with logical properties — ✅ CONFIRMED
**Plan says:** Hebrew-default RTL is the primary rendering; new surfaces RTL-verified in Hebrew first (III.4).
**Research shows:** RTL layouts must be *mirrored* (nav to the right, table headers align to start, directional icons flipped), and the correct implementation uses **CSS logical properties** (`margin-inline-start`, `text-align: start`, `border-inline-start`) rather than physical left/right, so a single stylesheet serves both directions. Directional icons need flipping but functionally-directional controls (undo/redo, media scrub) must not. A native-speaker review pass is advised — matching the plan's III.6 zero-tolerance "mis-truncated Hebrew label" defect class.
**Sources:** [SimpleLocalize — RTL design guide for developers](https://simplelocalize.io/blog/posts/rtl-design-guide-developers/) · [MDN/Firefox — RTL Guidelines](https://firefox-source-docs.mozilla.org/code-quality/coding-style/rtl_guidelines.html)
**Applied to plan:** no change; Phase 6/7 playbooks add "use CSS logical properties; don't flip functionally-directional controls."

## A7 — Incremental-native off Capacitor, not a big-bang rewrite — ✅ CONFIRMED
**Plan says:** the native rewrite is a follow-on program; this program makes it cheap by de-tangling product logic into UI-framework-free contracts; Phase 10 delivers a staged migration roadmap (I.2).
**Research shows:** migrating a Capacitor app to full native (e.g. React Native or SwiftUI/Kotlin) is a UI-layer *rebuild*, not a lift-and-shift — but business logic, API calls, and data models in TS carry over with light changes. The strongly-recommended approach is **staged, screen-by-screen** migration, keeping portable logic separate, rather than a single-switch rewrite (a "high-risk endeavor" / "massive upfront investment"). For regulated (healthcare) apps, native rendering also reduces the WebView attack surface — a governance argument, not just performance. This is exactly the plan's I.2 thesis (portable experience model + capability contracts + typed API surface + standalone board shell = cheaper staged migration).
**Sources:** [nextnative.dev — Capacitor vs React Native (2025)](https://nextnative.dev/blog/capacitor-vs-react-native) · [Bacancy — Capacitor vs React Native 2026 Decision Guide](https://www.bacancytechnology.com/blog/capacitor-vs-react-native)
**Applied to plan:** no change; Phase 10 native-migration-roadmap deliverable cites it as the recommended staging strategy.

---

## Flagged (owner decision required — NOT applied)
None. No R.1 finding contradicts Part I.4 or the Globally-Frozen list. One research-surfaced *opportunity* (not a plan change, not applied): a Cmd+K command palette is now the de-facto standard for ops consoles (Linear, Vercel, shadcn-admin) — a candidate console affordance the owner may want to scope into a future console phase. Recorded in `platform-strategy-research.md` R.2-6; adding it here would exceed Phase R's docs-only fence, so it is surfaced, not applied.
