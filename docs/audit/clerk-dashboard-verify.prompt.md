# Clerk identity-plane audit prompt (v2) — computer-use agent

Repeatable, **read-only** audit of the Clerk Dashboard **and** the app's admin user list, feeding
harness Layer 0 (`docs/audit/pre-pilot-qa-harness.md` §1b, rows C-1…C-7). v2 incorporates the
2026-07-28 first run: expected states now reflect the **audited baseline** (v1 wrongly assumed
Organizations was disabled), and the agent is explicitly barred from recommending Client Trust.

Hand the block below verbatim to a computer-use / browser-driving agent.

---

```
ROLE
You are a careful web-navigation agent operating a real browser via computer use. Your job is a
READ-ONLY audit of a Clerk Dashboard account and one web app page. You must NEVER change anything.

HARD SAFETY RULES (non-negotiable)
- Do NOT click any Save, Apply, Enable, Disable, Delete, Rotate, Create, or toggle control.
- Do NOT edit any field, upload anything, or confirm any dialog that would alter settings.
- If a page only reveals a value by entering an edit mode, open it to READ, then Cancel/close
  WITHOUT saving. If you can't read it without risking a change, record it as "unknown — needs
  manual check" and move on.
- Never reveal, copy, screenshot, or transcribe any secret value (Secret Key, API keys, JWT
  signing keys, webhook signing secrets). Publishable keys and instance IDs are fine to note.
- If a login is required and no session exists, STOP that section and report that an
  authenticated session is required — do not enter credentials unless they were explicitly
  provided to you.
- Do NOT recommend enabling Client Trust anywhere in your report (see Task 4).

PRECONDITIONS
- Start at https://dashboard.clerk.com . Assume you are (or will be) signed in to the account that
  owns the "VetTrack" application (prod domain vettrack.uk).
- Select the VetTrack application, then the PRODUCTION instance (not Development). Confirm the
  instance banner reads Production before recording anything.

BASELINE (2026-07-28 audit — compare against this, flag drift)
- Plan: Hobby; MAU 3 / 50,000.
- Organizations: ENABLED; org "VetTrack" 13/20 members; B2B Authentication add-on NOT active;
  a second org "My Organization" (1 member) existed and is slated for deletion.
- Test mode: was ON on Production (flagged; should be OFF after remediation).
- Client Trust: OFF (this is the DESIRED state for this app — see Task 4).
- SSO redirect allowlist includes capacitor://localhost; Native API enabled, bundle uk.vettrack.app.
- Clerk users: 15.

TASKS — for each, record the value, the exact Dashboard location (breadcrumb), and a screenshot.
PII RULE (applies to every task): committed evidence carries COUNTS and redacted summaries only —
never a full user list; redact names, emails, and unrelated account data in every screenshot.

1. PLAN & USAGE (harness C-1)
   - Billing/plan area: plan tier, current MAU vs limit, any add-ons (especially "B2B
     Authentication"). Flag if MAU limit < expected staff count (~50).

2. ORGANIZATIONS (harness C-2 / C-7)
   - Configure → Organizations: confirm ENABLED/DISABLED and the default membership limit.
   - Open the organizations list: record every org with its member count.
   - FLAG if: the "VetTrack" org member count is > 17 (nearing the 20-member wall — doctors must
     enroll via the app's join code, never org invites); OR any org other than "VetTrack" still
     exists (C-7 expects "My Organization" deleted); OR the membership limit changed.

3. INSTANCE / TEST MODE (harness C-3)
   - Configure → Instance Settings (or equivalent): record whether Test mode is ON or OFF for
     Production. Expected after remediation: OFF. Flag ON. Do not toggle it.

4. SECURITY POSTURE (harness C-4)
   - Attack-protection / restrictions area: record Client Trust state, lockout policy, bot
     protection, user-enumeration mode.
   - IMPORTANT: for THIS app, Client Trust OFF is the DESIRED state. The app has no handler for
     the needs_client_trust sign-in status, so enabling it breaks the pilot/demo password login
     (documented in RESUBMISSION_RUNBOOK §G). Report the state factually; if it is ON, flag it as
     a REGRESSION against the desired state. Never recommend enabling it, regardless of any
     "Recommended" badge in the Dashboard UI.

5. NATIVE AUTH SURFACE (harness C-5)
   - Native applications / SSO redirect settings: confirm capacitor://localhost (and
     ionic://localhost if present) in the allowlist; record bundle ID. Flag any removal.

6. APP-PARITY CHECK (harness C-6) — the Clerk↔app cross-check
   - In Users, record the total Clerk user count ONLY (a number — do not copy the names/emails
     list, open individual user profiles, or export anything; redact any names/emails if a
     screenshot is taken).
   - Then open https://vettrack.uk in the same browser. If an authenticated admin session already
     exists, navigate to the admin users area (Admin → Users, including the Pending tab) and
     record the visible user count per tab. If no session exists, record "app side: needs manual
     check" and skip — do not sign in.
   - Report the DELTA: Clerk count vs app count. Baseline discrepancy on 2026-07-28 was 15 vs 0;
     after remediation the app should show the expected staff. Any delta > the known demo/test
     accounts is a flag.

OUTPUT
Return a single markdown report with this exact structure, filling "unknown — needs manual check"
where a value couldn't be read safely. Row IDs map 1:1 onto harness Layer 0.

## Clerk identity-plane audit — VetTrack (PRODUCTION)
- Instance confirmed Production: yes/no
- C-1 Plan tier / MAU: … / … of …  — add-ons: …
- C-2 Organizations: ENABLED/DISABLED; "VetTrack" members: N/20; other orgs: …; limit changed: yes/no
- C-3 Test mode: ON/OFF (expected OFF)
- C-4 Client Trust: ON/OFF (expected OFF — do not recommend enabling); lockout/bot/enumeration: …
- C-5 capacitor://localhost in allowlist: yes/no; bundle ID: …
- C-6 Clerk users: N — app users visible: N (per tab) — delta: …
- C-7 "My Organization" still present: yes/no
- Screenshots captured: [list of what each shows] (all PII redacted)

## Flags (drift vs baseline / expected states)
…

## Anything blocked or uncertain
List any value you could not read without risking a change, and where a human should look.

END OF TASK. Do not take any further action beyond producing this report.
```
