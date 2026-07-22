# Prompt for Claude Design — VetTrack 2.0 UX/UI

> Paste the section below the divider directly into the "VetTrack Design System v2" project
> (`claude.ai/design/p/dc4c0446-2fdc-4877-acaf-eefc3a84e7b5`). This file also serves as the
> source-of-truth companion to `docs/vettrack-2.0-roadmap.md` for the design thread — update
> both when scope shifts.

---

## Role & context

You're designing inside **VetTrack Design System v2**, a claude.ai/design project already synced
from the real production codebase — not a blank canvas. It currently holds **110 real, compiled
components** pulled from the shipping app: shadcn/radix UI primitives, the desktop management-console
shell (`AppShell`, `Sidebar`, `Topbar`, `IconSidebar`), the native Capacitor shell (`NativeShell`,
`NativeHeader`, `NativeTabBar`, `NativeScreen`, `NativeTabSidebar`), and domain components for
equipment, alerts, inventory, and shared app chrome. **Compose new screens from these first.** Only
propose a new primitive when nothing in the synced set covers the need, and flag it explicitly as new
rather than silently reinventing (e.g. don't redraw a card component that already exists as
`EquipmentTruthCard` or `AlertCard`).

VetTrack is a veterinary hospital operations platform. Your job on this project is **all UX/UI and
frontend design** for the features below — screens, flows, states, and component specs precise enough
that Claude Code can implement them 1:1. Backend, data wiring, and implementation happen afterward in
Claude Code; you own the design layer only.

## VetTrack's timeline — past, present, future (read this before designing anything)

Get this straight first: three different things are all true about VetTrack at once, and they are
**not** the same "current state." Designing well here means knowing which bucket every surface you
touch falls into.

### Past — what real users have actually used
The app **live on the App Store today** is **v1.0.1, build 25**: an equipment-first veterinary-hospital
operations PWA wrapped in a Capacitor shell. One codebase, mostly one experience stretched across
phone/tablet/web. Core loop: a staff member scans a device in or out (custody), works a task or shift,
or responds to a Code Blue. This is the only version of VetTrack a real hospital user has ever touched.
Everything past this paragraph is **not yet in front of a real user.**

### Present, part A — built, verified, and sitting in App Store review (not live yet)
**v1.2.0, build 26** was submitted to Apple on 2026-07-18 and was last known to be in
`WAITING_FOR_REVIEW`. It is finished, gated green in the repo, but **not approved and not live** as of
this prompt. Treat everything in it as "shipped-but-invisible-to-users-until-Apple-says-so." Build 26
bundles the entire first redesign program that this design system's non-native/console/board
components came from:
- **Per-role UX + the web app re-cast as a management console** (admin/lead see oversight & config;
  floor staff see a focused ops home — not the same screen with hidden menus).
- **`/board` promoted from an in-app page to a standalone Command Center display** — kiosk-mode,
  chrome-free, glanceable, self-healing.
- **Docking-as-first-class** (P1–P3: room sweep, reconciliation, an auto-derived Equipment Coordinator
  role, an escalation ladder) — merged to `main`, not yet in a released build users hold.
- Five feature subspecs, two Code Blue race-condition fixes, and full Socket.io realtime-collab wiring.

**Design implication:** the desktop console shell, `NativeTabSidebar`, and the board shell you see
synced into this project already reflect *this* program — but a real user hasn't opened any of it yet.
Don't assume hospital staff have any mental model of the console or the board; this is all still a
first impression waiting to happen.

### Present, part B — decided and speced, but zero pixels exist
This is the most important distinction for you specifically. VetTrack 2.0 (Case Spine + Shift
Autopilot, below) is **6 of 18 tracker items done** — but every one of those six is a written spec, a
decisions document, or a throwaway code spike (explicitly not merged, "learning artifact" only per the
roadmap). **No Case Spine screen, no Autopilot approval queue, no Live Floor view, no ROI ledger exists
anywhere — not in the app, not in this design project, not as a sketch.** You are not restyling or
extending an existing 2.0 feature. You are originating it from zero, inside an existing visual language
built for a different (1.0-era) feature set. Also **not started at all, in any form:** the Android app
(a Play Store release is 2.0 task 1.3 — today VetTrack is iOS + web only).

**One exception, moving as this is written:** Task 1.1's *backend* (the `vt_action_proposal` schema,
the approval/edit/reject API, one proposal type's reader/composer) is being actively built right now in
an isolated git worktree — real, but **uncommitted, unmerged, and backend-only: zero UI, zero copy**.
The "Autopilot approval queue" spec below reflects that in-progress schema, so you have real field names
to design against instead of guessing — treat it as authoritative shape, not a finished feature.

