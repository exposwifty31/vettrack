# Live Tri-Display Obsessive Audit — Claude Cowork Prompt (Phase 10.A)

> **What this is.** A ready-to-run prompt for **Claude cowork**, driven live by the owner across **three real displays at once**. It is the release gate for the VetTrack transformation program — the single, batched, human-in-the-loop verification that replaces the deferred per-phase iOS sim matrix (Phases 8 & 9 shipped on automated gates only; this is where a human and Claude look at the real thing, hard).
>
> **How to use it.** Division of labor: **the owner operates the physical iPhone directly** (Display 1 — real device in hand), and **Claude cowork drives the two Mac-based displays** — the iPad simulator and the Web app. Before starting, the release-candidate app is **installed on the owner's connected iPhone** (the one task done *for* the owner — see "Install on the iPhone" below); everything after, the owner taps/scrolls on the real phone. The owner opens the iPad simulator + the browser on the Mac, then pastes everything from `═══ PROMPT STARTS ═══` down into a Claude cowork session with computer control. Cowork audits iPad + Web itself and coordinates the iPhone leg with the owner (for cross-display parity and realtime, cowork acts on one surface while the owner watches the iPhone, and vice versa). The owner applies the same audit lens to the iPhone and reports its findings. **Every finding — from cowork or the owner — is written in the exact report format at the end and sent back to the implementing agent (me) to fix and re-verify — loop until the board is clean.**
>
> **This prompt audits; it does not fix.** Cowork proposes and reproduces; fixes land in the repo through the implementing agent so they pass the III.8 gate and CodeRabbit review. Cowork may hand back a suggested diff, but the source of truth for the fix is the repo, not the cowork session.

---

## Owner setup (do this before pasting the prompt)

Three displays, side by side, all signed into the **same clinic**, ideally showing the **same data**:

| # | Display | How | Platform target | Notes |
|---|---------|-----|-----------------|-------|
| 1 | **iPhone** — real device, **operated by the owner directly** | RC build installed on the connected iPhone (see "Install on the iPhone"). The **owner** taps/scrolls the physical phone — cowork does **not** drive it. | `mobile` (Capacitor-native) | Source-of-truth surface, audited on true hardware — real safe-area/RTL, **real haptics, real multi-touch, real offline**. Cowork can't see this screen, so the **owner** applies the lens here and reports findings (with phone screenshots). |
| 2 | **iPad** — iOS simulator | `pnpm cap:build:native && pnpm cap:install:ios-sim` on a booted iPad simulator | `mobile` (Capacitor-native, large) | Same shell as iPhone but tablet width — reveals stretched/orphaned mobile layouts. |
| 3 | **Web** — production | Owner opens **https://vettrack.uk** in a desktop browser at **≥1024px** | `desktop` (and `board` for kiosk routes) | The management-console / large-format surface. Different shell (`WebShell`), different guards (`WebOnlyGuard`). |

**Install on the iPhone (one-time, done *for* the owner).** Get the RC build onto the connected iPhone before the audit — the implementing agent or cowork runs this on the Mac the phone is plugged into:
- `pnpm cap:build:native --ios` (bakes the `pk_live` Clerk key + `VITE_API_ORIGIN` into the bundle — never a plain `pnpm build`, per CLAUDE.md), then
- open Xcode (`pnpm cap:open:ios`), select the connected iPhone as the run destination, and **Run (⌘R)** to sign + install — or `npx cap run ios --target "<device-id>"` (`xcrun xctrace list devices` to find the id). First install needs the device unlocked + "Trust This Computer", and a signing team set on the App target.
- Confirm it launches to the sign-in screen on the phone. From here the **owner** operates the phone; nothing else about Display 1 is agent-driven.

**Owner-operated iPhone (Display 1) — how it's audited.** The owner holds the real phone, so the things a mirror can't give you all work first-hand: **haptics are felt, long-press / swipe / pinch are real multi-touch, latency has no mirror overhead, and the airplane-mode offline test is just a toggle** (no mirror link to drop). The one tradeoff: **cowork can't see the iPhone screen.** So:
- The **owner** applies the 8-point lens to the iPhone, captures screenshots *on the phone*, and writes iPhone findings in the report format — cowork does not audit the iPhone by itself.
- For **cross-display parity + realtime** (which need all three): cowork performs the action on iPad/Web and asks the owner to do the same on the iPhone and report what it shows — or the owner acts on the iPhone while cowork watches iPad/Web. Either way the owner is cowork's eyes on Display 1.

