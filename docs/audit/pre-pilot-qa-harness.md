# VetTrack — Pre-Pilot QA Harness (verification only, no new scope)

> Deliverable: an execution-ready harness/checklist to prove the app works end-to-end
> before the doctor-only hospital pilot. **This is a QA gate, not a roadmap.** Verified
> against `origin/main` @ `7772e33` (the PR #143 merge), 2026-07-28.
>
> Provenance note: this refines the local draft harness. Every command, path, PR, and version
> claim below was re-checked against the tree at `7772e33`; the five corrections vs the draft are
> annotated inline with **[refined]**.
>
> **v2 (2026-07-28, same day):** merged the Clerk Dashboard computer-use audit into the harness as
> **Layer 0 (§1b, rows C-1…C-7)** with the audited run as its baseline (Appendix). The repeatable
> audit prompt is committed as `docs/audit/clerk-dashboard-verify.prompt.md`. v2 changes are
> annotated **[v2]**. Key deltas vs v1: Organizations is ENABLED (13/20 seats) — the capacity
> conclusion now rests on the join-code path, not on Orgs being off; Test mode is ON on prod
> (C-3); and 15 Clerk users are invisible in the app (C-6, gating).

## §0 — SCOPE FREEZE (binding for the duration of this harness)

**VetTrack 2.0 is frozen.** No new features, no new proposal kinds, no enforce flips, no
refactors, no "while I'm here" changes until the pilot has run and been reviewed. Every item
below is **observe / run / verify** — if an item can only pass by writing product code, it is
out of scope and gets logged as a finding for post-pilot, not fixed inline. The one allowed
code change class is a **fix for a confirmed pilot-path defect** surfaced by this harness
(bug-fix, not feature), and only through the normal branch → Merge-gate → CodeRabbit flow.

**Frozen surfaces — VERIFY-UNCHANGED, never touch:** SSE/outbox realtime transport
(`/api/realtime/*`, `vt_event_outbox`), Code Blue semantics (server-confirmed end, no offline
queue, no optimistic termination), **Dexie pinned `3.2.7`** (confirmed in `package.json`),
`vt_appointments` table / `/api/appointments` / `appointmentsPage.*` keys, the
`off | shadow | enforce` enforcement envelope. The harness proves these still behave as
specified; it does not modify them.

## §1 — Pilot definition & environment matrix

| Fact | Value (drives every expected outcome) |
|---|---|
| Users | **One `vet` account** (doctor). NOT admin — admins bypass the shift/custody gates, so admin testing hides the real bug class. |
| Device | **Real iPhone, native Capacitor shell, portrait.** PWA has no scan entry; iPad/landscape → `ManagementWebGate`. |
| Hardware | **2 portable ultrasound units**, each with a **QR label + NFC tag**. |
| Core loop | sign-in → home → **scan (QR camera / manual code / NFC tap)** → equipment detail → **Take** (from `returned`, no dock) → **Return** → **report issue**; custody `returned ↔ in-use`. |
| Board | Separate kiosk/web surface showing live custody + `custodianName` (read-only for the pilot). |
| Auth | Clerk (prod), native session JWT (`azp = capacitor://localhost`). |
| **Doctor enrollment capacity [v2 — audited 2026-07-28]** | Dashboard reality: **Hobby plan, MAU 3/50,000; Organizations ENABLED; "VetTrack" org 13/20 members; no B2B Authentication add-on** (Layer 0, §1b). The 20-member org wall is avoided **only via the join-code path**: `server/routes/clinic-join.ts` writes `vt_users.clinicId` directly, consuming **zero** org seats, and the server accepts org-less sessions (`server/middleware/auth.ts:162` `DB_CLINIC_FALLBACK`, default on; the native shell never selects an org — `src/features/auth/hooks/useAutoSelectOrg.ts:19` bails on Capacitor). **Binding rule: enroll every pilot doctor via the app's join code — never via a Clerk Dashboard org invite** (only 7 seats remain before the wall; the B2B add-on is the only way past 20). ~50 doctors as plain Clerk users is trivial against the 50K MAU ceiling. See C-2/C-6. |
| Targets | **Staging** (`vettrack-staging.up.railway.app`) for rehearsal; **prod** (`vettrack.uk`) for the real seed + pilot. |
| Baseline | Flow-walk green 2026-07-16 (147 web / 68 iPhone / 68 iPad; 145 pass / 0 broken / 2 degraded — `tests/flow-walk/README.md`); doctor-journey fixes = PR #126 (`5f44554`); join codes = #127 (`571db93`). |

**Two device modes — both required, they cover different risk:**
- **Mode A — dev-bypass sim / flow-walk:** fast, repeatable, broad functional + regression coverage. Bring-up = `docs/audit/phase-0-2-device-audit-playbook.md` §1 (live-reload `CAPACITOR_SERVER_URL=http://localhost:5000 npx cap run ios`, **never** `cap:build:native`).
- **Mode B — real-device bundled build (Clerk mode):** the ONLY place camera QR, NFC tap, Clerk native JWT, haptics, and push-absence are truly exercised. Build via `pnpm cap:build:native` → TestFlight/device. **Pilot trust lives here.**

## §1b — Layer 0: identity-plane audit (Clerk Dashboard ↔ app parity) **[v2]**

Runs **before Layer 1** because it gates the pilot's front door: if the identity plane is
misconfigured, every downstream J-row fails for reasons no code test will surface.
**Method:** run `docs/audit/clerk-dashboard-verify.prompt.md` via a computer-use agent (or walk
the Dashboard manually). **Baseline:** the 2026-07-28 audited run (results in the Appendix).
Evidence → `docs/audit/device-audit-evidence/pilot/C-*.png` + a PROOF entry. All C-row remedies
are **owner-run Dashboard/DB/endpoint actions** — no product code (scope freeze §0 holds).

| ID | Check | 2026-07-28 baseline | Pass bar |
|---|---|---|---|
| C-1 | Plan / MAU headroom | Hobby, **3 / 50,000** ✅ | MAU limit ≥ expected staff (~50) |
| C-2 | Organizations state & seats | **ENABLED**; "VetTrack" org **13/20**; **no B2B add-on** | Seat count not growing. **Doctors enroll via join code only** (`server/routes/clinic-join.ts` → `vt_users.clinicId`, zero org seats); **never Clerk org invites** — 7 seats to the 20 wall |
| C-3 | Test mode OFF on Production | **ON ⚠️** (corroborated: user `danerez5+clerk_test@gmail.com` — `+clerk_test` only works in test mode) | Owner toggles OFF (Configure → Instance Settings) after confirming nothing still needs `+clerk_test` identifiers — or explicitly accepts ON in the PROOF log |
| C-4 | Client Trust stays **OFF** | **OFF ✅** — this is the **desired** state | **Countermand the Dashboard's "Recommended" badge and the audit agent's advice: do NOT enable.** `needs_client_trust` has zero in-app handling (IPHONE-5); enabling it breaks pilot/demo password login (RESUBMISSION_RUNBOOK §G). Cross-ref F-7 (watch-it-stays-off) |
| C-5 | Native auth surface | `capacitor://localhost` in SSO allowlist ✅; Native API on; bundle `uk.vettrack.app` | Allowlist entry present. Supporting evidence for F-4 — does **not** replace the on-device JWT check |
| C-6 | **Clerk ↔ app user parity** | **RESOLVED 2026-07-28 (owner-run):** `/me` returned the real clinic org (mismatch ruled out) → backfill executed on the correct org — **13 real staff visible in the app**, pilot doctor already `vet` | **EXIT BAR PASSED 2026-07-28:** after the Clerk-config fix (below), a fresh join-code signup ran clean — no org page → JoinClinicScreen → code → visible in Pending → account then self-deleted successfully (live 5.1.1(v) path proof). **C-6 CLOSED.** |
| C-7 | Test org removed | **DONE 2026-07-28 (owner-run):** "My Organization" deleted from the Clerk Dashboard — the web `memberships[0]` auto-select hazard is eliminated at the source | — |

### C-6 diagnosis — why 15 Clerk users can be invisible, and how to fix it (owner, ~10 min)

The app **never lists Clerk identities**. The admin list (`GET /api/users`,
`server/routes/users.ts:235`) shows only `vt_users` rows `WHERE clinicId = <viewer's clinic> AND
deletedAt IS NULL`. A `vt_users` row is born in three places: the auth-middleware upsert on
the user's own authenticated request (`server/middleware/auth.ts:477` — `clinicId` = session org
claim or DB fallback; `role = admin` iff email ∈ `ADMIN_EMAILS`,
`server/lib/admin-email-allowlist.ts:5`, else `technician`/`pending`), the first-login sync
path (`POST /api/users/sync`, `server/routes/users.ts:908-978` — inserts when no matching row
exists), or the admin backfill
endpoint `POST /api/users/backfill-clerk` (`server/routes/users.ts:1139` — pages the Clerk org
membership list **for the admin's own clinic**, inserting missing members as
`technician`/`active`). Clinic identity == Clerk org id (`ensureClinicExistsForOrg`,
`auth.ts:242`); on web, `useAutoSelectOrg` auto-activates **`memberships[0]`** — a dual-org user
can silently land in the wrong clinic. The "My Organization" artifact is therefore **not
cosmetic**: its creation date (May 22) matches user #9's last sign-in, and if the viewing admin's
active org is the empty test org, "0 users visible" occurs even with all 13 rows intact — which
ranks the mismatch hypothesis first.

