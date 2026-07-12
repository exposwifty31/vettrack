# Phase 0 + Phase 1 — Implementation Plan (TDD task cards)

- **Covers:** spec §4 (Phase 0: 6 HIGH fixes + 0B submission gate) + §5 (Phase 1: equipment/shift/inventory fixes + small features + web admin-gate).
- **Spec (source of truth):** `../../superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md`
- **Branch:** `claude/audit-10x-consolidated-plan`.
- **Card contract (spec §2.3):** each card = **RED** (write the failing test) → **GREEN** (minimal impl, ≤2 code files + 1 test) → **verify**. Exact anchors, zero open decisions. Commit per card; log evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md`.
- **Verify convention (every code card):** unless a card states otherwise, its **Verify** command is `pnpm test -- <the card's RED test file> && pnpm typecheck` (repo-wide frontend+server typecheck); DB-integration cards use the DB-integration runner, PWA/realtime cards add the browser drill, delete-only cards use the `knip`/`grep` command on the card. **0B is exempt** (binary/on-device — see §"Definition of done").
- **Tier (model routing):** **default = S (Sonnet); unmarked cards run on Sonnet.** Overrides are tagged inline (`Tier: S +R` / `Tier: O +R`); 0B is `Tier: Owner`. `+R` = a `code-reviewer` gate (+ browser drill for realtime/PWA) before commit. See README → "Execution driver".

## Execution order

1. **T-05 first** (sync foundation) — it's upstream of post-offline freshness; do it before the offline-adjacent cards.
2. Then **T-01 → T-04** (the other HIGH fixes) in any order.
3. **0B (T-06 → T-15)** runs in parallel (ops/config), and **T-16 (exit drill)** gates leaving Phase 0.
4. **Phase 1** bundles after Phase 0: Equipment → Shift/Home → Inventory → Web-gate. Within a bundle, fixes before features (stabilize→extend).

> **Frozen-surface note:** T-01 and T-05 touch Code Blue / offline (frozen). They are localized wiring fixes, not surface changes — the guardrails on each card are non-negotiable. Anything beyond them is out of scope for this plan.

---

## Phase 0A — HIGH fixes

### T-01 · Code Blue outcome-sheet "Cancel" dismisses without ending the session (R-CB-01 · CLICK-PATH-001 · HIGH) · **Tier: S +R**

- **Files:** `src/pages/code-blue.tsx` (`OutcomeModal` Cancel ~L266 `onClose("")`; `handleEndSession` ~L326, guard `if (!outcome || !session) return` ~L327, `setShowOutcomeModal(false)` ~L328).
- **Defect:** Cancel → `onClose("")` → `handleEndSession("")` returns at the outcome guard **before** closing the sheet → manager trapped over a live emergency (no browser-back in WKWebView).
- **RED:** `tests/code-blue-outcome-cancel.test.tsx` — outcome modal open + active session; click "Cancel"; assert (a) modal removed from DOM, (b) end-session mutation **not** called, (c) focus returns to trigger. Fails now.
- **GREEN:** give Cancel a dedicated `closeOutcomeModal()` that sets `showOutcomeModal=false` independent of the outcome guard; Cancel does **not** call the end path.
- **Guardrail:** no SSE/keepalive changes; **no optimistic session end** (server-confirmed only).
- **Verify:** `pnpm test -- tests/code-blue-outcome-cancel.test.tsx && pnpm typecheck`.
- **Done when:** RED test passes; the on-device drill (T-16) can open+dismiss the sheet without ending the session.

### T-02 · Dock-Return + RFID sheets mount at page level, not inside an inactive tab (R-EQ-01/02 · CLICK-PATH-002/003 · HIGH)

- **Files:** `src/pages/equipment-detail.tsx` (`setDockReturnOpen(true)` L1097; `onRfidAttention` L1214; `<DockReturnFlow>` L1361 + `<DockReturnNfc>` L1374 inside `<TabsContent value="readiness">` L1340).
- **Defect:** the only consumers are mounted inside the inactive Radix Readiness tab (bare `TabsPrimitive.Content`, no `forceMount`), so on the default `details` tab the state is set with no mounted consumer → silent no-op.
- **RED:** `tests/equipment-detail-dock-return-mount.test.tsx` — on the default tab, trigger Dock Return and the RFID-attention tap; assert each flow renders. Fails now.
- **GREEN:** move `<DockReturnFlow>` and `<DockReturnNfc>` to page level, alongside the other always-mounted sheets (mirror the equipment-list variant that already works).
- **Guardrail:** presentation/mount move only; no custody-mutation change.
- **Verify:** `pnpm test -- tests/equipment-detail-dock-return-mount.test.tsx && pnpm typecheck`.