**Role coverage.** VetTrack has five UI archetypes — `admin · vet · lead · tech · student`. The client experience-model maps the DB roles to archetypes: `senior_technician`/`lead_technician` → lead, `technician`/`vet_tech` → tech — so cycling any of those in the switcher shows lead/tech behavior, **not** student (see `tests/experience-model.test.ts`). (`lead_technician`/`vet_tech` are non-DB hierarchy-table aliases; the server's `normalizeUserRole` recognizes only the five real DB roles — a backend nuance that doesn't change what this visual audit sees.) On **Web (dev/staging builds)** use the **dev-role switcher** (Settings → *Developer · role override*) to cycle roles. On the **iPhone/iPad production build** the role is whatever the signed-in account is — note which role you are, and if you can, sign in as more than one.

**Ground rules the audit is measured against:**
- **Hebrew is the DEFAULT locale and the app is RTL.** Every screen must mirror correctly: layout direction, icon/chevron direction, text alignment, number/date formatting, and the back-gesture direction. English is the secondary locale — check parity, but Hebrew-RTL is the primary lens.
- **Mobile is the source of truth.** The web and board surfaces are management/large-format *projections* of the same data and flows — where they diverge in meaning (not just layout), the mobile behavior wins and the divergence is a finding.
- **No hardcoded copy.** Every user-facing string must come from the locale files; a literal English (or Hebrew) string baked into a component is a finding even if it "looks fine."
- **Emergency and realtime are load-bearing.** Code Blue must never queue offline, never optimistically terminate, and must propagate across displays over SSE within a couple seconds. Treat any lag, desync, or stale emergency state as high severity.

**Safety — read before you paste the prompt (non-negotiable).** This audit drives real mutations (start/end Code Blue, dispense/restock, start/end shifts, check-out/check-in) with computer control across three displays. Run it **only against a synthetic test clinic seeded for this audit** — never against a production clinic that holds real client, patient, or device data. Concretely:
- **Use a dedicated test clinic + test account.** `vettrack.uk` Display 3 must be signed into the **test clinic**, not a live hospital's tenant. If a production tenant is the only thing available, do **read-only** navigation and **skip every mutating flow** — do not create Code Blue sessions, dispense, or start shifts in it.
- **Every mutating flow must be reversed.** After the sweep, close/end any Code Blue session you opened, reverse or void test dispenses/restocks, end test shifts, and check test equipment back in. Leaving a live emergency session or an open shift behind is itself a finding. Treat the cleanup as a gate, not an afterthought.
- **Redact PII in every artifact.** Screenshots and finding reports must not carry real client names, patient names, phone numbers, device serial/pairing tokens, or account emails. Use seeded synthetic data; if a real value is unavoidably on screen, blur/crop it before attaching. Never paste a pairing token, session token, or `pk_live`/secret into a finding.
- **Never touch access, billing, or deletion.** No permission/sharing changes, no permanent deletes (emptying trash, hard-deleting records), no financial actions — those are out of scope for a QA sweep regardless of clinic.

---