```
C-6 diagnosis (read-only until the remedy step)
│
├─ Step 1 — identity check (prod web, signed in as the admin)
│   GET /api/users/me  → record { clinicId, role }
│   Clerk Dashboard    → is this user a member of BOTH orgs? which is memberships[0]?
│   ├─ role ≠ admin / 403        → bootstrap problem: add email to ADMIN_EMAILS env
│   │                              (server/lib/admin-email-allowlist.ts) + fresh sign-in
│   └─ clinicId ≠ org_3CPrzr…    → MISMATCH CONFIRMED (hypothesis 1) → Step 3a
│
├─ Step 2 — row census (Railway Postgres, read-only SQL)
│   SELECT clinic_id, status, COUNT(*) FROM vt_users GROUP BY 1,2;
│   SELECT COUNT(*) FROM vt_users WHERE deleted_at IS NOT NULL;
│   ├─ rows exist under org_3CPrzr…  → mismatch or status/deleted filter → Step 3a/3c
│   ├─ 0 rows total                  → DB was reset post-April (hypothesis 2) → Step 3b
│   └─ rows mostly soft-deleted      → deletion pass happened (hypothesis 3) → Step 3c
│
└─ Step 3 — remedies (ORDER MATTERS)
    3a MISMATCH: fix the admin's org FIRST — leave/delete "My Organization" (or switch active
       org), fresh sign-in, re-check /me shows clinicId = org_3CPrzr…  Deleting the test org
       also removes the memberships[0] hazard for every dual-member user (= C-7).
    3b MISSING ROWS: only AFTER 3a is confirmed clean, POST /api/users/backfill-clerk →
       inserts the 13 org members under the admin's clinic as technician/active. Then set real
       roles by hand (pilot doctor → vet). The ~2 non-org Clerk users appear on their next
       sign-in via the auth upsert (pending, unless allowlisted).
       ⚠ backfill READS AND WRITES THE SAME ORG (verified users.ts:1142/1155/1199): clinicId
       = req.clinicId (the admin's ACTIVE org) is used both to list Clerk org members AND as
       the inserted clinicId. Running it while sitting on "My Organization" does NOT scatter
       the 13 into the wrong clinic — it scans only that org's members (≈ just you) and
       inserts ≈0 ("inserted": 0 looks like a broken endpoint). Worse: the upsert conflict
       target is users.clerkId ALONE (:1208, set clinicId = clinicId), so scanning yourself
       from the wrong org can RELOCATE your own vt_users row into the empty clinic and break
       the DB-fallback auth path too. This is why 3a precedes 3b: be on the real clinic org
       first, or backfill is useless and can move your own row.
    3c FILTER/DELETED: check the Pending tab (status filter) and GET /api/users/deleted
       (server/routes/users.ts:212); decide restore vs purge per user.

#### C-6 closure — what it actually was (2026-07-28, same day)

The first exit-bar signup test FAILED and exposed the real root cause, proven from prod logs:
Clerk Organizations was set membership-required with user org-creation allowed, so a fresh
signup was FORCED through Clerk's create-organization page → the server minted a brand-new
vt_clinics row for that junk org (`ensureClinicExistsForOrg`, auth.ts:242, which also seeds
default rows — 4 vt_containers observed) → the user was JIT-provisioned pending under the junk
clinic, invisible to the real clinic's admin, and `MISSING_CLINIC_ID` never fired so the
join-code screen was bypassed entirely. Prod log signature: `[auth] Session org/clinic differs
from DB; using DB clinic` with three distinct org ids in play. Delete-account also 500'd for
that account (sole-admin-of-org lock — now unreachable for new signups; hardening tracked).
Fix: Clerk Dashboard → membership optional + user org-creation OFF; junk Clerk user/orgs
deleted; prod DB cleaned (zombie vt_users row + 2 junk clinics + their 4 seeded containers,
audit-FK count was 0). Re-test: full pass incl. self-deletion.
```

