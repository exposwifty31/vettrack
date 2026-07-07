# VetTrack Web Management Console — Mockup Design Audit

**Date:** 2026-07-07
**Artifact:** Claude Design project "VetTrack Design System" → `templates/console-management-home/ConsoleManagementHome.dc.html` (reviewed live in Chrome, Present mode)
**Method:** Full harness exercise — Persona (Admin/Lead) × State (Default/Empty/Loading/Error) × Locale (עברית RTL / English LTR) at 1440px; width probes at exactly 1024×757 and 1920×846 (verified via `innerWidth`); hover + keyboard-focus probes; zoom inspection of legends, chips, badges, progress bar, timestamps, avatar cluster.
**Access caveats:** (1) The preview iframe is cross-origin — accessibility-tree/DOM inspection was blocked, so semantics findings are grounded in visual + keyboard evidence only; a DOM-level a11y pass should happen on the synced source. (2) Harness toggle clicks intermittently fail to register with a mouse (keyboard activation always works) — see finding S6.

**Scope reality:** The artifact is the **shared shell + Management Home flagship only**. Modules 2–10 exist as sidebar destinations; none navigates. All interactive elements inside the stage are inert except the harness toggles. Per-module findings for modules 2–10 are therefore inheritance annotations, not page reviews.

---

## Shared shell + harness

| # | Type | Priority | Finding |
|---|------|----------|---------|
| S1 | EDIT | **Blocker** | **1024px overflows.** At exactly 1024×757 the shell clips horizontally — sidebar labels truncate ("…ment Home", "…s & Reports") and content runs off both edges. Non-negotiable #5 makes 1024 the floor; the flagship never demonstrates it. Fix: fluid stage with `min-width: 1024px` and a 3→2-column bento reflow, or harness width presets (1024/1440/1920). *(Seen: Empty·Admin·EN @1024.)* |
| S2 | ANNOTATION | Medium | **1920 undefined.** At 1920 the stage stays a fixed ~1180px centered rail with dead margins. Define the max-width token now (Linear/Vercel consoles run ~1280–1440 content rails); Audit/Analytics tables will want the width. *(Seen: Empty·Admin·EN @1920.)* |
| S3 | EDIT | **Blocker** | **No detail drawers exist.** Locked scoping decision — "detail drawers fully designed, incl. read-only vs edit per persona (the most important depth)" — is unmet. Verified inert in both personas: all 6 needs-attention rows (incl. chevrons), nav items, all "הצג הכל/View all" links, "חידוש חדש/New restock", "ניהול תפקידים/Manage roles". The sharpest persona test (admin edit vs lead read-only inside a drawer) is currently unverifiable. Build at least one exemplar pair (suggest: Ventilator VT-204 from needs-attention) before other modules inherit. |
| S4 | EDIT | High | **Lead × Empty is unreachable.** With Lead selected, the Empty pill never activates (mouse ×3, keyboard, hover-then-click); with Admin it works instantly. What a read-only lead sees in an unconfigured clinic is undesigned — and the admin onboarding CTAs (Invite/Add/Connect/Register) are all mutations a lead must not get. Design the lead variant (e.g., "המערכת עדיין לא הוגדרה — פנה למנהל"). |
| S5 | ANNOTATION | High | **No clinic context in the shell.** VetTrack is multi-clinic (every query is `clinicId`-scoped) but the shell shows no clinic name or switcher — not in the sidebar header, not in the user chip ("Maya Arad · Administrator"). Decide placement now; retrofitting after nine modules inherit the shell is expensive. |
| S6 | TWEAK | Low | **Harness toggle reliability.** Segmented-control clicks intermittently don't register (observed across Persona/State/Locale pills; keyboard Enter always works). Likely re-render/debounce swallowing pointer events. Fix hit target/handler. |
| S7 | TWEAK | Low | Mock browser chrome shows `vettrack.app/dashboard` — align the stage URL to the real console route naming so implementers don't infer a public `/dashboard`. |

**Done well (shell):** designed indigo focus rings on nav items, buttons, and harness pills (keyboard operability is real); persona swap has depth — user chip identity changes (מאיה ארד · מנהלת מערכת ↔ רועי לוי · אחראי · טכנאי בכיר), "קריאה בלבד" lock chip + info banner appear, mutating buttons swap to read-only links rather than merely disabling; harness pattern (Persona · State · Locale over one live frame) matches the Stage 7/8 convention and is pleasant to drive.

---

## Module 1 — Management Home (flagship)