### The design substrate you have to build on (regardless of era)
A few things hold across past, present, and future — carry them into every screen you produce:
- **Four platforms, one design system:** iPhone/iPad (Capacitor native shell), a desktop management
  console (web, ≥1024px, admin/lead-only), and `/board` (standalone kiosk display). A fourth,
  `marketing`, covers signin/signup/legal. Declare which target(s) every surface you design is for —
  never one responsive layout stretched across all four.
- **i18n is non-negotiable:** Hebrew is the default locale, RTL-first; English is secondary. Mock real
  Hebrew microcopy, not lorem ipsum, and check both locales' text-length extremes.
- **A visual language already exists** — clinical/indigo theme, Stage 1 tokens, AA-contrast already
  fixed. A future Liquid Glass restyle will be a token-level pass, so build everything **token-driven**
  (no hardcoded colors/spacing) so that restyle doesn't force rework.

### Future — what VetTrack 2.0 actually builds (the thesis you're designing toward)

VetTrack becomes **an operational layer running from the hospital's resources all the way to the
patient's bedside** — no longer a registry staff feed, but an operator staff approve. Two compounding
moves carry this:

1. **The Case Spine** (structural) — a first-class, *operational-only* Case object that threads
   through equipment, dispense, Code Blue, and tasks around one patient episode. **Hard boundary:**
   the Case is never a clinical record. No diagnoses, prescriptions, labs, imaging, or owner
   information — ever. The PMS (practice management system) stays the clinical source of truth;
   VetTrack is the *operational* source of truth for that same episode. Every Case surface you design
   must visually read as "operations, not chart" — no clinical-looking chrome, no field that implies
   medical documentation.
2. **The Shift Autopilot** (behavioral) — a continuously-learning assistant that watches the existing
   event stream and stages proposals (handover drafts, coordinator reassignment, restock triggers,
   crash-cart drift pull-back) for a human to approve, edit, or reject. Default posture is
   `shadow` — it never acts unilaterally unless an org explicitly turns on `enforce` for that specific
   proposal type. Every proposal surface must make **shadow vs. enforce** visually unambiguous, and
   must never read as a noisy alert firehose — restraint is a design requirement, not a nice-to-have.

## Design-scoped work, in priority order

Every item below falls in "Present, part B" above: **zero existing screens to extend.** You are
originating these from nothing, inside the visual language described in "design substrate" above —
not restyling anything that exists in the app, the App Store build, or this design project today.
Technical scope (schemas, routes, workers) is Claude Code's problem — shown only where it constrains
what you can design.

### Now-buildable (spec already frozen — start here)
- **Autopilot approval queue** (task 1.1) — the lead's home screen. Design against the REAL in-progress
  schema, not a generic one:
  - **Four proposal kinds exist as a closed set**, but only one has real content yet:
    `coordinator_reassign_off_roster`. The other three (`shift_handover_draft`, `restock_po_on_burn`,
    `crash_cart_drift`) are reserved kind values with no composed content behind them yet — design the
    queue's generic envelope (card shell, citation block, approve/edit/reject actions) so it visibly
    accommodates a kind it doesn't know the inner shape of yet; only fully flesh out the
    coordinator-reassign card body.
  - **Status lifecycle is exactly four states, one non-terminal:** `staged` (needs a decision) →
    `approved` / `edited` / `rejected` (all terminal — no partial/in-review state to design for).
  - **The coordinator-reassign card's real fields:** which coordinator went off-roster and when
    (`staleCoordinatorName`, `shiftDate`), Autopilot's proposed replacement (`proposedCandidateName` —
    **this can be null**, meaning Autopilot found no candidate; design that explicit "no suggestion —
    pick one yourself" state, don't just hide the field), and a `candidateOptions` list the human picks
    from. **Editing only ever means picking a different name from that same list** — there is no
    free-text edit surface here.
  - **Rejecting requires a reason** (a real required text field, 1–1000 chars) — reject is a two-step
    flow (reason first, then confirm), never a single dismiss tap.
  - Every proposal shows a citation-grounded "why" — a list of cited facts (source table + id +
    timestamp) linked back to the real event it's based on, never an unexplained suggestion.
  - Needs: mobile-first layout, a console variant (filterable by status/kind — the API already
    supports both), and a board ambient count (glance-only, no detail). Shadow-vs-enforce visual
    language must be reusable across all four kinds even before the other three have real content.
    i18n he+en. `aria-live` on newly-arriving proposals (screen-reader users must hear new items land,
    not just see them).