## §2 — Layer 1: Automated regression gate (run first, Mode A / CI)

Catches "a pre-pilot fix regressed something." All are existing suites — run, don't author.

| # | Command | Where runnable | Pass bar |
|---|---|---|---|
| L1-1 | `pnpm typecheck` | any env | 0 errors, both tsconfigs |
| L1-2 | `pnpm test` | any env | green except DB-integration files failing only on `ECONNREFUSED :5432` (no logic failures). Baseline for the no-Postgres sandbox: **20 test failures, all `ECONNREFUSED 127.0.0.1:5432`** (see PROOF log, 2026-07-28 haptics entry). |
| L1-3 | `pnpm test:db-integration` + `pnpm test:integration:ops` | owner (needs local Postgres + migrations) | green |
| L1-4 | `pnpm architecture:gates` · `pnpm depcruise:check` · `pnpm knip` | any env | no new violations vs baseline |
| L1-5 | `pnpm i18n:check` | any env | he⟷en parity clean |
| L1-6 | `pnpm dev:walk` then `pnpm test:playwright:flow-walk` | owner/CI (browser + app) | ≥ 2026-07-16 baseline (145 pass / 0 broken); **any new `broken` blocks** |
| L1-7 | `pnpm test:playwright:ci` · `:pwa` · `:ui-smoke` | owner/CI (browser) | green |
| L1-8 | `pnpm test:playwright:phase9` | owner/CI (browser) | 8 realtime/PWA drills green (frozen-surface proof) |
| L1-9 | `pnpm test:staging:e2e` + `pnpm test:staging:walkthrough` | owner (live staging) | green against live staging |

