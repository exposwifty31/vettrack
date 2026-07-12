# Phase 2 + Phase 3 — Implementation Plan (TDD task cards)

- **Covers:** spec §6 (Phase 2: native-reachable MED sweep + Do-Next feature pointers) + §7 (Phase 3: LOW cleanup).
- **Spec:** `../../superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md` · **Precedes:** Phase 0+1 (`phase-0-1.plan.md`) — do those first (stabilize before extend).
- **Card contract:** RED→GREEN→verify, ≤2 code files + 1 test, exact anchors. Commit per card; log to `docs/audit/PROOF_ALIGNMENT_LOG.md`.
- **Verify convention (every card):** unless stated otherwise, **Verify** = `pnpm test -- <the card's RED test file> && pnpm typecheck`; PWA/realtime cards add the browser drill; delete-only cards use their `knip`/`grep` command.
- **Tier (model routing):** **default = S (Sonnet).** `⚠ FROZEN` cards are tagged inline (`Tier: O +R` / `Tier: S +R`); `+R` = a `code-reviewer` gate (+ browser drill for realtime/PWA) before commit. See README → "Execution driver".
- **Card IDs continue the program sequence:** T-34…T-53 (T-32/T-33 moved to `subspecs/R-CB-stabilize-code-blue-races.plan.md` as R-CB-02/03).

> **Frozen-surface flags:** cards tagged `⚠ FROZEN` touch Code Blue / SSE / PWA. They are localized fixes, but each requires the doctrine check + (for PWA/SW) a browser drill, and must NOT be one-shot blindly. Treat them as careful cards; if execution reveals deeper reconciliation is needed, escalate to a mini-sub-spec.

---

## Phase 2 — native-reachable MED sweep (fixes)

> All 13 are native-reachable (grounding: 5 "admin" findings are NOT web-only). Fix before their surface's Do-Next feature.

### Code Blue stabilize (gates medium-01) — `⚠ SUB-SPEC` (moved out)

- **R-CB-02 / R-CB-03** (the two frozen Code Blue races, CLICK-PATH-010/011 — formerly T-32/T-33) are now a **dedicated SUB-SPEC** → **`subspecs/R-CB-stabilize-code-blue-races.plan.md`**. Per §2.4, subtle races on the frozen Code Blue runtime get their own spec-plan, not inline cards. They **gate medium-01** (`R-CBF-1`) and must be GREEN first.

### Scan

- **T-34 (R-SC-02 · CLICK-PATH-015):** `src/components/qr-scanner.tsx:425` — `visibilitychange` stops the camera on hidden with no resume branch; phase stays `scanning` over a dead camera. **GREEN:** restart the camera on visible/pageshow when the phase is still a live-camera phase. **RED:** `tests/qr-scanner-resume.test.tsx`.
- **T-35 (R-SC-03 · CLICK-PATH-016):** `src/components/nfc-foreground-scan.tsx:48` — the sessionStorage re-fire guard is stamped before `runEquipmentQuickToggle` and never cleared on its failure paths, silently dropping a retry within 8s. **GREEN:** clear the guard on all failure paths (network / 409 / throw); keep a short debounce for reader re-fires. **RED:** `tests/nfc-toggle-failure-guard.test.tsx`.

### Sync / global — `⚠ FROZEN` (PWA)