- **Case timeline + per-patient operations page** (task 1.2) — the operational story of one episode:
  equipment used, rooms occupied, tasks touched, Code Blue references, dispense events — nothing
  clinical. Needs an explicit **offline/stale-data affordance** (this page must work offline and
  visibly show when it's showing stale/reconciling data). Mobile + console; board support is later,
  don't design it yet.
- **One-tap "attach to case" pin** (task 2.1) — an affordance added to existing scan/dispense/damage/
  Code-Blue surfaces, not a new screen. The design constraint that matters most here: **zero added
  friction to the scan loop** — this has to prototype as literally one tap, verified on-device before
  it's considered done.

### Next up (needs a joint design/eng checkpoint before final freeze)
- **Per-org Autopilot policy console concept** (task 0.4) — an admin-facing "trust surface": how does
  an org explicitly turn `enforce` on for one proposal type, see who approved it, and revoke it? This
  is conceptual/admin-console-only for now; keep it simple, this isn't a heavily-trafficked screen.
- **The Live Floor + The Baton** (task 2.2) — a shared "who's doing what, where" picture across phone/
  tablet/board, plus a two-sided acknowledged handoff (offer → pending → accept/escalate) for
  tasks, cases, Code-Blue roles, or zones. Must design for **staleness gracefully** — this is advisory
  presence data, never authoritative, so a stale/disconnected state needs its own honest visual
  treatment rather than silently going wrong. Kiosk type scale for the board variant.
- **"Who's on the floor" glance card** (task 2.3) — a minimal home-screen presence card (avatars on
  rooms); treat this as the small, shippable-first slice of 2.2's idea.
- **Economic Loss & ROI Ledger** (task 2.4) — an owner-facing running P&L view on the management
  console only (admin+lead gated). Design brief: "looks like money, not logs" — this is a
  dataviz-as-design-system-citizen problem, not a table dump. Needs light+dark+RTL.
- **Autopilot `enforce` + Ambient Safety Net** (task 2.5) — once a proposal type is policy-unlocked,
  what does "executed" vs. "proposed" look like at a glance? Plus: a pre-failure warning that pages
  ONE named accountable person with ONE closing action — never a broadcast. This explicitly pages
  *about* Code Blue readiness gaps but must never look like it touches live Code Blue emergency state
  itself (that surface is frozen — see constraints below). Glass OFF on this surface if/when the
  Liquid Glass pass lands.

### Later / don't start yet (sequencing or scope not settled)
- Task 3.1 (Immutable Hospital Ledger — attestation/export artifact, console-only), 3.2
  (controlled-substance compliance module — a new compliance-officer archetype), 3.3 (Reception
  War-Room — a new reception archetype, not a re-skin of existing screens). Flag if you want to
  sketch direction early, but full specs for these come later.

## Hard constraints (do not design around these)

- **No PHI, ever.** No diagnoses, prescriptions, lab results, imaging, or owner-identifying info in
  any Case-adjacent mock, no matter how realistic you want the demo data to look.
- **RTL-Hebrew-first.** Every screen designed in Hebrew as the primary mock, English as the secondary
  check — not the other way around.
- **Four-platform seam.** State explicitly, per surface: mobile / desktop-console / board / none.
- **Code Blue is frozen and off-limits for redesign.** Online-only mutations, server-confirmed end,
  no offline queueing, no polling recovery — these are engineering invariants, but the *visual*
  consequence is: don't let any new surface (especially 2.5's Safety Net) blur into looking like it
  controls or shows live Code Blue session state. It only ever references or pages about it.
- **Glass is a floating-controls-layer material only**, never a content layer, and it's **OFF** on
  Code Blue and `/board` entirely — Apple's own hierarchy rule, and this project's rule too.
- **Accessibility parity is mandatory, not native-free:** honor `prefers-reduced-motion`,
  `prefers-contrast`, and a reduced-transparency fallback in your specs — the app is a WKWebView
  approximation of native materials, so it doesn't get these for free the way a truly native app would.
- **Restraint over richness.** Every proposal/alert/paging surface above needs a stated "what makes
  this NOT noisy" answer, not just a happy-path mock.

## What to hand back, and how

Organize your output by the task numbers above (1.1, 1.2, 2.1, …) so it maps directly onto
`docs/vettrack-2.0-roadmap.md`. For each: screens per required breakpoint/platform, both locales,
named against existing synced components where possible (call out any new primitive explicitly). Where
a design decision is genuinely open — the 0.4 policy console shape, the 2.5 alert-fatigue threshold
language — **ask, don't guess**; those are flagged in the roadmap as joint checkpoints, not solo design
calls.

Once a task's design is ready, I'll fetch it back into the codebase (`claude.ai/design` MCP +
`/design-sync`) and build the frontend wiring and backend (schemas, routes, workers) against it in
Claude Code — so the more precisely the spec maps to real component names and real states, the less
gets lost in that handoff.
