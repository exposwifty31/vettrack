# Consolidated Plan — Behavioral Audit × 10x Feature Library (SDD Design Spec)

- **Date:** 2026-07-12
- **Status:** Design spec — pending owner review; feeds `writing-plans` (implementation plan)
- **Working branch:** `claude/audit-10x-consolidated-plan` (off `main`; `main` already contains merged PR #83)
- **Execution model:** SDD (spec-driven) + TDD (test-first) + **Sonnet-sized** tasks (see §2)
- **Sources consolidated:**
  - `docs/audit/flow-audit-behavioral-2026-07-11.md` — 36 behavioral state-composition findings (6 HIGH · 21 MEDIUM · 9 LOW).
  - `.claude/docs/ai/vettrack/10x/` — 12 executable feature briefs (3 Massive · 4 Medium · 5 Small) + `session-1.md` strategy.
- **Grounding:** all 36 finding anchors + 12 feature anchors verified against live `main` (2026-07-12). Refined by four domain lenses: Apple App Store review, Capacitor preflight, mobile/HIG, and WCAG 2.2 AA / product-design-fundamentals.

---

## 1. Purpose & framing decisions

One plan that sequences remediation debt and the 10x library **together**, so no feature is built on a broken surface, and the sequence is tilted toward passing the pending iOS App Store re-review.

Owner-selected framing:

| Decision | Choice |
|---|---|
| **Structure** | Surface-bundled — the unit of work is a *surface* carrying both its findings and its 10x feature(s), executed **stabilize → extend**. |
| **Priority lens 1** | Stabilize a surface before extending it (never ship a feature onto an open HIGH on its own surface). |
| **Priority lens 2** | App Store resubmission readiness reweights *across* surfaces. |
| **Scope** | Everything, phased. Gated Massives sit in a marked, blocked phase. |

**App Store reframing (critical):** the app is **already live** — this is a rejection-fix re-upload, so the dominant risk is Guideline **2.1** (reviewer can't reach/operate core features), not 4.2 (minimum functionality). The App-Store lever is therefore **Phase 0 reviewer-reachability (work-stream 0B)**, *not* deferring web-console surfaces — grounding proved only 3 of the "admin" findings are web-only (and all 3 are already LOW); the other 5 are native-reachable and keep their MEDIUM weight.

---

## 2. Execution model (every task obeys this)

### 2.1 SDD
- Every unit of work is a numbered **Requirement** (`R-<area>-##`) with a precise statement, **testable acceptance criteria**, and **traceability** to its source finding (`CLICK-PATH-###`) or feature (`small-0#` / `medium-0#` / `massive-0#`).
- The spec is the source of truth. The implementation plan (`writing-plans` output) may only expand requirements into task cards; it may not introduce behavior not in a requirement.

### 2.2 TDD
- Each requirement carries a **RED test** hook: the test file to create/update and the assertion that must FAIL against current code.
- Task order is always **RED → GREEN → REFACTOR → verify**. No implementation lands before its failing test exists.

### 2.3 Sonnet-sized task contract (the important one)
Because the executing agent reasons less, every task card produced from this spec MUST:
1. Touch **≤ 2 files** for the change + **1 test file** (larger requirements are split until they fit).
2. Cite **exact anchors** — `file:line` + symbol names. No "find the relevant code."
3. Carry **all context inline** — the defect, the fix direction, and the frozen-surface guardrails — so the card is understandable without reading other cards.
4. Contain **zero open decisions** — every choice is pre-made here. If a task would require judgment, it is under-specified and must be refined before dispatch.
5. End with a **deterministic verify command** and its expected result (a test that goes RED→GREEN, plus `pnpm typecheck`).

### 2.4 Complexity gate (honesty about Sonnet's limits)
A requirement is **directly Sonnet-executable** only if it is a localized change on a non-frozen surface. Requirements that touch a **frozen surface** (SSE/realtime, Code Blue runtime, authority/enforcement, offline/PWA, telemetry enums) or are **net-new features of Medium+ size** are marked `⚠ SUB-SPEC` and MUST get a dedicated SDD spec-plan pass (their own requirements + task cards) before any Sonnet agent executes them. This spec defines them at requirement level only.

### 2.5 Standard feature checklist (inherited by every feature requirement)
Per `CLAUDE.md` §"Adding a new feature": schema → `npx drizzle-kit generate` → commit SQL → route in `server/routes/` registered in `server/app/routes.ts` → `src/lib/api.ts` fn + `src/types/` type → lazy route in `src/app/routes.tsx` → he+en keys (parity, `pnpm i18n:check`) → audit kind added to the closed `AuditActionType` union → bounded-enum telemetry on client + `server/routes/realtime.ts` → `pnpm typecheck` clean.

---

## 3. Phase spine

| Phase | Theme | Work-streams | Sonnet? |
|---|---|---|---|
| **0 — Stabilize + Ship-ready** | Pass iOS re-review | **0A** 6 HIGH fixes · **0B** reviewer-reachability & submission gate · **exit:** on-device drill | 0A yes · 0B mixed (ops) |
| **1 — Do-Now bundles** | Mine existing data (native-safe) | **Equipment** (fixes + small-01/02/04) · **Shift/Home** (fixes + medium-02/small-05) · **Inventory** (fixes + small-03) · **Web platform admin-gating** (NEW) | fixes yes · features small = yes · medium-02 `⚠ SUB-SPEC` |
| **2 — Do-Next + native MED** | Extend irreplaceable surfaces | **Code Blue** (fixes + medium-01) · **Board** (medium-03) · **Predictive** (massive-02) · **Native MED sweep** (12 fixes incl. 5 reclassified admin) | fixes yes · features `⚠ SUB-SPEC` |
| **3 — Cleanup + web-only** | Low visibility/severity | 9 LOW fixes (incl. the 3 genuinely web-only) | yes |
| **4 — Gated Massives** | Owner-decision-blocked | massive-01 passive BLE/RFID · massive-03 clinic network · medium-04 copilot/voice | all `⚠ SUB-SPEC` + blocked |

Finding accounting: 6 HIGH (P0) · 8 MED (P1) + 13 MED (P2) = 21 MED · 9 LOW (P3). Features: 6 (P1) + 3 (P2) + 3 (P4) = 12. ✓

---

## 4. Phase 0 — Stabilize + Ship-ready

### 4.1 Work-stream 0A — the 6 HIGH fixes (all directly Sonnet-executable)

#### R-CB-01 — Code Blue outcome-sheet "Cancel" must dismiss without ending the session  ·  traces CLICK-PATH-001 (HIGH)
- **Anchors:** `src/pages/code-blue.tsx` — `OutcomeModal` (def ~L237), Cancel button ~L266 (`onClick={() => onClose("")}`), `handleEndSession` ~L326, guard `if (!outcome || !session) return` ~L327, `setShowOutcomeModal(false)` ~L328.
- **Defect:** Cancel routes `onClose("")` → `handleEndSession("")` → the outcome guard returns *before* the `setShowOutcomeModal(false)` line, so the sheet never closes; there is no backdrop dismiss → the manager is trapped over a live emergency modal (no browser-back chrome in the WKWebView shell).
- **Fix direction:** Cancel gets its own dismiss that sets `showOutcomeModal=false` independent of the outcome guard (dedicated `closeOutcomeModal()` or set the flag before the guard). **Cancel must NOT end the session.**
- **RED test:** `tests/code-blue-outcome-cancel.test.tsx` — with outcome modal open + active session, click "Cancel" and assert: (a) modal removed from DOM, (b) end-session mutation **not** called, (c) focus returns to the trigger. Fails on current code.
- **Frozen guardrail:** do not touch SSE/keepalive; **no optimistic session end** — session-end stays server-confirmed (doctrine §"Code Blue runtime guarantees").
- **Verify:** `pnpm test -- tests/code-blue-outcome-cancel.test.tsx && pnpm typecheck`.

#### R-EQ-01 — "Dock Return" opens its sheet on the default tab  ·  traces CLICK-PATH-002 (HIGH)
- **Anchors:** `src/pages/equipment-detail.tsx` — button `setDockReturnOpen(true)` L1097; `<DockReturnFlow>` L1361 inside `<TabsContent value="readiness">` L1340.
- **Defect:** the only `<DockReturnFlow>` consumer is mounted inside an inactive Radix tab (`TabsPrimitive.Content`, no `forceMount`), so on the default `details` tab the state is set with no mounted consumer → silent no-op; later visiting Readiness pops it unexpectedly.
- **Fix direction:** move `<DockReturnFlow>` (and its sibling in R-EQ-02) to **page level**, alongside the other always-mounted sheets, so it is mounted regardless of active tab. The equipment-list variant already mounts it flat and works — mirror that.
- **RED test:** `tests/equipment-detail-dock-return-mount.test.tsx` — render detail on the default tab, trigger Dock Return, assert the flow renders. Fails on current code.
- **Frozen guardrail:** presentation/mount move only; no change to custody mutation semantics.
- **Verify:** `pnpm test -- tests/equipment-detail-dock-return-mount.test.tsx && pnpm typecheck`.

#### R-EQ-02 — RFID "confirm at dock" opens its sheet on the default tab  ·  traces CLICK-PATH-003 (HIGH)
- **Anchors:** `src/pages/equipment-detail.tsx` — StatusStrip `onRfidAttention={() => setDockReturnNfcOpen(true)}` L1214; `<DockReturnNfc>` L1374 inside the same inactive Readiness `TabsContent`.
- **Defect / fix / guardrail:** identical root cause and fix as R-EQ-01 — move `<DockReturnNfc>` to page level. **Do together with R-EQ-01** (same file, same mount block) as one card.
- **RED test:** extend `tests/equipment-detail-dock-return-mount.test.tsx` with the RFID-attention path.
- **Verify:** same command as R-EQ-01.

#### R-SC-01 — QR auto-decode targets the last physically-scanned tag exactly once  ·  traces CLICK-PATH-004 (HIGH)
- **Anchors:** `src/components/qr-scanner.tsx` — `handleScanResult` L215 (wired L367-368), `if (!eq)` branch L233, `DEBOUNCE_MS` L218.
- **Defect:** the only re-entry guard is a 300 ms time-debounce; the scanner is not stopped before the awaited `resolveEquipmentId`, so a later, slower resolve can overwrite `setScannedEquipment` (last-resolved-wins) → a custody action can hit the **wrong** equipment; also double-counts `scansToday`.
- **Fix direction:** add an in-flight request token/ref; stop the scanner **before** the await; early-return while a resolve is pending; guard the `scansToday` increment so it counts once per accepted scan.
- **RED test:** `tests/qr-scanner-race.test.tsx` — simulate two overlapping decodes where the first resolves slower; assert the final `scannedEquipment` is the second (last-scanned) and the increment fired once. Fails on current code.
- **Frozen guardrail:** does not touch offline-emergency classifier; scan remains a first-class custody source.
- **Verify:** `pnpm test -- tests/qr-scanner-race.test.tsx && pnpm typecheck`.

#### R-RM-01 — Room-radar "Return" stays functional after a canceled dialog  ·  traces CLICK-PATH-005 (HIGH)
- **Anchors:** `src/pages/room-radar.tsx` — `busyRef` decl L114; onClick L317-323 (`busyRef.current = true` L319); the reset lives only in `returnMut.onSettled`.
- **Defect:** tapping Return sets `busyRef=true` but only *opens* `ReturnPlugDialog` (no mutation). Cancel closes the dialog without running `returnMut`, so `onSettled` never resets `busyRef` → the `!busyRef.current` guard blocks every later tap; the button isn't visually disabled (that's tied to `returnMut.isPending`).
- **Fix direction:** reset `busyRef.current = false` on dialog close (`onOpenChange(o => { setReturnDialogOpen(o); if (!o) busyRef.current = false; })`), OR only set `busyRef` on the mutating path.
- **RED test:** `tests/room-radar-return-busyref.test.tsx` — tap Return, cancel the dialog, tap Return again; assert the dialog opens the second time. Fails on current code.
- **Verify:** `pnpm test -- tests/room-radar-return-busyref.test.tsx && pnpm typecheck`.

#### R-SY-01 — `initSyncEngine()` receives the QueryClient so post-offline-sync caches reconcile  ·  traces CLICK-PATH-006 (HIGH · foundational, **not** a review-risk)
- **Anchors:** `src/hooks/use-sync.tsx:168` `initSyncEngine()` (no arg); `src/lib/sync-engine.ts:480` `export function initSyncEngine(queryClient?: QueryClient)`; guarded invalidations `sync-engine.ts:207-217`, reconciliation bail `:233`, 401 clear `:422`.
- **Defect:** the sole caller passes no argument, so module-level `queryClientRef` stays `undefined` → post-replay equipment invalidations never fire, the post-sync reconciliation bails, and the 401-path cache clear is a no-op.
- **Fix direction:** pass the app's QueryClient — `initSyncEngine(queryClient)` from the SyncProvider (it has `useQueryClient()`).
- **RED test:** `tests/sync-engine-queryclient-wiring.test.ts` — assert `initSyncEngine` is called with a defined QueryClient and that a replayed mutation triggers the equipment invalidation. Fails on current code.
- **Frozen guardrail:** offline/PWA is a frozen surface — wiring only; do not alter the sync queue, circuit-breaker, or emergency-endpoint cache bypass. Verify no emergency endpoint enters any cache path.
- **Note:** lowest App-Store review risk of the six (a reviewer rarely toggles airplane-mode mid-session) — kept in Phase 0 for **correctness/foundation**, not rejection risk.
- **Verify:** `pnpm test -- tests/sync-engine-queryclient-wiring.test.ts && pnpm typecheck`.

### 4.2 Work-stream 0B — reviewer-reachability & submission gate (ops/config; not all TDD-shaped)

> These are the failure modes an iOS reviewer hits that the behavioral audit could not see. Each is a checklist item with a **binary verification**, not a unit test.

- **R-AS-01 — Rostered reviewer account.** Provision an isolated synthetic-tenant reviewer with a clinical role (vet/senior_technician) **and an active roster shift spanning the review window** (rostering is admin-CSV-import only). *Verify:* the account can start/end a Code Blue with no `INSUFFICIENT_CLINICAL_AUTHORITY` 403. **This is the single highest-value addition** — fixing R-CB-01 is moot if the reviewer 403s before reaching the outcome sheet.
- **R-AS-02 — Correct native build.** Archive **only** via `pnpm cap:build:native` (`scripts/build-native-shell.sh`) — bakes `VITE_CLERK_PUBLISHABLE_KEY` + `VITE_API_ORIGIN`, never sets `CAPACITOR_SERVER_URL`. *Verify:* login works in the shipped binary (a plain `pnpm build` → dev-bypass → `useUser` crash).
- **R-AS-03 — Sign in with Apple live.** Confirm the SIWA button renders and completes in the bundled shell (mandatory under Guideline 4.8 because Clerk offers Google OAuth). Entitlement `com.apple.developer.applesignin` is present — verify runtime.
- **R-AS-04 — Privacy manifest reconciliation.** If Sentry is active in the native build, add Crash Data/Diagnostics to `PrivacyInfo.xcprivacy` + App Store Connect privacy answers (currently declares only Email+Name → 5.1 mismatch risk).
- **R-AS-05 — Camera usage string.** Broaden `NSCameraUsageDescription` (Info.plist ~L52) — it claims "capture photos for equipment records" but the camera also does QR scanning (5.1.1 mismatch).
- **R-AS-06 — Localize permission prompts.** Info.plist usage strings are English-only on a Hebrew-default app (`CFBundleDevelopmentRegion=en`); add `InfoPlist.strings` (he) for NFC/Camera/Photo.
- **R-AS-07 — Offline cold-start state.** First launch airplane + empty Dexie + login wall must show a clear "connect to sign in" state, not a blank/white screen.
- **R-AS-08 — AASA liveness.** Confirm `vettrack.uk/.well-known/apple-app-site-association` is actually served (`applesignin`, `aps-environment=production`, `associated-domains: applinks:vettrack.uk`) or deep-link + OAuth redirect break.
- **R-AS-09 — Run resubmission gates.** `pnpm auth:preflight`, `pnpm validate:prod`, `pnpm verify:resubmission` all pass; bump `ios/.last-shipped-build` after upload (never hand-edit versions).
- **R-AS-10 — Review-notes framing.** Frame VetTrack in App Review notes as **internal veterinary equipment/ops tracking** (not patient diagnosis / emergency medical guidance) to pre-empt medical-substantiation questions on "Code Blue."

### 4.3 Phase 0 exit gate
**On-device drill (real device, shipped-style build):** Sign in with Apple → start a Code Blue → reach and **dismiss** the (now-fixed) outcome sheet → end the session. Passing this simultaneously proves reviewer access (R-AS-01/02/03), the R-CB-01 fix, and the OAuth path. Phase 0 is not "done" until this passes.

---

## 5. Phase 1 — Do-Now bundles

### 5.1 Equipment surface (stabilize → extend)
**Stabilize (Sonnet-executable fixes, each RED-test-first):**
- **R-EQ-03** — checkout must not conflate a *failed* shift query with off-shift. `equipment-detail.tsx:605` ignores `isError` from `useActiveShift`; mirror the equipment-list fix (block client-side only when `!isError && !hasActiveShift`). Traces CLICK-PATH-012. RED: `tests/equipment-detail-shift-error.test.tsx`.
- **R-EQ-04** — edit-equipment folder Select shows the loaded folder, not "Unfiled". `new-equipment.tsx:434` uses a static `defaultValue`; drive from `value={watch("folderId")}` / `existingEquipment?.folderId`. Traces CLICK-PATH-036. RED: `tests/new-equipment-folder-value.test.tsx`.
- **R-EQ-05** — "Return All" invalidates caches even when one return fails. `my-equipment.tsx:113` `Promise.all` rejects before the invalidations; use `Promise.allSettled` + invalidate in a finally/after-settle. Traces CLICK-PATH-020. RED: `tests/my-equipment-return-all.test.tsx`.
- **R-EQ-06** — a single-row Return spinner/disable is scoped to that row. `my-equipment.tsx:265` one shared `returnMut` drives all rows; scope to `returnMut.variables?.id === item.id`. Traces CLICK-PATH-021. RED: `tests/my-equipment-row-scope.test.tsx`.
- **R-EQ-07** — touch-target debt: audit `size="icon-sm"` header controls in `equipment-detail.tsx` (duplicate/edit/tools) to a ≥44pt hit area (padding, not glyph size). From mobile/HIG lens. RED: `tests/equipment-detail-touch-targets.test.tsx`.

**Extend (small features — Sonnet-executable, feature-checklist §2.5):**
- **R-EQ-F1 (small-01 locate)** — read-only `GET /api/equipment/locate?q=` composing existing resolvers (`server/domain/equipment/evidence/resolver/{location,custodian}.ts`) → `{ location, custodian, readiness }`. UI: **bottom-anchored / gesture-summoned** search (not a top bar), results in a **bottom sheet**, result row deep-links to detail; iPad → existing master-detail. Rate-limit under the scan/action limiter. `clinicId` scoped. **Acceptance:** correct room+custodian+readiness for seeded devices; distinct empty vs zero-results states, announced result count (`aria-live`); cross-clinic device never returned.
- **R-EQ-F2 (small-02 readiness badge)** — expose the already-derived readiness tier (`equipment-readiness-rules.service.ts`) as an additive read field; render via a single shared **6-status-token → 3-tier bucket helper** (one device, one truth) as **shape + glyph + text** (reuse existing `StatusBadge` pattern — do NOT regress to color-only). **Also fixes** the English-fallback i18n leak in `src/components/ui/status-badge.tsx` (`stale`/`unknown`/`info`/`neutral` must resolve through `t.status.*`). **Acceptance:** dead-battery/overdue-service/near-expiry render the correct tier; each tier ≥3:1 contrast in light **and** dark; no client-side re-derivation.
- **R-EQ-F3 (small-04 damaged-at-check-in)** — add "returned damaged" as a **third choice inside `ReturnPlugDialog`** (convert the phone presentation from centered Dialog → bottom sheet); write a `vt_damage_events` row (new table: `clinicId, equipmentId, reportedBy, at, note, resolvedAt`) + optional `conditionStatus` on equipment; **undoable** via the existing `UNDO_WINDOW_MS` countdown toast + `haptics.warning()` (not a blocking confirm); new `AuditActionType`. **Acceptance:** writes the event + flips condition; device then reads not-ready via readiness rules; damage queryable by clinic+period.

### 5.2 Shift / Home surface
- **R-SH-01** — shift-chat reactions/acks render live while the panel is open. `useShiftChat.ts:132` invalidate-only over a strict-`gt` incremental poll with an append-only accumulator can't show an edit; patch local state optimistically or reset `afterRef` + merge-by-id. Traces CLICK-PATH-007. RED: `tests/shift-chat-live-reaction.test.tsx`. **Guardrail:** don't add a realtime path — reconcile within the existing poll/accumulator.
- **R-SH-02** — closing shift chat doesn't spawn a spurious unread badge. `useShiftChat.ts:80` unread-increment effect re-fires on open→close while `data` holds the just-read batch; advance `lastOpenRef` on close / skip the transition edge. Traces CLICK-PATH-017. RED: `tests/shift-chat-unread-badge.test.tsx`.
- **R-SH-F1 (medium-02 shift handover)** `⚠ SUB-SPEC (LARGE)` — **extends the EXISTING `/handoff`** (`src/pages/handoff.tsx` renders `ShiftSummarySheet` — the brief's "no /handoff exists" premise is stale). Generate a `vt_shift_handover` artifact; **acknowledge = a deliberate confirm** (attestation — the sanctioned exception to undo-first); iPhone consume+ack / iPad two-pane authoring. **Scope resolved (owner) — a SUPERSET of the original brief:**
  - **All 4 delta types** (custody moves, task state, alerts, dispenses) — not a subset.
  - **Per-technician patient/animal worklist** — which animals each tech worked on during the shift. ⚠ **Data-source constraint:** VetTrack removed internal patient/ER tables (migrations 142–143), so this dimension is expected to be **sourced from the external PMS, not a reintroduced internal patient model** — see Priza below.
  - **App-observed signals** — system-derived observations during the shift (not just manually-logged actions): custody/scan/readiness/alert events attributable to the shift window.
  - **Future-integration constraint — Priza:** an eventual integration with the external system **Priza** is a first-class design input. Shape the `vt_shift_handover` schema + generator so the patient/animal and observed-signal dimensions can be sourced from / exported to Priza **without a rewrite** (stable, integration-friendly contract; don't hard-couple to internal-only sources).
  Its dedicated spec-plan is **larger than a normal SUB-SPEC** (new table + generator + route + audit kind + the PMS-integration seam); whoever writes it must scope for the Priza integration point up front.
- **R-SH-F2 (small-05 start-of-shift card)** — compose existing per-role surfaces (`src/features/today/surfaces/{Floor,Ops,Vet,Tech,Student}HomeSurface.tsx`, `OnShiftHero.tsx`) into **one focal "what needs me now" + one primary action**, gated by the existing capability union; phone compact / iPad hero band. No new data sources. **Acceptance:** each role's card differs correctly; off-shift renders a sensible idle variant; RTL spot-check.

### 5.3 Inventory surface
- **R-IN-01** — New Item dialog persists "Billable" + min-capture on create. `inventory-items.tsx:124` `createMut` omits `isBillable`/`minimumDispenseToCapture` (and the api type can't carry them); add to POST body + `api.inventoryItems.create` type + route, OR hide the controls in create mode. Traces CLICK-PATH-018. RED: `tests/inventory-create-fields.test.tsx`.
- **R-IN-02** — restock +/- burst stays consistent. `inventory-page.tsx:448` buttons aren't disabled while a scanLine is pending and send absolute quantities; serialize per-row (disable while pending) or drop stale responses. Traces CLICK-PATH-019. RED: `tests/inventory-restock-burst.test.tsx`.
- **R-IN-F1 (small-03 expiry/low-stock nudge)** — route existing `expiryCheckWorker` + `restock.service` output to a **home-surface nudge** for the relevant role (+ optional push), dismissible, links to the action. Bounded-enum telemetry if counters added; no new realtime path. **Acceptance:** nudge appears for the correct role only; dismiss persists; push fires once per event.

### 5.4 Web platform admin-gating (NEW work-stream — from this session's investigation)
- **R-WEB-01 — desktop web is restricted to the management tier** `⚠ SUB-SPEC` (small).
  - **Anchors:** `src/app/platform/PlatformRouter.tsx:16-28` (desktop branch passthrough L27); `src/desktop/management/ManagementGuard.tsx:17-27` (`can("management.web")` precedent); `src/app/platform/guards/WebOnlyGuard.tsx:22-58` (denial-screen precedent); `src/hooks/use-experience.ts` (`can()`); `src/lib/roles/experience-model.ts` (`management.web` grant: admin + `senior_technician`/`lead_technician` + secondary-admin).
  - **Defect:** `resolvePlatformTarget()` is role-blind; non-management roles resolve `desktop` and get a desktop-chromed **mobile-shaped** content tree (role-forked `FloorHomeSurface`), which is the reported "iPhone+iPad on web."
  - **Decisions (owner-confirmed):** threshold = **`can("management.web")`** (admin + leads), NOT literal `role==="admin"`. Behavior for non-eligible on desktop = **"use the app" denial screen** (no in-browser mobile fallback).
  - **Fix direction (surgical):** add a guard in the `PlatformRouter` **desktop branch**, mounted **inside `AuthGuard`** (role isn't known pre-auth): if `target === "desktop" && !experience.can("management.web")` → render a `WebOnlyGuard`-style dark full-screen denial ("this workspace is for management — open VetTrack on your device" + CTA). **Do NOT modify `resolvePlatformTarget()`'s synchronous/auth-independent contract.** `/board` (separate target) untouched.
  - **RED test:** `tests/web-platform-management-gate.test.tsx` — render `PlatformRouter` at `target=desktop` for a `vet_tech` (no `management.web`) → assert the denial screen, not app content; for an `admin` and a `lead` → assert normal passthrough. Fails on current code.
  - **Verify:** `pnpm test -- tests/web-platform-management-gate.test.tsx && pnpm typecheck`. Marked `⚠ SUB-SPEC` only because it touches the platform-routing seam — small, but the seam warrants its own reviewed card.

---

## 6. Phase 2 — Do-Next + native-reachable MED

### 6.1 Native MED sweep (Sonnet-executable fixes, RED-test-first)
Each traces its CLICK-PATH id; one card each, same contract as Phase 0/1 fixes.
- **R-CB-02 / R-CB-03** — Code Blue keepalive null-clear grace (CLICK-PATH-010) + quick-log rollback preserves teammates' entries (CLICK-PATH-011). `⚠ SUB-SPEC` — frozen Code Blue surface; these are the **stabilize** step gating medium-01.
- **R-SC-02** — QR camera resumes after backgrounding (CLICK-PATH-015). **R-SC-03** — failed NFC toggle clears its 8s guard (CLICK-PATH-016).
- **R-SY-02** — dismissed sync-failure banner resurfaces for new failures (CLICK-PATH-013). **R-SY-03** — SW-update "Refresh" reloads on the common path (CLICK-PATH-014, browser-verify). **R-SY-04** — equipment alias redirects ordered above `/equipment/:id` (CLICK-PATH-026).
- **R-PR-01** — profile display-name persists after save (CLICK-PATH-008): `refreshAuth()` after save / render from the invalidated `me` query.
- **R-AD-01..05** — the 5 native-reachable admin MEDs (CLICK-PATH-009 support quick-resolve, 022 settings sound-toggle await, 023 confirm-import re-import guard, 024 folder-dialog Enter guard, 025 secondary-role pending keyed by userId). Each a localized fix; **R-AD-02 (022)** must use an *observable* catch (Sentry), never an empty `catch(()=>{})`.

### 6.2 Do-Next features (all `⚠ SUB-SPEC`)
- **R-CBF-1 (medium-01 Code Blue one-tap)** — package existing frozen infra into **arm → hold-to-confirm** (~700–900ms hold, escalating haptic + filling ring, always-visible Cancel, ≥56px targets); phone initiates / iPad+board run; soft-reserve = additive custody hint (never a hard lock). Strict frozen doctrine (no new transport, no offline queueing, server-confirmed end, no emergency endpoint cached, bounded telemetry). Gated behind R-CB-01/02/03. Dedicated spec-plan required.
- **R-BDF-1 (medium-03 ambient board alerts)** — closed bounded set of anomaly rules over the existing snapshot; board-only, single-shot escalation, reduced-motion in calm mode; `/api/display/snapshot` stays cache-denylisted; anomaly types are a bounded enum on client + `server/routes/realtime.ts`. Dedicated spec-plan.
- **R-PDF-1 (massive-02 predictive readiness)** — `server/services/readiness-forecast.service.ts` (demand → supply → shortfall → surface), read-mostly over existing data, explainable (source rows per warning), conservative (precision over recall), rendered as an Analytics panel + PO recommendations. **Demand model resolved (owner): v1 = inference from historical usage (burn-rate), NO manual template authoring at launch.** Architecture requirement: put the historical-inference logic and the (future) explicit per-procedure template logic **behind a single demand-source interface**, so templates can be introduced per-procedure incrementally — once real usage data shows which procedures warrant hand-authored consumption profiles — with **no rewrite**. Burn-rate window (trailing 7/14/30d) is a spec-plan tuning detail. High effort; dedicated spec-plan.

---

## 7. Phase 3 — LOW cleanup + web-only (Sonnet-executable)
Nine LOW fixes, one card each: CLICK-PATH-027 (update-banner supersede guard), 028 (dead ScanScreen accountability banner — remove or wire), 029 (shift-chat Enter empty guard), 030 (Add Room Cancel reset), 031 (DispenseSheet Continue preserves patient), 032 (alerts pull-to-refresh awaits refetch), 033 (management-dashboard dead QrScanner — remove or wire; **web-only**), 034 (audit-log Apply commit-on-apply; **web-only**), 035 (Displays drawer derives from live data; **web-only**). Each RED-test-first where it has a runtime surface; 028/033 (dead paths) may be delete-only.

---

## 8. Phase 4 — Gated Massives (blocked; all `⚠ SUB-SPEC`)
Do not start code until the owner clears the standing blocker.
- **massive-01 passive RFID-gate tracking** — **core functionality (owner: not optional); technology LOCKED to RFID-gate** (chokepoint egress / last-seen), **not BLE/RTLS** — owner decision 2026-07-12 per `R-M1-PRE` (lowest TCO at clinic scale; `docs/business-case/2026-07-12-massive-01-passive-tracking-cost-benefit.md`). **Hardware rollout** stays gated on the manager go (owner brings the `R-M1-PRE` §6 clinic numbers). **The read path is ALREADY wired end-to-end (grounded 2026-07-12 — this CORRECTS an earlier "inert scaffolding" claim).** Working today: HMAC-auth, feature-flagged, rate-limited `POST /api/rfid/events` → `ingestRfidBatch` → the real append-only `vt_equipment_rfid_reads` table → evidence resolver → equipment-list "Last seen via RFID near {room}" subtitle + attention badge (working smoke runbook: `docs/rfid-smoke.md`). What is genuinely **inert/missing**: (1) the Command Board `rfid`/`evidenceConflict`/`rfid_reader_offline` contract (`shared/equipment-board.ts`) has **no producer** in `equipment-command-board.service.ts`; (2) reader management is **script + manual DB-flag only** (`/admin/rfid-readers` is read-only); (3) two resolvers **disagree on RFID precedence** (`equipment-location-inference.ts` = lowest-confidence vs evidence-graph `resolver/location.ts` = **outranks the authoritative room**) — a latent bug to reconcile; (4) **no gate direction** (gateway 1:1 room); (5) thin tests. **Scope LOCKED (owner 2026-07-12):**
  - **(A) Managed reader entity** — new `vt_rfid_readers` table (name, physical location, health, provisioning state) + admin **CRUD** + self-serve secret provisioning + per-clinic ingest toggle + reader-offline alerting; replaces the script/manual flow, turns the read-only console into real management.
  - **(B) True directional gates** — extend `RfidBatchSchema` + model gate **direction (entered/exited)** and room **adjacency** (net-new beyond today's 1:1 gateway→room).
  - **Plus:** fill the dead Command Board slot (producer + board UI); **reconcile the resolver-precedence conflict**; surface last-seen/direction in locate + detail; full tests.
  - **e2e acceptance bar:** a simulated **directional** reader payload drives the resolver to the correct room **and direction**, surfaced on the **board** and list; a scan-only clinic snapshot is **byte-for-byte unchanged** (golden test); cross-clinic reader IDs rejected; partial coverage degrades to last-known (no "unknown" regressions). Additive; `clinicId` on every read/write; **RFID never mutates custody** (existing non-goal preserved). Authored as the dedicated e2e SDD spec-plan **`R-M1`**.
- **massive-03 clinic network** — blocker: buyer identity (single vs multi-site) + a dedicated security design pass. Cross-tenant is the highest-risk surface; negative test (a non-group clinic can never read another's rows) is the acceptance bar.
- **medium-04 asset copilot / voice** — blocker (voice only): native shell sequencing; text copilot not blocked. Keep the mandatory citation + AI-safety validators; sequence after the data-quality wins.

---

## 9. Cross-cutting acceptance gates (every work-stream inherits)

**Interaction / mobile (HIG):** destructive/weighty actions get **Undo via the existing countdown toast**, not a blocking confirm — the only exceptions are attestations (medium-02 ack) and irreversible commits (medium-01 hold-to-start); **undo applies to all roles including students (no role carve-out)**; primary actions in the thumb arc; routine hands-full choices are bottom sheets with detents, alerts/mode-changes are centered/full-screen.

**Accessibility (WCAG 2.2 AA — pass/fail):**
- Every interactive control ≥ **44×44 CSS px** hit area (48 preferred); ≥8px spacing when either adjacent target is undersized.
- **No color-only status** (1.4.1) — every coded state ships icon/text/shape too.
- Text contrast ≥ 4.5:1 (3:1 large); non-text UI ≥ 3:1 — checked in **both** themes (badge tiers included).
- Visible focus (2.4.7/2.4.11); every sheet/modal traps focus only while open, moves focus in on open, restores to trigger on close, and is **Escape/VoiceOver-dismissible** (the regression gate for the CLICK-PATH-001/002/003/005 dead-control class — "Cancel works independent of the happy path").
- `prefers-reduced-motion` variant for every animation; `aria-live` (polite default; assertive only for Code Blue state) for content that updates without user action.
- **RTL/bidi:** logical CSS props; every embedded LTR run (device names, model numbers, dates) bidi-isolated; directional icons mirrored (regression gate for the confirmed bidi bugs).
- **i18n parity:** every new string in `he.json` + `en.json` same commit; `pnpm i18n:check` green; no hardcoded copy in `.ts/.tsx`.

**Design-fundamentals:** one dominant primary action per surface; every list/search/dashboard has designed empty + loading + error states; reuse design-system primitives (no ad-hoc badge/sheet variant); tokens only (no inline hex); a traced onClick→state→final-render path with no early-return that skips a close/reset (the audit's core defect class).

---

## 10. Execution context
- **Branch:** `claude/audit-10x-consolidated-plan` off `main`. New commits only; no amend/force-push/`--no-verify`. Commit per completed requirement.
- **Frozen surfaces (never weaken):** SSE transport + monotonic outbox cursor; no offline emergency queueing; no emergency endpoint in any cache; bounded-enum telemetry; Strategy A authority safety net; `appointmentsPage.*` / `vt_appointments` / `/api/appointments` names. Any requirement touching these is `⚠ SUB-SPEC`.
- **Proof:** before marking any requirement done, log verification evidence (the RED→GREEN test run, the command output) in `docs/audit/PROOF_ALIGNMENT_LOG.md` per that file's format.
- **Gates before merge:** `pnpm typecheck`, the requirement's test, and (for realtime/PWA/Code-Blue-adjacent work) the Playwright drills.
- **The 10x briefs** (`.claude/docs/ai/vettrack/10x/`) reach `main` via their own PR; this spec references them but does not commit them.

## 11. Owner-gated decisions & open questions

**Resolved (2026-07-12, owner) — folded into the requirements above:**
- medium-02 delta scope → **all 4 deltas + per-tech patient/animal worklist + app-observed signals + Priza integration constraint** (R-SH-F1).
- massive-02 demand model → **inference-first (burn-rate), evolving to per-procedure templates behind one interface** (R-PDF-1).
- Student undo carve-out → **no carve-out; students get undo like everyone** (§9).

**Still open / gated:**
- **massive-01** — **RFID-gate LOCKED**; scope LOCKED (owner 2026-07-12): **managed reader entity (`vt_rfid_readers` CRUD + provisioning) + true directional gates**. `R-M1-PRE` cost/benefit delivered. Grounding done — the **read path is already wired**; the e2e build = Command-Board surfacing + reader management + resolver-precedence reconciliation + directional-gate semantics + tests. Dedicated plan **`R-M1`** to be authored (scope now set). Hardware rollout still gated on the manager go.
- **massive-03** (clinic network) + **medium-04** (asset copilot/voice) — **on hold, no deadline** (owner). Blockers unchanged: buyer identity + security design pass (massive-03); native-shell sequencing for voice (medium-04).

---

## Appendix A — Finding → phase map (all 36)
- **Phase 0 (HIGH):** 001 R-CB-01 · 002 R-EQ-01 · 003 R-EQ-02 · 004 R-SC-01 · 005 R-RM-01 · 006 R-SY-01.
- **Phase 1 (MED):** 012 R-EQ-03 · 036 R-EQ-04 · 020 R-EQ-05 · 021 R-EQ-06 · 007 R-SH-01 · 017 R-SH-02 · 018 R-IN-01 · 019 R-IN-02.
- **Phase 2 (MED):** 010 R-CB-02 · 011 R-CB-03 · 015 R-SC-02 · 016 R-SC-03 · 013 R-SY-02 · 014 R-SY-03 · 026 R-SY-04 · 008 R-PR-01 · 009/022/023/024/025 R-AD-01..05.
- **Phase 3 (LOW):** 027 · 028 · 029 · 030 · 031 · 032 · 033(web-only) · 034(web-only) · 035(web-only).

## Appendix B — Feature → phase map (all 12)
- **Phase 1:** small-01 R-EQ-F1 · small-02 R-EQ-F2 · small-04 R-EQ-F3 · medium-02 R-SH-F1 · small-05 R-SH-F2 · small-03 R-IN-F1.
- **Phase 2:** medium-01 R-CBF-1 · medium-03 R-BDF-1 · massive-02 R-PDF-1.
- **Phase 4 (gated):** massive-01 · massive-03 · medium-04.

## Appendix C — Grounding status
All 6 HIGH anchors + all 12 feature reuse anchors CONFIRMED on live `main` (2026-07-12). Corrections folded in: (1) 5 of 7 "admin" findings are native-reachable → Phase 2, not deferred; (2) `/handoff` already exists → medium-02 extends it; (3) `StatusBadge` already renders icon+text → small-02 preserves + fixes its i18n leak; (4) "one tap" Code Blue → arm→hold-to-confirm; (5) web platform gating threshold = `can("management.web")`.