- **T-36 (R-SY-02 · CLICK-PATH-013):** `src/components/sync-status-banner.tsx:64` — `dismissed` is component-local with no reset; after one dismissal later permanent sync failures ("billing leakage") stay hidden all session. **GREEN:** key the dismissal to the **failure signature** — **defined as `(syncErrorKind, targetResource)`** (the error kind + the resource/mutation it concerns; two failures share a signature **iff both fields are equal**) — dismissal state is per-signature, not a component-local boolean; a distinct signature re-shows the banner. **RED:** `tests/sync-banner-redismiss.test.tsx` — dismissing a signature hides it and an **identical** signature stays hidden (persistence); a signature differing in **either** field re-shows the banner.
- **T-37 (R-SY-03 · CLICK-PATH-014) `⚠ FROZEN`:** `src/components/sw-update-banner.tsx:48` — on the `SW_UPDATED` path the new SW already claimed, so `controllerchange` fired; Refresh posts SKIP_WAITING to an already-active worker → no reload. **GREEN (one deterministic reload policy, pinned):** on Refresh resolve via a single race — **(a)** if the target worker **is already the controller**, call `safeReloadPage()` immediately; **(b)** else post SKIP_WAITING and reload on the next `controllerchange`; **(c)** if neither fires within **`SW_UPDATE_RELOAD_TIMEOUT_MS = 3000`**, call `safeReloadPage()` as the fallback. **Precedence:** an already-controller / `controllerchange` result **wins over** the timeout, and the reload runs **exactly once** (guard flag). **Cleanup:** clear the timeout and remove the `controllerchange` listener on reload/unmount. **RED:** `tests/sw-update-refresh.test.tsx` (fake timers) — already-controller → immediate reload; `controllerchange` before 3000ms → one reload with the timeout cleared; neither by 3000ms → one fallback reload; never a double reload. **Verify:** `pnpm test -- tests/sw-update-refresh.test.tsx && pnpm typecheck` **+ the Phase-9 PWA Playwright drill `pnpm test:playwright:phase9` passes (SW-update reload observed live).** **Tier: S +R** (frozen PWA — Sonnet + review + mandatory browser drill).
- **T-38 (R-SY-04 · CLICK-PATH-026):** `src/app/routes.tsx:161` — `/equipment/scan|maintenance|intelligence` alias redirects are shadowed by the dynamic `/equipment/:id` (L153/154). **GREEN:** move the three alias redirects **above** the dynamic route. **RED:** `tests/equipment-alias-redirects.test.tsx`.

### Profile

- **T-39 (R-PR-01 · CLICK-PATH-008):** `src/features/profile/ProfileHeroZone.tsx:77` — display-name save invalidates `me` but the header renders `useAuth().name` (separate fetch); label reverts after the 2s flash. **GREEN:** call `refreshAuth()` after save (so `useAuth().name` updates). **RED:** `tests/profile-name-persist.test.tsx`.

### Admin (native-reachable MEDs)

