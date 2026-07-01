# Design System Alignment — Phase 1

**Source:** VetTrack Design Handoff, Stages 1–10 (this project).
**Target:** `vettrack-ship` (real app) — files below are written to drop into `src/...` as-is.
**Continues the §-numbered decision log started in the handoff (last used: §19, Stage 10).**

This phase treats Stages 1–10 as the source of truth for product direction and brings
the design system's tokens/entities/components up to match — while staying grounded in
the *real* code already in `vettrack-ship/src` (not the compiled `ds-bundle`, which is a
generated re-export layer one step behind `src`).

---

## §20 Decisions

**§20-D1 — Status vocabulary: adopt the real `StatusKind` as-is.**
`src/core/entities/design-tokens.ts` already defines `ok | issue | maintenance |
sterilized | info | neutral | stale | unknown` as the unified status vocabulary. Our
handoff's "stale" and "unknown" (Stage 4 §7, Stage 6) already match it exactly — no new
status tokens needed there. Our "overdue" (Stage 6 equipment enum, Stage 7 Ops Metrics)
folds into `issue` via `normalizeStatus()`; **recommend** adding `"overdue"` alongside
`"critical"`/`"needs_attention"` in that function so intent isn't lost silently.
Stage 5's inventory taxonomy (`in_stock`/`low`/`out`/`expiring`) is a *different* domain
(stock, not equipment-custody) — kept as its own type, mapped to `StatusKind` for color
only: `ok→ok, low→stale, out→issue, expiring→stale`.

**§20-D2 — DeployabilityBadge stays authoritative; confidence is a new, separate axis.**
`DeployabilityBadge` (`custodyState` / `readinessState` / `usageState`) is the real,
shipped model for "what is this equipment's state" and is not being replaced. Stage 6's
location-confidence ladder (high/medium/low/unknown) answers a *different* question —
"how sure are we about the custody/location inference" — and ships as a new companion
component, `ConfidenceIndicator`, meant to sit alongside `EquipmentTruthCard`/
`DeployabilityBadge` on the detail view, never instead of them.

**§20-D3 — Frozen scope, excluded from this alignment.**
Per the Equipment Hero PRD ("no new ER wedge features, medication flows, Code Blue
changes"): Stage 5's medication-dispense flow and all of Stage 9 (Crash Cart, Code Blue
History) are **not** reflected in tokens/entities/components here. Those stages remain
in the handoff as exploratory reference only, clearly out of current product direction.

**§20-D4 — Analytics demoted in nav.**
The PRD demotes "Equipment Intelligence" from main nav. Stage 7's sidebar was updated
in place (small edit, not a rebuild) to show Analytics as a secondary/"More" item
rather than a primary nav row, matching real IA direction.

**§20-D5 — New components this phase (chosen for broadest reuse first):**
`RoleBadge`, `ConfidenceIndicator`, `StatTile`. Each is a thin, real `.tsx` using the
project's actual conventions (`cva`/`cn`, typed props, `t.` i18n singleton) — see
`components/`. Remaining new patterns are scoped for Phase 2 (below).