> Note: L1-6/-7 use `dev:walk` (= `PLAYWRIGHT_E2E=true pnpm dev:bypass`; `PLAYWRIGHT_E2E==="true"`
> relaxes the 100/min limiter at `server/middleware/rate-limiters.ts:27`). Plain `pnpm dev` bounces
> every row past the cliff to `/signin`.

> **[refined] Automated proof for pilot-path fixes.** Five PR-#126 regression-test files (covering four J-rows) run *inside*
> L1-2 (`pnpm test`) and are the automated proof for the Layer-2/3 rows that Mode B then confirms
> on device:
> - `tests/equipment-detail-tools-sheet-native.test.tsx` → **U-3 / IPHONE-2** (Print QR hidden on native)
> - `tests/equipment-detail-screen-nfc-confirm.test.tsx` → **J-4** (NFC in-app confirm, no silent toggle)
> - `tests/command-board-custodian-name.test.ts` → **J-8** (board `custodianName` via `server/lib/custodian-display-name.ts`; display-name/name, last-resort email **local part**, never a full email)
> - `tests/scan-screen-admin-shift-bypass.test.tsx` + `tests/shift-gate.test.ts` → **J-5** (`actOffShift` off-shift Take)

## §3 — Layer 2: Doctor-journey E2E flow (the actual pilot path) — CORE

