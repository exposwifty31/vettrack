# VetTrack UX Friction Audit

**Date:** 2026-04-26  
**Branch:** claude/ux-friction-audit-Ggsvn  
**Scope:** Full codebase audit — forms, modals, navigation, accessibility, mobile UX

---

## Summary

15 friction points identified across form validation, accessibility, error messaging, mobile responsiveness, and state management. Severity ratings: **High** (blocks users or causes data loss), **Medium** (degrades experience noticeably), **Low** (polish/accessibility).

---

## Friction Points

### 1. Inconsistent Label–Input Association
**Severity:** High (Accessibility)  
**Files:** `src/pages/appointments.tsx:703–728`, `src/components/phone-sign-in.tsx:94–108`

Form inputs lack proper `htmlFor`/`id` pairings. Labels and inputs are co-located visually but not linked in the DOM. Screen readers cannot associate them; clicking a label does not focus its input.

**Fix:** Add matching `id` to each input and `htmlFor` to its `<label>`.

---

### 2. Required Field Indicators Not Standardized
**Severity:** Medium  
**Files:** `src/pages/appointments.tsx:703,722`, `src/pages/new-equipment.tsx:322`

Some required fields show "Name *" in the label; others rely solely on post-submit validation. The `required` attribute is missing on some mandatory inputs.

**Fix:** Adopt a single convention — asterisk in label + `required` attribute + `aria-required="true"` — across all forms.

---

### 3. Critical Action Text Too Small
**Severity:** Medium (Mobile / Accessibility)  
**Files:** `src/pages/appointments.tsx:87,141,275–285`, `src/components/qr-scanner.tsx:209`

Action buttons and status text use `text-xs` (≈11 px) extensively. WCAG 2.1 AA requires a minimum of 4.5:1 contrast at normal size; small text makes this harder to meet and reduces tap-target size on mobile.

**Fix:** Raise button/status text to `text-sm` minimum; ensure touch targets are ≥ 44 × 44 px.

---

### 4. Disabled Buttons Give No Affordance Explanation
**Severity:** Medium  
**Files:** `src/components/MedicationCalculator.tsx:161,178,244`, `src/components/VerificationCalculator.tsx:267`

Disabled state is indicated only by `opacity-50/60`. No `cursor-not-allowed`, no tooltip explaining why the button is inactive.

**Fix:** Add `cursor-not-allowed` and a `title` or `aria-describedby` tooltip that explains the prerequisite (e.g., "Complete required fields above").

---

### 5. ConflictModal Shows Raw JSON
**Severity:** High  
**Files:** `src/components/ConflictModal.tsx:27–50`

Sync conflicts are surfaced as an unstyled `<pre>` block of raw JSON. Non-technical users cannot understand what changed, which version is newer, or the consequences of each choice.

**Fix:** Parse the conflict payload and render a human-readable diff — field name, local value vs. server value, timestamps — with a clear "Keep mine / Use server version" CTA.

---

### 6. Form Validation Only on Submit
**Severity:** Medium  
**Files:** `src/pages/new-equipment.tsx:121–138,330–332`, `src/pages/appointments.tsx` (booking form)

No per-field ("touched") validation. All errors appear at once after submission, requiring the user to re-read the form top-to-bottom.

**Fix:** Add `onBlur` validation per field; show inline error beneath the field as soon as the user leaves it.

---

### 7. Onboarding Walkthrough Not Keyboard-Navigable
**Severity:** Medium (Accessibility)  
**Files:** `src/components/onboarding-walkthrough.tsx:81–95`

Step-progress dots are rendered as `<button>` elements but lack arrow-key handling. Keyboard users must Tab through every dot individually; no left/right shortcut exists.

**Fix:** Add `onKeyDown` handler on the dot container — `ArrowRight` / `ArrowLeft` advance/retreat steps.

---

### 8. Truncated Text Has No Overflow Indication
**Severity:** Low  
**Files:** `src/pages/appointments.tsx:508–515`, `src/components/csv-import-dialog.tsx:248–250`

Some list items use `truncate` but no `title` attribute, tooltip, or ellipsis indicator. Users cannot tell whether content has been clipped.