**§20-D6 — Friction-audit guardrails baked in, not just noted.**
Every new component in this phase already satisfies the relevant findings from
`guidelines/docs/ux-friction-audit.md`:
- No text below `text-sm` on any status/label/value (finding #3).
- All interactive affordances get real `aria-label`s where icon-only (finding #13) —
  N/A for this phase's 3 components (none are icon-only controls), but called out here
  as a standing requirement for Phase 2 (`ChatMessage` composer, sheets).
- `StatTile`/`RoleBadge`/`ConfidenceIndicator` are pure presentational, no forms — findings
  #1/#2/#6/#10/#14 (label/input, validation) apply starting Phase 2 when form-bearing
  components (CSV import history, sheets) are added; will follow the single convention
  the audit recommends (asterisk + `required` + `aria-required`, `htmlFor`/`id` pairing).
- Sheets/dialogs added in Phase 2 will ship with `overflow-y-auto max-h-[90dvh]` by
  default (finding #11) rather than relying on callers to remember it.

## Where these land

```
design-system-updates/tokens/aligned-tokens.css        → append into src/index.css (root :root block)
design-system-updates/entities/design-tokens.additions.ts → append into src/core/entities/design-tokens.ts
design-system-updates/components/role-badge.tsx         → src/components/ui/role-badge.tsx
design-system-updates/components/confidence-indicator.tsx → src/components/equipment/confidence-indicator.tsx
design-system-updates/components/stat-tile.tsx          → src/components/ui/stat-tile.tsx
```

Once merged, the design-sync-cli will pick these up on its normal build (`components/`
`.jsx`/`.d.ts`/`.prompt.md` re-exports + `_ds_bundle.js`/`.css` regenerate from `src` —
nothing here should be hand-written into `ds-bundle/` directly).

## i18n keys to add (en + he)

`t.locationConfidence.high`, `t.locationConfidence.medium`,
`t.locationConfidence.low`, `t.locationConfidence.unknown` — labels for
`ConfidenceIndicator`. (`t.roles.*` already exists in full — see §27-D1.)

## §21 Decisions — Phase 2

**§21-D1 — `AuditLogRow` pixel-matches the real `AuditRowSkeleton`.**
Read the actual skeleton source (`src/components/ui/skeleton-cards.tsx`) rather than
guessing: it already carries a comment stating it "pixel-matches an AuditLogRow" —
fixed 130px timestamp column (left), category badge + single-line summary, optional
target-ref pill (hidden below `sm`), `minHeight: 60`. `AuditLogRow` implements exactly
that shape so loading → loaded never shifts layout. `summary` is typed as a plain
string (not a node) specifically so it can carry a real `title` attribute — friction-
audit finding #8 (truncated text, no tooltip).

**§21-D2 — `ChatMessage` is genuinely new; ships with non-clinical example copy.**
No chat component exists anywhere in the real DS. The Shift Chat *pattern* (normal/
broadcast/urgent bubbles, ack-progress on broadcasts) is not frozen scope — only
ER/medication *content* is (§20-D3) — so this component's docs use supply/scan-style
example copy instead of the original crash-cart wording. Alignment uses logical
`ms-auto`/`me-auto` (not `self-end`/`self-start`), so it's correct under `dir="rtl"`
without special-casing.

**§21-D3 — `Podium`/`RankedList` reuse `--primary`/`--muted` for rank 1 vs. rest;
only medal ring colors are new tokens** (already added in §20-D5's `aligned-tokens.css`).

**§21-D4 — `RoomReadinessCard` is a summary card, not an action sheet.**
The real `MoveRoomSheet` and `EquipmentRoomSweepSheet` already ship and do the
*actions* (move equipment, sweep a room) — neither renders an at-a-glance readiness
summary per room, which is what Stage 6 Room Radar needs. No overlap/duplication.

**§21-D5 — `CsvImportHistoryRow` is a companion to the real `CsvImportDialog`.**
That dialog performs the import; nothing in the real bundle renders the import-history
list shown beneath it. Stage 8 keeps history always visible under the active step
(never a separate mode) — this row is what that list is made of.

All five satisfy the §20-D6 friction-audit guardrails already: `text-sm` minimum
throughout, `title` attributes on every truncated string, no icon-only controls
without labels (none of these five have interactive icon buttons — that requirement
carries forward to Phase 3's sheets).

## §22 Decisions — Phase 3

**§22-D1 — Mock provider shell, scoped honestly.**
`preview/mock-app-providers.tsx` pre-seeds TanStack Query's cache
(`setQueryData`) rather than mocking the `api` module — simpler, and the
component never knows it isn't talking to a real backend. Coverage is stated
precisely, not implied: `EquipmentTruthCard`'s query key and full response
shape are **verified** against the real source
(`src/components/equipment/EquipmentTruthCard.tsx`). `ShiftSummarySheet` is
**partially verified** — only its first query is confirmed; the file is 651
lines and likely has more. `OperationalMetricsDashboard`/`AlertsDropdown`/
`WaitlistPanel` are **not yet read** — the helper pattern is documented so
whoever picks this up next follows the same read-the-source-first approach
rather than guessing shapes.

**§22-D2 — One real prerequisite surfaced, not worked around.**
`src/hooks/use-auth.tsx` defines `AuthContext` without exporting it, so
auth-gated components can't be mocked from outside that file yet. Flagged as
a one-line fix (`export const AuthContext = ...`) rather than papering over it
with a parallel fake auth system that would drift from the real one.

**§22-D3 — `equipment-detail-example.tsx` proves the §20-D2 pairing.**
`ConfidenceIndicator` renders above a mock-seeded, real `EquipmentTruthCard` —
concrete evidence the two compose as intended (confidence-of-inference next
to, not instead of, the real deployability/custody model) rather than just a
claim in prose.

## §23 Decisions — Phase 4

**§23-D1 — Corrected an inaccurate claim in the DS's own README.**
The bundle's README states `AlertsDropdown`, `OperationalMetricsDashboard`, and
`WaitlistPanel` all "expect a TanStack QueryClientProvider." Reading the actual
source shows this is only fully true for `OperationalMetricsDashboard` (takes
no props, must fetch internally: `["/api/operational-metrics/summary",
rangeDays]`, verified). `AlertsDropdown` is **100% presentational** — props
are `alerts`/`alertCount`/`badgeAnimating`, no react-query import at all.
`WaitlistPanel` is **conditional** — it takes `equipment`/`currentUserId` and
an *optional* `snapshot`; when `snapshot` is provided it explicitly skips its
own `useQuery(["equipment-waitlist", equipment.id])` fetch. For design
preview, passing `snapshot` as a prop is simpler and more representative of
how the real Equipment Detail page already calls it (per the prop's own
comment: "equipment detail passes shared snapshot"). This correction belongs
in the real bundle README the next time it's touched — flagging rather than
silently working around it.

**§23-D2 — `ShiftSummarySheet`'s full query surface, now enumerated.**
Six keys total, confirmed by grep: `/api/equipment/my`, `/api/equipment`,
`/api/activity`, `/api/alert-acks`, `/api/home/dashboard`,
`/api/tasks/dashboard` (keyed with `userId`). `seedShiftSummary()` seeds all
six with safe empty defaults, overridable per-key. Response *shapes* beyond
the first key are still not individually verified against each render
section — stated explicitly in the code comment rather than implied.

## §24 Decisions — Phase 5

**§24-D1 — Self-hosted Heebo, replacing the Google Fonts CDN link.**
`vettrack-ship/index.html` currently loads Heebo from Google Fonts at weights
400/500/600/700 alongside Plus Jakarta Sans/IBM Plex Mono/DM Mono/Rubik (one
combined `<link>`). `fonts/heebo/fonts.css` ships the variable font (100–900,
a strict superset) as a single self-hosted file — no CDN round-trip, works
offline. Only the Heebo segment of that link changes; the other four
families are untouched (no variable-font files were provided for those, so
they stay on Google Fonts for now — flagging as a candidate for the same
treatment if/when those are provided too).
`heebo/OFL.txt` (SIL Open Font License) ships alongside the font file, as
required for redistribution.

**Where this lands:**
```
design-system-updates/fonts/heebo/Heebo-VariableFont_wght.ttf → public/fonts/heebo/Heebo-VariableFont_wght.ttf
design-system-updates/fonts/heebo/fonts.css                    → public/fonts/heebo/fonts.css
design-system-updates/fonts/heebo/OFL.txt                      → public/fonts/heebo/OFL.txt
```
Then in `vettrack-ship/index.html`: remove `Heebo:wght@400;500;600;700;`
from the Google Fonts `<link>` (line ~248) and add
`<link rel="stylesheet" href="/fonts/heebo/fonts.css">` alongside it — or
`@import` the same path from `src/index.css` if that's the project's usual
pattern for global styles.

## §25 Decisions — Phase 6

**§25-D1 — App icon, composited from the Icon Composer source you provided.**
`icon.json` is an Apple Icon Composer bundle (the layered-icon format Xcode
16+ uses for the unified light/dark/tinted icon system) — its fill color
(display-p3 0.055/0.071/0.129) converts to essentially exactly
`manifest.json`'s existing `background_color`/`theme_color` (`#0b1021`),
confirming this mark was designed for VetTrack specifically, not a generic
placeholder. The source mark PNG (1024×1024, ~87% transparent) is composited
onto that navy fill at the scale/offset the Icon Composer file itself
specifies (`position-specializations`, ~1.12–1.26×), producing the 4 files
`manifest.json` already references by exact path:

```
design-system-updates/icons/icon-192.png            → public/icons/icon-192.png
design-system-updates/icons/icon-512.png            → public/icons/icon-512.png
design-system-updates/icons/icon-192-maskable.png   → public/icons/icon-192-maskable.png
design-system-updates/icons/icon-512-maskable.png   → public/icons/icon-512-maskable.png
```

The two `-maskable` variants use extra safe-zone padding (mark scaled to
~82% instead of ~116%) so Android's circular/squircle icon mask never clips
it — the "any" variants intentionally fill the canvas closer to the edge,
matching what the source file's own specialization values imply.

**§25-D2 — iOS gets the real Icon Composer bundle, not a flattened PNG.**
`icons/source/icon.json` + `icons/source/Assets/mark.png` are the untouched
original — Xcode 16+ imports `.icon` bundles directly into an asset catalog
and derives its own light/dark/tinted/clear renders from them, which will
look better and stay more correct than any manual PNG flattening. Drop this
into `ios/App/App/Assets.xcassets/` (rename the folder back to
`AppIcon.icon` — the upload's own folder name, `Untitled.icon`, is just a
placeholder Icon Composer gives new projects). Android has no equivalent
native format; the flattened PNGs are the right approach there.

**§25-D3 — Scope: exactly what `manifest.json` already asks for, nothing
guessed.** `public/favicon.png`/`favicon.svg` already exist and aren't
referenced by anything I've verified needs changing — not touched. If you
want those refreshed from the same mark too, say so and I'll generate them
from the same `icon-any-1024-master.png` master rather than re-deriving scale
values from scratch.

## §26 Decisions — Phase 7

**§26-D1 — Correction: Stage 7's "Operational Metrics" screen measures the
wrong thing.** Reading `OperationalMetricsDashboard`'s full render logic (not
just its query key, per your "proceed") shows the real metrics are
Equipment-Hero/deployability counters — `emergencyOverrides`,
`bundleFailures`, `staleConditions`, `procedureBounds`,
`averageCheckoutMs`/`averageDockReturnMs`, optional `deployableSuccessRate`
— gated by a `metricsEnabled` flag. Stage 7's handoff screen showed
"asset-type readiness compliance %" instead, which isn't what this real
feature reports at all. `seedOperationalMetricsSummary()` now seeds the
*real* shape. **Not yet done:** updating Stage 7's actual screen to match —
flagging here rather than quietly leaving the mismatch undocumented; say the
word and I'll rebuild that screen against the real metric set next.

**§26-D2 — `Topbar`/`AppShell` data-connection: inconclusive, not asserted.**
Grepped `src/components/layout/Topbar.tsx` and `.../AppShell.tsx` for
`useQuery` — no matches, but that's as likely a wrong guessed path as a
confirmed "these are presentational." Not stating either way until the
actual file paths are located and read; carried to Phase 8 rather than
guessed.

**§26-D3 — Fixed a documentation bug in this README.** Earlier phase edits
renamed a trailing "Phase N roadmap" heading without clearing the stale
bullets beneath the *previous* heading of the same kind, leaving a duplicate,
partly-already-done roadmap section (mock provider shell, ConfidenceIndicator
pairing — both shipped in Phase 3) sitting below the real, current one. Removed;
folded its one still-open item (i18n keys) into the existing §20 list rather
than tracking it in two places.

## §27 Decisions — Phase 8

**§27-D1 — `t.roles` already exists in full; no i18n additions needed for
roles at all.** Grepped the real dictionary (`locales/en.json` ~3785) instead
of assuming: it already has `admin`, `vet`, `senior_technician`,
`lead_technician`, `vet_tech`, `technician`, `student` — a superset of what
`RoleBadge` originally assumed. Added the two missed roles
(`lead_technician`, `vet_tech`) to `RoleKind` so the type and the real
dictionary match exactly.

**§27-D2 — Renamed our i18n key from `confidence.*` to `locationConfidence.*`
to avoid colliding with an unrelated existing dictionary.** The real
dictionary already has (at least) two separate `confidence: { low, medium,
high }` entries elsewhere for a different, unidentified feature — no
"unknown" key, and unconfirmed whether it's even the same semantic concept.
Rather than guess it's reusable and risk overloading a label that means
something else in context, `ConfidenceIndicator` now reads
`t.locationConfidence.*` — net-new, unambiguous, and still needs its own
"unknown" entry regardless. One JSON addition still required (see below).

**§27-D3 — `apply.sh` makes "where these land" an actual command, not just
prose.** Copies/appends every file in this package to its real destination in
one run. Deliberately does **not** touch `index.html`, `use-auth.tsx`,
`Assets.xcassets`, or the locale JSON files — those four are flagged as
manual on purpose (a `sed`/`jq` one-liner risks silently corrupting a file
whose surrounding content I haven't fully read); the script prints exactly
what's left and why.

## §28 Decisions — Phase 9

**§28-D1 — The honest limit, stated plainly.** Nothing in this project can
execute inside `vettrack-ship` (a read-only local mount from here) — no
commit, no build, no test run. "Force it to land" cannot mean I push code
myself; it means making it **impossible for "nothing landed" to look like
success**. `verify.sh` is that gate.

**§28-D2 — `verify.sh`: three sections, pass/fail per line, one exit code.**
1. **Landed** — every file `apply.sh` copies is checked for real existence
   at its destination (not "the script ran," the *file is actually there*).
2. **Manual steps** — the 4 things `apply.sh` refuses to automate (§27-D3)
   are checked directly: is `AuthContext` actually exported now, is the
   Google Fonts Heebo segment actually gone, are both locale files actually
   carrying `locationConfidence`, is the iOS icon bundle actually in the
   Xcode asset catalog.
3. **Drift** — re-asserts the specific source facts Phases 1–7 verified
   (`EquipmentTruthCard`'s query key, `AuditRowSkeleton`'s pixel shape,
   `OperationalMetricsDashboard`'s query key, `WaitlistPanel`'s
   prop-skips-fetch gate, `AlertsDropdown`'s no-query-at-all status). If the
   real app changed since those were read, this fails loudly instead of
   quietly shipping a seed helper that's now wrong.

Exit code is non-zero if *anything* in any section fails — a CI step or a
pre-merge check can gate on it directly rather than trusting a visual scan.

**§28-D3 — Run it, don't just read it.** `bash design-system-updates/verify.sh`
from the `vettrack-ship` root, any time — before applying (everything in
section 1/2 correctly fails, section 3 should all pass), and after (section
1/2 should flip to passing; section 3 re-confirms nothing moved underneath
this package while it sat unapplied).

## §29 Decisions — Phase 10

**Source:** design review note, "Increase depth hierarchy" — most surfaces
read as background → card → card → card, with a suggested 0–4 elevation
scale (app background / cards / active panels / sheets-modals / emergency
overlays) and example shadow values.

**§29-D1 — Elevation ladder, extended not replaced.** Read the real shadow
tokens (`src/index.css`) before touching anything: `--shadow-card`,
`--shadow-card-hover`, `--shadow-surface` already exist, already used by
`Card` and `Select`'s popover, and are explicitly commented "precise, not
floaty" — layered, slate-900-tinted `rgb(15 23 42 / α)`, not flat black. A
real, if incomplete, system — not a blank slate. The reviewer's literal
`rgba(0,0,0,…)` values are **not** adopted verbatim; two new rungs
(`--shadow-modal`, `--shadow-overlay`, `tokens/elevation-tokens.css`) extend
the same tinted/layered idiom upward instead of grafting a different visual
language on top of it:

| Level | Use | Token | Status |
|---|---|---|---|
| 0 | app background | *(none)* | — |
| 1 | cards | `--shadow-card` / `--shadow-card-hover` | existing, unchanged |
| 2 | active panels (popovers/dropdowns/tooltips, no scrim) | `--shadow-surface` | existing, now actually applied consistently (§29-D2) |
| 3 | sheets/modals (own a scrim, block the page) | `--shadow-modal` | **new** |
| 4 | emergency/system-critical overlays | `--shadow-overlay` | **new** |

**§29-D2 — The real bug wasn't "no ladder," it was an *inconsistent* one —
verified component-by-component, not asserted.** Grepped every `shadow-*`
usage across `src/components`:
- `Dialog`/`AlertDialog` (`shadow-xl`) and `Sheet` (`shadow-lg`) sit at the
  identical `z-50` tier (per `src/index.css`'s own z-index table) yet
  carried two different, untokenized weights — an accidental gap, not a
  designed one. Both now `shadow-modal`, along with the mobile nav drawer
  in `layout.tsx` (was a bare `shadow-2xl`).
- `AlertsDropdown` (a dismiss-on-outside-click menu, `z-[60]`) reached for
  `shadow-xl` — visually as heavy as a full-screen modal for a small
  notification panel. Now `shadow-surface`, matching `HelpTooltip` and
  `Select`'s popover (which already used `shadow-surface` correctly — the
  one component that had this right from the start).
- `EquipmentRoomSweepSheet` self-promotes its own `SheetContent` to `z-[70]`
  — the single highest ordinary stacking tier, shared only with
  `OnboardingWalkthrough` — but inherited `Sheet`'s base shadow with **no**
  boost. The most-elevated sheet in the app had the least distinguished
  shadow of any of them. Now carries `shadow-overlay` via its own
  `className` override.
- Two `PwaInstallPrompt` variants (Android banner vs. iOS guidance) render
  the identical role — a dismissible install nudge — but shipped `shadow-xl`
  and `shadow-2xl` respectively, for no documented reason. Both now
  `shadow-surface`, alongside `SyncStatusBanner` (same family: a fixed,
  non-blocking status banner, was `shadow-lg`).
- `EquipmentTruthCard` passes `shadow-sm` / `shadow-md` **into** `Card`,
  which already applies `shadow-card` itself — `cn()`/tailwind-merge keeps
  the last conflicting utility, so the passed class was silently
  *downgrading* an aligned token to Tailwind's generic default. Fixed: the
  resting variant drops the redundant override (now inherits `Card`'s own
  `shadow-card`); the "pinned" emphasized variant gets `shadow-card-hover`
  — it wants *more* weight than resting, not less.

**§29-D3 — Found, flagged, not fixed (scoped out of this phase):**
- `FirstScanCelebration` renders at `z-[120]` — outside `src/index.css`'s
  own documented z-index table, which tops out at "`z-[70]+` System-critical
  full-screen modals." Its shadow is aligned here (`shadow-overlay`, §29-D2)
  but the table comment itself is still stale; a one-line doc update, left
  for whoever next touches that file rather than sed'd sight-unseen (the
  multi-line comment insert isn't a safe single-literal match like the rest
  of this phase). `verify.sh` asserts the z-[120] fact itself so this
  doesn't silently drift further.
- `.dark` never overrides `--shadow-card` / `--shadow-card-hover` /
  `--shadow-surface` — dark mode silently reuses the light-mode tinted
  alpha values, which read as nearly invisible against `--card: 234 40% 12%`.
  Real, and arguably makes dark-mode elevation *flatter* than light mode —
  but rewriting three tokens' worth of already-shipped, light-derived
  behavior deserves visual QA in the running app, which isn't possible from
  here. The two **new** tokens ship `.dark` values (higher-alpha,
  black-based) since there's no existing behavior to regress there.
- ~40 more `<Card className="...shadow-sm">` call-sites exist across
  `src/pages/*.tsx` (grepped, not touched) — the identical override pattern
  as `EquipmentTruthCard` above, at much larger surface area (`analytics.tsx`
  ×7, `admin.tsx` ×6, `appointments.tsx` ×7, `equipment-detail.tsx` ×3, and
  more). Every one is the same mechanical "drop the redundant `shadow-sm`"
  edit as §29-D2 — but 40 call-sites across a dozen page files is a
  distinctly larger-blast-radius change from "fix the shared primitives,"
  and deserves its own reviewable pass. Good Phase 11 candidate.

**Where this lands:** everything in this phase is scripted by `apply.sh`
directly (sed edits to existing files, not new files to hand-copy) — see
its new "Phase 10" section. `tokens/elevation-tokens.css` is the one new
file, appended into `src/index.css` the same way `aligned-tokens.css` was
in Phase 1.

## §30 Decisions — Phase 11

**Source:** same design review pass as Phase 10 — "Introduce a richer
surface system" (bg/surface/card → a 5-step ivory ramp) and "Strengthen the
primary brand color" (forest green → richer emerald). This phase covers
the surface system only; the brand-color half is deliberately not started
— see §30-D3.

**§30-D1 — Real gap, verified.** `src/index.css` has exactly two
background-ish ivory steps: `--ivory-bg` (246 247 251) and `--ivory-surface`
(255 255 255) — nested panels, hover, and pressed/selected states all fall
back to generic Tailwind grays or collapse onto one of those two. Three new
steps round it out to five: `--ivory-panel`, `--ivory-hover`,
`--ivory-active` (`tokens/surface-tokens.css`), wired into
`tailwind.config.ts`'s `ivory` color object the same way the existing
entries are.

**§30-D2 — `--ivory-bg` itself changes from cool to warm — flagged, not
silent.** The current value carries an explicit comment: `/* cool
near-white — precise, clinical */` — a deliberate choice, not a bug.
Reversing it is a real call, made because the design system's own name and
its own guide ("the 'Ivory' design system... warm off-white background")
already promised warmth before that comment existed — the cool value reads
as the undocumented drift, not the reviewer's request. Proceeding on the
background/neutral tier specifically because it's lower-stakes than a
brand hue: nobody designed a logo around the *canvas* color. Compare
§30-D3, where the same kind of conflict gets the opposite call.

**§30-D3 — Brand-color half NOT started — a real conflict, surfaced rather
than guessed past.** The review's premise is that the current primary is a
muted forest green. The actual current `--primary`/`--brand` is **indigo**
(`#4f46e5`, `hsl(234 85% 63%)`) — confirmed against `src/index.css`'s own
comment ("VetTrack brand indigo/navy (matches the VT logo: navy #0b1021,
indigo mark)") and against the literal logo file (`Brand-Logo.png`): navy
background, indigo-to-periwinkle gradient mark, no green anywhere. The one
real forest green in the app is `--action` (`#15803d`), deliberately
*reserved* for scan/confirm/task-completion — a secondary accent, not the
brand color. The review's 3-row table (Primary / Success / Active nav) maps
onto real tokens as: "Primary" → actually `--action` (the green users
see most, via the scan FAB) — "too similar to Success" is a real,
verifiable observation (`--status-ok` at `hsl(142 76% 36%)` sits close to
`--action`'s `#15803d`). "Active nav" → `--ivory-green`/`--ivory-greenBg`,
which are *also* indigo despite the name (confirmed at 4 real nav
call-sites: `layout.tsx` ×3, `IconSidebar.tsx` ×1). Executing the review
literally (green as system-wide primary) would put the UI's dominant color
at odds with its own logo. Asking rather than guessing which the reviewer
actually wants — a richer *action* green with indigo staying the brand
color, or an actual brand-hue change (bigger; would want a logo
conversation too). This section gets a follow-up once that's resolved.

**Where this lands:** `tokens/surface-tokens.css`, appended into
`src/index.css` + one `tailwind.config.ts` wire-up, both scripted by
`apply.sh`'s new "Phase 11" section. Component-level adoption (retargeting
real hover/pressed states from generic Tailwind grays onto
`ivory-hover`/`ivory-active`) is NOT done this phase — the tokens are net
new, there's no existing "bug" to fix at call-sites the way Phase 10 had.
Good Phase 12 candidate once someone points at specific screens.

## §31 Decisions — Phase 12

**Source:** resolution of §30-D3 — user confirmed direction "A: keep indigo
brand, richen green action" and asked for the visual refresh to reach all
the way through Stages 3–10.

**§31-D1 — Indigo stays `--primary`/`--brand`, unchanged.** Verified still
`hsl(234 85% 63%)` in `src/index.css` and untouched by this phase — the
logo-matching rationale from §30-D3 holds. Everything below only touches
the real forest-green `--action` family and `--status-ok`.

**§31-D2 — `--action` richened; `--status-ok` deliberately pulled apart
from it, not just bumped.** Old values, side by side:

| Token | Old | New |
|---|---|---|
| `--action` | `#15803d` | `#2f6f5e` |
| `--action-deep` (hover) | `#166534` | `#285c4e` |
| `--action-ink` | `#1a6d38` | `#2a6555` |
| `--action-soft` | `#ecf6ee` | `#e8f2ee` |
| `--action-border` | `#c7e3cf` | `#c9ded9` |
| `--status-ok` | `hsl(142 76% 36%)` | `hsl(142 72% 42%)` |
| `--status-ok-bg` | `#f0faf2` | `#effaf3` |
| `--status-ok-fg` | `#166534` | `#145d2e` |
| `--status-ok-border` | `#a7f3bd` | `#a8e6bf` |

The user's example values (`#2F6F5E`/`#285C4E`/`#E8F2EE`) turned out to
already follow the app's own existing hue/lightness convention almost
exactly (same hue held between base and hover, ~5pt lightness drop for the
hover step — identical pattern to the original `--action`/`--action-deep`
pair) — adopted directly rather than re-derived. `--status-ok` keeps its
original hue (142°, a true medical green) while `--action` moves to a
teal-leaning 164° — the two were only 7 lightness points apart before
(read as near-duplicate greens, confirmed the review's "too similar"
point); now separated in hue, lightness, and saturation.

**§31-D3 — Scoped to default `:root`; theme variants found, not touched.**
`data-color-theme="clinical"` and `data-color-theme="dark"` each carry
their own `--action`/`--status-ok` overrides. In the **clinical** variant
specifically, `--action` (`#22c55e`) and `--status-ok` (`hsl(142 71% 45%)`)
are **currently identical colors** — a stronger version of the same bug,
found while grepping for this phase. Left alone for now (would need its own
differentiated pair, and this variant sees much less traffic) — flagged
here rather than silently left inconsistent. The plain `.dark` CSS class
still has no `--action`/`--status-ok` override at all (inherits the light
values) — the same category of gap Phase 10 found for shadows, not
re-solved here either.

**§31-D4 — "Active nav" from the original review needs no change here —
it was never the green token to begin with.** The review's table listed
"Active nav: low contrast → stronger green tint" alongside Primary/Success.
Per §30-D3, real active-nav state (`layout.tsx` ×3, `IconSidebar.tsx` ×1)
runs on `--ivory-green`/`--ivory-greenBg`, which are indigo values despite
the name — i.e. it's already brand-colored, not action-green-colored. Since
this phase keeps indigo as brand (§31-D1), active-nav is correctly
untouched; introducing green there would contradict the very brand-color
decision this phase just confirmed.

**§31-D5 — Stage handoff (1–10) updated to match, full reach per user's
answer.** Stages 1–9 each declare their own local `--action` (light +
dark); Stage 10 has no `--action` token at all (no scan/action element in
its screens — auth/onboarding/legal/FAQ) and was left alone. Every other
stage's root `--action` value now matches this phase's real value; Stage
1's token-guide swatch (`--action ⚑`) shows the new hex directly. Stage
files don't have a separate `--status-ok` value to fix — their status
colors alias onto `--sys-green` (Apple system green), already well
differentiated from `--action` in both the old and new palettes, so no
"too similar" problem existed there.

**Where this lands:** `tokens/brand-action-tokens.css`, appended into
`src/index.css`, scripted by `apply.sh`'s new "Phase 12" section — a pure
token append, no sed patches needed this time (every real consumer already
reads the CSS variables, never a hardcoded hex).

## §32 Decisions — Phase 13

**Source:** user asked to go back and finish the two things Phases 10/11
deliberately deferred — the ~40-call-site Card override cleanup, and
component-level adoption of the Phase 11 surface tokens.

**§32-D1 — Card `shadow-sm` overrides, all of them, re-grepped fresh (not
from memory).** Same bug class as `EquipmentTruthCard` in Phase 10:
`className="bg-card border-border/60 shadow-sm"` passed into `<Card>`,
which already applies `shadow-card` itself — the passed class wins via
`cn()`/tailwind-merge and silently downgrades the token to Tailwind's
generic default. Fixed at 34 call-sites across 9 page files (`analytics.tsx`
×7, `admin.tsx` ×6, `appointments.tsx` ×7, `admin-shifts.tsx`/
`new-equipment.tsx`/`management-dashboard.tsx`/`equipment-detail.tsx` ×3
each, `my-equipment.tsx`/`alerts.tsx` ×1 each), plus 2 with a matching
`hover:shadow-md` retargeted to `hover:shadow-card-hover`
(`rooms-list.tsx`, `equipment-list.tsx`), plus one with a `/80` border
opacity instead of `/60` (`inventory-page.tsx`). 4 more
(`shift-leaderboard.tsx`, `signup.tsx`, `signin.tsx`, `help.tsx`) are
hand-rolled `bg-card` divs rather than the `<Card>` component itself — not
literally the override bug, but the same "generic Tailwind default instead
of the token" pattern, fixed the same way.

**§32-D2 — 2 more shadow-ladder misses, found by the same grep, never on
Phase 10's original list.** `appointments.tsx`'s hover-card tooltip
(`bg-popover ... shadow-xl`) was at modal strength for a dismissable
popover — now `shadow-surface` (Level 2), matching `HelpTooltip`/`Select`/
`AlertsDropdown`. `room-radar.tsx`'s NFC Room Reset overlay is a
hand-rolled `z-50` modal (own backdrop, own `fixed inset-0` — never routed
through the `Dialog` component) that Phase 10's component-level pass
couldn't have found by reading `dialog.tsx` alone — now `shadow-modal`
(Level 3), matching `Dialog`/`AlertDialog`/`Sheet` at the same stacking
tier. Neither of these was in Phase 10's original README §29 list; both are
the same class of bug, caught by re-running the search rather than trusting
the earlier pass was exhaustive.

**§32-D3 — Phase 11's `ivory-hover`/`ivory-active` adopted at the exact
hack they were built to replace.** `layout.tsx`'s mobile nav drawer rows
(5 identical occurrences) were doing `hover:bg-ivory-border/40
active:bg-ivory-border/60` — reusing the *border* token at low opacity as
an improvised background tint, because no dedicated hover/active token
existed yet. Now `hover:bg-ivory-hover active:bg-ivory-active` — the real
tokens, not a border-color-as-fill workaround. `IconSidebar.tsx`'s
icon-only nav (desktop) only ever changed *text* color on hover
(`hover:text-ivory-text2`, no background at all) — added
`hover:bg-ivory-hover` alongside it for a more tactile hit target, same
spirit as the richer-surface-system ask.

**§32-D4 — Left alone, on purpose.** `layout.tsx` line ~1256 (a *different*
nav-item list, likely the "more" sheet) uses `hover:bg-muted/70
active:bg-muted` — the generic shadcn tokens, not the ivory-border hack.
It's internally consistent with itself (both its hover *and* its active
state use the generic family, unlike the ivory-border sites where only
hover/active were improvised while everything else was ivory-branded) — so
it reads as a deliberate choice to stay on the generic/shadcn track for
that particular sheet, not a bug. Converting it would mix two brand
systems on a guess; left for whoever owns that sheet to decide.

**Where this lands:** all sed patches via `apply.sh`'s new "Phase 13"
section — no new tokens, no new files. Every fix reuses a token that
already exists (from Phase 10, Phase 11, or the original ds).

## §33 Decisions — Phase 14

**Source:** next review batch — finish §32-D4 (layout.tsx unification),
"Increase typography contrast," "Make status chips more premium," "Upgrade
card architecture," "Improve mobile visual density."

**§33-D1 — §32-D4 finished, not just left as a documented choice.** The one
nav-item list in `layout.tsx` still on generic shadcn tokens
(`bg-primary/8 text-primary`, `hover:bg-muted/70 active:bg-muted`) is now
unified onto the same ivory-brand family as its 5 siblings
(`bg-ivory-greenBg text-ivory-green`, `hover:bg-ivory-hover
active:bg-ivory-active`) — and picks up the real Phase 11/13 tokens
directly rather than ever passing through the old ivory-border hack. No
more than one brand system in `layout.tsx`'s nav rendering.

**§33-D2 — Typography: two systems both needed touching, not one.** The
app has two parallel type scales: the named `--text-*` custom properties
(28/18/16/14/12px — comments read "page titles" / "card titles" / "body
default" / "secondary body" / "captions," an exact match for the review's
"current" column) and Tailwind's own default `text-2xl`/`lg`/`base`/`sm`/
`xs` utilities (24/18/16/14/12px stock), which is what most real components
actually use — `CardTitle`, `h1`/`h2`/`h3` (via `@apply text-2xl...`), and
the bulk of ad hoc page code. Bumping only the named tokens would be
correct but nearly invisible (limited real adoption, see Phase 11's own
§30 note on the same gap). Bumping only Tailwind's scale would drift from
the documented token values. Did both: the 5 named tokens to the review's
exact px values, AND a `tailwind.config.ts` `fontSize` extension so
`text-2xl`/`lg`/`base`/`sm`/`xs` resolve to the same new sizes everywhere
they're already used — no per-component hunting required, but a genuinely
wide visual change (every text-lg, text-sm, etc. app-wide). `--text-xl`
(22px, "section headings") and `--text-2xs`/`--text-3xl` were **not** in
the review's table and are untouched — worth noting `--text-lg`(20) and
`--text-xl`(22) are now only 2pt apart, tighter than before (18→22, 4pt);
flagged, not resolved, since it wasn't part of the ask. Heading
letter-spacing (-0.02em) added directly to `h1`/`h2`/`h3` (real headings)
and to `.vt-title` (was -0.01em); `.vt-page-title`/`.vt-display` already
had -0.02em, untouched. Body line-height: `--leading-normal` 1.55→1.5, and
the `p { @apply leading-relaxed; }` base rule (which was actually
Tailwind's 1.625, not the 1.55 token, for real `<p>` tags) changed to an
explicit `line-height: 1.5`. RTL is unaffected — `src/index.css` already
has `html[dir="rtl"] h1,h2,h3 { letter-spacing: normal }` at higher
specificity, resetting these for Hebrew regardless.

**§33-D3 — Status chips: pill, tint-only, no border, font-medium, 28px.**
`StatusBadge` (the real, DS-recommended component for clinical status —
its own dot was already there, only the container read as "traditional
admin") is a full replacement:
`rounded-[4px]` → `rounded-full`, drops its `1px solid` border entirely,
explicit `h-7` (28px), `font-semibold` → `font-medium`. `Badge`'s 4
status-semantic variants (`ok`/`issue`/`maintenance`/`sterilized`) lose
their border the same way, for consistency — `Badge`'s
`default`/`secondary`/`destructive`/`outline` variants are generic UI
badges, not "status chips," and are deliberately untouched.

**§33-D4 — Card architecture: 3 variants, `primary` (no shadow) as
default — a real, wide visual change, called out explicitly rather than
softened.** `primary`: background + subtle border, no shadow (static
containers — the common case). `interactive`: adds `shadow-card` +
`hover:shadow-card-hover` + a lift + `cursor-pointer` (reserved for cards
that are actually clickable). `critical`: `border-s-4 border-s-destructive`
left accent (logical "start" side, RTL-safe); pairing it with a
high-contrast heading is a usage note in the component's own comment, not
something `Card` can enforce on a free-form child. Making `primary`
(shadow-less) the default means **every existing bare `<Card>` app-wide
loses its Phase-10 `shadow-card` by default** — that follows the review's
own framing ("most cards currently use border, shadow, padding" was the
complaint), but it's a wide, visible change and is flagged as such rather
than buried. One known-interactive real card (`rooms-list.tsx`) got the
explicit `variant="interactive"` prop so it keeps shadow + hover; the other
~40 Card call-sites from Phase 13 were not individually audited for
whether they're secretly interactive too — same "not exhaustive, flag
don't guess" posture as every prior phase.

**§33-D5 — Mobile density: mostly satisfied by §33-D3/D4, the spacing-px
half deliberately not attempted.** "Reduce badge height / border
visibility / shadow intensity" — badge height+border: §33-D3 (though note
the chip spec's *explicit* 28px pill is a specific, deliberate height, not
literally "shorter" than before — resolved in favor of the more detailed
chip spec where the two asks tension; visual weight still drops since the
border disappears). Shadow intensity: §33-D4's shadow-less `primary`
default. "Increase vertical rhythm 8→12px / section spacing 16→24px" —
**not attempted**. Unlike the shadow/color token work, there's no single
token or shared wrapper this reaches through — `src/index.css`'s own
`[data-density="compact"]` block proves spacing is applied ad hoc, per
page, via plain Tailwind `gap-*`/`space-y-*`/`p-*` utilities, not a shared
constant. Globally overriding those utility classes (the only mechanical
lever available) would hit every use of `gap-2`/`gap-4` app-wide —
icon-to-text gaps, button padding, unrelated layouts — not just "section
spacing," with no way to visually verify the result from here. The
existing `[data-density="compact"]` mechanism is the right *pattern* to
extend (an opt-in, attribute-scoped override, not a blind global one) —
doing that well needs page-by-page rhythm decisions a follow-up phase
should make deliberately, not infer from a single px pair.

**Where this lands:** `components/status-badge.tsx` and `components/card.tsx`
are full-file replacements (`cp`, not sed — both needed structural changes:
a new cva-based variant system for `Card`, a border/radius/height rewrite
for `StatusBadge`) via `apply.sh`'s new "Phase 14" section. Everything else
(layout.tsx, index.css, tailwind.config.ts, badge.tsx, rooms-list.tsx) is
sed, same as Phases 10/11/13.

## §34 Decisions — Phase 15

**Source:** "Introduce a criticality system" — Normal/Attention/Critical,
illustrated with a left-rail alert ("┃ Ventilator requires service")
instead of a boxed alert.

**§34-D1 — Criticality is a second, independent axis on `Card`, not a 3rd
`variant` value.** Phase 14 had briefly put a `critical` variant alongside
`primary`/`interactive` (§33-D4) — collapsed here, because interactivity
and operational urgency are orthogonal (a critical alert card can also be
tappable; the old single-enum design couldn't express "interactive AND
critical" at once). `card.tsx` now has `variant` (primary/interactive,
unchanged from Phase 14) and a new, independent `criticality`
(normal/attention/critical, default `normal`). `attention` reuses the real
`--status-maintenance`/`--status-maint-bg` tokens (the app's existing
"maintenance" semantic — no new color invented, same posture as every
token decision in this package). `critical` is `border-s-4
border-s-destructive` + `shadow-card-hover` ("elevated card") — no
background tint, matching the review's own spec precisely (it lists a tint
for Attention but not for Critical; a restrained rail plus elevation reads
as more serious than a flooded-red background). "Strong title" is a usage
note in the component's own comment (pair with a high-contrast
`CardTitle`), not something `Card` can enforce on a free-form child.

**§34-D2 — The two real "standard alert boxes" this review is reacting
to, found and fixed, not just the general capability shipped.**
`AlertCard.tsx` (the real, shipped alerts component) was exactly the
pattern in the review's "instead of" example — `rounded-sm border` on all 4
sides. Now `border-s-4` (rail only), same 3 tones (`err`/`warn`/`ok`), same
tokens. `err` (the closest existing tone to "Critical") picks up
`font-bold` + `shadow-card-hover`, matching the new Card critical
treatment's weight; `warn`/`ok` stay at the lighter existing weight.
`ErrorCard.tsx` was the other one — `<Card className="border-destructive
bg-destructive/5">`, a hand-rolled 4-side red border. Rather than give it
its own similar-but-different rail treatment, it now composes the actual
new system: `<Card criticality="critical" className="bg-destructive/5">` —
real adoption of §34-D1, not a parallel implementation.

**§34-D3 — Not done: auditing every other real alert-ish surface for the
same box-not-rail pattern.** `AlertCard`/`ErrorCard` were the two
components whose names and existing code most directly matched the
review's "standard alert box" complaint (grepped and read this phase,
confirmed). Other candidates — inline warning banners, form validation
messages, `CsvImportDialog`'s error states — were not audited. Same
posture as every other phase: fix what's confirmed, flag rather than
guess at the rest.

**Where this lands:** `components/alert-card.tsx` is a new file (`cp` to
`src/components/alerts/AlertCard.tsx`); `components/card.tsx` is the same
destination as Phase 14, just revised source content — no `apply.sh`
changes needed there beyond re-running the existing `cp`. `error-card.tsx`
is one sed edit. All in `apply.sh`'s new "Phase 15" section.

## §35 Decisions — Phase 16

**Source:** retrospective audit of Phases 10-15 — verify the elevation
ladder against modal/popover/dropdown/command-palette/drawer; extend
tabular-nums to numeric displays; revise the status-chip border call;
add a 4th criticality level.

**§35-D1 — Elevation audit: clean bill of health, nothing to fix.**
Checked each surface named against what Phase 10 actually landed: Dialog/
AlertDialog → `shadow-modal`; Select/HelpTooltip/AlertsDropdown →
`shadow-surface` (popover/dropdown tier); Sheet + the hand-rolled mobile
nav drawer → `shadow-modal`; OnboardingWalkthrough/FirstScanCelebration/
custom high-z sheets → `shadow-overlay`. No "command palette" component
exists in this app (grepped `src` — only unrelated "Command Center"/
"Command board" *page* names, a Ward-Display feature, nothing cmdk-shaped)
— not a gap, just not applicable here.

**§35-D2 — Tabular numerals: real gap, real existing infrastructure.**
`.font-num` already exists and already sets `font-variant-numeric:
tabular-nums` (plus the DM Mono stack and a zero-slash feature) — this
isn't new CSS, it's an adoption question. `code-blue.tsx`'s timer,
`ShiftProgressHero.tsx`'s stats, and `EquipmentTriageList.tsx`'s counts
already use it; `inventory-page.tsx` already has bare `tabular-nums` in 5
spots. `analytics.tsx` — literally the utilization/financial-metrics
screen the review named — had neither, on all 4 of its headline stat
numbers. Fixed there; a full app-wide numeric-display audit (schedules,
appointment times, every remaining count) was not attempted this phase.

**§35-D3 — Status chip border: reversed, on purpose, with reasoning kept
in the component's own comment.** Phase 14 removed StatusBadge's border
entirely, per the original review. This phase's revision — hospital
fluorescent lighting washes a border-less, low-alpha tint chip toward
invisible — reintroduces a **subtle** border only (the existing
`--status-*-border` tokens, unchanged values, not new colors) and bumps
`font-medium` → `font-semibold`. Still a pill, still `h-7`, still no full
admin-bracket box — the correction is "subtle border, not zero," not an
undo of Phase 14's direction. Did not recompute the bg/border tint
percentages themselves (4-6%/12-18%) from scratch — the existing
`--status-*-bg/-border` tokens were designed as tints already and were not
re-derived pixel-by-pixel this phase.

**§35-D4 — 4th criticality level: `maintenance`, with a naming collision
flagged loudly.** "Not broken, not urgent, but action required" (e.g.
preventive service due) — blue-green rail, reusing `--action`/
`--action-soft` (Phase 12's richer emerald-forest accent, a genuine
teal/blue-green hue). The real app's `StatusKind` **already has** a
`maintenance` value — amber, meaning equipment currently out for
repair — a different concept entirely. `Card`'s `criticality="maintenance"`
is a separate prop/namespace (no code collision), but the shared word
across two different colors and meanings is a real readability trap for
whoever touches this next — documented prominently in `card.tsx`'s own
header comment, not just here, so it surfaces at the point of use.

## §36 Decisions — Phase 17

**Source:** navigation motion timing spec — sheet 220ms, drawer 260ms,
modal 180ms, page 240ms.

**§36-D1 — Real durations audited against the spec, not assumed.** Sheet
was asymmetric and slow: `duration-300` closing / `duration-500` opening —
now a flat `220ms` both directions, matching the spec exactly (and fixing
the open/close asymmetry as a side effect). Dialog/AlertDialog were
`200ms` → `180ms`. The route-transition `page-enter` keyframe already
existed at `0.22s` (220ms, with its own comment noting *"large values feel
like jump / CLS with lazy routes"* — a deliberate prior decision) → `240ms`
per spec, a small enough bump not to fight that reasoning. The mobile nav
drawer (`layout.tsx`, hand-rolled, not the `Sheet` component) was
`duration-220` → `260ms`. Only durations changed — easing curves and the
open/close mechanism itself are untouched.

**§36-D2 — Operational/clinical motion (scan pulse, sterilization settle,
attention breathing pulse, critical shadow pulse): not built this phase.**
The real app already has a substantial keyframe library —
`syncSuccessBoom`, `checkPop`, `scanAmbient`, `alertPing`, `badgePop`,
`scanningBar`, `scan-count-pop`, `stroke-draw` — that plausibly already
covers some of what's being asked for (a scan-confirmation boom, a
check-mark pop, an ambient scan pulse, an alert ping). Building new,
possibly-duplicate keyframes without first reading what each existing one
actually does and where it's wired up risks shipping a second, competing
motion language instead of systematizing the one that exists. That audit —
existing keyframe → real trigger point → keep/rename/extend — is real work
or its own phase, not a same-turn add-on.

**§36-D3 — Screenful-density metric audit: not attempted, and said so
plainly rather than guessing numbers.** "How many actionable items fit
above the fold" is a measurement of a *rendered* page at a *real* viewport
height — this project can read the source (`vettrack-ship` is a read-only
local mount) but cannot run the app, so there's no way to produce an
honest per-screen fold count from here. Fabricating plausible-sounding
numbers for Dashboard/Equipment/Patients/Appointments/Alerts would be
worse than not answering. If useful: the methodology itself (render each
page at the target device viewport, count fully-visible actionable rows
before the first scroll, compare against the stated targets) is sound and
is a reasonable next step for whoever can run the real app.

**Where this lands:** all sed edits (durations) + 2 re-`cp`'d component
files (`status-badge.tsx`, `card.tsx`, same destinations as Phases 14/15,
revised content) via `apply.sh`'s new "Phase 16" and "Phase 17" sections.

## §37 Decisions — Phase 18 (partial — A/B/C/D audit)

**Source:** follow-up audit — broaden the numeric-typography grep
(currency, %, counts, durations, utilization, schedules, occupancy);
audit alert-surface consistency (banners/validation/CSV errors); audit
empty-state consistency (8 named scenarios); audit skeleton-loading
consistency.

**§37-D1 — Numeric typography, round 2: 3 more real gaps fixed, several
found-not-fixed, listed honestly.** Fixed:
`management-dashboard.tsx`'s three equipment-status counts (available/
in-use/issues — exactly "equipment counts" from the original ask) had
neither `font-num` nor `tabular-nums`; now `font-num`. **Found, not
fixed** (grepped this phase, real, left for a follow-up pass): `rooms-
list.tsx`'s Health Ring percentage (`{pct}%`) and utilization bar;
`procurement.tsx:239`'s currency total (`${(total/100).toFixed(2)}`);
`inventory-page.tsx`'s progress percentage at line 742; `display.tsx`'s
Ward-Display percentages (uses `vt-text-xs`, which is font-size only, no
numeral treatment). None of these are hidden — they're a known, scoped
remainder, not silently missed.

**§37-D2 — Alert-surface consistency: not audited this phase.** Flagged
already in §34-D3 as a follow-up (inline banners, form validation, CSV
import errors) — still not done. No new information to add beyond that
flag; restating it here so it isn't lost between phases.

**§37-D3 — Empty states: audited, already consistent — a clean bill of
health, not a gap.** Grepped every `EmptyState` usage: 20 call-sites
across 13 pages (equipment, appointments ×6, alerts, inventory, rooms,
analytics ×2, audit-log, admin, home, shift-leaderboard,
management-dashboard) — all route through the one real, shared
`EmptyState` component, not ad hoc per-page markup. This is the opposite
finding from the alert-box audit (§34): no drift to fix. Not independently
confirmed: whether "offline" and "permission denied" states (not obviously
named in this grep) use `EmptyState` too, or a different mechanism —
narrow enough to flag rather than block on.

**§37-D4 — Skeleton loading: spot-checked, consistent where checked, not
exhaustive.** `equipment-detail-skeleton.tsx` follows the base `Skeleton`
component's own documented convention exactly (pass a `rounded-*` class
matching the real element it stands in for, so there's no shape "pop" on
swap) — `rounded-xl`/`rounded-2xl` used correctly throughout. Did not
individually check every named skeleton (`SkeletonAlertCard`,
`SkeletonEquipmentCard`, `EquipmentListSkeleton`, `AuditRowSkeleton` —
the last one already verified pixel-matched in Phase 2/§21-D1) against
this same standard — one spot-check passed, not a full sweep.