### T-03 · QR auto-decode targets the last-scanned tag exactly once (R-SC-01 · CLICK-PATH-004 · HIGH)

- **Files:** `src/components/qr-scanner.tsx` (`handleScanResult` L215, wired L367-368; `if (!eq)` L233; `DEBOUNCE_MS` L218).
- **Defect:** only guard is a 300ms debounce; the scanner isn't stopped before the awaited `resolveEquipmentId`, so a slower earlier resolve overwrites a newer scan (last-resolved-wins) → custody action can hit the **wrong** equipment; also double-counts `scansToday`.
- **RED:** `tests/qr-scanner-race.test.tsx` — two overlapping decodes, first resolves slower; assert final `scannedEquipment` is the second scan and the increment fired once. Fails now.
- **GREEN:** tag each scan with a monotonic token; stop the scanner **before** the await; when a `resolveEquipmentId` settles, apply it **only if its token is still the latest** — a newer scan supersedes an older in-flight resolve (last physically-scanned wins); discard stale resolves; guard the `scansToday` increment to once per *applied* scan.
- **Guardrail:** don't touch `classifyEmergencyEndpoint`/offline block; scan stays a first-class source.
- **Verify:** `pnpm test -- tests/qr-scanner-race.test.tsx && pnpm typecheck`.

### T-04 · Room-radar "Return" stays functional after a canceled dialog (R-RM-01 · CLICK-PATH-005 · HIGH)

- **Files:** `src/pages/room-radar.tsx` (`busyRef` L114; onClick L317-323, `busyRef.current = true` L319; reset only in `returnMut.onSettled`).
- **Defect:** Return sets `busyRef=true` then only *opens* `ReturnPlugDialog`; Cancel closes it without running `returnMut`, so `onSettled` never resets `busyRef` → `!busyRef.current` blocks all later taps (button not visually disabled).
- **RED:** `tests/room-radar-return-busyref.test.tsx` — tap Return, cancel, tap Return again; assert the dialog opens the second time. Fails now.
- **GREEN:** reset `busyRef.current = false` on dialog close via `onOpenChange(o => { setReturnDialogOpen(o); if (!o) busyRef.current = false; })`.
- **Verify:** `pnpm test -- tests/room-radar-return-busyref.test.tsx && pnpm typecheck`.

### T-05 · `initSyncEngine()` receives the QueryClient (R-SY-01 · CLICK-PATH-006 · HIGH · foundational) · **Tier: S +R**

- **Files:** `src/hooks/use-sync.tsx:168` `initSyncEngine()`; `src/lib/sync-engine.ts:480` `initSyncEngine(queryClient?)`; guarded invalidations `:207-217`, reconcile bail `:233`, 401 clear `:422`.
- **Defect:** sole caller passes no arg → `queryClientRef` stays `undefined` → post-replay equipment invalidations never fire, reconciliation bails, 401 cache-clear is a no-op.
- **RED:** `tests/sync-engine-queryclient-wiring.test.ts` — three assertions, all failing now because `queryClientRef` is `undefined`: (1) `initSyncEngine` is called with a defined QueryClient; (2) a replayed mutation triggers the equipment invalidation; (3) **a 401 on the sync path exercises the `:422` cache-clear branch and the relevant QueryClient cache is actually cleared**.
- **GREEN:** pass the app QueryClient — `initSyncEngine(queryClient)` from the SyncProvider (`useQueryClient()`).
- **Guardrail:** offline/PWA frozen — wiring only; **no emergency endpoint added to any cache**; don't alter the queue/circuit-breaker.
- **Verify:** `pnpm test -- tests/sync-engine-queryclient-wiring.test.ts && pnpm typecheck`.

## Phase 0B — reviewer-reachability & submission gate (ops/config; binary verification, not TDD)