**Fix:** Add `title={fullText}` to truncated elements so a native tooltip reveals the full value on hover/focus.

---

### 9. Indeterminate Progress for Long Operations
**Severity:** Medium  
**Files:** `src/components/csv-import-dialog.tsx:120–250`, `src/pages/new-equipment.tsx:251–263`

CSV import and equipment creation show a generic spinner with no step label or estimated time. Users cannot distinguish "processing" from "frozen."

**Fix:** Show a step counter ("Validating rows… 3 / 5") or a progress bar with percentage. At minimum, add a descriptive label beneath the spinner.

---

### 10. Phone Sign-In Error Messages Are Too Technical
**Severity:** Medium  
**Files:** `src/components/phone-sign-in.tsx:83–93,109–120`

Validation failures surface Clerk internal error strings (e.g., configuration references) in `text-xs`. Israeli phone number formatting instructions appear only in fine print.

**Fix:** Map Clerk error codes to plain-language messages. Surface the "+972 / 05x" format hint inline above the input before the user makes a mistake.

---

### 11. Modals Overflow on Small Screens
**Severity:** High (Mobile)  
**Files:** `src/pages/appointments.tsx` (booking modal, ~line 1200+), `src/components/ui/dialog.tsx:36`

`DialogContent` has a fixed size without an inner scrollable region. On viewports shorter than the modal content, bottom buttons and fields are pushed off-screen and unreachable.

**Fix:** Add `overflow-y-auto max-h-[90dvh]` to `DialogContent` or wrap the form body in a scrollable `<div>`.

---

### 12. ErrorCard Retry Silently Stops After 3 Attempts
**Severity:** Medium  
**Files:** `src/components/ui/error-card.tsx:8–49`

After 3 internal retries the component swaps to a "Refresh page" button — but the retry counter is hidden state. Users don't see a countdown or explanation; the sudden button change is disorienting.

**Fix:** Display "Retry (2 attempts left)" on the button, and after exhausting retries show a message explaining why it switched to the page-refresh fallback.

---

### 13. Icon-Only Buttons Missing `aria-label`
**Severity:** High (Accessibility)  
**Files:** `src/pages/equipment-detail.tsx` (various icon buttons), `src/components/layout.tsx` (side nav icons)

Close, collapse, and action icon buttons have no accessible name. Screen readers announce them as "button" with no context.

**Fix:** Add `aria-label="Close"` (or equivalent) to every icon-only button.

---

### 14. Appointment Time Input Gives No Timezone Feedback
**Severity:** Medium  
**Files:** `src/pages/appointments.tsx:380–390,1200+`

The datetime input doesn't indicate whether it uses the user's local timezone. The error code `TIMEZONE_REQUIRED` is exposed verbatim to the user.

**Fix:** Display the detected timezone next to the input (e.g., "Times shown in Asia/Jerusalem"). Replace the raw error code with "Please allow location access or select your timezone."

---

### 15. MedicationCalculator State Lost on Navigation
**Severity:** High (Data loss risk)  
**Files:** `src/components/MedicationCalculator.tsx`

Complex dosage inputs are held only in local React state. Switching tabs, accidentally pressing Back, or a screen timeout wipes the calculation — critical in a clinical context.

**Fix:** Persist calculator state to `sessionStorage` (keyed by patient/appointment ID if available) and restore it on mount.

---

## Priority Matrix

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 5 | ConflictModal raw JSON | High | Medium |
| 11 | Modal overflow on mobile | High | Low |
| 13 | Icon buttons missing aria-label | High | Low |
| 15 | MedicationCalculator state loss | High | Medium |
| 1 | Label–input association | High | Low |
| 6 | Validate on blur, not submit | Medium | Medium |
| 10 | Technical phone error messages | Medium | Low |
| 12 | ErrorCard silent retry limit | Medium | Low |
| 3 | Text too small on mobile | Medium | Low |
| 4 | Disabled button affordance | Medium | Low |
| 7 | Onboarding keyboard nav | Medium | Low |
| 9 | Indeterminate progress spinner | Medium | Medium |
| 14 | Timezone feedback missing | Medium | Low |
| 2 | Required field standardisation | Medium | Low |
| 8 | Truncated text no tooltip | Low | Low |
