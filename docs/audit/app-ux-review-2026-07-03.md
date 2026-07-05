# VetTrack — Full App UX Review (iPhone + iPad)

**Date:** 2026-07-03
**Method:** Live walkthrough of the running app on two simulators — iPhone 17 Pro (iOS 26.4) and iPad Pro 11-inch (M5) — Hebrew RTL, logged in as Dan Erez (מנהל/Manager), no active shift.
**Lens:** `apple-platform-ux` (device cognition, information architecture, motor control, workflow economics) + `product-design-fundamentals` (Fitts, Hick, hierarchy, pattern familiarity, Gestalt).

Screens exercised: Today · Profile · Equipment list + item detail · Emergency / Code Blue intake · Scan · the Menu drawer · Tasks · Rooms · Notifications · global Search · Admin · Inventory/consumables · Settings — on both devices where they differ.

---

## Verdict

The **iPhone app is genuinely good**: a calm action device with a coherent shift-gating rule, a standout Emergency flow, and solid RTL. The **iPad app is the core problem — it is the iPhone stretched wide**, confirmed by interaction, not just the landing screen. Separately, the app's **information architecture buries most of itself behind an overflow "Menu"**, and a set of cross-cutting issues (notification overload, a colliding floating button, dead-end empty states, a stray English string) drag down an otherwise strong build.

None of this is a rewrite. The iPad needs a real layout; the rest are targeted fixes.

---

## What's working — keep it

- **Emergency / Code Blue intake.** Dark "mode-shift" theme signals you've left routine, a required incident manager is pre-filled ("Dan Erez — you"), an equipment-readiness checklist gates the action, the red primary button is unmistakable, and there's an escape hatch ("continue without full check"). It's reachable even with **no active shift** — correct; emergencies don't wait for a roster. This is the best-designed surface in the app.
- **Coherent shift-gating.** Off-shift disables scanning/dispensing consistently across Today *and* Scan, with matching copy. The rule is legible.
- **Tasks screen.** Sectioned by urgency ("What to do now?" / "Urgent"), positive empty states, and a real "Create task" CTA — the empty-state pattern the rest of the app should copy.
- **Rooms & Equipment.** Real operational surfaces: availability %, in-use/needs-attention/total tiles, status filters, per-room sync/staleness and capacity.
- **Settings.** Comprehensive and well-grouped — color scheme, night mode, haptics, display size, language, master/critical sound, date & time formats, reset.
- **Visual system & RTL.** Consistent navy hero / semantic-green action / status pills / shimmer skeletons; the earlier floating "Take consumables" button is now inline (good). RTL is executed well — mirrored layouts and tab order, LTR islands ("Dan", "NFC", IDs) preserved.

---

## Issues, prioritized

### CRITICAL — the iPad is a large iPhone (confirmed by interaction)

**Observed, by driving it:**
- Tapping a **sidebar** item (Equipment) swapped the *entire* main pane — no split view.
- Tapping an equipment row pushed a **full-screen detail that replaced the list** (with a "Back" link) — the phone navigation-stack pattern, not master-detail. You cannot see the list and an item at the same time.
- Every list is a **single full-width column**; rows stretch the label to one edge and the badge/status to the other, leaving a dead gap across the middle. Detail screens leave the entire lower half empty.

**Principles:** *"The iPad is not a large iPhone"* — it pairs Mac-like workspace cognition with touch. iPad should **externalize** cognitive load (keep related context visible), use **spatial architecture** (persistent sidebars/inspectors/panels), and treat **spatial memory** as a first-class affordance ("the list stays on the right"). Full-screen push navigation forces the user to hold state in memory through a stack — the exact failure the model warns against. Error recovery on iPad is supposed to come from *visible context*, which a single swapping pane removes.

**Why it matters here:** For a clinical ops tool, the iPad is the counter-top awareness surface — the thing that should show the roster, equipment board, and an item's detail together. Right now it shows one narrow column at a time.

**Fix (the real design work):** Give iPad master-detail — list on one side, detail/inspector on the other, both persistent — for Equipment, Rooms, Admin, and Inventory. Use the width for more data or columns, not stretched whitespace.