Each is a checklist card with a pass/fail check (spec §4.2). Owner-executed where hardware/accounts are involved. **Tier: Owner** (T-06…T-16) — accounts/build/device/hardware, not a model choice.

- **T-06 (R-AS-01)** Rostered reviewer account — synthetic tenant, vet/senior_technician role, **active roster shift** spanning review window. *Verify:* account starts+ends a Code Blue with no `INSUFFICIENT_CLINICAL_AUTHORITY` 403. **Highest-value item.**
- **T-07 (R-AS-02)** Build only via `pnpm cap:build:native`. *Verify:* login works in the shipped binary.
- **T-08 (R-AS-03) — conditional on social login:** **if the app retains a third-party/social login (Clerk Google OAuth), Sign-in-with-Apple must render + complete in the bundled shell** (mandatory under 4.8); if login is email/password-only, this card is N/A. *Verify:* SIWA round-trip on device (when applicable).
- **T-09 (R-AS-04)** Sentry → `PrivacyInfo.xcprivacy` + ASC privacy answers include Crash Data/Diagnostics.
- **T-10 (R-AS-05)** Broaden `NSCameraUsageDescription` (also used for QR). *Verify:* Info.plist string mentions scanning.
- **T-11 (R-AS-06)** Localize permission prompts (`InfoPlist.strings`, he) on the Hebrew-default app.
- **T-12 (R-AS-07)** Offline cold-start shows "connect to sign in", not a blank screen. *Verify:* airplane-mode first launch.
- **T-13 (R-AS-08)** AASA served at `vettrack.uk/.well-known/apple-app-site-association`; entitlements live.
- **T-14 (R-AS-09)** `pnpm auth:preflight` + `validate:prod` + `verify:resubmission` all green; bump `ios/.last-shipped-build` after upload.
- **T-15 (R-AS-10)** App Review notes frame VetTrack as internal veterinary equipment/ops tracking.

### T-16 · Phase 0 exit gate — on-device drill (blocks leaving Phase 0)

Real device, shipped-style build: **sign in (SIWA if social login is retained — T-08/R-AS-03; else email/password) → start a Code Blue → dismiss the (now-fixed T-01) outcome sheet → end the session.** Proves reviewer access + the T-01 fix + OAuth in one pass. Phase 0 is not done until this passes.

---

## Phase 1 — Equipment bundle (stabilize → extend)

### Fixes

- **T-17 (R-EQ-03 · CLICK-PATH-012):** `src/pages/equipment-detail.tsx:605` — checkout ignores `isError` from `useActiveShift`, rendering a failed shift query as "off-shift". **GREEN:** block client-side only when `!isError && !hasActiveShift` (mirror the equipment-list fix). **RED:** `tests/equipment-detail-shift-error.test.tsx` (transient shift-query error → checkout not disabled). Verify: `pnpm test -- tests/equipment-detail-shift-error.test.tsx && pnpm typecheck`.
- **T-18 (R-EQ-04 · CLICK-PATH-036):** `src/pages/new-equipment.tsx:434` — folder Select uses static `defaultValue`, shows "Unfiled" for filed items. **GREEN:** drive from `value={watch("folderId")}` / `existingEquipment?.folderId`. **RED:** `tests/new-equipment-folder-value.test.tsx`. 
- **T-19 (R-EQ-05 · CLICK-PATH-020):** `src/pages/my-equipment.tsx:113` — "Return All" `Promise.all` rejects before invalidations. **GREEN:** `Promise.allSettled` + invalidate after settle. **RED:** `tests/my-equipment-return-all.test.tsx` (one failed return; others still invalidate). 
- **T-20 (R-EQ-06 · CLICK-PATH-021):** `src/pages/my-equipment.tsx:265` — one shared `returnMut` spins all rows. **GREEN:** scope spinner/disable to `returnMut.variables?.id === item.id`. **RED:** `tests/my-equipment-row-scope.test.tsx`.
- **T-21 (R-EQ-07 · HIG debt):** `src/pages/equipment-detail.tsx` header `size="icon-sm"` controls (`:948`, `:969`, `:981`, `:991`, `:1001`) render under 44pt. **GREEN:** ≥44pt hit area (padding) on each. **RED:** `tests/equipment-detail-touch-targets.test.tsx` (computed hit box ≥44 for each header control). Verify: `pnpm test -- tests/equipment-detail-touch-targets.test.tsx && pnpm typecheck`.