| # | Type | Priority | Finding |
|---|------|----------|---------|
| M1 | EDIT | **Blocker** | **RTL bidi numeral mis-ordering.** Hebrew empty-state progress renders **"הושלמו 4 מתוך 0"** ("completed 4 of 0") instead of "הושלמו 0 מתוך 4". Same family: Inventory rows compose as "בתהליך 1" / "ממתינות 3" (numeral at inline-end) where the mirror of "1 in progress" puts the numeral first. Cause: LTR mono-numeral spans dropped into RTL sentences without bidi isolation. Fix: `<bdi>`/`dir=auto`/`unicode-bidi: isolate` around numerals, or compose via ICU messages. Violates non-negotiable #1. *(Seen: Empty·Admin·HE zoom; Default·Admin·HE inventory zoom.)* |
| M2 | EDIT | **Blocker** | **Hardcoded English relative timestamps in Hebrew locale.** Recent-activity feed shows "2m ago / 18m ago / 1h ago" untranslated under עברית — while the Connectivity card on the same page localizes correctly ("סונכרן לפני 4 דק'"). Route through a keyed relative-time formatter; sweep for other hardcoded strings. Violates non-negotiable #2. *(Seen: Default·Admin·HE activity zoom.)* |
| M3 | EDIT | High | **Semantic color collision in equipment-readiness donut.** תחזוקה (maintenance, 12) and מיושן (stale, 8) share the same amber in the legend, and the arc shows one merged orange band — two distinct alert states are indistinguishable (worse for color-blind users). Give stale its own token (or a pattern/darker step). Add the standing annotation: chart is CSS-only illustrative; real build uses recharts. *(Seen: legend + donut zooms, HE & EN.)* |
| M4 | EDIT | Medium | **Sidebar badges ignore state.** Inventory "12" and Ops Health "2" badges persist in Empty (unconfigured clinic) and Error states — contradicts the content region. Bind badge data to the active state. *(Seen: Empty·Admin·HE/EN; Error·Admin·HE.)* |
| M5 | TWEAK | Medium | **Empty-state icon tiles are blank.** All four onboarding cards show empty lavender squares where icons belong (both locales). Fill with glyphs or drop the tiles. |
| M6 | EDIT | Medium | **No perceptible hover states.** Hover produced no visible change on: needs-attention rows (which carry chevron affordances), sidebar nav items, secondary buttons ("חידוש חדש"). Focus states exist; hover does not. Quality bar requires designed hover/focus/active — add row tint, nav pill, button border/bg shift to the shell pattern. *(Hover-tested Default·Admin·HE.)* |
| M7 | ANNOTATION | Medium | **Loading skeleton ≠ final geometry.** Skeleton shows 6 generic gray blocks; default shows a 7-card bento with different proportions → CLS on hydrate. Annotate: skeleton must mirror the real card grid. *(Seen: Loading·Admin·HE.)* |
| M8 | TWEAK | Low | Role-change arrow in activity item "ד. כהן ← טכנאי": verify the glyph mirrors in RTL — rendered arrow appears to point back into the sentence rather than toward the new role. |
| M9 | TWEAK | Low | Avatar initials stay Latin (MA/RL/DC/SA/YT) under Hebrew locale while the same people render Hebrew in the feed (מ. ארד). Pick one convention. |
| M10 | TWEAK | Low | AA spot-checks: small gray mono captions (error code `MGMT_OVERVIEW · 503`, sidebar section headers, search placeholder) look near the 4.5:1 line — verify on the synced source. |
| M11 | ANNOTATION | Low | "הצג הכל / View all" links: annotate their intended module routes for implementers (equipment → Equipment Governance, inventory → Inventory & Procurement, activity → Audit). |

