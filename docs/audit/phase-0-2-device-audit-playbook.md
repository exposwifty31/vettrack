# Device Audit Playbook — Consolidated Audit × 10x, Phases 0–2

> **On-device behavioral audit** of the code merged in PR #86 (`b6856f921`, `main`). Runs the **native Capacitor shell in the iOS Simulator on both iPhone and iPad**, against the **local `pnpm dev` server in dev-bypass** — driving each device-observable Phase 0–2 fix/feature to its final state and capturing screenshot evidence per surface (backend → frontend → UX, per the E2E rule). Complements the static-diff audit (`phase-0-2-implementation-audit-prompt.md`), which covers the non-device-observable cards.

---

## 0. Environment (verified 2026-07-13, this machine)

| Fact | Value |
|---|---|
| Audit target | `main` @ `b6856f921` (PR #86 merge) — this worktree |
| Running app | `pnpm dev` live: API `:3001`, web `:5000` (process cwd = this tree) |
| Auth | **dev-bypass** (`.env.local` `CLERK_ENABLED=false`) → hardcoded admin, `clinicId=dev-clinic-default` |
| DB | Postgres `localhost:5432/vettrack`, accepting connections |
| Xcode | 26.5; CocoaPods 1.16.2 (⚠ pods NOT yet installed — no `.xcworkspace`) |
| Simulators | iPhone 17 Pro (**booted**, `9821AC5F…`); iPad Pro 11-inch M5 (`8B8E788A…`) |
| Capacitor | appId `uk.vettrack.app`, `webDir=dist/public`, honors `CAPACITOR_SERVER_URL` |

**Device matrix (2 targets):** `iPhone 17 Pro` (phone shell — `NativeShell`, tab bar, `MoreSheet`) · `iPad Pro 11-inch (M5)` (tablet shell — `NativeTabSidebar`, master-detail variants).

## 1. Bring-up runbook (live-reload, dev-bypass — do NOT bundle-build)

Bundling via `scripts/build-native-shell.sh` reads `.env` only (ignores `.env.local`) and would bake the **live Clerk key** → Clerk mode, defeating a dev-bypass audit. Instead point the WKWebView at the running dev server:

1. **Reuse the running dev server** — do NOT run `pnpm dev` again (its `predev` kills :3001/:5000 and would disrupt concurrent agents). Confirm reachable: `curl -s localhost:3001/api/health` → 200. If it is not dev-bypass, stop and surface (do not restart their server).
2. **Confirm seed data exists** (locate/return/dispense drills need equipment, rooms, containers). If empty: `pnpm seed:dev` (idempotent). Record counts.
3. **iOS ATS for cleartext localhost** — the sim reaches the Mac at `http://localhost:5000`. If `ios/App/App/Info.plist` lacks an ATS exception, add a **dev-only** `NSAppTransportSecurity → NSAllowsLocalNetworking = true` (revert before any commit; ios build files are never committed by this audit).
4. **Sync + launch** per device (installs pods on first `sync`):
   ```bash
   CAPACITOR_SERVER_URL=http://localhost:5000 npx cap sync ios
   CAPACITOR_SERVER_URL=http://localhost:5000 npx cap run ios --target 9821AC5F-F618-4608-8CF5-7DB435BC874C   # iPhone 17 Pro
   CAPACITOR_SERVER_URL=http://localhost:5000 npx cap run ios --target 8B8E788A-B932-4DAC-BE21-C89B752F5012   # iPad Pro 11"
   ```
   `cap sync` needs `dist/public` to exist; if absent, run a **plain `pnpm build`** once (never `pnpm cap:build:native`, which is prohibited here — it bakes the Clerk key and produces the bundled shell). The plain build is only a prerequisite for `cap sync`; that bundle is **not** what the live-reload WebView serves — it loads `CAPACITOR_SERVER_URL` at runtime.
5. **Drive with computer-use** (`request_access` for Simulator; it is full-tier — click/type/screenshot allowed). Verify the app loaded the **dev-bypass** UI (admin home, no sign-in wall).
6. **Fallback (only if native build blocks after ~3 attempts):** open the URL in the sim's Mobile Safari and audit there — record the deviation loudly (this exercises the mobile web shell via touch-narrow, NOT the Capacitor native shell; native-only surfaces — status bar inset, NFC, haptics — become CANNOT-VERIFY).

## 2. Device-observability triage (honest coverage — no silent gaps)

A device audit can only verify cards with a **UI surface reachable in dev-bypass on the simulator**. Everything else is explicitly out-of-scope-for-device and deferred to the static audit / DB+API checks.

| Card | CLICK-PATH | Device-observable? | Drill / disposition |
|---|---|---|---|
| **T-01** Code Blue outcome Cancel | 001 | ✅ full | D1 |
| **T-02** dock-return/RFID mount | 002/003 | ✅ full | D2 |
| **T-03** QR decode race | 004 | ⚠ partial (sim has no camera) | D3 — manual-code entry only; camera path → CANNOT-VERIFY |
| **T-04** room-radar Return after cancel | 005 | ✅ full | D4 |
| **T-05** sync-engine QueryClient wiring | 006 | ⚠ indirect | D5 — observe post-reconnect cache refresh; else defer to test |
| **T-06–T-15** submission gate | — | ❌ config/owner | file/DB checks + owner checklist; not device |
| **T-12** offline cold-start copy | — | ✅ full | D6 — airplane-mode launch shows "connect to sign in" |
| **T-16** Phase-0 exit drill | — | ✅ full | D7 — the plan's own drill (start CB → dismiss outcome → end) |
| **T-17** checkout on shift error | 012 | ⚠ partial | force shift-query error hard → likely CANNOT-VERIFY-live |
| **T-18** folder Select value | 036 | ✅ full | D8 — edit a filed item, folder shows real folder |
| **T-19** Return-All partial failure | 020 | ✅ full | D9 |
| **T-20** per-row spinner scope | 021 | ✅ full | D10 |
| **T-21** header touch targets ≥44pt | — | ✅ visual | D11 — inspect/measure header controls |
| **T-22** locate search | — | ✅ full (+iPad) | D12 — the headline feature drill |
| **T-23** readiness badge | — | ✅ visual (+iPad, board) | D13 — badge on each surface, not color-only |
| **T-24** damaged-return + **custody release (owner decision)** | — | ✅ full | **D14 — headline: return "damaged" releases custody + defers damage report** |
| **T-25 / T-26** shift-chat | — | ✅ full | D15 |
| **T-27** start-of-shift card | — | ✅ full (+iPad hero band) | D16 |
| **T-30** nudge feed | — | ✅ full | D17 — compute-on-read nudges surface on home/alerts |
| **T-31 … T-33** | — | mixed | reconcile at run; observable ones get a drill, rest deferred |
| **T-34–T-35, T-38–T-44** native-reachable MED | — | ✅ mostly | reconcile each to its screen at run; drill the observable |
| **T-36** sync-status-banner (frozen) | 013 | ⚠ partial | banner needs a real sync error; try, else defer to test |
| **T-37** sw-update-banner (frozen PWA) | 014 | ❌ in native shell | SW-reload is a web/PWA concern; defer to `pnpm test:playwright:phase9` |

## 3. Drill scripts (each = touchpoint → steps → expected → evidence)

Run every ✅ drill on **iPhone**; re-run the **iPad-divergent** ones (D12, D13, D16, and any master-detail screen) on iPad. Each step captures a screenshot named `<device>-D<NN>-<step>.png`.

- **D14 — Damaged return releases custody (headline, owner decision 2026-07-13).**
  Steps: check out a device to the admin user → open `/equipment/:id` → **Return** → in the plug/return dialog choose **"Returned damaged"** → confirm.
  Expected (backend): `POST /api/equipment/:id/return` fires (custody released — device no longer in "my equipment"); a deferred damage report is queued behind the undo window. (frontend): row leaves custody; a **single** undo toast for the damage report appears. (UX): undo cancels only the damage report, not the return.
  Fail signals: custody NOT released (device still held) = the decision didn't ship; OR two competing undo toasts; OR offline path fires an online-only damage report. Cross-check server: `curl localhost:3001/api/equipment/:id` shows custodian cleared.

- **D1 — Code Blue outcome Cancel (T-01).** Open `/code-blue` → start/enter an active session → open the outcome modal → tap **Cancel**. Expected: sheet closes, **session stays active** (no end-session), focus returns to trigger. Fail: session ends, or modal stays (manager trapped).

- **D2 — Dock-return/RFID on default tab (T-02).** `/equipment/:id` on the default **Details** tab → trigger **Dock Return** and the **RFID-attention** action. Expected: each flow/sheet actually renders (not a silent no-op). 

- **D4 — Room-radar Return after cancel (T-04).** `/rooms` radar → **Return** on a device → **Cancel** the dialog → tap **Return** again. Expected: dialog opens the second time (button not dead).

- **D7 — Phase-0 exit drill (T-16).** Sign-in (dev-bypass auto) → start a Code Blue → dismiss the (fixed) outcome sheet → end the session. One pass proving T-01 + reachability.

- **D8 — Folder Select value (T-18).** Edit a **filed** equipment item (`/equipment/:id/edit`). Expected: folder Select shows its **real folder**, not "Unfiled".

- **D9 — Return-All partial failure (T-19).** `/my-equipment` with ≥2 held items → **Return All** while one return is made to fail (e.g. stop one item server-side / offline one). Expected: the others still return + caches invalidate (no all-or-nothing abort).

- **D10 — Per-row spinner scope (T-20).** `/my-equipment` ≥2 items → **Return** one row. Expected: only that row shows the spinner/disabled state; siblings stay interactive.

- **D11 — Header touch targets (T-21).** `/equipment/:id` → inspect the 5 header icon controls. Expected: each hit area ≥44pt (visually comfortable; note any that look cramped for the static/test cross-check).

- **D12 — Locate search (T-22, headline feature).** Summon `LocateSearch` (bottom-anchored / gesture) → type a known device/room query. Expected: results carry **location + custodian + readiness**; empty query ≠ zero-results; result count announced (`aria-live`); tapping a row deep-links to `/equipment/:id`. **iPad:** row selection drives the **master-detail** pane, not a full push.

- **D13 — Readiness badge (T-23).** Confirm `<ReadinessBadge>` renders on `/my-equipment`, `/equipment` list, `/equipment/:id`, a role home surface, and the locate result — **shape + glyph + text**, readable (not color-only), both light/dark. **iPad + board** surfaces too.

- **D15 — Shift-chat (T-25/26).** Open the shift-chat launcher/panel → post a message. Expected: message renders; panel z-index correct; no layout break over the shell chrome.

- **D16 — Start-of-shift card (T-27).** Home surface for the admin role → the `StartOfShiftCard` renders one focal "what needs me now" + one primary action. **iPad:** hero band variant; phone: compact.

- **D17 — Nudge feed (T-30).** Home/alerts → compute-on-read nudges (expiry/restock) surface with correct target-role gating; acting on one clears it.

- **D3 / D5 / D6 / D17-mixed / T-34–T-44 reconcile** — run at execution; camera-dependent (D3) and forced-error (D5, T-17, T-36) paths that cannot be produced in the sim are recorded **CANNOT-VERIFY (needs live hardware / injected failure)**, never silently passed.

## 4. Evidence + report

- **Screenshots:** `docs/audit/device-audit-evidence/<device>/D<NN>-<step>.png` (via computer-use `screenshot` / `gif_creator` for multi-step flows like D14 and D4).
- **Report:** `docs/audit/phase-0-2-device-audit-<YYYY-MM-DD>.md`:
  - Header: audited SHA, device matrix, app URL + auth mode, bring-up method (live-reload native shell), date.
  - Per drill: `D<NN>` · card(s) · device(s) · Screenshot(s) → Expected → **Actual** → **PASS / FAIL / CANNOT-VERIFY** (+ backend cross-check where taken).
  - **Coverage table:** every T-01…T-44 → `PASS (D<NN>) | FAIL (D<NN>) | DEFERRED-STATIC (reason) | CANNOT-VERIFY (reason)`. No card omitted.
  - iPhone-vs-iPad divergences called out (master-detail, hero band, sidebar).
- **Proof log:** one `docs/audit/PROOF_ALIGNMENT_LOG.md` append (claim: device audit executed on iPhone+iPad over the observable Phase 0–2 subset; evidence: SHA, report path, screenshot dir, pass/fail counts).

## 5. Constraints

- **Report-only.** A FAIL is documented, not fixed here (fixes are a follow-up task). The one allowed mutation is the dev-only ATS Info.plist toggle, reverted before finishing.
- **Do not disrupt concurrent agents:** reuse the running dev server; never `pnpm dev` (kills their ports) or restart Postgres.
- **Never commit iOS build artifacts** (`ios/App/Pods`, `Podfile.lock`, `.xcworkspace`, `dist/`) or the ATS toggle. If committing, `git add` only the report + evidence dir + proof-log append.
- **Confirm database isolation before any destructive drill.** Auth mode (dev-bypass) does **not** guarantee DB isolation. Before returns, damage, dispense, or Code Blue drills, verify the target is a local dev database, not production: `NODE_ENV` is non-production, `DATABASE_URL` points to the intended local DB, and the active clinic is `dev-clinic-default`. Only then are the destructive drills safe.
- **No silent truncation:** a card not driven is `DEFERRED-STATIC` or `CANNOT-VERIFY` with a reason — never an implied pass.