### Features (each decomposed into ordered cards; feature-checklist spec §2.5)

- **T-22 (R-EQ-F1 · small-01 locate)** — three dispatchable cards, each ≤2 files + 1 test (read-only feature: no schema/migration/audit/telemetry per spec §2.5):
  - **T-22a · backend** — read-only `GET /api/equipment/locate?q=` composing `server/domain/equipment/evidence/resolver/{location,custodian}.ts` → `{ location, custodian, readiness }`; `clinicId`-scoped; rate-limit under the scan/action limiter; register in `server/app/routes.ts`. RED: `tests/equipment-locate-route.test.ts` (seeded device → correct room+custodian; cross-clinic returns nothing).
  - **T-22b · client wiring** — `src/lib/api.ts` fn + `src/types/` type. RED: type-check + `tests/api-locate.test.ts`.
  - **T-22c · UI** — a new `LocateSearch` component + bottom-sheet result view (`src/features/equipment/LocateSearch.tsx` + its mount at the home/nav entry point) — bottom-anchored / gesture-summoned; row deep-links to detail; iPad → existing master-detail. RED: `tests/locate-search.test.tsx` (empty≠zero-results; result count announced `aria-live`; label not placeholder). Verify: `pnpm test -- tests/locate-search.test.tsx && pnpm typecheck`.
- **T-23 (R-EQ-F2 · small-02 readiness badge)** — five dispatchable cards, each ≤2 files + 1 test:
  - **T-23a · additive read field** — surface the already-derived readiness state on the equipment read payload. Derivation exists: `computeBundleReadinessGate()` (`server/services/equipment-operational-state.service.ts:37`) → `readinessState`; rules from `getReadinessRules()` (`server/services/equipment-readiness-rules.service.ts:24`). Add it as an additive, non-breaking field on the by-id read handler `server/routes/equipment/handlers/get-equipment-by-id.ts` (registered `server/routes/equipment.ts:285`). RED: `tests/equipment-readiness-field.test.ts` (seeded device → payload carries the derived `readinessState`; existing keys unchanged). Verify: `pnpm test -- tests/equipment-readiness-field.test.ts && pnpm typecheck`.
  - **T-23b · tier bucket helper** — new `src/lib/equipment-readiness-tier.ts`: a pure map from the **six `EquipmentStatus` tokens** (`src/types/equipment.ts:6-12` — `ok | issue | maintenance | sterilized | critical | needs_attention`) → a **3-tier** bucket (`ready | caution | not_ready`). RED: `tests/readiness-tier-bucket.test.ts` (each of the six tokens maps to its documented tier; assertion is exhaustive over the union). Verify: `pnpm test -- tests/readiness-tier-bucket.test.ts && pnpm typecheck`.
  - **T-23c · i18n leak** — **fix the English-fallback i18n leak** at `src/components/ui/status-badge.tsx:33-36` (`STATUS_LABELS` for `stale/unknown/info/neutral` currently `(t.status as Record<string,string>)[k] ?? "Stale"/"Unknown"/"Info"/"Unknown"` — hardcoded English fallbacks) → typed `t.status.*` keys; add `status.stale/unknown/info/neutral` to `locales/he.json` + `locales/en.json` (parity-checked). RED: `tests/status-badge-i18n.test.tsx` (each of the four kinds renders its locale string; no English literal under the He locale). Verify: `pnpm test -- tests/status-badge-i18n.test.tsx && pnpm typecheck`.
  - **T-23d · component** — new `src/components/ui/readiness-badge.tsx` `<ReadinessBadge>` (shape+glyph+text) composing the T-23b tier helper over `StatusBadge` (`src/components/ui/status-badge.tsx:46`). RED: `tests/readiness-badge.test.tsx` (**glyph/container contrast ≥3:1 and rendered-text contrast ≥4.5:1, both light and dark themes**; screen-reader label present — status is not color-only). Verify: `pnpm test -- tests/readiness-badge.test.tsx && pnpm typecheck`.
  - **T-23e (mechanical mount fan-out — ONE card, exempt from the ≤2-file *implementation* bound because each change is a 1–2 line import+render, not logic):** mount `<ReadinessBadge>` at each named call site — **`src/pages/my-equipment.tsx`, `src/pages/equipment-list.tsx`, `src/pages/equipment-detail.tsx`, the role home surfaces `src/features/today/surfaces/*HomeSurface.tsx`, the board `src/board/*`, and `src/features/equipment/LocateSearch.tsx` (T-22c)** — one import+render per surface, no logic. RED: `tests/readiness-badge-surfaces.test.tsx` (badge renders on **each** named surface). Verify: `pnpm test -- tests/readiness-badge-surfaces.test.tsx && pnpm typecheck`.
