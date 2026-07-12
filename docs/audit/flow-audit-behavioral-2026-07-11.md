# VetTrack Behavioral Flow Audit (click-path) — 2026-07-11

**Method:** click-path-audit — static behavioral trace of every interactive touchpoint (onClick/onSubmit/onChange/onPress/mutation chains) through its full state-change sequence to final state, hunting six composition patterns: Sequential Undo, Async Race, Stale Closure, Missing Transition, Dead Path, useEffect Interference (+ Broken Redirect for route sanity). Complements the 2026-07-10 release QA audit (i18n/UX/API); this audit targets state-composition bugs only.
**Execution:** Workflow run `wf_af513824-72e`, 3 checkpointed waves × 3 batch agents + adversarial verifiers (18 agents, 2.47M subagent tokens, 592 touchpoints traced). Planned 2026-07-11; batches executed 2026-07-12 ~09:14–10:15 after two session-limit failures (store map cached from 2026-07-11).
**Tree audited:** branch `claude/phase-10a-audit-fixes`, base `ceed40241`; commits `bd8deca33` (09:19) and `9b813e0ea` (09:43) landed **mid-audit** — a post-run drift pass re-verified every finding citing a file those commits touched (EMERGENCY-1, TASKS-ALERTS-4) against final HEAD `9b813e0ea`. Line numbers cite that HEAD.
**Verification policy:** adversarial verification covered the **workflow (batch) findings only**: every CRITICAL/HIGH batch finding was independently re-traced by an adversarial refuter agent instructed to refute (default `isReal=false` when uncertain) and armed with a known-intent digest distilled from all 41 branch commit bodies + `PROOF_ALIGNMENT_LOG.md` + `release-qa-2026-07-10.md`, so deliberate behaviors are not reported as bugs. **8/8 workflow crit-high findings survived; 0 refuted; 5 severity corrections applied** (both CRITICALs → HIGH; three HIGHs → MEDIUM). The one additional store-map finding (CLICK-PATH-006) was **controller-verified by direct code read, not adversarially verified**. MEDIUM/LOW findings are single-pass (unverified) and labeled so.
**Reconciliation tags:** `NEW` (not previously known) · `OVERLAPS <id>` (already tracked — cites the prior ID) · `BY-DESIGN <commit>` (documented intent, not a bug) · `TOUCHES-RECENT-FIX` (file churned by mid-audit/recent commits; drift-reverified).
**No code changes were made by this audit.** Fixes are a follow-up task.

---

## Summary

| Severity | Count | Verification |
|---|---|---|
| HIGH | 6 | 5 adversarially verified + 1 controller-verified (store-map wiring) |
| MEDIUM | 21 | 3 adversarially verified (downgraded from HIGH) + 18 single-pass |
| LOW | 9 | single-pass |
| REFUTED | 0 | (1 self-refuted during in-run drift re-read — see appendix) |
| **Total** | **36** | 35 workflow findings + 1 store-map finding |