**Done well (Home) — preserve as the inherited pattern:**
- **Exactly 7 tiles** (non-negotiable #7 ✓), with genuine bento hierarchy — the donut card is visually dominant, triage list is a distinct rail.
- **Internally consistent data:** 168 Ready + 18 Sterilized = 186 = 87% of 214; needs-attention count (6) matches its rows; inventory 12 matches sidebar badge and low-stock row. This is rare in mockups and should be kept.
- **Needs-attention as a cross-module triage router** with module-tagged subtitles ("Ops Health · dead-letter queue", "RFID Readers · no heartbeat 12m") — exactly the Linear-style console energy the brief asked for.
- **Frozen surfaces respected:** Ops Health card carries an explicit **READ-ONLY / קריאה בלבד chip**; DLQ, sync queue, display heartbeats are counts only; zero Code Blue or realtime controls anywhere. (Non-negotiable #3 ✓.)
- **Error state discipline:** honest copy ("הנתונים בטוחים"), retry, and a bounded mono error code (`MGMT_OVERVIEW · 503`) that matches the telemetry doctrine.
- **Empty state as guided setup** with per-step status chips (בתהליך/טרם התחיל) and correct RTL progress-fill direction.
- **RTL execution at layout level is strong:** nav right, content scrollbar on the left, chevrons and avatar stacks mirrored, chip status dots at inline-start, search magnifier at inline-start.
- **Persona depth:** in Lead, every mutation is removed or swapped for a read equivalent — no lead-visible edit control found on Home (persona rule ✓ for what exists).
- **Typography with character:** mono numerals (slashed zero) against a clean sans; scale contrast on the 87%/12/7 stats.
- **Real entities only** (non-negotiable #8 ✓): equipment, rooms, crash cart, inventory, Provet PMS, webhooks, RFID readers, users. No ER/patient/med resurfacing.

**State coverage (Home):** default ✓ · read-only(lead) ✓ · empty ✓(admin only — see S4) · loading ✓ · error ✓ · RTL spot-check ✓ (with M1/M2 defects).

---

## Modules 2–10 (not built — nav destinations only)

Each is a sidebar entry that does not navigate. No states, no drawers, no RTL variants exist for any of them. The chat sidebar in the design project confirms only People & Roles and Inventory & Procurement are queued next. Annotations to carry into each build:

2. **People & Roles** — carry persona pattern: role edits admin-only; lead sees roster read-only. Role vocabulary must match the numeric hierarchy (admin/vet/senior_technician=lead_technician/vet_tech/technician/student). Drawer exemplar candidate (user detail: role, shift, check-in state).
3. **Equipment Governance** — the needs-attention rows already deep-link here; build the VT-204 drawer first (S3). Custody/stale semantics need the M3 color fix.
4. **Inventory & Procurement** — "New restock" is the flagship's only creation flow; design the restock drawer/wizard with lead read-only variant. Badge binding (M4) applies.
5. **Integrations & Webhooks** — **carry non-negotiable #4:** credentials render masked (••••), rotate is write-only (never round-trip a secret into an editable input), reveal never exists. The Home activity item "System rotated webhook secret" correctly shows no secret value — keep that discipline. Provet PMS is the only named vendor ✓.
6. **Notifications** — WhatsApp failure surfaces exist on Home; module needs delivery-log states + retry semantics (retry is a mutation → admin-only).
7. **RFID Readers** — heartbeat/offline states already have Home vocabulary ("no heartbeat 12m", "6 of 7 online", מוגבל/degraded). Reader registration = admin-only.
8. **Ops Health** — **frozen-surface rules:** outbox/DLQ/telemetry/keepalive are observed only; carry the READ-ONLY chip pattern; no requeue/purge/transport controls in v1. Charts CSS-illustrative → recharts annotation.
9. **Analytics & Reports** — chart treatment must adopt the fixed readiness palette (post-M3). Wide-layout needs make S2 (max-width strategy) a prerequisite.
10. **Audit** — feed pattern exists (Recent activity); fix M2 (timestamps) before this module inherits it. `AuditActionType` vocabulary is closed — copy must map to real audit kinds.

---

## Compliance scorecard (non-negotiables)

| Rule | Status |
|------|--------|
| 1. RTL-Hebrew-first | ⚠️ Layout mirror excellent; **numeral bidi broken (M1)** → Blocker |
| 2. i18n-keyed copy | ⚠️ Mostly keyed; **"2m ago" hardcoded English (M2)** → Blocker |
| 3. Frozen surfaces read-only | ✅ Pass (READ-ONLY chip, counts only, no Code Blue controls) |
| 4. Secrets masked | ➖ Not exercisable yet (no Integrations page); no leak on Home; carry annotation |
| 5. ≥1024 desktop-only | ⚠️ **Breaks at exactly 1024 (S1)** → Blocker |
| 6. Existing design system | ✅ Consistent tokens/typography observed (DOM check pending on synced source) |
| 7. ≤7 Home tiles | ✅ Exactly 7 |
| 8. Real entities only | ✅ Pass |
| Personas (lead read-only) | ✅ Pass on what exists; ⚠️ drawers missing (S3) so the sharpest test is unverifiable |

---

## Cross-cutting: highest-leverage changes

1. **Build one drawer exemplar pair** (VT-204 equipment detail: admin-edit vs lead-read-only) — unblocks the locked scoping decision and gives the nine modules their most important inherited pattern. (S3, Blocker)
2. **Fix bidi numeral composition** shell-wide (`<bdi>`/ICU messages for every numeral-in-Hebrew string). (M1, Blocker)
3. **Localize relative time** via a keyed formatter; sweep for hardcoded English. (M2, Blocker)
4. **Make 1024 real** (fluid stage or width presets) and **declare the max-width token** for 1920. (S1 Blocker / S2 Medium)
5. **Add clinic context to the shell** (name + switcher placement) before inheritance. (S5, High)
6. **Design Lead × Empty** (read-only unconfigured-clinic view). (S4, High)
7. **Split the two ambers** in the readiness palette; annotate charts as recharts-bound. (M3, High)
8. **Add the hover treatment set** (row tint, nav pill, button shift) to the shell pattern. (M6, Medium)

## Verdict

**Needs-work — but narrowly.** The flagship's visual language, persona mechanics, state scaffolding, data discipline, and frozen-surface/entity compliance are strong and worth inheriting; this is much closer to "go" than to a rework. What blocks it is precisely the stuff the other nine modules would copy: no drawers (the locked decision's core depth), an undemonstrated 1024 floor, broken numeral bidi in the default locale, and unlocalized timestamps. Fix the four Blockers plus clinic context, re-verify Lead × Empty, and the shell + Management Home is ready to be the pattern the rest inherit.

*Evidence: all findings observed live in the Present-mode session of 2026-07-07 and cited by persona/state/locale; screenshots are inline in the review session (disk export unavailable in this environment).*