### HIGH — navigation is split across three arbitrary containers on iPad

**Observed:** iPad top-level navigation is scattered across a **3-item sidebar** (Today / Equipment / Emergency), a **floating QR button** (Scan), and a **13-item modal drawer** ("Menu") for everything else (Tasks, Critical-kit check, Rooms, Mine, Alerts, Inventory, Admin, Shifts, Profile, Settings, End-shift). The sidebar — the one true iPad affordance — carries 3 of ~13 destinations; the rest hide behind a sheet that covers the workspace. There's no logic to which container holds what (Emergency is sidebar-only; Scan is FAB-only; Admin is drawer-only).

**Principle:** Spatial anchors and consistent placement over modal overflow; Hick's law (a 13-item ungrouped sheet is slow to scan).

**Fix:** Put the full, grouped navigation in the **persistent iPad sidebar**; drop the modal drawer and the QR FAB on iPad.

### HIGH — most of the app is buried behind an overflow "Menu"

**Observed:** The tab bar surfaces only Today / Equipment / Scan / Emergency. Everything else — Tasks, Critical-kit check, Rooms, Mine, Alerts, Inventory items, Admin, Shifts, Profile, Settings — lives in a catch-all "Menu" drawer on *both* devices. Today and Equipment also appear *twice* (tab + drawer).

**Principle:** "Menu" as a dumping ground hurts discoverability; top-level IA should be chosen by frequency and workflow, not "4 favorites + a junk drawer."

**Fix:** Re-derive the top level by task frequency (Tasks, Rooms, and Alerts are strong tab candidates); make the drawer grouped and searchable; remove the duplicate entries.

### HIGH — notification overload / alarm fatigue

**Observed:** The bell shows a red **"60"**. Opening it: nearly every item is the *same* low-urgency warning — "not scanned in 14+ days" — for individual devices. The same staleness signal also appears on Equipment ("needs attention") and Rooms ("stale").

**Principle:** A high, undifferentiated count in a clinical app manufactures urgency and desensitizes the user; Gestalt says aggregate the like items.

**Fix:** Group and aggregate ("12 devices not scanned in 14+ days"), tier by severity so real events stand out, cap the badge ("9+"), and unify the staleness signal into one source instead of three.

### HIGH — the floating chat button collides with content, and iPad adds a second FAB

**Observed:** The purple chat FAB (badge "7") floats bottom-leading on *every* screen and overlapped real content repeatedly — an Equipment list row, the Code Blue "continue without full check" link, etc. On iPad there's *also* a QR-scan FAB bottom-trailing, so Scan has 2–3 entry points on iPad (sidebar-adjacent + FAB, plus the Today green card).

**Principle:** The FAB is a Material/Android convention; iOS HIG places persistent actions in tab bars/toolbars. Two ungrouped floating buttons in opposite corners also break Gestalt grouping.

**Fix:** Move chat into a toolbar/menu item (or a docked, content-aware position); remove the iPad QR FAB and let Scan live in navigation. If any float stays, keep exactly one and keep it clear of content.

### MEDIUM — dead-end empty states (Today, Scan)

**Observed:** Both the Today hero and the Scan screen explain the block ("no active shift") but offer **no next step** — no next-shift time, no "view schedule," no "request shift." (Tasks, by contrast, offers a CTA.)

**Fix:** Show the next scheduled shift + a primary action; reuse the Tasks empty-state pattern.

### MEDIUM — untranslated English on a Hebrew UI

**Observed:** The Equipment detail location card renders **English** — "No location signal available — device has not been scanned, docked, checked out, or seen by RFID" — while the entire UI is Hebrew and the language setting is עברית. This is a missing translation, not a locale artifact.

**Fix:** Add the missing `he` keys; the repo's no-hardcoded-string tests should catch it.

### MEDIUM — professional workflows shown as database-table screens

**Observed:** Admin is tabs-per-table (Users / Categories / Pending / Support / Shift-requests) with raw CRUD lists (label + edit/delete icons). On iPad this is a stretched single column with a wide empty middle.