**§37-D5 — Phases 18-21 roadmap (motion inventory → operational motion →
haptics → sound): responding honestly about what's buildable here rather
than executing all four same-turn.** Motion inventory (catalog existing
keyframes, classify keep/modify/delete) is real, scoped, buildable work —
a natural next phase, not attempted this turn given the size of A-D above.
Operational motion language (scan/sync/sterilize/confirm/acknowledge/
critical) is partially buildable — CSS animations tied to real interaction
points — but depends on the inventory being done first so it extends
existing keyframes instead of duplicating them (same reasoning as §36-D2).
Haptics: this is a Capacitor app (real `capacitor.config.ts` in the repo),
so a real native haptics hook exists (Capacitor's Haptics plugin) — but
"designing" a haptic language (light/medium/heavy/success/warning/
critical *feel*) isn't verifiable from source reading alone; it needs a
physical device. Sound: no audio assets exist in this repo and none can be
generated here — a sound vocabulary can be *specified* (when each cue
fires, what category, roughly what it should feel like) but not shipped as
real audio without actual sound files supplied. Recommend: Phase 19
(motion inventory + operational language) is the right next ask if this
continues; haptics/audio need assets or device access this project doesn't
have.

**Where this lands:** 3 sed edits in `apply.sh`'s new "Phase 18" section.
Nothing else in §37 required a code change — C and D were audits with a
passing result, B is a restated flag, and the roadmap section (§37-D5) is
a scoping response, not a deliverable.

## §38 Decisions — Phase 19 (§34-D3 resolved)

**Source:** explicit follow-up to resolve §34-D3 (alert-surface audit —
inline banners, form validation, `CsvImportDialog`'s error states).

**§38-D1 — `CsvImportDialog`: two real issues, both fixed, full
replacement.** Read the whole file. Two distinct problems, not one: (a)
every success/error indicator — summary chips, table row backgrounds,
error text, the "done" banner — used hardcoded Tailwind `emerald-*`/
`red-*` utilities instead of the app's own real `--status-ok-*`/
`--status-issue-*` tokens, invisible unless you actually read the classes
rather than just look at the render; (b) the "done" success banner was a
full 4-side border box, the same pattern already fixed in `AlertCard`/
`ErrorCard` (Phase 15). Both fixed: real tokens throughout, banner
converted to a rail. Shipped as a full-file replacement (too many distinct
spots across one file for a safe, reviewable sed diff — same reasoning as
`StatusBadge`/`Card` in Phases 14/15).

**§38-D2 — Form validation messages: audited, no fix needed.**
`native-social-buttons.tsx`, `phone-sign-in.tsx` (×2), `native-clerk-gate.tsx`
all render validation text as plain `text-destructive` + `role="alert"` —
no border, no background, no box to begin with. Nothing to convert to a
rail; this surface was never boxy.

**§38-D3 — The much bigger finding: hardcoded `emerald-*`/`red-*` instead
of real status tokens, found across ~15 files, NOT fixed this phase.**
Grepping for the same anti-pattern that broke `CsvImportDialog` turned up
the identical thing at real scale: `inventory-page.tsx`, `equipment-
detail.tsx`, `rooms-list.tsx`, `home.tsx`, `crash-cart.tsx`, `alerts.tsx`,
`room-radar.tsx`, `equipment-list.tsx`, `help.tsx`, `admin.tsx`,
`appointments.tsx`, `management-dashboard.tsx`, `qr-print.tsx` all reach
for raw `bg-emerald-50`/`bg-red-50`/`border-emerald-200`/`border-red-200`
etc. rather than `--status-ok-*`/`--status-issue-*`. This is a distinctly
bigger, separate finding from "3 named alert surfaces" — dozens of
call-sites across a dozen-plus files, not 3 components — and deserves its
own dedicated, reviewable phase rather than a rushed pass appended to this
one. Flagging prominently rather than either ignoring it or attempting a
same-turn mass edit with no way to verify the result visually.

**§38-D4 — Inline warning banners: tokens exist, usage not located.**
`--color-background-warning`/`--color-border-warning`/`--color-text-warning`
are real, defined tokens (light + dark), explicitly commented "inline SVG
/ ER reconciliation triangle" — but grepping `src/components` for their
actual usage came back empty this phase. Either they're consumed somewhere
in `src/pages` or `src/features` not yet checked, or they're currently
unused. Left open rather than guessed at.

**Where this lands:** one full-file replacement
(`components/csv-import-dialog.tsx` → `src/components/csv-import-dialog.tsx`)
via `apply.sh`'s new "Phase 19" section.

## §39 Decisions — Phase 20 (§38-D3 partial, §38-D4 resolved)

**Source:** explicit follow-up — fix §38-D3 (the ~13-file hardcoded-color
pattern) and §38-D4 (inline warning banner tokens).

**§39-D1 — Prerequisite done first: dark-mode overrides for the status
bg/fg/border tokens.** Real call-sites don't just hardcode a light color —
they hand-roll a `dark:` variant alongside it (`bg-emerald-50 ...
dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800`).
Retokenizing the light side onto `var(--status-ok-bg)` etc. *without*
giving those tokens a `.dark` override would have silently deleted the
dark-mode treatment every one of these components already has — so
`status-dark-mode-tokens.css` (translucent `rgba()`, matching the
`/40`-style overlays the hand-rolled classes already used) landed before
any component edit, not after.

**§39-D2 — Honest partial: 3 of ~13 files fully retokenized, not a
sample smeared across all of them.** `rooms-list.tsx` (6 occurrences) and
`home.tsx` (4 occurrences) are **completely** done — every hardcoded
emerald/red string in each file is gone, not just the easy ones.
`management-dashboard.tsx` picked up its 2 remaining boxes (its stat
*numbers* were already fixed in Phase 18). Deliberately did whole files
top-to-bottom rather than the same one or two patterns everywhere, so
`verify.sh` can assert each of these 3 files is **actually clean**
(`check_not_grep` for the old classes), not just "some of the pattern was
touched somewhere."

**§39-D3 — The other ~10 files: not touched, listed explicitly so
"partial" doesn't quietly become "silently abandoned."** `inventory-
page.tsx` and `equipment-detail.tsx` are the biggest and most
context-dependent (progress-bar fill functions keyed on numeric ratios,
disabled/focus-ring states, ~15-20 occurrences each) — real work, not a
quick sed pass, and higher risk of a wrong match if rushed. Not started:
`crash-cart.tsx`, `alerts.tsx`, `room-radar.tsx`, `equipment-list.tsx`,
`help.tsx`, `admin.tsx`, `appointments.tsx`, `qr-print.tsx`. The mechanical
recipe is the same for all of them and is now proven correct by the 3
files above:
`bg-emerald-50→bg-[var(--status-ok-bg)]`,
`text-emerald-700/900→text-[var(--status-ok-fg)]`,
`border-emerald-200/300→border-[var(--status-ok-border)]`,
`bg-emerald-500 (solid)→bg-[hsl(var(--status-ok))]`, mirrored for
`red→status-issue` and `amber→status-maintenance`, **dropping** the
hand-rolled `dark:` variant each time (the token now carries it). Good
Phase 21 candidate — file-by-file, verified against `verify.sh` the same
way as this phase, not all at once.

**§39-D4 — §38-D4 resolved: verified dead, not hidden.** Broadened the
grep from `src/components` to the whole `src` tree this time —
`--color-background-warning`/`--color-border-warning`/`--color-text-warning`
have **zero usages anywhere**, only their two definitions (light + dark,
already in `src/index.css`). Not a missed inline banner to retokenize —
dead tokens nobody consumes. Nothing to fix; flagging the dead-code
finding itself is the resolution (whoever owns `index.css` next can
decide whether to remove them or find the banner they were meant for).

**Where this lands:** `tokens/status-dark-mode-tokens.css` (new, appended
to `src/index.css`) + sed edits across 3 files, via `apply.sh`'s new
"Phase 20" section.

## §40 Decisions — Phase 21

**Source:** a 15-item visual-polish review (section headers, accent rails,
metadata rows, card rhythm, stat cards, soft surface separation, tables,
status dots, empty states, search inputs, context chips, ambient
backgrounds, staff cards, room cards, a clinical timeline component). Unlike
most prior sources, several items already read as aware of this package's
own past decisions ("You already have criticality. Extend it." / "You
correctly removed most shadows.") — treated as a genuine next round, not a
from-scratch ask, and verified against real source accordingly rather than
assumed pre-fixed.

**§40-D1 — A real conflict, surfaced rather than acted on.** The user's
scoping note for this phase stated medications are no longer part of the
code. Re-grepped the real source specifically to check before touching
anything: `DispenseSheet.tsx` (651+ lines, container/medication dispense
UI), the `containerDispenseWithResult`/`dispense` API surface (`lib/api.ts`),
`medsPage.*`/`dispense.*`/`adminMedicationIntegrity.*` i18n keys, and the
Smart-Cop medication-reconciliation alert types (`cop-alerts.ts`,
`event-reducer.ts`'s `admin_no_dispense` handling) are all still extensively
present and wired up — the premise does not match what's in the mounted
`vettrack-ship` source as of this phase. Not acted on either way: medication/
dispense UI is untouched by this phase's changes (consistent with leaving it
alone), but Stage 5's dispense-flow mockup screens were NOT removed or
altered on the strength of an unverified claim, and §20-D3's frozen scope
(Stage 5 dispense flow + all of Stage 9 Crash Cart/Code Blue) is unchanged —
flagging the discrepancy plainly rather than guessing which is stale, the
user's understanding or this read of the repo.

**§40-D2 — Section headers (item 1): real gap, new component.** Grepped for
an existing title+meta+subtitle+divider primitive across the operational
list pages (equipment-list, rooms-list, inventory-page, admin, alerts,
appointments) — none exists; each hand-rolls its own header. `SectionHeader`
(`components/section-header.tsx`) formalizes it, sized off the REAL shipped
scale (Phase 14's bumped tokens): title at `text-lg` (20px/700, matching the
review's "20px/700" exactly), meta at `text-xs`/`font-num` (13px, matching
"13px/font-num" exactly), subtitle at `text-sm` (15px vs. the review's 14px
— kept on-scale per the reconcile-with-shipped-tokens instruction rather
than a new off-scale value). Shipped as a ready component; NOT wired into
any specific real page this phase — doing that safely means reading each
page's exact current header JSX first (only equipment-list.tsx's search
area was read, not its title block), and guessing the surrounding markup
risks a bad sed on unread code. Good Phase 22 candidate, one page at a time.

**§40-D3 — Accent rails (item 2): mostly already shipped (Phase 15/16);
extended into 2 more real spots this same grep pass turned up.** The
criticality system and AlertCard's rail (Phase 15) already cover the core
ask. Reading `EquipmentDetailStatusStrip.tsx` for this phase's other items
turned up two more of the review's "instead of a standard alert box"
pattern that were never on Phase 15's original list: its `recoveryCalloutKey`
banner (a full 4-side amber border box) and, while in the same file, a
hardcoded-color bug from the same family as §38-D3/§39-D3's still-open list
(STATUS_CONFIG's `text-emerald-600`/`bg-emerald-100` etc., never audited —
this file wasn't on that list either). Both fixed in one full-file
replacement (too many distinct spots for a safe sed, same reasoning as
`csv-import-dialog.tsx` in Phase 19): the callout is now a rail on the real
`--status-maintenance`/`--status-maint-bg` tokens, and STATUS_CONFIG reads
the real `--status-{ok,issue,maintenance,sterilized}-{fg,bg}` vars
throughout. The Card wrapper's `shadow-sm` (the same shadow-into-Card
override bug Phase 10/13 fixed elsewhere) is dropped too, now that Card's
own primary variant is correct on its own (§40-D6).

**§40-D4 — Top metadata rows (item 3): real gap, new component, wired to
one real page.** `equipment-detail.tsx`'s `<h1>` (line ~987) renders with no
breadcrumb context above it — confirmed by reading the page directly.
`EntityMetaRow` (`components/entity-meta-row.tsx`) is deliberately generic
(explicit string segments, not coupled to the `Equipment` type) and is wired
in via `apply.sh` using `equipment.location` / `equipment.model` /
`equipment.serialNumber` — all three confirmed real, already-used optional
fields (read verbatim in `equipment-list.tsx`'s own search predicate, so
confirmed without needing to guess at the type file). The import + JSX sed
edits deliberately keep the new statements on their original single line
(valid TS/JSX either way) rather than attempting a literal multi-line sed
replacement, which is not portable across GNU/BSD `sed` the way every other
edit in this script is — a formatter pass can re-wrap it later; nothing
depends on the exact line shape.

**§40-D5 — Card internal rhythm (item 4): reconciled onto Tailwind's own
spacing scale, not new tokens.** The review's literal spec (header-bottom
12px / status-gap 20px / body-gap 24px / footer-gap 16px) doesn't map
cleanly onto `Card`'s 3-slot API (header/content/footer — no distinct
"status" slot). Rather than invent a 4th slot the real API has no
caller-visible need for: `CardHeader` now ends at `pb-3` (12px, exact
match); `CardContent`'s status-gap(20)/body-gap(24) pair collapses onto ONE
default, `space-y-5` (20px — the more common case of a status line or short
fact sitting right under the header), with the review's 24px available via
a `className` override that `cn()`/tailwind-merge resolves cleanly (already
true of every call site read this phase — `EquipmentTruthCard`,
`EmptyState`, `EquipmentDetailStatusStrip` all already set their own
`space-y-N`, so they're unaffected by the new default). `CardFooter` is
UNCHANGED — the review's 16px "footer-gap" already exists today via
`CardContent`'s own `pb-4` sitting above it; verified by reading the
rendered gap, not re-implemented. Blast radius stated plainly, same posture
as Phase 14's own type-scale/Card-shadow calls: `CardContent`'s new
`space-y-5` reaches every real call site with multiple direct children AND
no `className` override of its own — not individually re-audited beyond the
three files above.

**§40-D6 — Stat cards (item 5): existing component (§20-D5, Phase 1),
never adopted anywhere real yet — restructured freely.** Confirmed via
Phase 18's own finding (§37-D1: `management-dashboard.tsx`'s stat numbers
were still hand-rolled, not using `StatTile`) that this component carries no
real call-site risk. Reshaped from value-first/trend-top-right to
icon+label / big value / change-sentence, per the review's own mock.
Reconciled sizes: label → `text-xs` (13px, matches the review's "13px/600"
exactly) at `font-semibold`; value → `text-3xl` (35px, an EXISTING token
Phase 14 explicitly left untouched — closer to the review's "34px" than
`text-2xl`'s 32px) at `font-bold tracking-tight` (~-0.025em vs. the
review's -0.03em, on-scale rather than re-derived to the exact decimal);
added `min-h-[120px]` verbatim. `trend`/`trendTone` keep their original
prop names — no real call site to break, and the prop always accepted a
plain string, so "+12.4% this month" needs no type change from "+12%".

**§40-D7 — Soft surface separation (item 6): mostly shipped (Phase 14's
shadow-less `primary` variant); one new token for the piece that wasn't —
the inset highlight.** `Card`'s `primary` variant already is "border +
no shadow." The review's other half — an inset top highlight instead of a
drop shadow, for Apple Health/Linear-style depth — genuinely didn't exist;
added as one new token, `--card-inset-highlight` (light: 1px translucent
white, `.dark`: a much dimmer equivalent), applied only to `primary` (NOT
`interactive`, which already carries a real drop shadow — stacking a sheen
on top of an actual shadow reads muddy, not premium; the two variants are
now two distinct depth languages, not layered together). This is the
single new CSS custom property this whole phase needed — every other item
reconciles onto Tailwind's existing spacing/color scale, consistent with
this codebase's own convention (custom properties for colors/shadows/type
scale; layout spacing is always literal Tailwind utilities, never a
parallel token set).

**§40-D8 — Tables (item 7): real gap in interaction states, plus a
real-vs-shared-component split found while fixing it.** No `<table>` exists
anywhere in the app (grepped `src`, zero matches) — "tables" here means the
row-list pattern the app already uses (`AuditLogRow`, §21-D1, pixel-matched
to its loading skeleton). Added `selected`/`hoverable` props (real Phase 11
`ivory-active`/`ivory-hover` tokens — mostly unadopted at real call sites
per §30, one of the "Good Phase 12 candidate" spots finally landing) and an
`AuditLogHeaderRow` companion (13px/semibold/uppercase/0.04em-tracked, the
review's exact header spec). Reading the real `audit-log.tsx` page to wire
this up surfaced something not previously logged: **the page does not
actually import the shared `AuditLogRow` component** — it has its own
local, same-named `AuditLogRow` function (a different, hand-rolled
implementation that happens to also hit `minHeight: 60`, so it still
pixel-matches the skeleton, just via parallel code, not the shared
primitive). Not unified this phase — a real refactor with its own risk,
bigger than a hover-state tweak, good Phase 22 candidate. The real page's
own hover state (already present, `hover:bg-muted/50`, a generic shadcn
tint) was retargeted onto `ivory-hover` directly via sed, so the visual fix
lands in the actual app either way, component-unification question aside.

**§40-D9 — Status dots (item 8): the dot already existed (Phase 14);
sizing bumped, and a second surface (generic `Badge`) now supports one
too.** `StatusBadge`'s dot goes from 6px/6px-gap to the review's literal
8px/8px. Separately: much of the app's status rendering goes through the
generic `Badge` component (not `StatusBadge`) — `EquipmentDetailActivityTab`,
`EquipmentDetailStatusStrip`, `EquipmentTruthCard`'s citations all use
`Badge` with a status-semantic `variant`. Added an opt-in `dot` boolean
prop to `Badge` (renders `bg-current`, so it never needs its own color
mapping — automatically matches whichever variant's text color) and wired
it into the two real call sites touched this phase
(`EquipmentDetailStatusStrip`'s status badge, `EquipmentDetailActivityTab`'s
scan-status badge) as concrete proof rather than a purely theoretical prop.
The remaining `Badge` call sites across the app were not individually
audited/converted — same "flag, don't guess" posture as every prior
wide-reaching change.

**§40-D10 — Empty states (item 9): the real, shared component, two
concrete fixes.** `EmptyState`'s icon size (64px) already matches the
review's spec exactly. Two real gaps: (a) its dashed card carried a bare
`shadow-sm` — the same Card-shadow-override bug Phase 10/13 fixed
elsewhere, missed here (a dashed, already-restrained card shouldn't fight
an unwanted default shadow — arguably the same "soft surface" idea as item
6, just never applied to this component); (b) the action button's top
margin (`pt-1`, 4px) fell well short of the review's 24px ask — bumped to
`pt-6`.

**§40-D11 — Search inputs (item 10): scoped to the real search field(s),
not the shared `Input` component.** Widening the shared `Input`
(`src/components/ui/input.tsx`) would reach every form app-wide — a much
bigger, unrequested change (same reasoning Phase 14 used for NOT touching
every `Card` shadow at once without auditing call sites). Instead,
`equipment-list.tsx`'s real search field(s) get the upgrade directly:
height 44→48px, radius 12px→14px (an arbitrary value — Tailwind has no
exact 14px step), 2px/`ring-ring` focus ring → 4px/primary-tinted, matching
the review's spec. The `className="ps-10"` anchor matches BOTH the
equipment-search and the folder-search `Input`s in this file (grepped —
both are icon-padded search fields sharing the same class) — applied to
both intentionally, not a blind guess; they're the same kind of control.
The search icon's vertical offset was recentered for the new 48px height
(`top-3`→`top-4`); it was already ~2px off true-center at the OLD 44px
height too, a pre-existing imperfection this incidentally corrects rather
than something newly introduced.

**§40-D12 — Clinical context chips (item 11): new, standalone component —
deliberately NOT a `Badge` variant.** `Badge`'s `cva` base already owns
`text-xs`/`px-2.5`/`py-0.5` for every existing variant (none of them
override size, only color — the established safe `cva` pattern in this
file). This chip's spec (h-5/11px/uppercase) genuinely conflicts with that
shared sizing; `cva` appends `variants` classes to `base` via plain
`clsx` with no tailwind-merge pass between them, so a variant redeclaring
conflicting utility classes leaves two same-specificity classes in one
string with an unpredictable winner — a real footgun, not a nitpick.
`ContextChip` ships as its own tiny component with one, fully-owned
className string instead. Shipped ready to use; not wired into a specific
real card this phase (no confirmed real call site read yet — would want to
land on `EquipmentTruthCard` or an equipment list row, neither read closely
enough this phase to safely sed).

**§40-D13 — Ambient background layers (item 12): tokens already
sufficient (Phase 11); not wired to a real page this phase.** The
page→section→card layering the review asks for doesn't need a new token —
Phase 11's `--ivory-panel` (opaque near-white, for nested/inset surfaces)
plus Tailwind's own `bg-white/40` (arbitrary opacity on a literal color,
built in) already cover it without inventing a translucent-white token to
sit alongside `ivory-panel`. Reconciled, not built: no real page's content
wrapper was read closely enough this phase to pick a safe, concrete
insertion point — flagged as a good Phase 22 candidate once a specific page
is pointed at, same posture as §30's original component-level-adoption
deferral for the same token family.

**§40-D14 — Staff / visual-ownership cards (item 13): new component,
composed from two already-shipped primitives.** `StaffCard`
(`components/general/staff-card.tsx`) is genuinely new only in that it
composes `getInitials` (`src/lib/user-utils.ts` — already used by
`Topbar`/`ProfileHeroZone`/`NativeHeader`, confirmed by grep) for the
avatar and `RoleBadge` (§20-D5, Phase 1) for the role pill into one card,
plus a shift-status dot. No new color or avatar system invented. Not wired
to a real page — no staff/roster list page was located and read this
phase; ships ready for whichever page owns that view.

**§40-D15 — Room cards (item 14): existing component (§21-D4, Phase 2)
revised — ring swapped for a bar, deliberately, not just extended.**
`RoomReadinessCard`'s ring-based readiness display is replaced with a
linear bar (`h-1.5 rounded-full`) matching the review's mock. This mirrors,
verbatim, the REAL `rooms-list.tsx` page's own room card (a different,
already-shipped card for a different page), which already renders its
own percent-of-capacity metric — `available`/`total` — as exactly this
kind of bar (confirmed by reading the file directly). `rooms-list.tsx`'s
`HealthRing` (a DIFFERENT metric — 24h scan freshness, not readiness) keeps
its ring elsewhere in the app, so rings aren't lost app-wide, just not
duplicated for the same percent-of-capacity meaning on this specific card.
Added a status line (auto-derived from `readyPercent`/`attentionCount`,
override-able) and an optional `staffCount` prop rendering "N devices · M
staff" — presentational only; grepped for a real per-room staff-assignment
field on the `Room` type and found none, so wiring real data here is left
to the caller, same posture as every other prop on this component.

**§40-D16 — Clinical timeline component (item 15): real gap, new
primitive, wired into one real component (full-file replacement).**
`EquipmentDetailActivityTab.tsx` (equipment history) rendered a flat stack
of individually-carded rows — no dot/line timeline — even though Stage 6's
own mockup ("ACCOUNTABILITY TIMELINE") already established exactly this
visual for the same content. `Timeline`/`TimelineRow`
(`components/equipment-timeline.tsx`) formalizes it; wired into
`EquipmentDetailActivityTab` via a full-file replacement (too many distinct
spots for a safe sed, same reasoning as `StatusBadge`/`Card` in Phases
14/15) that also, incidentally, drops the same shadow-into-Card override
bug (`shadow-sm`) this file had never been audited for before. Data,
loading, and empty-state logic are unchanged — only each entry's container
markup changed, from a `Card` to a `TimelineRow`.

**§40-D17 — Stage handoff (1–10) sync: token/component showcase updated
directly (Stages 1–2); a representative pass across 3 of the 7 operational
stages, named exactly, not implied.** Stage 1's swatch/spec board and
Stage 2's component gallery are the natural documentation home for every
new token/component this phase adds (same posture as §31-D5 updating
Stage 1's `--action` swatch directly) and got the fullest treatment: Stage
1 gained a new "Card rhythm & soft surface" spec block (items 4/6) plus a
Phase 21 decisions-log entry; Stage 2 gained six new numbered component
showcases (6.23–6.28: Section header, Stat tile, Context chip, Staff card,
Room card, Clinical timeline) and four updated ones (Card/Surface now
shows the inset highlight + a criticality rail; EmptyState's icon/spacing
bumped to match; ListRow gained a real hover state + header row; AppBar's
search field carries the new height/radius/focus-ring).
Stages 3–9 each hand-author their own inline-CSS-variable styling (DCs
don't carry Tailwind classes) rather than importing the real Tailwind
components directly, so "syncing" one means re-expressing a shipped change
in that stage's own token vocabulary at a specific screen — not a
find/replace. Three got exactly that, at their clearest real fit: **Stage
5** (Inventory screen's header gained a hairline divider, its search field
the new height/radius/focus-ring, item 10); **Stage 6** (Equipment Detail's
metadata line re-typeset to the EntityMetaRow spec, item 3; Room Radar's
readiness ring replaced with a bar, matching §40-D15's real-app call, item
14); **Stage 7** (Management Dashboard's KPI tiles rebuilt to the new
icon+label/value/trend-sentence layout, item 5). **Not touched this
phase, named rather than left implicit:** Stage 3 (Today), Stage 4
(Screens), Stage 8 (Admin & Governance), Stage 9 (Emergency &
Collaboration) — good Phase 22 candidates for the same treatment. Stage 9
specifically would also need its Crash Cart / Code Blue content kept
untouched per the frozen scope (§20-D3, unchanged per §40-D1) when that
phase happens — only its non-frozen collaboration surfaces should pick up
this phase's patterns.

**Where this lands:** `components/section-header.tsx`,
`components/entity-meta-row.tsx`, `components/context-chip.tsx`,
`components/equipment-timeline.tsx`, `components/staff-card.tsx` (all new)
+ `components/card.tsx`, `components/stat-tile.tsx`,
`components/status-badge.tsx`, `components/badge.tsx`,
`components/room-readiness-card.tsx`, `components/audit-log-row.tsx`,
`components/equipment-detail-activity-tab.tsx`,
`components/equipment-detail-status-strip.tsx` (all revised) +
`tokens/phase21-card-tokens.css` (new, appended into `src/index.css`) +
sed edits across `empty-state.tsx`, `equipment-list.tsx`,
`equipment-detail.tsx`, `audit-log.tsx` — all via `apply.sh`'s new
"Phase 21" section.