Run **Mode A** first for speed, then **Mode B** on a real iPhone as the true gate. Each row:
touchpoint → expected → evidence artifact (`docs/audit/device-audit-evidence/pilot/<id>.png`).
Rehearse as the **`vet` account**, Board on.

| ID | Step | Expected | Fail signal | Automated proof (L1) |
|---|---|---|---|---|
| J-0 | Ops pre-flight (owner, no code). **Pre-req: Layer 0 green — C-3, C-6, C-7 especially (§1b)** | join code generated (Admin→Pending Users→Invite staff); 2 US units created **via app UI** (UUID + `returned`); QR labels printed from prod web. **Enrollment uses the join code, not a Clerk org invite** (C-2). | non-UUID seed → 400 / `untracked` 422 `CUSTODY_CHAIN_BROKEN`; **admin can't see/approve pending users → C-6 not done** | — |
| J-1 | First sign-in on **mobile-web**, Veterinarian chip + license ≥3 chars, email/password | pending screen → admin approves → sign out/in → lands authenticated | native-shell first-login dead-ends (no org auto-select); pending screen never self-recovers | — |
| J-2 | Open native shell, iPhone portrait | home renders, no `ManagementWebGate`, tab bar present | landscape/iPad → management wall (expected; document) | — |
| J-3 | **QR scan** a unit (Mode B: camera; Mode A: manual code) | scanner opens → decodes → equipment detail for the right unit, exactly once | double-count / last-scan-wins wrong unit (T-03 regression) | `tests/e2e/flows/duplicate-scan.spec.ts` (Mode A) |
| J-4 | **NFC tap** a unit (Mode B only) | in-app confirm dialog (Take/Return), **no silent toggle**, resolves on the **phone** | stuck "nfc-open" toast / dropped intent (the original audit bug — #126 fix) | `tests/equipment-detail-screen-nfc-confirm.test.tsx` |
| J-5 | **Take** a `returned` unit (no dock) | custody → `in-use`, custodian = the vet; appears in `/my-equipment` | `hasActiveShift` gate locks the vet (root audit bug — verify #126 `actOffShift` holds) | `tests/scan-screen-admin-shift-bypass.test.tsx` + `tests/shift-gate.test.ts` |
| J-6 | **Return** the unit | custody → `returned`; leaves `/my-equipment` | server-confirmed release fails; row still held | — |
| J-7 | **Report issue** on a unit | mobile report-issue sheet opens + submits | button absent on native (pre-#126 gap) | — |
| J-8 | **Board** reflects custody | unit shows held/returned + `custodianName` (display name / name / email-local — **never full email on kiosk**) | custody block empty; `custodianName` unpopulated (pre-#126 bug) | `tests/command-board-custodian-name.test.ts` |
| J-9 | Duplicate / wrong-QR / non-UUID | duplicate scan de-dupes; unknown tag → clean not-found; non-UUID → graceful | crash / silent no-op | `tests/e2e/flows/duplicate-scan.spec.ts` |

Cross-check server truth per state change: `GET /api/equipment/:id` shows expected custody/custodian.

## §4 — Layer 3: UI/UX conformance pass (Mode B on real iPhone, portrait)

Reuse `ui-smoke` + manual inspection; grade against the ECC web-testing rules (320/375 widths)
and the accessibility skill (WCAG AA). Findings prefixed **IPHONE-N** trace to
`docs/audit/pre-resubmission-4flow-audit-2026-07-18.md` **[refined]** — each is a pass/accept
decision, not a rebuild.

| ID | Check | Pass bar |
|---|---|---|
| U-1 | Hebrew default + RTL correctness across the loop | chevrons/icons mirrored, no bidi leaks, no clipped text |
| U-2 | Safe-area on fullscreen routes | headers/back not under Dynamic Island. **[refined] IPHONE-1 is already fixed on `main`** — `src/components/handover-artifact-panel.tsx:58-59` adds `paddingTop: "calc(env(safe-area-inset-top) + 16px)"` for the `phone` variant (fixed by a later commit, **not** #126). `/handoff` is a shift-handover surface **off the doctor scan→take→return→report loop**, so this is *verify-still-fixed*; if it regressed it is a **post-pilot finding, not a GO blocker**. |
| U-3 | No dead affordances on native | **Print QR hidden on native** (IPHONE-2: `EquipmentDetailToolsSheet.tsx` gates the Print QR button on `isCapacitorNative()`; target `/equipment/:id/qr` is `WebOnlyGuard`-walled). Fixed by **#126** with regression test `tests/equipment-detail-tools-sheet-native.test.tsx` (L1-2). Confirm on device. |
| U-4 | Touch targets ≥ 44pt | header controls, scan button, Take/Return/Report |
| U-5 | Empty / loading / error states | no unit yet, offline, failed action all render intentionally (not blank/spinner-stuck) |
| U-6 | Locale-on-sign-in | **IPHONE-4**: `preferred_locale` is not applied to the UI (`src/lib/i18n.ts:80-89` localStorage-only, defaults `he`); server `preferredLocale` is read only by notification/handover code. If the pilot expects a set language, **decide accept-or-fix** (no code change without a confirmed pilot-path defect per §0). |
| U-7 | Native chrome | tab bar, MoreSheet, status-bar inset, back behavior coherent in portrait |

## §5 — Layer 4: Bug-class & failure-injection (Mode B where hardware-bound)

**[refined]** F-4/F-5/F-7 have **no CI proxy** — they are owner-verify-on-device only. Evidence
lines are from `docs/audit/pre-resubmission-4flow-audit-2026-07-18.md`.

| ID | Injection | Expected | Coverage |
|---|---|---|---|
| F-1 | Airplane mode mid-scan / mid-Take | loud, recoverable failure; no corrupt custody; reconciles on reconnect (SSE replay) | Mode B |
| F-2 | Offline cold-start | "connect to sign in" copy (T-12), not a white screen | Mode B |
| F-3 | Session timeout / 401 during a call | re-auth path, cache cleared (T-05 wiring), no infinite spinner | Mode B |
| F-4 | **Clerk native JWT round-trip** (IPHONE-3, real device only) | first authed `/api/*` from `capacitor://localhost` returns 200 under `@clerk/express ^2.x` — **no dev-bypass substitute exists; owner must verify on device**. Supporting baseline (C-5, audited 2026-07-28): `capacitor://localhost` confirmed in the SSO allowlist, Native API enabled — necessary but not sufficient | **owner-verify-on-device, no CI proxy** |
| F-5 | Push-notification absence (IPHONE-6) | no permission prompt, no crash; confirm privacy-policy copy vs behavior acceptable for the pilot | **owner-verify-on-device, no CI proxy** |
| F-6 | Rapid double-tap Take/Return | idempotent; one state change, per-row spinner scope (T-20) | Mode B |
| F-7 | `needs_client_trust` at demo/pilot login (IPHONE-5) | owner-run pre-archive login gate (`verify:resubmission` §C/§G); watch Clerk Client Trust. Baseline (C-4, audited 2026-07-28): Client Trust confirmed **OFF** — the desired state. **Do NOT enable it** despite the Dashboard's "Recommended" badge; the gate is that it *stays* off | **owner-procedural, no CI proxy** |

## §6 — Frozen-surface non-regression (VERIFY the pilot didn't disturb them)

| ID | Verify | Method |
|---|---|---|
| Z-1 | SSE/outbox transport intact | `pnpm test:playwright:phase9` (L1-8); board custody updates arrive via SSE, not polling |
| Z-2 | Code Blue unchanged & **out of the doctor path but not reachable-and-broken** | `tests/e2e/flows/code-blue-read.spec.ts`; page renders, session start server-gated, offline blocked loud |
| Z-3 | Dexie `3.2.7` unchanged | `grep '"dexie"' package.json` → `3.2.7` |
| Z-4 | `vt_appointments` / `appointmentsPage.*` untouched | i18n parity (L1-5) + no diff to the frozen namespace |
| Z-5 | **Autopilot is shadow-inert to the vet** | the doctor sees **no** proposals/enforce; `off\|shadow\|enforce` resolves to shadow; nothing in the pilot loop routes through it |

## §7 — Go / No-Go exit criteria

**GO only when all hold:**
0. **[v2] Layer 0 (§1b): C-1…C-7 each green or explicitly accepted in the PROOF log** — in
   particular the C-6 exit bar (admin sees the expected staff under the correct clinic + a fresh
   join-code signup lands in Pending and can be approved), Test mode OFF (or accepted), and **no
   doctor enrolled via a Clerk org invite**.
1. Layer 1 fully green (or every non-green is a documented DB-only `ECONNREFUSED`).
2. Layer 2 **J-1…J-8 pass on a real iPhone (Mode B)** as the `vet` account — the pilot loop works end-to-end on the actual pilot device.
3. Layer 3: zero unaccepted UI/UX blockers on the pilot path. **[refined]** split by proof class:
   - **Fixed-and-tested** (U-3 / J-4 / J-5 / J-8): the L1 regression test is green **and** one Mode-B on-device confirmation passes.
   - **Verify-still-fixed** (U-2 / IPHONE-1): confirmed present on device; off the pilot loop, so post-pilot if regressed — not a GO blocker.
   - **Accept-or-fix** (U-6 / IPHONE-4): explicitly decided and recorded.
4. Layer 4: F-1/F-2/F-3/F-6 pass; **F-4 owner-verified on device** (Clerk native JWT, no CI proxy); F-5/F-7 accepted with the owner gate documented.
5. Layer 6: all Z-rows verified unchanged.
6. Evidence captured under `docs/audit/device-audit-evidence/pilot/` + a `docs/audit/PROOF_ALIGNMENT_LOG.md` entry (commands + actual results, not summaries).

**Any new `broken` in the flow-walk, any Layer-2 fail on the pilot loop, or an unverified F-4 = NO-GO.**

Sign-off: owner records GO/NO-GO in the PROOF log with the evidence bundle path and the date.

## Notes on reuse (no new harness code)

Everything above runs on shipped infrastructure: `tests/flow-walk/*`, the `PW_SUITE` suites,
`tests/e2e/flows/*`, `docs/audit/phase-0-2-device-audit-playbook.md` §1 (Mode-A live-reload
bring-up: `CAPACITOR_SERVER_URL=http://localhost:5000 npx cap run ios --target …`; never
`cap:build:native`), the four #126 regression tests (§2 note), and the `verify:resubmission` /
`validate:prod` / `auth:preflight` scripts. The IPHONE-N findings are sourced from
`docs/audit/pre-resubmission-4flow-audit-2026-07-18.md`. The only authored artifact is the
**evidence** (screenshots + PROOF entry). If a check needs a capability we don't have a test for
(e.g. F-4 native JWT), it stays a **manual owner-verify** — we do not write new product or test
code to satisfy it during the freeze.

---

## Appendix — Layer-1 subset executed in the cloud planning session (2026-07-28)

The runnable subset of Layer 1 was executed in the remote sandbox (no Postgres, no browser, no
device). Playwright (L1-6/-7/-8), DB-integration (L1-3), staging (L1-9), and all of Mode B remain
**owner-run**. Actual results — recorded verbatim, not summarized — are in the matching
`docs/audit/PROOF_ALIGNMENT_LOG.md` entry of the same date. Results table:

| L1 row | Command | Exit | Result |
|---|---|---|---|
| L1-1 | `pnpm typecheck` | 0 | 0 errors (frontend `tsconfig` + `tsconfig.server.json`). |
| L1-2 | `pnpm test` | 1 | `Test Files 16 failed \| 652 passed \| 19 skipped`; `Tests 20 failed \| 5838 passed \| 255 skipped`. **All 20 failures = `ECONNREFUSED 127.0.0.1:5432`** in 4 shift-handover DB-integration files (`shift-handover-generator` 9, `shift-handover-patient-worklist` 4, `shift-handover-surface` 4, `shift-handover-observed` 3). Zero assertion/logic failures. Matches the documented no-Postgres baseline (20/5838). **Pass bar met.** |
| L1-4 | `pnpm architecture:gates` | 0 | tsc (frontend + server) clean; depcruise `no dependency violations (979 modules)`, 10 known-violations baseline unchanged; madge cycles = baseline (server 2, src 0). No new violations. (`architecture:gates` runs depcruise internally; `knip`'s 131-unused-files baseline is unchanged from the prior PROOF entry.) |
| L1-5 | `pnpm i18n:check` | 0 | `locales/en.json` ⟷ `locales/he.json` deep key parity clean. |

**Owner-run, not executed here:** L1-3 (DB-integration — needs Postgres), L1-6/-7/-8 (Playwright —
need a browser + running app), L1-9 (staging E2E — needs live staging), and all of Layer 2–5 Mode B
(real iPhone: camera QR, NFC, Clerk native JWT, haptics, push-absence).

### Layer-0 baseline — Clerk Dashboard audit, 2026-07-28 (owner-run, computer-use agent) **[v2]**

> **Historical pre-remediation snapshot (morning 2026-07-28).** C-3/C-6/C-7 rows below were
> remediated later the same day — current state lives in the §1b table and the C-6 closure note.
> Do not action rows from this snapshot.

Read-only run of the v1 audit prompt (now committed, revised, as
`docs/audit/clerk-dashboard-verify.prompt.md`); results as reported by the owner:

| Item | Audited value |
|---|---|
| Plan / MAU | Hobby (Monthly, $0); **3 / 50,000** MAU; 1/100 retained orgs; no B2B Authentication add-on |
| Organizations | **ENABLED** (Membership required / Standard; default limit 20/org). Orgs: **"VetTrack" 13 members** (Apr 16), **"My Organization" 1 member** (May 22 — test artifact, slated for deletion, C-7) |
| Test mode | **ON on the Production instance ⚠️** (C-3; corroborated by `+clerk_test` user) |
| Client Trust | **OFF** — desired state (C-4); lockout ON (100/1h); bot protection OFF; enumeration Bulk |
| Native | Native API ENABLED; bundle `uk.vettrack.app`; `capacitor://localhost` in SSO allowlist (C-5) |
| Session | custom claim `org_id: {{org.id}}` (org_3CPrzr…) — web sessions bind clinic = Clerk org id |
| Domain | `vettrack.uk` verified, SSL issued |
| Users | **15 total in Clerk — 0 visible in the app ⚠️** (C-6 — pre-remediation reading; CLOSED same day, see C-6 row + closure note); MAU 3 consistent with only the July sign-ins in-window |

The audit agent's recommendation to enable Client Trust was **rejected** (C-4/F-7: unhandled
`needs_client_trust` would break pilot/demo password login). All C-row remediations are owner-run
Dashboard/DB/endpoint actions and land in the PROOF log when done.