**Principle:** The skill explicitly asks whether *"professional workflows [are] represented directly rather than as database-table screens."* Here they aren't.

**Fix:** Represent the workflow (e.g., a category beside the items it contains) and use iPad multi-column/master-detail rather than a table per tab.

### MEDIUM — card spacing: too little "air" between cards (inside-vs-between imbalance)

**Observed (Rooms grid, but the pattern recurs):** In the 2-column room grid, the gutter between cards is only ~10% of a card's width (~45–50px between ~430px-wide cards), and the grid sits close to the screen edges. The four cards read as one dense block rather than four distinct objects; the only thing separating them is a subtle card shadow that isn't strong enough to carry the job.

**The real issue is *where* the whitespace is, not how much.** Each card has generous empty space *inside* (especially the 0-item rooms, which are mostly blank), while the space *between* cards is tight. So cards feel airy internally and the grid feels cramped — that inside-vs-between imbalance is what the eye reacts to.

**Principle:** Proximity/separation — whitespace *between* elements is what signals they're separate things; when the gaps are this tight, separation falls entirely on the shadow. Rhythm should be intentional, not uniform padding that piles up inside cards while gutters starve.

**Fix (in impact order):** increase the inter-card gutter (~16→24px); add an outer margin so the grid doesn't touch the screen edges; tighten internal card padding so internal air ≈ external air; optionally shorten empty (0-item) cards so blank space doesn't pad the vertical rhythm. Caveat: on a 2-column phone grid the gutter can't go too wide or names start wrapping — this is a modest bump plus trimming internal dead space, not large gaps. The app already defines `--content-gap` / `--inline-margin` (16/24/32px by size class); the grid likely just needs a larger token.

### MEDIUM — smaller, concrete items

- **Checkbox semantics:** the Code Blue readiness list uses **radio-style circles** for what are independent, multi-select checks. Use a checkbox affordance.
- **System appearance & text size:** dark mode is a **manual in-app toggle** ("מצב לילה") that doesn't track iOS system appearance; "display size" is a custom control rather than Dynamic Type. Both are minor HIG/accessibility deviations — default to system, allow override, and respect Dynamic Type.
- **Ambiguous affordances:** the "DE" pill is actually the **profile** (user initials) but reads like a toggle; the Today hero **clock icon** wears button chrome but appears decorative. Clarify or relabel.
- **Header touch targets:** bell / DE / gear sit in the hardest-to-reach top corners — verify each is ≥48px (Fitts / VetTrack convention).
- **Row layout wastes width:** labels pinned to one edge and badges/icons to the other leave dead center space (worst on iPad). Tighten grouping by proximity.

---

## iPhone vs iPad — the through-line

| | iPhone (action cognition) | iPad (workspace cognition) |
|---|---|---|
| Job | Scan / confirm / respond in seconds | Monitor / plan / hand off over minutes |
| Nav today | 5 tabs + overflow drawer | 3-item sidebar + Scan FAB + 13-item drawer |
| Detail nav | Full-screen push (correct here) | Full-screen push (**wrong** — should be master-detail) |
| Canvas use | Reasonable | Single narrow column, ~½ empty |
| Verdict | Keep lean | Redesign as a workspace |

The fix is not "add features to iPad." It is: **design the iPad as its own workspace** (persistent sidebar nav + master-detail + visible context), and let the iPhone stay the lean action device it already nearly is.

---

## Recommended order of work

1. **iPad navigation:** move the full grouped nav into the persistent sidebar; remove the QR FAB and the modal drawer on iPad. (Cheap, high impact.)
2. **iPad master-detail:** list + detail visible together for Equipment, Rooms, Admin, Inventory. (The real design work.)
3. **Chat FAB:** relocate so it stops colliding with content; drop the duplicate iPad scan FAB.
4. **Notifications:** aggregate + tier + cap the badge; unify the staleness signal.
5. **Empty states:** Today/Scan get a next-shift readout + primary action.
6. **Cleanups:** missing Hebrew string; checkbox semantics; system appearance / Dynamic Type; header affordance + touch-target audit.

Items 1, 3–6 are quick wins; item 2 is where the iPad becomes an iPad.