```text
═══ PROMPT STARTS ═══

You are a ruthless, obsessive release-QA partner auditing VetTrack — a veterinary
hospital operations platform (equipment custody, Code Blue emergencies,
inventory/dispense, tasks & shifts) — across THREE live displays simultaneously:

  DISPLAY 1 — iPhone (real device, Capacitor-native)   ← source of truth · OWNER-DRIVEN
  DISPLAY 2 — iPad  (iOS simulator, Capacitor-native)  ← YOU drive
  DISPLAY 3 — Web   (vettrack.uk, desktop browser ≥1024px)  ← YOU drive

You have COMPUTER CONTROL of the Mac. You operate DISPLAY 2 and DISPLAY 3
yourself:
  - DISPLAY 2 (iPad) via the iOS Simulator window — you tap, type, scroll,
    and screenshot it directly.
  - DISPLAY 3 (Web) via the browser — you navigate and screenshot directly.
Take your own screenshots of iPad + Web; do not ask the human to describe pixels
you can see there.

DISPLAY 1 (the iPhone) is the HUMAN's — a real phone in their hand, which you
CANNOT see or control. The human is your eyes and hands on Display 1: they run
each flow on the phone, screenshot it, and report what they observe using the
same lens. Your job for Display 1 is to DIRECT and INTERROGATE — tell the human
exactly what to do and what detail to check, then cross-check their report
against what you see on iPad + Web. Do not skip the iPhone; drive it through the
human.

Ask the human for (Display 1 is theirs, plus anything you can't reach):
  - every iPhone observation — you can't see that screen, so request the specific
    screenshot/detail you need,
  - realtime + cross-display parity: when you mutate on iPad/Web, ask the human to
    watch the iPhone and report whether it updated within ~1–2s (and vice versa),
  - the airplane-mode offline test on the phone (flow E) — a simple toggle now,
    since there is no mirror to drop,
  - haptics, real multi-touch gestures, subjective-polish calls, and account/role
    changes you can't make.

Your job is to find EVERYTHING wrong — not the big obvious breakage, but the
small, embarrassing, "ship-blocking-in-aggregate" details that a tired human
misses. Assume the app is 95% right and your entire value is the last 5%. Be
relentless. Do not reassure the human. Do not say "looks good" and move on —
prove it looks good with a screenshot, or record why it doesn't.

SAFETY — HARD CONSTRAINTS (these override the instruction to "test everything"):
  - You are operating against a SYNTHETIC TEST CLINIC seeded for this audit.
    Confirm with the human that all three displays are signed into the test
    clinic BEFORE you run any mutating flow. If you cannot confirm it is a test
    clinic, do READ-ONLY navigation only: do NOT create/end Code Blue sessions,
    do NOT dispense/restock, do NOT start/end shifts, do NOT check equipment
    in/out. Ask the human first.
  - Every mutation you make, you undo. Maintain a running cleanup list as you go
    (session opened, item dispensed, shift started, equipment checked out) and,
    before you finish, reverse each one — end sessions, void test dispenses, end
    shifts, check items back in. Report anything you could not cleanly reverse.
  - Redact PII. Real client/patient names, phone numbers, device serials,
    pairing/session tokens, and account emails must never appear in a screenshot
    you keep or in a finding. Prefer seeded synthetic data; blur/crop anything
    real before attaching. Never copy a token or secret into a report.
  - Out of scope regardless of clinic: changing permissions/sharing, permanently
    deleting data, and any billing/financial action. Do not perform these even
    to "test" them — describe them as untested and move on.

## The lens (apply ALL of these to EVERY screen, on EACH of the three displays)

1. PIXEL & LAYOUT — alignment, spacing rhythm, truncation, overflow, orphaned
   elements, things that touch screen edges, safe-area collisions (notch /
   Dynamic Island / home indicator on iPhone), stretched-mobile-layout on iPad,
   cramped-or-empty desktop layout on Web. Tap targets < 44pt. Off-grid nudges.
2. RTL & HEBREW (primary) — the app defaults to Hebrew and must be fully RTL.
   Check: layout mirrors, text right-aligns, chevrons/arrows/back-icons point the
   RIGHT way, numbers and dates read correctly, mixed Hebrew+Latin (device IDs,
   codes) doesn't scramble, nothing is left-aligned "by accident." Then flip to
   English and check parity — same meaning, no clipped translations, no leftover
   Hebrew in the English view or vice-versa.
3. COPY — every string must come from the locale files. Hunt for: hardcoded
   English/Hebrew literals, placeholder text ("TODO", "lorem", raw keys like
   `appointmentsPage.title` rendering literally), inconsistent terminology
   (the unified task model is "Tasks / משימות" — flag any stray "appointment"
   in USER-FACING copy), sentence case vs Title Case drift, wrong pluralization.
4. INTERACTION STATES — every interactive element must have designed hover
   (web), focus (keyboard), active/pressed, disabled, loading, empty, and error
   states. Tab through the whole web screen with the keyboard: is focus visible,
   is the order sane, can you reach everything, can you escape modals? On device:
   does tapping give visual feedback? Are there dead buttons? (On the iPhone the
   HUMAN owns this check on the real phone — ask them to confirm haptics actually
   fire and that long-press / swipe / pinch behave correctly, since those are all
   first-hand on hardware. You verify the iPad + Web interaction states yourself.)
5. LATENCY & MOTION — time every meaningful action (screenshot before/after on
   iPad + Web; on the iPhone, have the human time it on the real phone). Flag
   anything that feels slow with no spinner/skeleton, janky animation, layout shift
   as content loads (CLS), double-taps registering twice, or a control that looks
   tappable before it's ready.
6. CROSS-DISPLAY PARITY — this is the whole point of three displays. For each
   flow, do the SAME action and compare: does the iPhone, iPad, and Web show the
   same data, same state, same result? When they differ, is the difference
   intentional (a management-only affordance on Web) or a bug (stale data, a
   missing field, a different number)? Mobile wins ties.
7. REALTIME PROPAGATION — mutate on one display, watch the other two. A check-out,
   a task completion, a Code Blue start/log/end must propagate over SSE to the
   other displays within ~1–2s WITHOUT a manual refresh. Time it. A display that
   needs a reload to catch up is a finding.
8. ROLE CORRECTNESS — the same screen must differ by role in the RIGHT ways.
   Cycle roles (dev-role switcher on Web; the signed-in account on device) across
   admin · vet · lead · tech · student. A student must NOT see admin/governance
   affordances; an admin must see them. Flag both over-exposure (student sees an
   admin button) and under-exposure (a role can't reach something it should).

## The walk (do these flows in order — on all three displays, cycling roles)

For EACH flow: state which display + which role, drive it, apply the 8-point lens,
and log every finding in the report format below before moving on.

A. AUTH & SHELL
   - Cold launch each display. First paint, splash, and how fast the shell is
     usable. On Web, the marketing/sign-in path (chrome-free) vs the app shell.
   - Bottom tab bar / sidebar: correct tabs per role, correct order, active-state,
     the "More" sheet on mobile, the web sidebar. RTL: tabs and sidebar mirrored.

B. HOME / PER-ROLE SURFACE  (Phase 8 — the newest per-role work)
   - The home surface differs by archetype: ops-style (admin/lead) vs floor-style
     (vet/tech/student), and Phase 8 split floor into distinct vet / tech / student
     home surfaces. Verify EACH archetype's home renders the RIGHT surface with the
     RIGHT sections — no empty archetype, no admin card leaking into the student
     home, correct tab-bar order per archetype. Compare the same role's home across
     iPhone vs iPad vs Web.

C. EQUIPMENT — list → detail → edit, scan/custody (check-out/return), my-equipment,
   maintenance, intelligence. Checkout on iPhone → confirm it appears on iPad + Web
   in realtime. RTL on the equipment cards. Empty states (no equipment). Long
   device names / IDs (truncation + RTL mixing).

D. TASKS  (`/equipment/tasks` — unified task model; internally `appointments`)
   - Create / complete / reassign a task. User-facing copy must say "Tasks/משימות"
     everywhere — NO "appointment" in the visible UI. Completion propagates across
     displays. Conflict handling (two displays editing the same task).

E. CODE BLUE / EMERGENCY  (highest severity — audit hardest here)
   - Start a Code Blue session on iPhone. It MUST appear on iPad + Web + any board
     display within ~1–2s. Add a log entry — propagates. End the session — the UI
     must follow SERVER confirmation, never optimistically show "ended" early.
   - Emergency wall displays on Web/board (`/code-blue/display`,
     `/emergency-equipment-wall`) — legible from across a room, high-contrast,
     auto-updating.
   - OFFLINE TEST — the HUMAN runs this on the iPhone they're holding (a simple
     toggle now — no mirror to drop): direct them to turn on airplane mode, attempt
     a Code Blue mutation offline — it must FAIL LOUDLY with a toast, never silently
     queue — then turn airplane mode off and confirm state reconciles without a
     manual refresh. Ask for a screenshot of the failure toast. Don't leave this
     silently unchecked.

F. INVENTORY / DISPENSE — containers, items, dispense an item, restock. Numbers
   and quantities in RTL. Dispense on one display reflects on the others.

G. DISPLAY PAIRING  (Phase 9 — the newest surface)
   - On Web as admin: `/admin/displays` — issue a pairing code; the device registry
     lists name + last-seen + status (Active/Revoked/Never). Rename a device. Revoke
     a device (two-step confirm) — confirm the revoked device can no longer load.
   - `/board/pair` (no login) — enter a pairing code, confirm the board authenticates
     and starts showing the live snapshot + realtime updates. Then revoke its token
     from `/admin/displays` and confirm the board is kicked back to the pairing screen
     (not to a broken /signin, not an infinite reconnect loop).

H. ROOMS / LOCATIONS · SHIFT (chat, handover, pending) · SETTINGS / HELP /
   WHAT'S-NEW — walk each, apply the lens, cross-display parity.

I. LARGE-FORMAT / WEB-ONLY  (Web + board only; MUST redirect on iPhone/iPad)
   - `/dashboard`, `/analytics/*`, `/procurement`, `/audit-log`, `/equipment/board`,
     QR/print sheets. On Web ≥1024: do they render well, with real hierarchy (not a
     dashboard-by-numbers)? On iPhone/iPad: navigating to one of these must REDIRECT
     to the mobile fallback — never render a broken desktop layout. Verify the
     redirect, don't just accept the destination.

J. REDIRECTS & REMOVED SCOPE (a rendered page here = blocking finding)
   - `/appointments`, `/equipment-tasks` → `/equipment/tasks`
   - `/display`, `/equipment-board` → `/equipment/board`
   - `/patients`, `/patients/:id`, `/billing`, `/er`, `/meds`, `/pharmacy-forecast`
     → must REDIRECT (these domains were removed). If any renders a real page,
     that's a blocking finding. Also hunt the app for any surviving LINK that points
     at one of these dead routes.

## Severity rubric (assign one to every finding)

- BLOCKING — data loss, emergency/realtime failure, a removed-scope page rendering,
  a security/role over-exposure, anything that breaks a core flow. Ship-stopper.
- HIGH — a flow works but is visibly wrong: RTL broken on a real screen, hardcoded
  copy, a role seeing the wrong affordances, a cross-display desync, missing error
  handling.
- MEDIUM — polish that a real user would notice: spacing/alignment, a missing
  loading/empty state, a weak interaction state, minor copy drift.
- LOW — nitpick: sub-pixel nudge, a nicer-to-have animation, subjective taste.

Be honest about severity. Do not inflate; do not soften. A "small" RTL mirror bug
on the primary (Hebrew) locale is HIGH, not LOW.

## How to work (you drive; the human co-pilots)

- Drive iPad + Web yourself: tap/type/scroll in the iPad Simulator window and the
  browser. Take your own screenshots there whenever pixels matter — don't ask the
  human to describe what you can see on those two.
- Drive the iPhone THROUGH the human: give exact step-by-step instructions and
  name the specific detail to check, then request the screenshot/observation back.
  You can't see Display 1, so treat the human as your remote hands+eyes on it —
  never skip an iPhone flow, and never accept a vague "looks fine" without the
  detail that confirms it.
- INTERROGATE every observation — yours or the human's. Zoom into the screenshot,
  check the specific detail that would confirm or deny a bug.
- Hand the human the iPhone leg plus the tasks you can't do anywhere: haptic
  confirmation, an inconclusive multi-touch gesture, subjective-polish calls, and
  role/account switches you can't perform.
- Keep a running numbered findings list. At the end of each flow, summarize the new
  findings. Never lose one.
- When the audit is done (or the human says stop), output the COMPLETE findings list
  in the report format below, sorted BLOCKING → HIGH → MEDIUM → LOW, ready to paste
  back to the implementing agent.

═══ PROMPT ENDS ═══
```

---

## Finding report format (cowork emits these; owner pastes them back to me)

Every finding must be a self-contained block the implementing agent can act on without the cowork session's context. Use exactly this shape:

```text
### [SEVERITY] <one-line title>
- **Flow:** <e.g. E. Code Blue — end session>
- **Display(s):** <iPhone | iPad | Web | all three | iPhone+Web> (+ role if relevant)
- **Repro:** <numbered exact steps: 1… 2… 3…>
- **Expected:** <what should happen — cite the ground rule if it's RTL/copy/parity/emergency>
- **Actual:** <what actually happened>
- **Evidence:** <screenshot filename / timing / quote of the on-screen string>
- **Suspected area:** <route/component/locale-key if cowork can guess; optional>
```

**Example (so cowork matches the shape):**

```text
### [HIGH] Task-detail back chevron points left in Hebrew (RTL)
- **Flow:** D. Tasks — open a task, observe the header
- **Display(s):** iPhone + iPad, Hebrew locale, tech role
- **Repro:** 1. Home → Tasks. 2. Tap any task to open detail. 3. Look at the top-left/right back control.
- **Expected:** In RTL the back chevron points RIGHT and sits on the right edge (ground rule: Hebrew-RTL primary).
- **Actual:** Chevron points left, sits top-left, like an LTR layout.
- **Evidence:** IMG_2041.png; the header title is correctly right-aligned but the chevron is not mirrored.
- **Suspected area:** the task-detail header component's back button (hardcoded chevron-left icon, not direction-aware).
```

## The loop (how Phase 10.A closes)

1. Owner opens the three displays and pastes the prompt into Claude cowork.
2. Owner + cowork walk the flows; cowork emits findings in the format above.
3. Owner pastes the findings back to **me** (the implementing agent).
4. I fix each finding in the repo, run the III.8 gate, and re-verify — batched into a Phase 10 fix PR (or folded into 10.B) with genuine CodeRabbit review.
5. Owner re-runs the affected flows on the three displays to confirm the fix.
6. Repeat until the findings board is **clean (zero BLOCKING/HIGH)** — that is the Phase 10.A sign-off, and it resolves the deferred iOS sim-matrix gate for the whole program.

> Findings that are genuinely subjective/taste (LOW) or out-of-scope for this release get recorded in `docs/audit/PROOF_ALIGNMENT_LOG.md` with an explicit owner decision rather than silently dropped — no row closes "broken/degraded" without a recorded decision (III.6).
