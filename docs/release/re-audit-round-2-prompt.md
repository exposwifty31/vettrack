# Re-Audit Round 2 — Verify the fixes + go deeper (Claude Cowork Prompt)

> **What this is.** The second turn of the audit loop. Round 1 (the tri-display sweep) produced 11 findings (F1–F11); all are fixed on branch `claude/phase-10-close` (PR #76). This prompt has cowork **confirm each fix actually took** and **go deeper where Round 1 was blocked** (the full Code Blue flow — Round 1 only had an admin, who can't complete it).
>
> **Where the fixes live.** On the branch, running at **http://localhost:5000** (the owner has it up). The fixes are **NOT** on production vettrack.uk yet, so Round 2 runs against **localhost**, not the live site.
>
> **Auth on localhost.** The local server is **dev-bypass** (hardcoded "Dev Admin", clinic `dev-clinic-default`). To change role, use the **dev-role switcher**: Settings → *Developer · role override* → pick `vet` / `technician` / `senior_technician` / `student` / clear-for-admin. The real **vet account** the owner created is a *production* (vettrack.uk) account — use it only if a round explicitly targets production; for localhost use the dev switcher.
>
> **Two fixes need an iPad build.** F1 and F4 are iPad-tablet-layout fixes (`HomeTabletDashboard`), which don't render on desktop web. Verify them only if the owner rebuilds the iPad sim from this branch (`pnpm cap:build:native && pnpm cap:install:ios-sim`); otherwise mark them "not re-verified — needs iPad build."

---

```text
═══ PROMPT STARTS ═══

You are a rigorous release-QA partner doing a SECOND-PASS verification of VetTrack
on http://localhost:5000 (a dev build with 11 fixes to confirm). You have computer
control of the browser — drive it yourself, take your own screenshots, and prove
each fix with a screenshot or a concrete observation. Don't take "looks fixed" on
faith: reproduce the ORIGINAL bug's steps and show it no longer happens.

The app defaults to Hebrew + RTL. Localhost auth is dev-bypass (admin by default);
switch roles via Settings → "Developer · role override". Report anything that is
still wrong, regressed, or newly noticed in the finding format at the end.

## PART A — Confirm the 11 Round-1 fixes

Do each in order. For each: state PASS (fixed) or FAIL (still broken / regressed),
with a screenshot and one line of evidence.

F11 — WEB SCROLL (do this first; it unblocks everything else)
  • On any long page (e.g. /settings), scroll DOWN with the trackpad/mouse wheel
    over the content. Expected: content scrolls, the top nav bar stays fixed, no
    double scrollbar. (Round-1 bug: only the right-edge scrollbar drag worked.)

F10 — NAV POINTS AT CANONICAL PATHS
  • Click "Command Board" and "Tasks" in the top nav. Watch the URL bar. Expected:
    it lands directly on /board and /equipment/tasks with NO intermediate redirect
    flash, and the clicked nav item shows its active state.

F9 — NO INSTALL PROMPT ON THE BOARD KIOSK
  • Go to /board/pair. Expected: NO "add to home screen / install VetTrack" banner
    overlapping the pairing-code input. The code field is unobstructed.

F7 / F8 — ADMIN DISPLAYS REGISTRY IS LIVE
  • As admin, open /admin/displays. In a SECOND tab, /board/pair, and pair a board
    using a code you issue from /admin/displays (issue code → enter it on the board).
  • Back on /admin/displays WITHOUT reloading: within ~15s the new device appears
    (F7) and its "Last seen" turns into a real time, not "Never" (F8).

F6 — REVOKED DISPLAY IS KICKED OFF THE LIVE STREAM (security)
  • With the board from F7/F8 still open and showing live data, revoke it from
    /admin/displays (open device → revoke → confirm). Do NOT reload the board.
  • Expected: within ~10s the board stops updating and drops to /board/pair on its
    own (Round-1 bug: it kept streaming live data on the revoked token until a
    manual reload). Time it.

F3 — ADMIN NOT AUTO-FILLED AS CODE BLUE EVENT MANAGER
  • As admin, go to Emergency → open a Code Blue. Expected: you are NOT pre-filled
    as the event manager; you see a manager PICKER (a list of clinicians to choose).
    (Round-1 bug: "Dan Erez (you)" was auto-filled and the start button enabled.)

F2 — CODE BLUE FAILURE MESSAGE IS LOCALIZED, NO requestId
  • As admin (no clinical authority), pick a manager and try to open the Code Blue.
    Expected: it fails with a HEBREW message about clinical authority
    ("רק צוות קליני במשמרת יכול לפתוח Code Blue…"), the toast stays ~8s, and there
    is NO "requestId: <guid>" and NO raw English in it. (Round-1 bug: English
    "Clinical authority required (requestId: …)".)

F1 / F4 — iPAD ONLY (needs an iPad sim build from this branch)
  • F1: iPad Home exceptions card reads "חריגות" (not "התראות").
  • F4: iPad Home shift card shows NO "Start shift" button (roster-derived hero,
    matching iPhone) — tapping nothing opens the summary sheet.
  • If no iPad build is available, mark both "not re-verified — needs iPad build".

## PART B — Code Blue deep dive (the Round-1 gap: do the FULL flow as a vet)

Round 1 couldn't complete Code Blue (admin lacks clinical authority). Now switch to
a clinician and exercise the whole flow.
  1. Settings → Developer role override → "vet" (or senior_technician). If the
     server still denies Code Blue for the dev vet (no seeded clinical check-in),
     say so — that itself confirms F2/F3's server gate — and note the green path
     needs a properly-seeded clinician (the production vet account).
  2. If allowed: open a Code Blue. Confirm it starts, the timer runs, and it does
     NOT optimistically show "ended" before the server confirms.
  3. Add a log entry. Open a SECOND browser tab on the same clinic and confirm the
     new session + log entry appear there within ~1–2s (SSE realtime), no reload.
  4. End the session (with an outcome). Confirm both tabs reflect the end from the
     server, and no error toast leaks a raw message/requestId (F2 also covers the
     end path).
  5. RTL/copy check throughout: Hebrew, right-aligned, no hardcoded English, no
     stray "appointment" wording anywhere in the Code Blue UI.

## PART C — Keep looking (now that scroll works and you can be a clinician)

With F11 fixed you can finally see full pages, and with the role switcher you can be
each archetype. Sweep these with the Round-1 lens (pixel/RTL/copy/interaction/
latency/role-correctness) and log anything wrong:
  • Cycle admin → vet → senior_technician → technician → student via the switcher;
    on each, walk Home, Equipment, Tasks, Alerts, Rooms, Inventory. Flag wrong
    per-role affordances (a student seeing admin controls; a role missing something).
  • Anything that scrolls: confirm no content is cut off at the bottom now that the
    scroll container changed (F11 touched every desktop page — watch for a page
    whose footer/last row is now unreachable or a nested scroll that fights the
    page scroll).
  • Hebrew-RTL correctness on any screen Round 1 didn't reach.

## Report format (same as Round 1 — paste back to the implementing agent)

For each fix in Part A: `Fx — PASS` or `Fx — FAIL: <what's still wrong>` + screenshot.
For any NEW or still-broken issue, a full block:

### [SEVERITY] <one-line title>
- **Flow / fix ref:** <e.g. F6, or "new: Alerts page">
- **Where:** <route + role>
- **Repro:** <numbered steps>
- **Expected:** <what should happen — cite the Hebrew-RTL / no-requestId / realtime rule>
- **Actual:** <what happened>
- **Evidence:** <screenshot filename / timing / the on-screen string>

Severity: BLOCKING / HIGH / MEDIUM / LOW (a broken fix that shipped is at least HIGH).

═══ PROMPT ENDS ═══
```

## The loop from here

1. Owner pastes the prompt into cowork; cowork drives localhost:5000.
2. Cowork reports PASS/FAIL per fix + any new findings in the format above.
3. Owner pastes results back to me. I fix regressions / new issues on `claude/phase-10-close` (→ PR #76), re-verify, push.
4. CodeRabbit re-reviews the new head; repeat until the board is clean, then merge → deploy → a final production pass with the real vet account.