- **T-24 (R-EQ-F3 · small-04 damaged-at-check-in)** — five dispatchable cards, each ≤2 files + 1 test (net-new-data feature: full checklist per spec §2.5):
  - **T-24a · schema** — add `vt_damage_events` (`clinicId, equipmentId, reportedBy, at, note, resolvedAt`) as a new `vtTable` in `server/schema/equipment.ts` (mirror `equipment = vtTable("vt_equipment", …)` at `server/schema/equipment.ts:102`) + an additive `conditionStatus` column on the equipment table (alongside `status` at `server/schema/equipment.ts:116`); re-export from `server/db.ts`; `npx drizzle-kit generate` → commit SQL. RED: `tests/migrations/damage-events.test.ts` (DB-integration — table exists, `clinicId` NOT NULL, `conditionStatus` default preserves existing rows). Verify: DB-integration runner (`DATABASE_URL` + applied migrations), per the DB-integration convention above.
  - **T-24b · route + audit** — new `server/routes/equipment-damage.ts` (write a `vt_damage_events` row + set `conditionStatus`, `clinicId`-scoped) registered in `server/app/routes.ts` (mirror the equipment mount at `server/app/routes.ts:18`); add the new kind to the closed `AuditActionType` union at `server/lib/audit.ts:5` and `logAudit()` it. RED: `tests/damage-report-route.test.ts` (report persists the event + flips `conditionStatus`; cross-clinic write rejected; audit row emitted). Verify: `pnpm test -- tests/damage-report-route.test.ts && pnpm typecheck`.
  - **T-24c · api + types** — `src/lib/api.ts` fn (`api.equipment.reportDamage`) + a `DamageReport` type in `src/types/equipment.ts`. RED: `tests/api-damage.test.ts` (typed fn shape). Verify: `pnpm test -- tests/api-damage.test.ts && pnpm typecheck`.
  - **T-24d · UI** — add "returned damaged" as a **third choice inside `ReturnPlugDialog`** (`src/components/return-plug-dialog.tsx:27`; extend the two-button grid at `:72-95` to three and the `onConfirm` contract at `:22`/`:45`; convert the phone `Dialog` → bottom sheet), and wire it at the return call site to fire the T-24c damage api with **undo** via the existing `UNDO_WINDOW_MS` toast (`src/pages/equipment-detail.tsx:112`, toast at `:267-323`) + `haptics.warning()` (`src/lib/haptics.ts:64`). RED: `tests/return-damaged.test.tsx` (third choice submits a damage report; undo within the window cancels it). Verify: `pnpm test -- tests/return-damaged.test.tsx && pnpm typecheck`.
  - **T-24e** — readiness reads the new `conditionStatus` so a damaged device reads not-ready: extend `computeBundleReadinessGate()` (`server/services/equipment-operational-state.service.ts:37`) so a non-clear `conditionStatus` forces `readinessState` not-ready. RED: **its own** `tests/damage-readiness-not-ready.test.ts` (distinct from T-24b's route test) — after a damage report the readiness gate reports the device not-ready. Verify: `pnpm test -- tests/damage-readiness-not-ready.test.ts && pnpm typecheck`.

---

## Phase 1 — Shift / Home bundle

- **T-25 (R-SH-01 · CLICK-PATH-007):** `src/features/shift-chat/hooks/useShiftChat.ts:132` — reactions/acks never render live (invalidate-only over a strict-`gt` poll + append-only accumulator). **GREEN:** on react/ack success, patch the affected message in local state **by id (merge-by-id)** so the open panel reflects it without a strict-`gt` refetch. **Guardrail:** no new realtime path. **RED:** `tests/shift-chat-live-reaction.test.tsx`. **Tier: S +R** (subtle poll/accumulator reconcile — review before commit).
- **T-26 (R-SH-02 · CLICK-PATH-017):** `useShiftChat.ts:80` — open→close unread badge counts the just-read batch. **GREEN:** advance `lastOpenRef` on close / skip the transition edge. **RED:** `tests/shift-chat-unread-badge.test.tsx`.
- **T-27 (R-SH-F2 · small-05 start-of-shift card)** — **T-27a:** build one `StartOfShiftCard` component (one focal "what needs me now" + one primary action, gated by the capability union; phone compact / iPad hero band), composed from existing per-role data. RED: `tests/start-of-shift-card.test.tsx` (per-role composition differs; off-shift idle variant; RTL). **T-27b (mechanical mount fan-out — ONE card, exempt from the ≤2-file *implementation* bound: a 1-line mount per surface, not logic):** mount `StartOfShiftCard` in each role home surface (`src/features/today/surfaces/{Floor,Ops,Vet,Tech,Student}HomeSurface.tsx` + `OnShiftHero.tsx`) — one line each. RED: `tests/start-of-shift-card-surfaces.test.tsx` (the card renders on each named surface). Verify: `pnpm test -- tests/start-of-shift-card-surfaces.test.tsx && pnpm typecheck`.
- **R-SH-F1 (medium-02 handover)** → **SUB-SPEC**, see `subspecs/R-SH-F1-shift-handover.plan.md` (superset + Priza). Not a card here.

## Phase 1 — Inventory bundle

- **T-28 (R-IN-01 · CLICK-PATH-018)** — two cards (≤2 files each):
  - **T-28a (server):** `createItemSchema` (`server/routes/inventory-items.ts:23`) omits `isBillable`/`minimumDispenseToCapture` (they exist only on `updateItemSchema` at `:40-41`), and the create insert (`router.post("/")` `:176`, `db.insert(...).values(...)` `:183`) never persists them. **GREEN:** add the two optional fields to `createItemSchema` and pass them through the insert. RED: `tests/inventory-create-fields.test.ts` (create with both fields → row persists them). Verify: `pnpm test -- tests/inventory-create-fields.test.ts && pnpm typecheck`.
  - **T-28b (client):** the `api.inventoryItems.create` payload type (`src/lib/api.ts`) + the `src/pages/inventory-items.tsx` create dialog send the fields (decision: persist, not hide). RED: `tests/inventory-create-dialog.test.tsx` (dialog submits both fields). Verify: `pnpm test -- tests/inventory-create-dialog.test.tsx && pnpm typecheck`.
- **T-29 (R-IN-02 · CLICK-PATH-019):** `src/pages/inventory-page.tsx:448` — restock +/- burst desyncs (absolute qty, no per-row disable). **GREEN:** serialize per-row — disable the +/- controls while a scanLine mutation is pending. **RED:** `tests/inventory-restock-burst.test.tsx`.
- **T-30 (R-IN-F1 · small-03 nudge)** — dispatchable cards, each **≤2 impl files** + 1 test:
  - **T-30a1-i (backend · nudge-feed module + expiry producer) — ≤2 impl files:** new role-scoped nudge-feed module `server/services/nudge-feed.service.ts` + wire `expiryCheckWorker` (`server/workers/expiryCheckWorker.ts`) to emit expiry nudges into it, tagged by target role. RED: `tests/expiry-nudge-feed.test.ts` (expiry nudge reaches the correct role only; other roles excluded). Verify: `pnpm test -- tests/expiry-nudge-feed.test.ts && pnpm typecheck`.
  - **T-30a1-ii (backend · restock producer — depends on T-30a1-i) — ≤2 impl files:** wire `restock.service` (`server/services/restock.service.ts`) to emit restock nudges into the T-30a1-i feed, tagged by target role. RED: `tests/restock-nudge-feed.test.ts` (restock nudge reaches the correct role only; other roles excluded). Verify: `pnpm test -- tests/restock-nudge-feed.test.ts && pnpm typecheck`.
  - **T-30a2-i (telemetry · server enum + metric) — 2 impl files:** the nudge telemetry surface (`server/routes/realtime.ts` + `server/lib/metrics.ts`) originally spanned three impl files with the client enum, so it is split. Add a closed `ALLOWED_NUDGE_*` enum + type-guard in `server/routes/realtime.ts` (mirror `ALLOWED_CB_PROPAGATION_BUCKETS` at `server/routes/realtime.ts:349-353`) **and** the matching `MetricName` union member + `DEFAULT_COUNTERS` entry in `server/lib/metrics.ts` (`MetricName` at `server/lib/metrics.ts:6`, `DEFAULT_COUNTERS` at `:719`, accepted via `incrementMetric()` at `:1002`). RED: `tests/expiry-nudge-telemetry-server.test.ts` — the telemetry endpoint **rejects an out-of-enum nudge bucket (no metric bump)** and an in-enum bucket increments the closed counter. Verify: `pnpm test -- tests/expiry-nudge-telemetry-server.test.ts && pnpm typecheck`.
  - **T-30a2-ii (telemetry · client enum — depends on T-30a2-i) — 2 impl files:** the client classifier that only ever posts an in-enum bucket — a `classifyNudge*` in `src/lib/realtime.ts` (mirror `classifyPropagationMs` at `src/lib/realtime.ts:72` + the `api.realtime.telemetry({…})` post at `:87-88`) + the telemetry payload field type on `api.realtime.telemetry` in `src/lib/api.ts`. RED: `tests/expiry-nudge-telemetry-client.test.ts` — the classifier maps to a bounded bucket and **never emits an out-of-enum value**. Verify: `pnpm test -- tests/expiry-nudge-telemetry-client.test.ts && pnpm typecheck`.
  - **T-30b (UI):** the dismissible home-surface nudge (dismiss persists). RED: `tests/expiry-nudge-ui.test.tsx`. Verify: `pnpm test -- tests/expiry-nudge-ui.test.tsx && pnpm typecheck`.
  - **T-30c (push):** once-per-event push via `notification.worker`. RED: `tests/expiry-nudge-push.test.ts`. Verify: `pnpm test -- tests/expiry-nudge-push.test.ts && pnpm typecheck`. **No new realtime path.**

## Phase 1 — Web platform admin-gate

- **T-31 (R-WEB-01 · localized `S +R` card — a single-file `PlatformRouter` guard, NOT a `⚠ SUB-SPEC` doc):** `src/app/platform/PlatformRouter.tsx` desktop branch (L27 passthrough) — add a guard **inside `AuthGuard`**: if `target === "desktop" && !experience.can("management.web")` → render a `WebOnlyGuard`-style denial ("this workspace is for management — open VetTrack on your device"). Threshold = `can("management.web")` — grant = **admin + `senior_technician` + `lead_technician` + secondary-admin** (not the lossy "admin + leads"). **Do NOT touch `resolvePlatformTarget()`'s synchronous contract.** `/board` untouched. **RED:** `tests/web-platform-management-gate.test.tsx` — **every `management.web` grant covered**: `vet_tech` + `student`@desktop → denial; `admin` + `senior_technician` + `lead_technician` + **secondary-admin**@desktop → passthrough. **Verify:** `pnpm test -- tests/web-platform-management-gate.test.tsx && pnpm typecheck`. **Tier: S +R** (platform-routing seam — review before commit).

---

## Definition of done (Phase 0 + 1)

- **Code cards (all except 0B):** RED test written first, then GREEN; `pnpm typecheck` clean.
- **0B is different — do not apply RED→GREEN to it.** T-06–T-15 are **binary config/account/build checks** and T-16 is an **on-device drill**; their "done" is the pass/fail verification stated on each card (e.g. "reviewer starts+ends a Code Blue with no 403", "SIWA round-trips on device"), not a unit test.
- Phase 0 exit drill (T-16) passes on device.
- `pnpm i18n:check` green for every new string; no hardcoded copy in `.ts/.tsx`.
- Cross-cutting a11y gates (spec §9) satisfied for touched surfaces (focus/dismiss on sheets, ≥44pt, non-color status, RTL/bidi).
- Evidence logged in `docs/audit/PROOF_ALIGNMENT_LOG.md` per requirement.
