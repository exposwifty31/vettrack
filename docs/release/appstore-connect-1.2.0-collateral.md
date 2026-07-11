# App Store Connect Collateral — VetTrack 1.2.0 (build 26)

> **Purpose.** The owner-facing authoring pieces for the 1.2.0 submission (Phase 10.B, Step 4 of `cowork-appstore-resubmission-prompt.md`): "What's New" in both locales, App Review notes, and the isolated reviewer-account seeding steps. These are drafts to paste into App Store Connect — they are **not** credentialed actions. The archive/upload and the ASC form entry are owner-run.
>
> **Version:** marketing `1.2.0`, `CURRENT_PROJECT_VERSION` (build) `26`, `CFBundleVersion` → `$(CURRENT_PROJECT_VERSION)`. Set by `pnpm resubmit:release 1.2.0`. `ios/.last-shipped-build` stays `25` until this build uploads successfully.
>
> **Truthfulness gate.** Every line below describes work already merged to `main` and documented in `docs/audit/PROOF_ALIGNMENT_LOG.md` (Phase 10.A batches). Do not add a claim that isn't shipped.

---

## 1. "What's New" copy

Hebrew is the default locale — enter it as the primary. Keep both in sync if edited.

### Hebrew (he) — primary

```
מסכי בית לכל תפקיד — לכל תפקיד (וטרינר/ית, טכנאי/ת, סטודנט/ית, ניהול) מסך פתיחה מותאם לפעולות היומיום שלו.

לוח מרכז הבקרה — תצוגת חדר־בקרה מלאה למסך גדול, לניטור הפעילות במחלקה במבט אחד.

צימוד מסכי תצוגה — חיברו מסך קיר או טאבלט ייעודי בצימוד מאובטח, עם ניהול המכשירים מהקונסולה.

חוויית סטודנט ממוקדת — ממשק מצומצם למשמורת ציוד ולניפוק מלאי בלבד, המתאים לעבודה בהשגחה.

שיפורי יציבות ל־Code Blue ולתמיכת ימין־לשמאל בכל המסכים.
```

### English (en)

```
Per-role home screens — vets, technicians, students, and managers each get a home surface tuned to their day-to-day work.

Command Center board — a full control-room view for large displays, so the whole department's activity reads at a glance.

Display device pairing — connect a dedicated wall screen or tablet through a secure pairing flow, managed from the admin console.

Focused student experience — a pared-down interface scoped to equipment custody and inventory dispense, built for supervised work.

Reliability improvements to Code Blue and right-to-left layout across every screen.
```

> App Store "What's New" has a 4000-char limit per locale; both drafts are well under. Trim the last line first if space is tight.

---

## 2. App Review notes

Paste into the "Notes" field of the version's "App Review Information". State plainly this is a real native app, and hand the reviewer an isolated, pre-seeded account.

```
VetTrack is a native veterinary-hospital operations app (equipment custody, Code
Blue emergency workflow, inventory). It is NOT a web wrapper: it ships distinct
native surfaces — a mobile floor UI, an iPad layout, and a large-format Command
Center board — with native Control Center widgets and NFC/haptics. (App Review 4.2.)

Default language is Hebrew (right-to-left). Switch to English in Settings if needed.

Reviewer account (isolated, synthetic data only — no real client/patient/device
records):
  Email:    <reviewer login — from the App Store Connect review credentials>
  Password: <from the password manager — never commit it>
  Role:     vet (has clinical authority for the Code Blue flow)
  Clinic:   dedicated review tenant, separate from any production clinic

To exercise Code Blue: open the Emergency tab → start a session → log an action →
end the session. To exercise custody: open Equipment → scan/checkout/return.

The account is scoped to synthetic data and will be revoked after review.
```

> Fill the `< >` placeholders from the password manager / ASC at submit time. Do **not** write the credential into this file or any tracked file (see the 2026-07-10 credential-exposure entry in the proof log).

---

## 3. Reviewer-account seeding (do this BEFORE submitting)

Clinical authority is roster-derived: `resolveAuthority()` grants Code Blue rights only to a **vet / senior-technician / lead-technician** who **also** has an **active roster shift** covering the moment of use. An unrostered reviewer — or an admin — gets a silent `403 INSUFFICIENT_CLINICAL_AUTHORITY` on every Code Blue mutation, which reads to a reviewer as a broken feature.

Seed, in the isolated review tenant:

1. **Role.** Create the reviewer user as `vet` (or `senior_technician` / `lead_technician`) — **not** `admin`. Admin never resolves clinical authority even with a shift.
2. **Active shift.** Roster is admin-CSV-import only (`/api/shifts/import*`). Import a shift for the reviewer user with a **wide date range** that fully spans the review window (Apple can review any time over several days — a one-day shift will lapse). Import a range generously wider than the expected window.
3. **Synthetic data.** Seed only fake equipment/inventory/animals — never real records.
4. **Verify before submitting.** Sign in as the reviewer, start a Code Blue session, log one action, end it. If any step 403s, the shift isn't active for "now" — widen the roster range and re-import.
5. **After review.** Revoke/rotate the reviewer credential.

> Background: `docs/release/cowork-appstore-resubmission-prompt.md` Step 4, and the 2026-07-10 `docs(10.B)` reviewer-shift guardrail (the reason this section exists — a reviewer without an active shift silently fails Code Blue).

---

## 4. Pre-submit checklist (owner, on a Mac)

- [ ] `pnpm resubmit:release 1.2.0` already run — marketing `1.2.0`, build `26` (done; committed).
- [ ] Populate `.env` with the production `pk_live` Clerk key + `VITE_API_ORIGIN` (so the shell doesn't fall into dev-bypass).
- [ ] `pnpm cap:build:native` (the ONE sanctioned build path — never `pnpm build && npx cap sync`).
- [ ] `REVIEWER_PASSWORD=… pnpm verify:resubmission` on the Mac → all gates green (the sandbox can't run the demo-login / Clerk / `sips` icon / native-bundle gates).
- [ ] Live tri-display audit (`live-tri-display-audit-prompt.md`) comes back **clean (zero BLOCKING/HIGH)** — the required release quality gate.
- [ ] Xcode: "Any iOS Device" → Product → Archive → Organizer → Distribute → App Store Connect → Upload.
- [ ] ASC: new `1.2.0` version record; paste §1 (he + en), §2 review notes; refresh screenshots if UI changed; seed reviewer account per §3.
- [ ] Submit for review.
- [ ] After a successful upload: `echo 26 > ios/.last-shipped-build` and commit (raises the `verify:resubmission` floor for next time).
