# Today Screen — iPhone + iPad UX Review

**Date:** 2026-07-03
**Surfaces reviewed:** iPhone 17 Pro (iOS 26.4) and iPad Pro 11-inch (M5), VetTrack "Today" (`src/pages/home.tsx`), Hebrew RTL, **no-active-shift** state.
**Lens:** `apple-platform-ux` (device cognition, IA, motor control) + `product-design-fundamentals` (Fitts, Hick, hierarchy, pattern familiarity).

---

## Top-line verdict

The iPhone screen is close to right: a single, calm, thumb-reachable action surface with a strong iOS large-title and correct RTL. The **iPad screen is the main problem — it is a stretched iPhone**, not a tablet workspace. Both devices also share a dead-end empty state and an inconsistent, FAB-heavy navigation model. None of this is a rewrite; it's a layout-and-IA correction.

What's genuinely good (keep it): the large-title greeting, the high-contrast navy hero, semantic green for scan, and the RTL execution (mirrored tab order, right-side sidebar, LTR islands like "Dan"/"NFC" preserved).

---

## Issues, prioritized

### 1. iPad is a large iPhone — CRITICAL (strategic)

**Observed:** The iPad shows the same single content column as the phone — one hero card, one scan card — just wider, with a 3-item sidebar bolted on. ~60% of the canvas is empty.

**Principle:** *"The iPad is not a large iPhone"* — it pairs Mac-like workspace cognition with touch. iPhone should *reduce* cognitive load (infer context, one next action); iPad should *externalize* it (keep related operational context visible). This screen does neither on iPad — it reduces, then leaves the freed space blank.

**Why it matters here:** For a clinical ops tool, the iPad is the operational-awareness surface — the thing propped on a counter showing shift roster, equipment status, and handoff context at a glance. Right now even a no-shift iPad shows nothing to be aware of.

**Fix (default):** Give iPad its own layout, not a wider phone. Use a persistent spatial region (the space is already there) for at-a-glance context: today's/upcoming roster, an equipment status board, or a monitoring panel. The no-shift hero can stay as the primary card while the workspace still carries operational awareness.

### 2. Dead-end empty state wastes the whole lower canvas — HIGH

**Observed:** "אין משמרת פעילה" tells the user what is *not* available (scanning, dispensing) but offers no next step — no next-shift time, no "view schedule," no "request shift." Below it: void.

**Principle:** An empty state should orient and offer an action; whitespace should create rhythm/grouping, not absence. Here the whitespace is void, not proportion — most acute on iPad.

**Fix (default):** Surface the next scheduled shift ("Next shift: Sat 08:00") and one primary action (View schedule / Request shift). Turns a dead end into the screen's job.

### 3. Navigation model is inconsistent across devices — HIGH

**Observed:**
- iPhone: 5-item bottom tab bar — Menu · Emergency · Scan · Equipment · Today.
- iPad: 3-item right sidebar — Today · Equipment · Emergency — **plus** a separate bottom-right "תפריט/Menu" hamburger **plus** a QR-scan FAB.

So Scan and Menu are silently demoted from first-class tabs (phone) to floating/hamburger controls (tablet), and the sidebar's item count doesn't match the tab bar's.

**Principle:** Users build mental models from consistency; spatial memory ("Scan is bottom-center") is a first-class affordance. Moving destinations between devices imposes a relearning cost with no payoff.

**Fix (default):** Make the iPad sidebar mirror the same top-level destinations as the phone tab bar (Scan and Menu included). One destination map, two form factors.

### 4. Floating action buttons — anti-pattern, and multiplying — HIGH

**Observed:** A chat FAB (bottom-left, red "7" badge) floats on both devices. On iPad a QR-scan FAB also floats bottom-right — so scanning now has 2–3 entry points on iPad (green card + FAB, plus wherever the sidebar/menu leads), and two unrelated FABs sit in opposite empty corners.

**Principle:** The FAB is a Material/Android convention; Apple HIG places primary and persistent actions in tab bars and toolbars, not floating pucks. Two ungrouped floating buttons also violate Gestalt grouping — related actions should read as a set, not scatter to corners.

**Fix (default):** Move Scan into the tab bar/toolbar (it already is on the phone) and drop the iPad QR FAB. Relocate chat into a toolbar item or the Menu. If a floating control must stay, there should be exactly one, consistently placed.

### 5. Emergency access latency — HIGH (clinical)

**Observed:** "חירום" (Code Blue) is one of five equal-weight tabs on iPhone and the third sidebar item on iPad — visually indistinguishable from Equipment or Menu.

**Principle:** Emergency response is the canonical "seconds count" iPhone action; the app's own architecture treats Code Blue as a frozen, first-class surface. Equal visual weight makes the most time-critical action as slow to find as the least.

**Fix:** Make an explicit decision to differentiate emergency (distinct color/weight, or a persistent always-visible affordance) rather than leaving it at parity with routine tabs. Flagging as a decision, not prescribing the exact treatment.

### 6. Top bar is cluttered and the "DE" control is ambiguous — MEDIUM

**Observed:** Five elements compete in the header — bell (red "60"), a "DE" pill, gear, "VetTrack" wordmark, search. "DE" reads like a language code, but the UI is Hebrew — its function isn't self-evident. The "60" badge is alarmingly high and near-overflowing its pill.

**Principle:** Hick's law — decision/scan time rises with choice count, and the top bar is the first thing scanned. Ambiguous labels add hidden state the user has to carry.

**Fix:** Clarify or icon-label the "DE" control; cap the badge display ("9+" or "50+"); consider whether all five header elements need to be top-level on the phone.

### 7. Ambiguous affordance: hero clock icon — MEDIUM

**Observed:** The clock icon sits in a rounded-square container using the same treatment as a tappable button, inside a card where it appears decorative.

**Principle:** Button chrome signals tappability (learned pattern). Decorative elements wearing button styling create a false affordance — users tap and nothing happens, or miss a real action.

**Fix:** If decorative, remove the button container. If it opens the schedule, label it and make it a real control.

### 8. Verify touch targets — MEDIUM

The header icons and the "DE" pill look near the small end. Can't measure from a screenshot — verify each is ≥48px (VetTrack's Fitts-derived minimum), since these sit in the hardest-to-hit top corners.

---

## iPhone vs iPad — the one thing to take away

| | iPhone (action cognition) | iPad (workspace cognition) |
|---|---|---|
| Job | Scan / confirm / respond in seconds | Monitor / plan / hand off over minutes |
| This screen does | Roughly right — calm, one action | Wrong — a wider phone with empty canvas |
| Needed | Keep it lean | Externalize context: roster, equipment board, monitoring |

The fix is not "add stuff to iPad." It's: **design the iPad Today screen as its own workspace**, then let iPhone stay the reduced action view it already nearly is.

---

## Suggested order of work

1. Unify the navigation map across devices; remove the iPad QR FAB (items 3, 4).
2. Give the empty state a next-shift readout + primary action (item 2).
3. Design an iPad-specific Today layout that fills the canvas with operational context (item 1).
4. Resolve emergency differentiation as an explicit decision (item 5).
5. Header cleanup, clock-icon affordance, touch-target audit (items 6, 7, 8).

Items 1–2 are cheap and high-impact; item 3 is the real design work.