- **T-40 (R-AD-01 · CLICK-PATH-009):** `src/pages/admin/SupportSection.tsx:114` — shared `updateMut.onSuccess` unconditionally `setSelectedTicket(updated)` → quick-resolve pops the editor seeded with contradictory state; Save reverts. **GREEN:** only `setSelectedTicket` when a detail dialog is already open, and re-seed `detailStatus`/`detailNote` from `updated` (so quick-resolve doesn't pop a contradictory editor). **RED:** `tests/support-quick-resolve.test.tsx`.
- **T-41 (R-AD-02 · CLICK-PATH-022):** `src/pages/settings.tsx:124` — `await playFeedbackTone()` (no catch) runs before the persist; an `AudioContext.resume()` reject skips the write. **GREEN:** fire the tone without awaiting so the persist always commits, and catch **observably** (`Sentry.captureMessage`, mirroring `use-pwa-install`) — **never an empty catch**. **RED:** `tests/settings-sound-toggle.test.tsx`.
- **T-42 (R-AD-03 · CLICK-PATH-023):** `src/pages/admin-shifts.tsx:147` — `onSuccess` keeps file+preview but nothing marks the file imported, so `canImport` stays true → re-click re-imports the same roster CSV. **GREEN:** track an imported flag per accepted file, gate `canImport` on it. **RED:** `tests/admin-shifts-reimport-guard.test.tsx`.
- **T-43 (R-AD-04 · CLICK-PATH-024):** `src/pages/admin/FoldersSection.tsx:188` — the Enter handler replicates Save without the empty-name/isPending guards → empty submit + double-Enter dup. **GREEN:** extract one guarded `submit()` used by both. **RED:** `tests/folders-enter-guard.test.tsx`.
- **T-44 (R-AD-05 · CLICK-PATH-025):** `src/pages/admin/UsersSection.tsx:407` — secondary-role dropdowns share one optimistic pending pair across all rows. **GREEN:** key pending state by `userId`. **RED:** `tests/users-secondary-role-pending.test.tsx`.

## Phase 2 — Do-Next features (SUB-SPEC; each authored separately before execution)

- **R-CBF-1 (medium-01 Code Blue one-tap)** → `subspecs/R-CBF-1-code-blue-one-tap.plan.md` — arm→hold-to-confirm; gated behind **R-CB-stabilize** (R-CB-02/03, `subspecs/R-CB-stabilize-code-blue-races.plan.md`). Frozen doctrine.
- **R-BDF-1 (medium-03 ambient board alerts)** → `subspecs/R-BDF-1-ambient-board-alerts.plan.md` — closed bounded anomaly-rule set over the existing snapshot; `/api/display/snapshot` stays cache-denylisted.
- **R-PDF-1 (massive-02 predictive readiness)** → `subspecs/R-PDF-1-predictive-readiness.plan.md` — inference-first demand model behind one interface (spec §6.2).

> These are **not** cards here. Author each sub-spec (same SDD+TDD contract) when its phase is reached.

---

## Phase 3 — LOW cleanup

- **T-45 (CLICK-PATH-027):** `src/components/update-banner.tsx:24` — version-check effect lacks a supersede guard; stale resolve can set banner state after auth changed. **GREEN:** an **ignore-flag** captured in the effect and checked before `setState`, flipped in the effect's cleanup (a stale resolve after re-run/unmount is discarded). **RED:** `tests/update-banner-supersede.test.tsx` — a stale resolve after the effect re-ran/unmounted does **not** set banner state.
- **T-46 (CLICK-PATH-028) — remove dead path:** `src/features/scan/ScanScreen.tsx:142` — `confirmedName` is never set non-null, so `AccountabilityConfirm` can never mount (dead). **GREEN:** remove the dead mount + its unused import (decision: remove, not wire — verified no non-null setter for `confirmedName`). **RED:** `tests/scan-accountability-dead-path.test.tsx` — assert the mount/branch is gone. **Verify:** `pnpm knip` (no new unused export) + `grep -n 'AccountabilityConfirm' src/features/scan/ScanScreen.tsx | wc -l` = 0 (the import/render removed from *this* file; a valid definition/consumer elsewhere is out of scope) + `pnpm typecheck`.
- **T-47 (CLICK-PATH-029):** `src/features/shift-chat/components/ShiftChatPanel.tsx:83` — `if (!trimmed && !showBroadcast) return;` makes the empty-guard dead when the broadcast selector is open → Enter sends empty. **GREEN:** `if (!trimmed) return;`. **RED:** `tests/shift-chat-empty-guard.test.tsx`.
- **T-48 (CLICK-PATH-030):** `src/pages/rooms-list.tsx:447` — Add Room "Cancel" only closes; Escape/overlay/X clear. **GREEN:** route Cancel through the same reset. **RED:** `tests/add-room-cancel-reset.test.tsx`.
- **T-49 (CLICK-PATH-031):** `src/features/containers/components/DispenseSheet.tsx:759` — items→confirm transition unconditionally `setSelectedAnimalId(undefined)`, defeating the `patientId` prop (latent). **GREEN:** preserve `patientIdProp` in the step transition. **RED:** `tests/dispense-preserve-patient.test.tsx`.
- **T-50 (CLICK-PATH-032):** `src/features/alerts/AlertsScreen.tsx:44` — `refetch()` returns void un-awaited; `finally` clears `refreshing` in the same tick. **GREEN:** make the controller refetch return `Promise.all` and await it. **RED:** `tests/alerts-pull-refresh.test.tsx`.
- **T-51 (CLICK-PATH-033) web-only — remove dead path:** `src/pages/management-dashboard.tsx:371` — `setScannerOpen(true)` never called; unused `QrCode` import. **GREEN:** remove the dead scanner mount + the unused `QrCode` import (decision: remove, not wire — verified no caller sets `setScannerOpen(true)`). **RED:** `tests/management-dashboard-dead-scanner.test.tsx` asserts no scanner mounts. **Verify:** `pnpm knip` + `grep -rn 'setScannerOpen\|QrScanner' src/pages/management-dashboard.tsx | wc -l` = 0 + `pnpm typecheck`.
- **T-52 (CLICK-PATH-034) web-only:** `src/pages/audit-log.tsx:305` — filter state is in the queryKey (request per keystroke); "Apply" only resets pagination. **GREEN:** commit-on-apply — keep filter state out of the live queryKey; "Apply" commits the pending filters (single request per Apply, not per keystroke). **RED:** `tests/audit-log-apply.test.tsx`.
- **T-53 (CLICK-PATH-035) web-only:** `src/pages/console/DisplaysConsolePage.tsx:210` — manage-drawer acts on a stale snapshot while the list polls live. **GREEN:** derive the drawer's device from live `devicesQ.data` by id. **RED:** `tests/displays-drawer-live.test.tsx`.

---

## Definition of done (Phase 2 + 3)

- Every card RED→GREEN; `pnpm typecheck` clean; `pnpm i18n:check` green for new copy.
- `⚠ FROZEN` cards additionally pass their doctrine check + browser drill (Code Blue / SW).
- The 3 Do-Next feature sub-specs are authored (not necessarily executed) before their features are built.
- Evidence logged in `docs/audit/PROOF_ALIGNMENT_LOG.md` per requirement.