Highest-leverage cluster: **always-visible triggers driving sheets mounted inside inactive Radix tabs** (CLICK-PATH-002/003 — the equipment detail page's primary custody-return affordances are silent no-ops on the default tab), and **stranded one-shot guards** (CLICK-PATH-005 `busyRef`, CLICK-PATH-016 NFC 8s guard, CLICK-PATH-013 dismissed-forever safety banner).

---

## HIGH (5 adversarially verified workflow findings + 1 controller-verified store-map finding)

### CLICK-PATH-001 [HIGH · Missing Transition] — Code Blue outcome sheet "Cancel" is a no-op; manager trapped over a live emergency `NEW` `TOUCHES-RECENT-FIX`

- **Flow:** Code Blue — end-event outcome selection (batch: emergency; id EMERGENCY-1; filed CRITICAL, verifier corrected → HIGH)
- **Touchpoint:** 'Cancel' in the End-event outcome sheet — `src/pages/code-blue.tsx:328`
- **Trace:** 'End event' → `setShowOutcomeModal(true)` renders OutcomeModal (`fixed inset-0 z-50`, no backdrop-dismiss). Cancel `onClick={() => onClose("")}` → `handleEndSession("")` → guard `if (!outcome || !session) return;` returns **before** `setShowOutcomeModal(false)`. No effect resets `showOutcomeModal`.
- **Expected:** Cancel dismisses the sheet and returns to the live ActiveSession view.
- **Actual:** Cancel does nothing. The only working exits are tapping an outcome (which **ends the live Code Blue**) or browser-back (abandons the live view). Drift-reverified at HEAD `9b813e0ea` after the round-3 commit touched this file.
- **Fix:** Move `setShowOutcomeModal(false)` above the outcome guard, or give Cancel its own `setShowOutcomeModal(false)` + a backdrop dismiss.
- **Verdict:** CONFIRMED (high confidence). Not among the branch's documented code-blue render-gating fixes (those cover pending/error/active-session gates, not the outcome modal).

### CLICK-PATH-002 [HIGH · Missing Transition] — "Dock Return" primary button is a silent no-op on the default Details tab `NEW`

- **Flow:** Equipment detail — custody return (batch: equipment; id EQUIPMENT-1; filed CRITICAL, verifier corrected → HIGH)
- **Touchpoint:** "Dock Return" (Quick Action Bar) — `src/pages/equipment-detail.tsx:1097`
- **Trace:** Button (rendered above the Tabs block) → `setDockReturnOpen(true)`. The ONLY `<DockReturnFlow>` is at line 1361 inside `<TabsContent value="readiness">`; `tabs.tsx` uses bare Radix `TabsPrimitive.Content` with no `forceMount`, so on the default `details` tab the consumer is **unmounted** — state set with no consumer. (The equipment-list variant mounts DockReturnFlow flat and works, proving the tab placement is the defect.)
- **Expected:** The dock-return confirmation flow opens.
- **Actual:** Nothing opens; if the user later visits the Readiness tab the persisted `dockReturnOpen=true` pops the sheet unexpectedly.
- **Fix:** Move `<DockReturnFlow>`/`<DockReturnNfc>` to page level alongside the other always-mounted sheets.
- **Verdict:** CONFIRMED (high confidence).

### CLICK-PATH-003 [HIGH · Missing Transition] — RFID "confirm at dock" attention tap never opens its sheet `NEW`

- **Flow:** Equipment detail — RFID/dock reconciliation (batch: equipment; id EQUIPMENT-2)
- **Touchpoint:** StatusStrip `onRfidAttention` — `src/pages/equipment-detail.tsx:1214`
- **Trace:** Same root cause as CLICK-PATH-002: always-visible StatusStrip (line 1205) sets `setDockReturnNfcOpen(true)`; the only `<DockReturnNfc>` (line 1374) lives inside the inactive Readiness `TabsContent`. The badge is gated by `custodyState === 'checked_out'`, which guarantees it coexists with the unmounted consumer.
- **Expected:** NFC dock-return sheet opens to reconcile location.
- **Actual:** Tap does nothing on the default tab.
- **Fix:** Same page-level mount as CLICK-PATH-002.
- **Verdict:** CONFIRMED (high confidence).

### CLICK-PATH-004 [HIGH · Async Race] — QR auto-decode: last-resolved-wins can target custody actions at the WRONG equipment `NEW`

- **Flow:** Scan — QR camera decode → result sheet (batch: scan; id SCAN-1)
- **Touchpoint:** camera decode callback — `src/components/qr-scanner.tsx:233`
- **Trace:** Only re-entry guard is a 300 ms time-debounce; `setPhase('resolving')` neither collapses the camera nor stops html5-qrcode (teardown happens **after** the awaited `resolveEquipmentId`). Camera keeps decoding ~66 ms/frame during a cold-cache resolve (>300 ms), so a second decode launches a concurrent resolve; whichever settles **last** wins `setScannedEquipment` + phase. Scan B (fast) then A's slow resolve lands → sheet and subsequent Checkout/Return/Mark-OK target **A** while the user scanned **B**. Also double-counts `scansToday` and clobbers the first-scan celebration.
- **Expected:** Result sheet shows the last physically-scanned tag exactly once; custody actions act on it.
- **Actual:** Stale resolve overwrites the newer scan; custody mutation can hit the wrong equipment.
- **Fix:** Set an in-flight ref + stop the scanner **before** the await; early-return while a resolve is pending; guard the scansToday increment.
- **Verdict:** CONFIRMED (high confidence; severity retained).

### CLICK-PATH-005 [HIGH · Missing Transition] — Room-radar "Return" dies after one canceled dialog (stranded `busyRef`) `NEW`

- **Flow:** Rooms — room-radar card quick return (batch: rooms; id ROOMS-1)
- **Touchpoint:** 'Return' quick-action — `src/pages/room-radar.tsx:319`
- **Trace:** Tap → `busyRef.current = true` → action only **opens** ReturnPlugDialog (no mutation). Cancel closes the dialog without running `returnMut`, whose `onSettled` is one of only two resets of `busyRef`. The guard `!busyRef.current` then blocks every subsequent tap; the button is not visually disabled (that's tied to `returnMut.isPending`).
- **Expected:** After cancel, Return stays functional.
- **Actual:** Return is silently dead on that card until unmount.
- **Fix:** `onOpenChange={(o) => { setReturnDialogOpen(o); if (!o) busyRef.current = false; }}` — or only set `busyRef` on the mutating path.
- **Verdict:** CONFIRMED (high confidence).

### CLICK-PATH-006 [HIGH · Missing Transition] — `initSyncEngine()` never receives the QueryClient: post-offline-sync UI stays stale `NEW`

- **Flow:** Offline sync replay → equipment cache reconciliation (source: Phase A store map; controller-verified 2026-07-12, not adversarially verified)
- **Touchpoint:** sync-engine init — `src/hooks/use-sync.tsx:168` / `src/lib/sync-engine.ts:480`
- **Trace:** `initSyncEngine(queryClient?: QueryClient)` sets module-level `queryClientRef = queryClient`. Its **only** caller is `use-sync.tsx:168` — `initSyncEngine()` with no argument — so `queryClientRef` is permanently `undefined`. Consequences: (a) post-replay equipment invalidations (`sync-engine.ts:207-217`: `/api/equipment`, `/my`, `/paginated`, per-id + logs) never fire; (b) the Phase-9 post-sync reconciliation bails (`:233`); (c) the 401-path `queryClientRef.clear()` (`:422`) is a no-op, so a halted queue leaves stale authenticated caches; (d) `runStartupCleanup(queryClient)` invalidations are skipped.
- **Expected:** After offline queue replay, equipment views refetch to reflect the replayed mutations.
- **Actual:** The UI keeps pre-sync data until an unrelated refetch/navigation; the offline→online recovery path silently loses its cache-consistency step.
- **Fix:** Pass the app's QueryClient: `initSyncEngine(queryClient)` from the SyncProvider (it already has access via `useQueryClient()` / the module import used elsewhere).
- **Verdict:** CONFIRMED by controller read of both files at HEAD (signature, sole no-arg caller, guarded invalidation sites).

---

## MEDIUM

### Verified (filed HIGH, downgraded by the adversarial verifier)

### CLICK-PATH-007 [MEDIUM · Missing Transition] — Shift-chat reactions/broadcast-acks never render while the panel is open `NEW`

- **Flow:** Shift chat — react + broadcast ack (batch: home-board-shell; id HOME-BOARD-SHELL-1)
- **Touchpoint:** emoji react / "Got it, on way" ack — `src/features/shift-chat/hooks/useShiftChat.ts:132`
- **Trace:** react/ack `onSuccess` → `invalidateQueries` → refetch `getMessages(afterRef.current)`; the server window is strict `gt(createdAt, after)` (`server/lib/shift-chat-window.ts:56`) so the reacted/acked (older) message is excluded; `reconcileMessages` is append-only by id — an existing message is never replaced. Reactions/acks live in separate tables and don't bump `createdAt`. So the accumulator keeps the stale message: no live reaction, ack button never flips, sender's ack-progress bar never advances. Close→reopen does recover (session-replace branch) — the verifier corrected the original claim that it didn't, and downgraded HIGH→MEDIUM.
- **Expected:** Reaction appears live; ack flips to receipt and advances the sender's progress.
- **Actual:** The mutation succeeds server-side; the open panel shows nothing until reopened.
- **Fix:** Patch local state optimistically (or on success), or reset `afterRef` + make reconcile merge-by-id. Invalidate-only cannot work over a strict-`gt` incremental poll with an append-only accumulator.
- **Verdict:** CONFIRMED, severity MEDIUM.

### CLICK-PATH-008 [MEDIUM · Missing Transition] — Profile display-name save flashes then reverts to the old name `NEW`

- **Flow:** My Profile — display-name editor (batch: tasks-alerts; id TASKS-ALERTS-1)
- **Touchpoint:** Save (check) — `src/features/profile/ProfileHeroZone.tsx:77`
- **Trace:** Save PATCHes the server, then `invalidateQueries(['/api/users/me'])` — but the rendered name comes from `useAuth().name`, populated by the auth provider's own raw fetch effect (not TanStack). Invalidation refreshes only `me` (used for the avatar). After the 2 s "saved" flash the label reverts; reopening the editor pre-fills the stale name.
- **Expected:** Header shows the new name after save.
- **Actual:** Looks like the save was lost (it wasn't — server row is updated; corrects on full reload). Verifier downgraded HIGH→MEDIUM: staleness, not data loss.
- **Fix:** Call `refreshAuth()` after save, or render from the invalidated `me` query.
- **Verdict:** CONFIRMED, severity MEDIUM.

### CLICK-PATH-009 [MEDIUM · Missing Transition] — Quick "Resolve" on a support ticket pops the detail dialog seeded with contradictory state; Save reverts the resolution `NEW`

- **Flow:** Admin → Support (batch: admin-console; id ADMIN-CONSOLE-1)
- **Touchpoint:** row "Resolve" — `src/pages/admin/SupportSection.tsx:114`
- **Trace:** Shared `updateMut.onSuccess` unconditionally `setSelectedTicket(updated)`; the detail dialog is `open={!!selectedTicket}` → quick-resolve **opens the editor** the admin never asked for. `detailStatus`/`detailNote` are seeded only by `openDetail()` (never called on this path), so the dialog shows 'Open'/stale note against a 'Resolved' badge; clicking Save writes the stale values back — reverting the resolution.
- **Expected:** In-place resolve, no editor, nothing to revert.
- **Actual:** Editor pops with contradictory seed; a follow-up Save reverts status/overwrites the note. Verifier: dialog-pop certain, revert contingent on Save → MEDIUM.
- **Fix:** Separate mutations per path, or only `setSelectedTicket` when a dialog is already open — and re-seed `detailStatus`/`detailNote` from `updated`.
- **Verdict:** CONFIRMED, severity MEDIUM.

### Single-pass (unverified)

### CLICK-PATH-010 [MEDIUM · Async Race] — Null KEEPALIVE optimistically clears a just-started Code Blue session `NEW` ⚠ frozen-surface adjacent

- **Flow:** Code Blue mobile page — live session (emergency; EMERGENCY-2) — `src/hooks/useCodeBlueSession.ts:121`
- A stale/racing `activeCodeBlueSessionId=null` keepalive runs `clearCachedSession()` + `setQueryData(session:null)` immediately — no grace window, no confirming refetch — flipping the manager who just started a session back to the launch form for up to one 2 s poll cycle and inviting a duplicate start. Contrast the sanctioned wall-display reconciler (`useCodeBlueKeepaliveReconciliation`) which waits `RECONCILE_GRACE_MS` and only refetches. Doctrine says session end is server-confirmed; a keepalive-driven local clear is an optimistic end in all but name. **Fix:** on null keepalive, invalidate/refetch to confirm (mirror the grace reconciler), or ignore null keepalives briefly after a local start.

### CLICK-PATH-011 [MEDIUM · Async Race] — Quick-log failure rollback erases teammates' concurrent log entries `NEW`

- **Flow:** Code Blue quick-log (emergency; EMERGENCY-3) — `src/hooks/useCodeBlueSession.ts:192`
- `logEntry` snapshots the whole session cache before its optimistic append and restores that snapshot on failure; the 2 s poll is never cancelled, so server updates (other participants' entries, presence) that arrived during the request are momentarily discarded on rollback. **Fix:** `cancelQueries` before the optimistic write; on error remove only the optimistic entry.

### CLICK-PATH-012 [MEDIUM · Dead Path] — Equipment detail checkout conflates a FAILED shift query with off-shift `NEW` `OVERLAPS CodeRabbit-r2 (pattern)`

- **Flow:** Equipment detail — Take/checkout (equipment; EQUIPMENT-3) — `src/pages/equipment-detail.tsx:605`
- The detail page ignores `isError` from `useActiveShift`, so a transient `/api/home/dashboard` error renders the user "off-shift", disables checkout, and never reaches the server's authoritative roster gate — the exact defect CodeRabbit round 2 fixed on **equipment-list** (`067d217a9`); the detail page kept the pre-fix behavior. **Fix:** mirror the list: block client-side only when `!isError && !hasActiveShift`.

### CLICK-PATH-013 [MEDIUM · Missing Transition] — Dismissed sync-failure banner never resurfaces for NEW failures `NEW`

- **Flow:** Global sync overlay (auth-global; AUTH-GLOBAL-3) — `src/components/sync-status-banner.tsx:64`
- `dismissed` is component-local with no reset; the banner mounts once at app root. After one dismissal, later permanent sync failures (the component's own comment: "guaranteed billing leakage") stay hidden for the whole session. **Fix:** key dismissal to the failure signature or clear it when `failedCount` rises.

### CLICK-PATH-014 [MEDIUM · Missing Transition] — SW-update toast "Refresh" is a no-op on the common update path `NEW` `TOUCHES-RECENT-FIX`

- **Flow:** SW update banner (auth-global; AUTH-GLOBAL-2) — `src/components/sw-update-banner.tsx:48`
- On the `SW_UPDATED` message path the new SW already called `skipWaiting()`+`claim()`, so `controllerchange` has **already fired**; Refresh posts SKIP_WAITING to an already-active worker and waits for a controllerchange that never comes — no reload. (The waiting-worker branch works; kiosk auto-reload `7853fc9b9` unaffected.) **Fix:** if the target worker is already the controller (or after a timeout), call `safeReloadPage()` directly. Browser-verify per Phase-9 doctrine.

### CLICK-PATH-015 [MEDIUM · Missing Transition] — QR scanner camera permanently dead after backgrounding; overlay still says "scanning" `NEW`

- **Flow:** Scan (scan; SCAN-2) — `src/components/qr-scanner.tsx:425`
- `visibilitychange` stops the camera on hidden but there is **no resume branch**; phase stays `scanning` over a dead camera. **Fix:** restart on visible/pageshow when in a live-camera phase, or show an explicit Resume affordance.

### CLICK-PATH-016 [MEDIUM · Missing Transition] — Failed NFC toggle locks the tag out for 8 s with zero feedback `NEW`

- **Flow:** NFC quick-toggle (scan; SCAN-3) — `src/components/nfc-foreground-scan.tsx:48`
- The sessionStorage re-fire guard is stamped **before** `runEquipmentQuickToggle` and never cleared on its failure paths (network/409/throw); a retry tap within 8 s is silently dropped. **Fix:** clear the guard on failure, or stamp it only after success (keep a short debounce for reader re-fires).

### CLICK-PATH-017 [MEDIUM · useEffect Interference] — Closing shift chat spawns a spurious unread badge for already-read messages `NEW`

- **Flow:** Shift chat launcher badge (home-board-shell; HOME-BOARD-SHELL-2) — `src/features/shift-chat/hooks/useShiftChat.ts:80`
- The unread-increment effect re-fires on the open→close transition while `data` still holds the just-read batch, counting it as unread. **Fix:** advance `lastOpenRef` on close, or skip the transition edge.

### CLICK-PATH-018 [MEDIUM · Missing Transition] — New Item dialog silently discards "Billable" + min-capture on create `NEW`

- **Flow:** Inventory items — admin create (inventory; INVENTORY-1) — `src/pages/inventory-items.tsx:124`
- The create dialog renders both controls, but `createMut` omits `isBillable`/`minimumDispenseToCapture` from the POST (and the `api.inventoryItems.create` type can't carry them); success toast implies saved. Edit-mode `updateMut` **does** send both. **Fix:** add the fields to create (body + api type + route) or hide the controls in create mode.

### CLICK-PATH-019 [MEDIUM · Async Race] — Restock +/- burst: failure rollback/out-of-order success desyncs count from server `NEW`

- **Flow:** Inventory restock card (inventory; INVENTORY-3) — `src/pages/inventory-page.tsx:448`
- Buttons aren't disabled while a scanLine is pending; each call snapshots the optimistic value at entry and sends an **absolute** quantity. Overlapping taps → a mid-sequence failure rolls back to a stale baseline, or out-of-order successes patch the cache below the last-issued value. **Fix:** serialize per-row (disable while pending) or drop stale responses (apply only if optimistic still equals this call's next value).

### CLICK-PATH-020 [MEDIUM · Missing Transition] — "Return All": one failure skips cache invalidation; returned items still render checked-out `NEW`

- **Flow:** My Equipment (tasks-alerts; TASKS-ALERTS-2) — `src/pages/my-equipment.tsx:113`
- `Promise.all` rejects on the first failed return, jumping to the error toast **before** the three `invalidateQueries` calls; successfully returned items keep rendering as checked-out (custody surface). **Fix:** `Promise.allSettled` + invalidate in a finally/after-settle block.

### CLICK-PATH-021 [MEDIUM · Stale Closure] — Returning one item spins/disables every row's Return button `NEW`

- **Flow:** My Equipment rows (tasks-alerts; TASKS-ALERTS-3) — `src/pages/my-equipment.tsx:265`
- One shared `returnMut` drives all rows' `disabled`/spinner. **Fix:** scope to `returnMut.variables?.id === item.id`.

### CLICK-PATH-022 [MEDIUM · Missing Transition] — Sound-feedback await can silently swallow a settings toggle `NEW`

- **Flow:** Settings — Critical Alerts + role-notification toggles (admin-console; ADMIN-CONSOLE-2) — `src/pages/settings.tsx:124`
- `await playFeedbackTone()` (no catch) runs **before** the persist; if `AudioContext.resume()` rejects (iOS WKWebView), the preference write is skipped and the switch snaps back with no feedback. The sibling `handleSoundToggle` was deliberately written fire-and-forget — these two weren't. **Fix:** fire the tone without awaiting so the persist always commits, and catch **observably** rather than swallowing — e.g. `void playFeedbackTone().catch((e) => Sentry.captureMessage("settings feedback tone failed", { extra: { error: String(e) } }))` (mirrors the `use-pwa-install.ts` storage-failure reporting pattern); a try/catch that logs before proceeding to `update()`/`syncRoleNotificationSettings()` is equally acceptable. Do not use an empty `catch(()=>{})`.

### CLICK-PATH-023 [MEDIUM · Missing Transition] — "Confirm Import" stays armed after success; second click re-imports the same roster CSV `NEW`

- **Flow:** Admin Shifts import (admin-console; ADMIN-CONSOLE-3) — `src/pages/admin-shifts.tsx:147`
- `onSuccess` intentionally keeps file+preview (for reference) but nothing marks the file imported, so `canImport` stays true and a re-click re-runs `confirmImport` on the identical CSV — roster rows feed shift/authority derivation; idempotency rests entirely on the server. Distinct from the T18/T19 import fixes (`3083dd3f5`). **Fix:** track an imported flag per accepted file and gate `canImport` on it.

### CLICK-PATH-024 [MEDIUM · Async Race] — Folder dialog: Enter bypasses every Save guard `NEW`

- **Flow:** Admin → Folders (admin-console; ADMIN-CONSOLE-4) — `src/pages/admin/FoldersSection.tsx:188`
- The Enter handler replicates the Save action with neither the empty-name nor the isPending guard → empty-name submits and double-Enter duplicate creates. **Fix:** extract one guarded `submit()` used by both.

### CLICK-PATH-025 [MEDIUM · Async Race] — Secondary-role dropdowns share one optimistic pending pair across all user rows `NEW`

- **Flow:** Admin → Users (admin-console; ADMIN-CONSOLE-5) — `src/pages/admin/UsersSection.tsx:407`
- Concurrent edits on two rows clobber each other's optimistic display; one row's completion clears the other's in-flight indicator. Self-corrects after invalidation. **Fix:** key pending state by userId.

### CLICK-PATH-026 [MEDIUM · Broken Redirect] — /equipment/scan, /equipment/maintenance, /equipment/intelligence are shadowed by /equipment/:id `NEW`

- **Flow:** Legacy deep links (auth-global; AUTH-GLOBAL-1) — `src/app/routes.tsx:161`
- wouter matches in source order: the dynamic `/equipment/:id` (line 153/154) captures the alias segment before the redirect routes (161–163), which are unreachable — the detail page loads a bogus id (`scan`) and errors instead of redirecting. Distinct from the fixed kiosk `?query` aliases (`d6fcf07de`). No internal nav uses these paths — external bookmarks only. **Fix:** move the three alias redirects above the dynamic route, next to `/equipment/new|tasks|board`.
- *(Filed as MEDIUM Broken Redirect; grouped here with single-pass MEDIUMs.)*

### CLICK-PATH-036 [MEDIUM · Missing Transition] — Edit Equipment folder dropdown always shows "Unfiled" for filed items `NEW`

- **Flow:** Equipment edit form (equipment; EQUIPMENT-4) — `src/pages/new-equipment.tsx:434`
- The folder Select is uncontrolled with a static `defaultValue={prefill.folderId || "none"}`; in edit mode the remount key changes when the equipment loads, but the remounted instance re-reads the same `"none"` default. RHF state holds the real folderId (so an untouched save preserves it), but the dropdown displays "Unfiled" — and a user who "re-confirms" Unfiled actually removes the item from its folder on save. **Fix:** drive the Select from the loaded value (`value={watch("folderId")}` or default from `existingEquipment?.folderId`).

---

## LOW (single-pass)

### CLICK-PATH-027 [LOW · Async Race] — UpdateBanner version-check effect lacks a supersede guard (`src/components/update-banner.tsx:24`; auth-global; AUTH-GLOBAL-4) `NEW` — stale resolve can set banner state after auth changed; usually unmounted first. Fix: ignore-flag/AbortController in cleanup.

### CLICK-PATH-028 [LOW · Dead Path] — ScanScreen accountability banner unreachable (`src/features/scan/ScanScreen.tsx:142`; scan; SCAN-4) `NEW` — `confirmedName` is never set non-null; `AccountabilityConfirm` can never mount. Fix: remove or wire it.

### CLICK-PATH-029 [LOW · Dead Path] — Shift-chat Enter sends an empty message while the broadcast selector is open (`src/features/shift-chat/components/ShiftChatPanel.tsx:83`; home-board-shell; HOME-BOARD-SHELL-3) `NEW` — `if (!trimmed && !showBroadcast) return;` makes the empty guard dead when `showBroadcast=true`. Fix: `if (!trimmed) return;`.

### CLICK-PATH-030 [LOW · Missing Transition] — Add Room "Cancel" keeps typed values for the next open (`src/pages/rooms-list.tsx:447`; rooms; ROOMS-2) `NEW` — Cancel only closes; Escape/overlay/X clear. Fix: route Cancel through the same reset.

### CLICK-PATH-031 [LOW · Sequential Undo] — DispenseSheet "Continue" erases the pre-selected patient (`src/features/containers/components/DispenseSheet.tsx:759`; inventory; INVENTORY-2) `NEW` — latent: no current caller passes `patientId` and `activePatients` is stubbed `[]`, but the items→confirm transition unconditionally `setSelectedAnimalId(undefined)`, defeating the documented prop. Fix: preserve `patientIdProp` in the step transition.

### CLICK-PATH-032 [LOW · Sequential Undo] — Alerts pull-to-refresh spinner cancels itself in the same tick (`src/features/alerts/AlertsScreen.tsx:44`; tasks-alerts; TASKS-ALERTS-4) `NEW` `TOUCHES-RECENT-FIX` — `refetch()` returns void un-awaited; `finally` clears `refreshing` immediately. Drift-reverified at HEAD after `9b813e0ea` touched this file. Fix: make controller refetch return `Promise.all` and await it.

### CLICK-PATH-033 [LOW · Dead Path] — Management-dashboard QrScanner has no trigger (`src/pages/management-dashboard.tsx:371`; tasks-alerts; TASKS-ALERTS-5) `NEW` — `setScannerOpen(true)` is never called; unused `QrCode` import. Fix: wire a button or remove the mount.

### CLICK-PATH-034 [LOW · Dead Path] — Audit-log "Apply" is a near no-op over a per-keystroke live query (`src/pages/audit-log.tsx:305`; admin-console; ADMIN-CONSOLE-6) `NEW` — filter state is in the queryKey, so typing fires a request per character; Apply only resets pagination. Fix: commit-on-apply or debounce + drop the button.

### CLICK-PATH-035 [LOW · Stale Closure] — Displays manage-drawer acts on a snapshot while the list polls live (`src/pages/console/DisplaysConsolePage.tsx:210`; admin-console; ADMIN-CONSOLE-7) `NEW` — drawer offers rename/revoke against a device another admin already revoked; errors instead of reflecting state. Fix: derive the drawer's device from live `devicesQ.data` by id.

---

## REFUTED / self-corrected (appendix)

- **0 workflow findings refuted by the adversarial verifiers** (all 8 workflow crit-high findings confirmed; 5 severity corrections: EMERGENCY-1 CRITICAL→HIGH, EQUIPMENT-1 CRITICAL→HIGH, HOME-BOARD-SHELL-1 HIGH→MEDIUM, TASKS-ALERTS-1 HIGH→MEDIUM, ADMIN-CONSOLE-1 HIGH→MEDIUM). CLICK-PATH-006 (store map) is outside this count — controller-verified only.
- **1 self-refuted during the run:** the equipment batch's initial read of `equipment-list.tsx` returned a pre-`bd8deca33` snapshot whose apparent "checkout always off-shift" bug is fixed at HEAD (props threaded to both `EquipmentItem` call sites). The agent re-read the current file and dropped the finding.
- **Verifier correction of record:** HOME-BOARD-SHELL-1's claim that close→reopen also fails was wrong (reopen triggers the session-replace branch and does refresh); the primary defect stands.

## Dead / unwired surfaces (noted during tracing, not behavioral bugs)

- `src/features/scan/TransferSheet.tsx`, `ScanResultCard.tsx`, `hooks/use-scan-accountability.ts` — **zero consumers** (only barrel re-exports); the planned Batch-4 TransferSheet audit found the entire surface unreachable in the running app.
- `src/infrastructure/platform/NfcAdapter.ts`, `DeepLinkAdapter.ts` — inert hexagonal adapters; live NFC/deep-link path uses `src/lib/nfc-platform.ts` + `deep-link-router.ts`.
- `conflict-store.ts useConflicts()` — no mounted consumer; no keep-server conflict-resolution UI exists (SyncQueueSheet offers retry=keep-local / discard only).
- `room-radar.tsx` pilot 'Confirm here' — deliberately disabled behind `false ?`.
- `equipment-detail.tsx handleConfirmReturn` + `isPluggedIn/plugInDeadlineMinutes` state — dead (live path uses ReturnPlugDialog inline confirm).

## Coverage

| Batch | Touchpoints traced | Findings | Crit/High → adversarially verified¹ | Skipped (with reason, see agent lists) |
|---|---|---|---|---|
| emergency | 42 | 3 | 1 → 1 | 5 |
| equipment | 70 | 4 | 2 → 2 | 5 |
| auth-global | 42 | 4 | 0 | 6 |
| scan | 38 | 4 | 1 → 1 | 5 |
| home-board-shell | 63 | 3 | 1 → 1 | 9 |
| rooms | 40 | 2 | 1 → 1 | 2 |
| inventory | 78 | 3 | 0 | 4 |
| tasks-alerts | 77 | 5 | 1 → 1 | 7 |
| admin-console | 142 | 7 | 1 → 1 | 6 |
| **Total** | **592** | **35 (+1 store-map)** | **8 → 8 (0 refuted)** | **49** |

¹ Adversarial verification applied to workflow (batch) findings only. The store-map finding CLICK-PATH-006 sits outside this table and was controller-verified by direct code read, not adversarially verified.

**UNTESTED (systemic, by policy):** Clerk third-party component internals (`<SignIn>`/`<SignUp>` state machines); Capacitor-native social OAuth handlers; server route internals; shadcn/Radix primitive internals; DataTable sort internals; DevRoleSwitcher; usePushNotifications hook internals; customer-side shift-adjustment requester sheet; `src/native/tablet/*` deep chrome; `/board` `isDisplayPaired` gating end-to-end (display-pairing flow crosses batch boundaries). Each batch's full skip list with reasons is preserved in the workflow journal (`wf_af513824-72e`).

**Overlay-flow accounting (16 planned):** ShiftSummarySheet (traced from both `/handoff` + `/settings` — clean), EquipmentDetailToolsSheet / EquipmentConfirmInRoomSheet / ReportEquipmentIssueSheet (traced, no findings), TransferSheet (dead — see above), EquipmentRoomSweepSheet (traced in rooms — no composition findings; multi-select reset paths clean), DispenseSheet (CLICK-PATH-031), MoreSheet trigger wiring (clean; internals in admin batch scope), ReportIssueDialog (triple-mount trigger wiring traced clean from all three mounts), NativeTabBar/NativeTabSidebar/NativeHeader (traced — no findings), SyncQueueSheet/GlobalSyncQueue (traced; conflict-UI gap noted), sync-status-banner (CLICK-PATH-013), sw-update-banner (CLICK-PATH-014), update-banner (CLICK-PATH-027), main.tsx chunk-load recovery (traced — loop guard correct).

## Reconciliation against the branch's own records

Baseline sources read before assembly: `docs/audit/release-qa-2026-07-10.md` (T1–T26, all implemented per proof log), `PROOF_ALIGNMENT_LOG.md` entries through CodeRabbit PR #83 rounds 1–3, and all 41 branch commit bodies. The verifiers carried a distilled known-intent digest; consequently **zero findings in this report re-litigate a documented deliberate behavior** (admin shift-bypass scoping, students dispensing, wall-display bounded poll, `animalId` slot reuse, sign-in inert chips, etc.). Two findings extend recent fixes to sites they missed: CLICK-PATH-012 (detail-page sibling of the r2 equipment-list shift-error fix) and CLICK-PATH-001/032 (files churned mid-audit by r3 commits, drift-reverified). No finding duplicates a release-QA T-item; the QA audit's behavioral items (silent swallows, gating) were all fixed on this branch and verified as such by the auditors reading post-fix code.
